import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { dateOnlyToUtc, toDateOnly, todayInTimezone } from '../../lib/time.js';

/**
 * Resolving the markup for a buyer.
 *
 * This fills in the seam `resolveMarkupBps` has occupied since Phase 4. Every
 * caller already went through that function while it simply returned the
 * partner commission rate, so adding a whole rules table changed no call site —
 * which was the point of putting a resolver there before there was anything to
 * resolve.
 *
 * A rule matches when every field it *sets* matches the request; a null field
 * means "any". The most specific match wins, and specificity is counted rather
 * than ordered by hand, so adding a dimension later does not reshuffle the
 * existing precedence.
 *
 * Dimensions, from the widest to the narrowest: a product type ("every tour"),
 * a destination, a named product (a hotel, a tour, a service or a package),
 * and the buyer. The weights are powers of two so a partner rule always beats
 * a platform rule however many product dimensions the platform rule pins
 * down, and a named product always beats its type — the same relative order
 * the original three dimensions had, scaled by two.
 */

/** How many dimensions a rule pins down. Higher is more specific. */
const specificity = (rule) =>
    (rule.partnerId ? 8 : 0) +
    (rule.hotelId || rule.tourId || rule.serviceId || rule.packageId ? 4 : 0) +
    (rule.destinationId ? 2 : 0) +
    (rule.productType ? 1 : 0);

/** The product type a request is for, inferred from what it names. */
const productTypeOf = ({ productType, hotel, tour, service, pkg }) =>
    productType ?? (hotel ? 'HOTEL' : tour ? 'TOUR' : service ? 'SERVICE' : pkg ? 'PACKAGE' : null);

/** Either the column is null, or it names this id. */
const anyOr = (column, id) => ({ OR: [{ [column]: null }, ...(id ? [{ [column]: id }] : [])] });

/**
 * The markup for one buyer at one product.
 *
 * Falls back through: a matching rule, then the partner's own commission rate,
 * then the platform default. The commission rate stays in the chain because it
 * is what every existing partner already has, and pulling it out would silently
 * reprice them the day this shipped.
 *
 * `destinationId` and `timezone` may be given instead of a hotel, which is how
 * transfers reach the same rules: a journey has no property, but it does start
 * somewhere, and a rule scoped to a destination should price the drive to it as
 * well as the bed at the end of it. A hotel supplies both implicitly, so
 * existing callers are unchanged. Tours, services and packages pass their own
 * record, and `productType` may be given on its own for a rule such as "all
 * tours get 12%".
 */
export const resolveMarkup = async ({
    partner,
    hotel,
    tour,
    service,
    package: pkg,
    productType,
    destinationId,
    timezone,
    date
} = {}) => {
    // Only an approved partner buys at its negotiated terms. One still waiting
    // for approval, or one that has been suspended or rejected, is priced as
    // the public would be: its session may be live, but its agreement is not.
    // A bare `{ id }` built without the relation (tests, system callers) is
    // taken at its word, the same rule `isTrade` applies.
    const buyer = partner && (partner.status === undefined || partner.status === 'APPROVED') ? partner : null;
    const named = hotel ?? tour ?? service ?? pkg ?? null;
    const scopeDestinationId = destinationId ?? named?.destinationId ?? null;
    const type = productTypeOf({ productType, hotel, tour, service, pkg });
    const on = date ?? todayInTimezone(timezone ?? named?.timezone ?? 'Asia/Tbilisi');

    const candidates = await prisma.pricingRule.findMany({
        where: {
            isActive: true,
            // A rule that names a partner applies only to that partner; a rule
            // that names none applies to everyone including anonymous guests.
            OR: [{ partnerId: null }, ...(buyer?.id ? [{ partnerId: buyer.id }] : [])],
            AND: [
                anyOr('hotelId', hotel?.id),
                anyOr('tourId', tour?.id),
                anyOr('serviceId', service?.id),
                anyOr('packageId', pkg?.id),
                anyOr('destinationId', scopeDestinationId),
                anyOr('productType', type),
                { OR: [{ validFrom: null }, { validFrom: { lte: dateOnlyToUtc(on) } }] },
                { OR: [{ validUntil: null }, { validUntil: { gte: dateOnlyToUtc(on) } }] }
            ]
        }
    });

    if (candidates.length > 0) {
        const [best] = candidates.sort(
            (a, b) => specificity(b) - specificity(a) || b.priority - a.priority
        );

        return { markupBps: best.markupBps, source: 'RULE', ruleId: best.id, label: best.label ?? null };
    }

    if (buyer?.commissionRateBps != null) {
        return { markupBps: buyer.commissionRateBps, source: 'PARTNER_COMMISSION' };
    }

    const platformDefault =
        type === 'TOUR'
            ? config.tour.defaultMarkupBps
            : type === 'SERVICE'
              ? config.service.defaultMarkupBps
              : type === 'TRANSFER'
                ? config.transfer.defaultMarkupBps
                : config.hotel.defaultMarkupBps;

    return { markupBps: platformDefault, source: 'PLATFORM_DEFAULT' };
};

const ruleInclude = {
    partner: { select: { id: true, reference: true, name: true } },
    hotel: { select: { id: true, name: true, slug: true } },
    destination: { select: { id: true, name: true, slug: true } },
    tour: { select: { id: true, title: true, slug: true } },
    service: { select: { id: true, name: true, slug: true } },
    package: { select: { id: true, name: true, slug: true } }
};

