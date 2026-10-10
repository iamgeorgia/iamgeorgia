import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { ConflictError, HttpError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { addDays, nightsBetween, todayInTimezone, zonedTimeToInstant } from '../../lib/time.js';
import { issuePackageOfferToken, readPackageOfferToken } from '../../lib/package/offerToken.js';
import { readOfferToken } from '../../lib/hotel/offerToken.js';
import { readQuoteToken } from '../../lib/transfer/quoteToken.js';
import { readTourOfferToken } from '../../lib/tour/offerToken.js';
import { hotelAvailability, searchHotels } from '../hotel/search.service.js';
import { resolveMarkup } from '../hotel/pricingRule.service.js';
import { quotesForJourney } from '../transfer/quote.service.js';
import { tourAvailability } from '../tour/search.service.js';
import { quoteService } from '../service/pricing.service.js';
import { serviceInclude } from '../service/service.service.js';
import { findPackageOr404 } from './package.service.js';
import { kosherHotelInclude, validateKosherQuote } from './kosherEligibility.service.js';
import { isTrade } from '../../middleware/auth.js';
import { accessWhere } from '../partner/access.service.js';

/**
 * Quoting a package: every slot resolved through the product's own engine.
 *
 * Nothing here prices anything. A hotel slot asks `hotelAvailability`, a
 * transfer slot asks `quotesForJourney`, a tour slot asks `tourAvailability`,
 * a service slot asks `quoteService` — the same functions the standalone
 * pages call, with the same viewer, so a partner's negotiated hotel rate
 * applies inside a package automatically and a price shown here is a price
 * the standalone checkout would also show. What this file adds is the
 * arithmetic on top: which offer fills each slot, the package adjustment, and
 * its allocation across the items so the lines sum to the total exactly.
 *
 * A slot that cannot be filled is not an error. A required one makes the
 * package unavailable for these dates; an optional one is returned excluded
 * with its reason, so a listing can say "not on these dates" without a 500.
 */

const MAX_ALTERNATIVES = 6;

const reasonOf = (error) => {
    if (error instanceof HttpError) {
        return error.details?.reason ?? (error instanceof NotFoundError ? 'UNAVAILABLE' : error.status === 400 ? 'OUT_OF_WINDOW' : 'UNAVAILABLE');
    }

    throw error;
};

/** Largest-remainder allocation: `total` split by `weights`, summing exactly. */
export const allocate = (total, weights) => {
    const sum = weights.reduce((acc, weight) => acc + weight, 0);

    if (sum === 0 || weights.length === 0) {
        // Nothing to weight by: the first item carries it whole.
        return weights.map((_, index) => (index === 0 ? total : 0));
    }

    const raw = weights.map((weight) => (total * weight) / sum);
    const floors = raw.map((value) => (total >= 0 ? Math.floor(value) : Math.ceil(value)));
    let remainder = total - floors.reduce((acc, value) => acc + value, 0);
    const order = raw
        .map((value, index) => ({ index, frac: Math.abs(value - floors[index]) }))
        .sort((a, b) => b.frac - a.frac);

    for (const { index } of order) {
        if (remainder === 0) break;
        const step = remainder > 0 ? 1 : -1;
        floors[index] += step;
        remainder -= step;
    }

    return floors;
};

/** The package adjustment against the eligible items' sell total. */
export const computeAdjustment = (pkg, party, eligibleSellCents) => {
    switch (pkg.adjustmentKind) {
        case 'DISCOUNT_BPS':
            return -Math.round((eligibleSellCents * pkg.adjustmentValue) / 10_000);
        case 'FIXED_SELL':
            return pkg.adjustmentValue - eligibleSellCents;
        case 'PER_PERSON_FIXED':
            return pkg.adjustmentValue * (party.adults + party.children) - eligibleSellCents;
        case 'NONE':
        default:
            return 0;
    }
};

// --- slot resolvers ----------------------------------------------------------

const hotelOffers = (availability) => availability.roomTypes.flatMap((entry) => entry.offers);

const describeHotelOffer = (offer, hotel) => ({
    hotelId: hotel.id,
    hotelName: hotel.name,
    roomTypeId: offer.roomType.id,
    roomTypeName: offer.roomType.name,
    ratePlanId: offer.ratePlan.id,
    ratePlanName: offer.ratePlan.name,
    mealPlanCode: offer.ratePlan.mealPlan?.code ?? null,
    // Both names carry the payable figure. A buyer comparing alternatives is
    // comparing what each would cost them, and an alternative priced ex-tax
    // beside a chosen slot priced inc-tax is a lie of about eighteen per cent.
    sellCents: offer.quote.totals.totalCents,
    totalCents: offer.quote.totals.totalCents,
    token: offer.token
});

const resolveHotelSlot = async ({ pkg, component, startDate, party, rooms, choice, locale, viewer }) => {
    const checkIn = addDays(startDate, component.dayOffset);
    const checkOut = addDays(checkIn, component.nights);
    const profile = pkg.kosher;
    const stay = { checkIn, checkOut, adults: party.adults, childAges: party.childAges, rooms, locale };

    let hotelIds;

    if (component.hotelId) {
        hotelIds = [component.hotelId];
    } else {
        // Any property at the destination that meets the slot's constraints
        // and, for a kosher package, its declared minimums. The candidate
        // query does the narrowing so five hotels are priced, not fifty.
        const { hotels: found } = await searchHotels(
            {
                ...stay,
                destinationPath: pkg.destination.path,
                mealPlan: component.allowedMealPlanCodes.length > 0 ? component.allowedMealPlanCodes : undefined,
                ...(profile
                    ? {
                          kosher: component.kosherMinServiceLevel ?? profile.minServiceLevel,
                          kosherCertified: component.kosherCertifiedRequired ?? profile.certifiedRequired
                      }
                    : {}),
                page: 1,
                pageSize: config.package.maxCandidates
            },
            viewer
        );

        hotelIds = found.map((result) => result.hotel.id);

        if (choice?.hotelId && !hotelIds.includes(choice.hotelId)) {
            hotelIds.unshift(choice.hotelId);
        }
    }

    const candidates = [];
    let reason = 'UNAVAILABLE';

    for (const hotelId of hotelIds) {
        try {
            const availability = await hotelAvailability(hotelId, stay, viewer);
            const hotel = hotelOffers(availability)[0]?.hotel;

            for (const offer of hotelOffers(availability)) {
                if (component.allowedRoomTypeIds.length > 0 && !component.allowedRoomTypeIds.includes(offer.roomType.id)) continue;
                if (component.allowedRatePlanIds.length > 0 && !component.allowedRatePlanIds.includes(offer.ratePlan.id)) continue;
                const meal = offer.ratePlan.mealPlan?.code ?? null;
                if (component.allowedMealPlanCodes.length > 0 && !component.allowedMealPlanCodes.includes(meal)) continue;
                if (profile?.requiredMealPlanCodes?.length > 0 && !profile.requiredMealPlanCodes.includes(meal)) continue;
                if (offer.quote.currency !== pkg.currency) continue;

                candidates.push({ hotel, offer });
            }
        } catch (error) {
            reason = reasonOf(error);
        }
    }

    if (candidates.length === 0) {
        return { resolved: null, reason, alternatives: [] };
    }

    // Cheapest to the buyer, which for a hotel means after its taxes: two
    // rate plans can carry different tax treatment, so the cheaper room is not
    // always the cheaper stay.
    candidates.sort((a, b) => a.offer.quote.totals.totalCents - b.offer.quote.totals.totalCents);

    const chosen =
        (choice?.ratePlanId && candidates.find((candidate) => candidate.offer.ratePlan.id === choice.ratePlanId)) ||
        (choice?.hotelId && candidates.find((candidate) => candidate.hotel.id === choice.hotelId)) ||
        candidates[0];

    // The full hotel, with its kosher profile, for the eligibility rules.
    const hotel = await prisma.hotel.findUnique({ where: { id: chosen.hotel.id }, include: kosherHotelInclude });

    return {
        resolved: {
            componentType: 'HOTEL_STAY',
            component,
            hotel,
            hotelSummary: { id: hotel.id, slug: hotel.slug, name: hotel.name },
            roomType: { id: chosen.offer.roomType.id, name: chosen.offer.roomType.name },
            ratePlan: {
                id: chosen.offer.ratePlan.id,
                name: chosen.offer.ratePlan.name,
                mealPlanCode: chosen.offer.ratePlan.mealPlan?.code ?? null,
                mealPlanName: chosen.offer.ratePlan.mealPlan?.name ?? null
            },
            checkIn,
            checkOut,
            nights: component.nights,
            rooms,
            token: chosen.offer.token,
            netCents: chosen.offer.quote.totals.netCents,
            // The room plus its included taxes: what `prepareHotelBooking`
            // compares at confirmation, so the quote and the order agree.
            // `payableAtPropertyCents` is settled at the desk and stays out.
            sellCents: chosen.offer.quote.totals.totalCents,
            payableAtPropertyCents: chosen.offer.quote.totals.payableAtPropertyCents ?? 0,
            offer: chosen.offer
        },
        reason: null,
        alternatives: candidates
            .filter((candidate) => candidate.offer.token !== chosen.offer.token)
            .slice(0, MAX_ALTERNATIVES)
            .map((candidate) => describeHotelOffer(candidate.offer, candidate.hotel))
    };
};

const resolveTransferSlot = async ({ pkg, component, startDate, endDate, party, choice, locale, viewer }) => {
    const fromId = component.route?.fromPointId ?? component.fromPointId;
    const toId = component.route?.toPointId ?? component.toPointId;
    const date = addDays(startDate, component.dayOffset);
    const time = component.timeOfDay ?? '10:00';
    const tripType = component.tripType ?? 'ONE_WAY';

    let result;

    try {
        result = await quotesForJourney(
            {
                from: fromId,
                to: toId,
                date,
                time,
                tripType,
                returnDate: tripType === 'RETURN' ? endDate : undefined,
                returnTime: tripType === 'RETURN' ? time : undefined,
                adults: party.adults,
                children: party.children,
                childAges: party.childAges,
                luggage: party.adults,
                cabinBags: 0,
                extras: [],
                locale
            },
            viewer
        );
    } catch (error) {
        return { resolved: null, reason: reasonOf(error), alternatives: [] };
    }

    const offers = result.offers.filter(
        (offer) =>
            (component.allowedVehicleClasses.length === 0 || component.allowedVehicleClasses.includes(offer.vehicle.vehicleClass)) &&
            offer.quote.currency === pkg.currency
    );

    if (offers.length === 0) {
        return { resolved: null, reason: result.closed ? 'ROUTE_CLOSED' : 'UNAVAILABLE', alternatives: [] };
    }

    offers.sort((a, b) => a.quote.totals.totalCents - b.quote.totals.totalCents);

    const chosen = (choice?.vehicleId && offers.find((offer) => offer.vehicle.id === choice.vehicleId)) || offers[0];
    const describe = (offer) => ({
        vehicleId: offer.vehicle.id,
        vehicleName: offer.vehicle.name,
        vehicleClass: offer.vehicle.vehicleClass,
        sellCents: offer.quote.totals.totalCents,
        token: offer.token
    });

    return {
        resolved: {
            componentType: 'TRANSFER',
            component,
            vehicle: { id: chosen.vehicle.id, slug: chosen.vehicle.slug, name: chosen.vehicle.name, vehicleClass: chosen.vehicle.vehicleClass },
            from: { id: result.from.id, name: result.from.name },
            to: { id: result.to.id, name: result.to.name },
            tripType,
            legs: chosen.quote.legs.map((leg) => ({
                direction: leg.direction,
                pickupAt: leg.pickupAt,
                fromPointName: leg.fromPointName,
                toPointName: leg.toPointName
            })),
            token: chosen.token,
            netCents: chosen.quote.totals.netCents,
            sellCents: chosen.quote.totals.totalCents,
            offer: chosen
        },
        reason: null,
        alternatives: offers.filter((offer) => offer.token !== chosen.token).slice(0, MAX_ALTERNATIVES).map(describe)
    };
};

const resolveTourSlot = async ({ pkg, component, startDate, party, choice, locale, viewer }) => {
    const date = addDays(startDate, component.dayOffset);

    let availability;

    try {
        availability = await tourAvailability(component.tourId, { date, adults: party.adults, childAges: party.childAges, locale }, viewer);
    } catch (error) {
        return { resolved: null, reason: reasonOf(error), alternatives: [] };
    }

    const all = availability.options
        .filter((entry) => component.allowedTourOptionIds.length === 0 || component.allowedTourOptionIds.includes(entry.option.id))
        .flatMap((entry) => entry.dates.map((offer) => ({ option: entry.option, offer })));
    const sellable = all.filter(({ offer }) => offer.available && offer.quote.currency === pkg.currency);

    if (sellable.length === 0) {
        return { resolved: null, reason: all[0]?.offer?.reason ?? 'UNAVAILABLE', alternatives: [] };
    }

    sellable.sort((a, b) => a.offer.quote.totals.totalCents - b.offer.quote.totals.totalCents);

    const chosen = (choice?.tourOptionId && sellable.find(({ option }) => option.id === choice.tourOptionId)) || sellable[0];
    const describe = ({ option, offer }) => ({
        tourOptionId: option.id,
        optionName: option.name,
        kind: option.kind,
        confirmationMode: option.confirmationMode,
        sellCents: offer.quote.totals.totalCents,
        token: offer.token
    });

    return {
        resolved: {
            componentType: 'TOUR',
            component,
            tour: { id: availability.tour.id, slug: availability.tour.slug, title: availability.tour.title },
            option: {
                id: chosen.option.id,
                code: chosen.option.code,
                name: chosen.option.name,
                kind: chosen.option.kind,
                confirmationMode: chosen.option.confirmationMode
            },
            date,
            endDate: chosen.offer.endDate,
            departureTime: chosen.offer.departureTime ?? null,
            tourKosher: component.tour?.kosher ?? null,
            token: chosen.offer.token,
            netCents: chosen.offer.quote.totals.netCents,
            sellCents: chosen.offer.quote.totals.totalCents,
            offer: chosen.offer
        },
        reason: null,
        alternatives: sellable.filter((entry) => entry.offer.token !== chosen.offer.token).slice(0, MAX_ALTERNATIVES).map(describe)
    };
};

const usesDays = (basis) => basis === 'PER_DAY' || basis === 'PER_PERSON_PER_DAY';

const resolveServiceSlot = async ({ pkg, component, startDate, party, rooms, viewer, now }) => {
    const service = await prisma.service.findFirst({
        where: { id: component.serviceId, status: 'ACTIVE', ...(isTrade(viewer) ? {} : { b2cEnabled: true }) },
        include: serviceInclude()
    });

    if (!service || service.currency !== pkg.currency) {
        return { resolved: null, reason: 'UNAVAILABLE', alternatives: [] };
    }

    const date = addDays(startDate, component.dayOffset);
    const time = component.timeOfDay ?? '09:00';
    const startAt = zonedTimeToInstant(date, time, service.timezone);

    if (startAt.getTime() - now.getTime() < service.noticeHours * 3_600_000) {
        return { resolved: null, reason: 'TOO_SOON', alternatives: [] };
    }

    const pax = party.adults + party.children;
    const quantity = component.quantityRule === 'PER_PERSON' ? pax : component.quantityRule === 'PER_ROOM' ? rooms : 1;
    const days = usesDays(service.basis) ? Math.max(1, pkg.nights) : 1;

    if (quantity < service.minQuantity || (service.maxQuantity !== null && quantity > service.maxQuantity)) {
        return { resolved: null, reason: 'QUANTITY', alternatives: [] };
    }

    const { markupBps } = await resolveMarkup({
        partner: viewer?.partner ?? (viewer?.partnerId ? { id: viewer.partnerId } : null),
        service,
        date
    });
    const quote = quoteService({ service, quantity, pax, days, markupBps });

    return {
        resolved: {
            componentType: 'SERVICE',
            component,
            service: { id: service.id, slug: service.slug, name: service.name, category: service.category, confirmationMode: service.confirmationMode },
            date,
            endDate: addDays(date, days - 1),
            time,
            quantity,
            pax,
            days,
            token: null,
            // What the package token carries for a service instead of a child token.
            serviceFields: { serviceId: service.id, date, time, days, quantity, pax },
            netCents: quote.totals.netCents,
            sellCents: quote.totals.totalCents,
            quote
        },
        reason: null,
        alternatives: []
    };
};

const RESOLVERS = {
    HOTEL_STAY: resolveHotelSlot,
    TRANSFER: resolveTransferSlot,
    TOUR: resolveTourSlot,
    SERVICE: resolveServiceSlot
};

// --- the quote ---------------------------------------------------------------

const assertSellable = (pkg, { startDate, adults, childAges, today }) => {
    const on = (value) => (value ? value.toISOString().slice(0, 10) : null);

    if ((pkg.sellableFrom && on(pkg.sellableFrom) > today) || (pkg.sellableUntil && on(pkg.sellableUntil) < today)) {
        throw new ConflictError('This package is not on sale today', { reason: 'NOT_ON_SALE' });
    }

    if ((pkg.validFrom && on(pkg.validFrom) > startDate) || (pkg.validUntil && on(pkg.validUntil) < startDate)) {
        throw new UnprocessableEntityError('This package does not travel on those dates', {
            reason: 'OUTSIDE_TRAVEL_WINDOW',
            validFrom: on(pkg.validFrom),
            validUntil: on(pkg.validUntil)
        });
    }

    if (startDate < today) {
        throw new UnprocessableEntityError('That start date has passed', { reason: 'PAST', today });
    }

    const pax = adults + childAges.length;

    if (
        adults < pkg.minAdults ||
        (pkg.maxAdults !== null && adults > pkg.maxAdults) ||
        (pkg.maxChildren !== null && childAges.length > pkg.maxChildren) ||
        (pkg.maxPax !== null && pax > pkg.maxPax)
    ) {
        throw new UnprocessableEntityError('This package is not offered for a party of that shape', {
            reason: 'PARTY_SIZE',
            minAdults: pkg.minAdults,
            maxAdults: pkg.maxAdults,
            maxChildren: pkg.maxChildren,
            maxPax: pkg.maxPax
        });
    }
};

/**
 * Resolves every slot and totals the package.
 *
 * `choices` is `{ [slotIndex]: { ratePlanId | hotelId | vehicleId | tourOptionId } }`;
 * `excluded` lists optional slots the buyer dropped. `mode: 'availability'`
 * skips the token, for listings that only want to know whether it can be sold.
 */
export const quotePackage = async (criteria, viewer, { anyStatus = false, mode = 'quote', now = new Date() } = {}) => {
    const { slugOrId, startDate, adults, childAges = [], rooms = 1, choices = {}, excluded = [], locale } = criteria;

    const pkg = await findPackageOr404(slugOrId, {
        locale,
        statuses: anyStatus ? null : ['ACTIVE'],
        b2cOnly: !anyStatus && !isTrade(viewer),
        access: anyStatus ? undefined : accessWhere(viewer, 'PACKAGE')
    });

    const today = todayInTimezone(pkg.timezone, now);
    assertSellable(pkg, { startDate, adults, childAges, today });

    const endDate = addDays(startDate, pkg.nights);
    const party = { adults, children: childAges.length, childAges, pax: adults + childAges.length };
    const excludedSet = new Set(excluded.map(Number));

    // Slots are independent reads into four different engines, so they resolve
    // concurrently rather than one after another — a five-slot package was
    // five searches deep in series. Bounded by `slotConcurrency` because each
    // in-flight slot holds a pool connection; see the note in config.js.
    //
    // Results are written back by index, so the concurrency never reorders the
    // trip: slot 3 is the third day whichever call finishes first.
    const slots = new Array(pkg.components.length);

    const resolveOne = async (component, position) => {
        const included = component.required || !excludedSet.has(component.slotIndex);

        if (!included) {
            slots[position] = { component, included: false, resolved: null, reason: 'EXCLUDED', alternatives: [] };

            return;
        }

        const choice = choices[component.slotIndex] ?? choices[String(component.slotIndex)] ?? null;
        const outcome = await RESOLVERS[component.componentType]({
            pkg,
            component,
            startDate,
            endDate,
            party,
            rooms,
            choice,
            locale,
            viewer,
            now
        });

        slots[position] = { component, included: true, ...outcome };
    };

    for (let start = 0; start < pkg.components.length; start += config.package.slotConcurrency) {
        const wave = pkg.components.slice(start, start + config.package.slotConcurrency);

        await Promise.all(wave.map((component, offset) => resolveOne(component, start + offset)));
    }

    const missingRequired = slots.filter((slot) => slot.component.required && !slot.resolved);
    const priced = slots.filter((slot) => slot.included && slot.resolved);

    // Optional slots that could not be filled drop out rather than block.
    for (const slot of slots) {
        if (slot.included && !slot.resolved && !slot.component.required) {
            slot.included = false;
        }
    }

    const eligible = priced.filter((slot) => pkg.adjustmentAppliesTo === 'ALL_ITEMS' || slot.component.required);
    const eligibleSell = eligible.reduce((sum, slot) => sum + slot.resolved.sellCents, 0);
    const componentsNet = priced.reduce((sum, slot) => sum + slot.resolved.netCents, 0);
    const componentsSell = priced.reduce((sum, slot) => sum + slot.resolved.sellCents, 0);
    const adjustmentCents = missingRequired.length === 0 ? computeAdjustment(pkg, party, eligibleSell) : 0;
    const shares = allocate(adjustmentCents, eligible.map((slot) => slot.resolved.sellCents));

    eligible.forEach((slot, index) => {
        slot.adjustmentCents = shares[index];
    });
    for (const slot of priced) {
        slot.adjustmentCents ??= 0;
        slot.lineTotalCents = slot.resolved.sellCents + slot.adjustmentCents;
    }

    const sellTotal = componentsSell + adjustmentCents;
    let unavailableReason = missingRequired.length > 0 ? 'COMPONENT_UNAVAILABLE' : null;

    // A fixed price below what the components cost the platform is a template
    // mistake, not a deal.
    if (!unavailableReason && pkg.adjustmentKind !== 'NONE' && sellTotal < componentsNet) {
        unavailableReason = 'ADJUSTMENT_BELOW_COST';
    }

    let kosher = null;

    if (pkg.kosher && !unavailableReason) {
        kosher = validateKosherQuote(pkg, pkg.kosher, priced.map((slot) => slot.resolved), { today, startDate, endDate });

        if (kosher.blockers.length > 0) {
            unavailableReason = 'KOSHER_INELIGIBLE';
        }
    }

    const available = unavailableReason === null;

    const quote = {
        package: pkg,
        startDate,
        endDate,
        party,
        rooms,
        currency: pkg.currency,
        available,
        unavailableReason,
        slots,
        adjustment: {
            kind: pkg.adjustmentKind,
            value: pkg.adjustmentValue,
            appliesTo: pkg.adjustmentAppliesTo,
            appliedCents: adjustmentCents
        },
        totals: {
            componentsNetCents: componentsNet,
            componentsSellCents: componentsSell,
            adjustmentCents,
            sellTotalCents: sellTotal,
            totalCents: sellTotal,
            marginCents: sellTotal - componentsNet
        },
        kosher,
        token: null
    };

    if (available && mode === 'quote') {
        quote.token = issuePackageOfferToken({
            packageId: pkg.id,
            startDate,
            adults,
            childAges,
            rooms,
            slots: slots.map((slot) => ({
                slotIndex: slot.component.slotIndex,
                componentType: slot.component.componentType,
                included: slot.included,
                token: slot.resolved?.token ?? null,
                sellCents: slot.resolved?.sellCents ?? 0,
                service: slot.resolved?.serviceFields ?? null
            })),
            adjustmentCents,
            totalCents: sellTotal,
            currency: pkg.currency
        });
    }

    return quote;
};

/** The choices and exclusions a token encodes, so a re-quote lands on the same offers. */
export const choicesFromToken = (decoded) => {
    const choices = {};
    const excluded = [];

    for (const slot of decoded.slots) {
        if (!slot.included) {
            excluded.push(slot.slotIndex);
            continue;
        }

        if (!slot.token) {
            continue;
        }

        if (slot.componentType === 'HOTEL_STAY') {
            const child = readOfferToken(slot.token);
            choices[slot.slotIndex] = { hotelId: child.hotelId, ratePlanId: child.ratePlanId };
        } else if (slot.componentType === 'TRANSFER') {
            choices[slot.slotIndex] = { vehicleId: readQuoteToken(slot.token).vehicleId };
        } else if (slot.componentType === 'TOUR') {
            choices[slot.slotIndex] = { tourOptionId: readTourOfferToken(slot.token).tourOptionId };
        }
    }

    return { choices, excluded };
};

/**
 * Re-prices a package offer from its token. `strict` makes a moved price a
 * 409, which is what the order does; the quote endpoint shows the new figure.
 */
export const revalidatePackageOffer = async (token, viewer, { strict = true, locale } = {}) => {
    const decoded = readPackageOfferToken(token);
    const { choices, excluded } = choicesFromToken(decoded);

    const quote = await quotePackage(
        {
            slugOrId: decoded.packageId,
            startDate: decoded.startDate,
            adults: decoded.adults,
            childAges: decoded.childAges,
            rooms: decoded.rooms,
            choices,
            excluded,
            locale
        },
        viewer
    );

    if (!quote.available) {
        throw new ConflictError('That package is no longer available for those dates', {
            reason: quote.unavailableReason ?? 'UNAVAILABLE',
            slots: quote.slots
                .filter((slot) => slot.component.required && !slot.resolved)
                .map((slot) => ({ slotIndex: slot.component.slotIndex, label: slot.component.label, reason: slot.reason })),
            ...(quote.kosher?.blockers?.length ? { blockers: quote.kosher.blockers } : {})
        });
    }

    const priceChanged = quote.totals.totalCents !== decoded.quotedTotalCents;

    if (strict && priceChanged) {
        throw new ConflictError('The price of this package has changed', {
            reason: 'PRICE_CHANGED',
            quotedCents: decoded.quotedTotalCents,
            currentCents: quote.totals.totalCents,
            currency: quote.currency
        });
    }

    return { ...quote, priceChanged, quotedTotalCents: decoded.quotedTotalCents, decoded };
};

/** How many nights the stay covers, for a card. */
export const packageNights = (pkg) => nightsBetween('2000-01-01', addDays('2000-01-01', pkg.nights));
