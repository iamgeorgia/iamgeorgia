import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { dateOnlyToUtc } from '../../lib/time.js';
import { findUsablePolicy } from '../hotel/policyCatalog.service.js';
import { resolveAssignablePolicy } from '../payments/payment-policies.service.js';
import { lowestAdultSellCents } from './pricing.service.js';

/**
 * Tour options and their price sheets.
 *
 * An option is the sellable variant — the RatePlan of tours — and a season is
 * its price sheet over a date window. Everything is scoped tour -> option ->
 * season, so an id from one tour can never be reached through another's URL.
 */

export const optionInclude = {
    cancellationPolicy: { include: { rules: { orderBy: { hoursBeforeCheckIn: 'desc' } } } },
    paymentPolicy: true,
    seasons: {
        orderBy: [{ validFrom: 'asc' }, { priority: 'desc' }],
        include: { tiers: { orderBy: { minPax: 'asc' } } }
    }
};

/** The bases a tour can be cancelled on: a tour has no nights to charge for. */
const TOUR_CHARGE_BASES = ['PERCENT_OF_TOTAL', 'FIXED_AMOUNT'];

const assertTour = async (client, tourId) => {
    const tour = await client.tour.findUnique({
        where: { id: tourId },
        select: { id: true, title: true, status: true, currency: true, timezone: true }
    });

    if (!tour) {
        throw new NotFoundError('Tour not found');
    }

    if (tour.status === 'ARCHIVED') {
        throw new ConflictError('An archived tour cannot be edited', { status: tour.status });
    }

    return tour;
};

export const findTourOptionOr404 = async (tourId, optionId) => {
    const option = await prisma.tourOption.findFirst({
        where: { id: optionId, tourId },
        include: optionInclude
    });

    if (!option) {
        throw new NotFoundError('Tour option not found');
    }

    return option;
};

export const listTourOptions = async (tourId, { status, includePartnerOnly } = {}) => {
    const tour = await prisma.tour.findUnique({ where: { id: tourId }, select: { id: true } });

    if (!tour) {
        throw new NotFoundError('Tour not found');
    }

    return prisma.tourOption.findMany({
        where: {
            tourId,
            ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
            ...(includePartnerOnly ? {} : { visibility: 'PUBLIC' })
        },
        include: optionInclude,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    });
};

/**
 * Checks the cancellation policy is one a tour may use — a platform template,
 * since tours own none of their own yet — and that its tiers make sense for
 * something charged whole rather than per night.
 */
const resolveCancellationPolicy = async (tx, policyId) => {
    const policy = await findUsablePolicy(tx, 'cancellationPolicy', null, policyId);
    const rules = await tx.cancellationRule.findMany({ where: { policyId } });

    const bad = rules.find((rule) => !TOUR_CHARGE_BASES.includes(rule.chargeBasis));

    if (bad) {
        throw new BadRequestError('A tour cannot be cancelled on a per-night basis', {
            field: 'cancellationPolicyId',
            chargeBasis: bad.chargeBasis,
            allowed: TOUR_CHARGE_BASES
        });
    }

    return policy;
};

/** SHARED sells seats, PRIVATE sells the departure; the unit follows unless said otherwise. */
const defaultUnitKind = (kind) => (kind === 'PRIVATE' ? 'GROUP' : 'SEAT');

export const createTourOption = async (tourId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await assertTour(tx, tourId);

        await resolveCancellationPolicy(tx, input.cancellationPolicyId);
        await resolveAssignablePolicy(tx, input.paymentPolicyId, { productKind: 'TOUR', tourId });

        const existing = await tx.tourOption.count({ where: { tourId } });

        const option = await tx.tourOption.create({
            data: {
                ...input,
                unitKind: input.unitKind ?? defaultUnitKind(input.kind),
                sortOrder: input.sortOrder ?? existing,
                tourId
            },
            include: optionInclude
        });

        await recordAudit(tx, {
            action: 'TOUR_OPTION_CREATED',
            actor,
            entityType: AUDIT_ENTITY.tourOption,
            entityId: option.id,
            summary: `Added option ${option.name} to ${tour.title}`,
            metadata: { tourId, code: option.code, kind: option.kind, pricingBasis: option.pricingBasis },
            req
        });

        return option;
    });

export const updateTourOption = async (tourId, optionId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await assertTour(tx, tourId);
        const current = await tx.tourOption.findFirst({ where: { id: optionId, tourId } });

        if (!current) {
            throw new NotFoundError('Tour option not found');
        }

        if (current.status === 'ARCHIVED') {
            throw new ConflictError('An archived option cannot be edited', { status: current.status });
        }

        if (input.cancellationPolicyId) {
            await resolveCancellationPolicy(tx, input.cancellationPolicyId);
        }

        if (input.paymentPolicyId !== undefined) {
            await resolveAssignablePolicy(tx, input.paymentPolicyId, { productKind: 'TOUR', tourId });
        }

        // A change of kind without an explicit unit follows the kind, so a
        // private option does not keep counting seats by accident.
        const unitKind =
            input.unitKind ?? (input.kind && input.kind !== current.kind ? defaultUnitKind(input.kind) : undefined);

        const option = await tx.tourOption.update({
            where: { id: optionId },
            data: { ...input, ...(unitKind ? { unitKind } : {}) },
            include: optionInclude
        });

        await recordAudit(tx, {
            action: 'TOUR_OPTION_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.tourOption,
            entityId: optionId,
            summary: `Updated option ${option.name} on ${tour.title}`,
            metadata: { tourId, fields: Object.keys(input) },
            req
        });

        await refreshTourPriceFrom(tx, tourId);

        return option;
    });