export const listPricingRules = ({
    partnerId,
    hotelId,
    tourId,
    serviceId,
    packageId,
    productType,
    includeInactive
} = {}) =>
    prisma.pricingRule.findMany({
        where: {
            ...(includeInactive ? {} : { isActive: true }),
            ...(partnerId ? { partnerId } : {}),
            ...(hotelId ? { hotelId } : {}),
            ...(tourId ? { tourId } : {}),
            ...(serviceId ? { serviceId } : {}),
            ...(packageId ? { packageId } : {}),
            ...(productType ? { productType } : {})
        },
        include: ruleInclude,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
    });

const NAMED = ['hotelId', 'tourId', 'serviceId', 'packageId'];

const toData = (input) => ({
    partnerId: input.partnerId ?? null,
    hotelId: input.hotelId ?? null,
    tourId: input.tourId ?? null,
    serviceId: input.serviceId ?? null,
    packageId: input.packageId ?? null,
    productType: input.productType ?? null,
    destinationId: input.destinationId ?? null,
    markupBps: input.markupBps,
    label: input.label ?? null,
    priority: input.priority ?? 0,
    isActive: input.isActive ?? true,
    validFrom: input.validFrom ? dateOnlyToUtc(input.validFrom) : null,
    validUntil: input.validUntil ? dateOnlyToUtc(input.validUntil) : null
});

/** The type a named product implies; a rule may not contradict it. */
const impliedType = (data) =>
    data.hotelId ? 'HOTEL' : data.tourId ? 'TOUR' : data.serviceId ? 'SERVICE' : data.packageId ? 'PACKAGE' : null;

export const upsertPricingRule = async (ruleId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        if (ruleId) {
            const current = await tx.pricingRule.findUnique({ where: { id: ruleId } });

            if (!current) {
                throw new NotFoundError('Pricing rule not found');
            }
        }

        const data = toData(input);
        const named = NAMED.filter((key) => data[key]);

        // The database CHECK says the same thing; saying it here names the
        // fields instead of answering with a bare 409.
        if (named.length > 1) {
            throw new UnprocessableEntityError('A rule may name at most one product', { named });
        }

        const implied = impliedType(data);

        if (implied && data.productType && data.productType !== implied) {
            throw new UnprocessableEntityError('The product type contradicts the product named', {
                productType: data.productType,
                implied
            });
        }

        const rule = ruleId
            ? await tx.pricingRule.update({ where: { id: ruleId }, data })
            : await tx.pricingRule.create({ data });

        await recordAudit(tx, {
            action: ruleId ? 'PRICING_RULE_UPDATED' : 'PRICING_RULE_CREATED',
            actor,
            entityType: AUDIT_ENTITY.pricingRule,
            entityId: rule.id,
            summary: `${ruleId ? 'Updated' : 'Created'} pricing rule at ${rule.markupBps} bps`,
            metadata: {
                partnerId: rule.partnerId,
                hotelId: rule.hotelId,
                tourId: rule.tourId,
                serviceId: rule.serviceId,
                packageId: rule.packageId,
                productType: rule.productType,
                destinationId: rule.destinationId,
                markupBps: rule.markupBps,
                validFrom: rule.validFrom ? toDateOnly(rule.validFrom) : null,
                validUntil: rule.validUntil ? toDateOnly(rule.validUntil) : null
            },
            req
        });

        return rule;
    });

export const deletePricingRule = async (ruleId, actor, req) =>
    prisma.$transaction(async (tx) => {
        const rule = await tx.pricingRule.findUnique({ where: { id: ruleId } });

        if (!rule) {
            throw new NotFoundError('Pricing rule not found');
        }

        await tx.pricingRule.delete({ where: { id: ruleId } });

        await recordAudit(tx, {
            action: 'PRICING_RULE_DELETED',
            actor,
            entityType: AUDIT_ENTITY.pricingRule,
            entityId: ruleId,
            summary: `Deleted pricing rule at ${rule.markupBps} bps`,
            metadata: { partnerId: rule.partnerId, hotelId: rule.hotelId, tourId: rule.tourId },
            req
        });

        return rule;
    });

/**
 * Explains which markup a buyer would get, and why.
 *
 * Exists because "why is this partner seeing that price" is the commonest
 * question about a B2B platform, and answering it by reading code is a bad way
 * to spend an afternoon. Takes any one product, or just a type.
 */
export const explainMarkup = async ({ partnerId, hotelId, tourId, serviceId, packageId, productType, date }) => {
    const [partner, hotel, tour, service, pkg] = await Promise.all([
        partnerId ? prisma.partner.findUnique({ where: { id: partnerId } }) : null,
        hotelId ? prisma.hotel.findUnique({ where: { id: hotelId } }) : null,
        tourId ? prisma.tour.findUnique({ where: { id: tourId } }) : null,
        serviceId ? prisma.service.findUnique({ where: { id: serviceId } }) : null,
        packageId ? prisma.package.findUnique({ where: { id: packageId } }) : null
    ]);

    if (hotelId && !hotel) {
        throw new NotFoundError('Hotel not found');
    }

    if (tourId && !tour) {
        throw new NotFoundError('Tour not found');
    }

    if (serviceId && !service) {
        throw new NotFoundError('Service not found');
    }

    if (packageId && !pkg) {
        throw new NotFoundError('Package not found');
    }

    if (partnerId && !partner) {
        throw new NotFoundError('Partner not found');
    }

    return resolveMarkup({ partner, hotel, tour, service, package: pkg, productType, date });
};