/** Off sale for good. Holds and bookings against it survive; nothing new is written. */
export const archiveTourOption = async (tourId, optionId, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await assertTour(tx, tourId);
        const current = await tx.tourOption.findFirst({ where: { id: optionId, tourId } });

        if (!current) {
            throw new NotFoundError('Tour option not found');
        }

        if (current.status === 'ARCHIVED') {
            throw new ConflictError('That option is already archived', { status: current.status });
        }

        const option = await tx.tourOption.update({
            where: { id: optionId },
            data: { status: 'ARCHIVED' },
            include: optionInclude
        });

        await recordAudit(tx, {
            action: 'TOUR_OPTION_ARCHIVED',
            actor,
            entityType: AUDIT_ENTITY.tourOption,
            entityId: optionId,
            summary: `Archived option ${option.name} on ${tour.title}`,
            metadata: { tourId },
            req
        });

        await refreshTourPriceFrom(tx, tourId);

        return option;
    });

/**
 * A season is written whole, tiers included: a price sheet only means
 * anything as a set, and patching one tier of it is how a sheet ends up with
 * a gap nobody can see.
 */
const assertTiersPriceable = (option, tiers) => {
    for (const tier of tiers) {
        const priced =
            option.pricingBasis === 'PER_GROUP'
                ? tier.groupNetCents !== null && tier.groupNetCents !== undefined
                : tier.adultNetCents !== null && tier.adultNetCents !== undefined;

        if (!priced) {
            throw new BadRequestError(
                option.pricingBasis === 'PER_GROUP'
                    ? 'Every tier of a per-group option needs a group price'
                    : 'Every tier of a per-person option needs an adult price',
                { field: 'tiers', minPax: tier.minPax, pricingBasis: option.pricingBasis }
            );
        }
    }
};

export const upsertTourSeason = async (tourId, optionId, seasonId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await assertTour(tx, tourId);
        const option = await tx.tourOption.findFirst({ where: { id: optionId, tourId } });

        if (!option) {
            throw new NotFoundError('Tour option not found');
        }

        const currency = input.currency ?? tour.currency;

        // One currency per tour, so a package built from it never has to
        // convert. A sheet in another currency is refused, not converted.
        if (currency !== tour.currency) {
            throw new BadRequestError('A season must be priced in the tour currency', {
                field: 'currency',
                tourCurrency: tour.currency
            });
        }

        assertTiersPriceable(option, input.tiers);

        const { tiers, ...fields } = input;
        const data = {
            ...fields,
            currency,
            validFrom: dateOnlyToUtc(input.validFrom),
            validUntil: dateOnlyToUtc(input.validUntil)
        };

        let season;

        if (seasonId) {
            const current = await tx.tourSeason.findFirst({ where: { id: seasonId, tourOptionId: optionId } });

            if (!current) {
                throw new NotFoundError('Season not found');
            }

            await tx.tourSeasonTier.deleteMany({ where: { seasonId } });
            season = await tx.tourSeason.update({
                where: { id: seasonId },
                data: { ...data, tiers: { create: tiers } },
                include: { tiers: { orderBy: { minPax: 'asc' } } }
            });
        } else {
            season = await tx.tourSeason.create({
                data: { ...data, tourOptionId: optionId, tiers: { create: tiers } },
                include: { tiers: { orderBy: { minPax: 'asc' } } }
            });
        }

        await recordAudit(tx, {
            action: 'TOUR_SEASON_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.tourSeason,
            entityId: season.id,
            summary: `${seasonId ? 'Updated' : 'Added'} season ${season.name} on ${tour.title} / ${option.name}`,
            metadata: { tourId, optionId, validFrom: input.validFrom, validUntil: input.validUntil, tiers: tiers.length },
            req
        });

        await refreshTourPriceFrom(tx, tourId);

        return season;
    });

export const deleteTourSeason = async (tourId, optionId, seasonId, actor, req) =>
    prisma.$transaction(async (tx) => {
        const tour = await assertTour(tx, tourId);
        const season = await tx.tourSeason.findFirst({
            where: { id: seasonId, tourOptionId: optionId, tourOption: { tourId } }
        });

        if (!season) {
            throw new NotFoundError('Season not found');
        }

        await tx.tourSeason.delete({ where: { id: seasonId } });

        await recordAudit(tx, {
            action: 'TOUR_SEASON_DELETED',
            actor,
            entityType: AUDIT_ENTITY.tourSeason,
            entityId: seasonId,
            summary: `Deleted season ${season.name} on ${tour.title}`,
            metadata: { tourId, optionId },
            req
        });

        await refreshTourPriceFrom(tx, tourId);

        return season;
    });

/**
 * Refreshes the tour's "from" price from its live price sheets.
 *
 * Indicative only — marked up at the platform default because a browse page
 * has no buyer — and never used to quote or to book.
 */
export const refreshTourPriceFrom = async (tx, tourId) => {
    const options = await tx.tourOption.findMany({
        where: { tourId },
        include: { seasons: { include: { tiers: true } } }
    });

    const lowest = lowestAdultSellCents(options, config.tour.defaultMarkupBps);

    await tx.tour.update({ where: { id: tourId }, data: { priceFromCents: lowest ?? 0 } });

    return lowest;
};
