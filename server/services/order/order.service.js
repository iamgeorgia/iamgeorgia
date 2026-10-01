import { createHash } from 'node:crypto';

import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { ConflictError, ForbiddenError, GoneError, HttpError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { assertReplayOwner } from '../../lib/idempotency.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { nextOrderReference } from '../../lib/reference.js';
import { addDays, dateOnlyToUtc, toDateOnly, todayInTimezone } from '../../lib/time.js';
import { readPackageOfferToken } from '../../lib/package/offerToken.js';
import { readOfferToken } from '../../lib/hotel/offerToken.js';
import { readTourOfferToken } from '../../lib/tour/offerToken.js';
import { impliedOrderStatus, LIVE_ITEM_STATUSES, orderMachine } from '../../lib/order/machines.js';
import { ACTOR } from '../../lib/transfer/machines.js';
import { isAdmin, isTrade } from '../../middleware/auth.js';
import {
    cancelHotelBookingInTx,
    confirmHotelBookingInTx,
    hotelBookingInclude,
    prepareHotelBooking,
    quoteCancellation as quoteHotelCancellation
} from '../hotel/booking.service.js';
import { createHoldIn, releaseHoldByToken } from '../hotel/availability.service.js';
import { revalidateOffer } from '../hotel/search.service.js';
import {
    cancelTransferBookingInTx,
    confirmTransferBookingInTx,
    driverConflictFor,
    prepareTransferBooking,
    quoteTransferCancellation,
    transferBookingInclude
} from '../transfer/booking.service.js';
import {
    cancelTourBookingInTx,
    confirmPendingTourBookingInTx,
    confirmTourBookingInTx,
    declinePendingTourBookingInTx,
    prepareTourBooking,
    quoteTourCancellation,
    tourBookingInclude
} from '../tour/booking.service.js';
import { createTourHoldIn, releaseTourHoldByToken } from '../tour/availability.service.js';
import { revalidateTourOffer } from '../tour/search.service.js';
import {
    cancelServiceBookingInTx,
    confirmPendingServiceBookingInTx,
    confirmServiceBookingInTx,
    declinePendingServiceBookingInTx,
    prepareServiceBooking,
    quoteServiceCancellation,
    serviceBookingInclude
} from '../service/booking.service.js';
import { findPackageOr404 } from '../package/package.service.js';
import { allocate, computeAdjustment } from '../package/quote.service.js';
import { kosherHotelInclude, validateKosherQuote } from '../package/kosherEligibility.service.js';

/**
 * Orders: the product-agnostic parent of one booking row per product.
 *
 * What is load-bearing here:
 *
 *   1. Everything slow happens before the transaction. Every slot is prepared
 *      outside it — tokens read, prices recomputed, schedules built, kosher
 *      rules run — and refused as one 409 listing every slot that moved or
 *      went. The transaction holds only claims and inserts.
 *   2. Inside it, the order row is created first (so a racing duplicate hits
 *      the idempotency key before any inventory row is locked), then every
 *      child is committed by its own `confirmXInTx` in a global lock order:
 *      hotels by room type, then tours by option. Two orders overlapping on
 *      {A, B} both lock A then B, so they cannot deadlock.
 *   3. With every product's inventory internal there is no partial failure:
 *      the transaction commits every child or none, and nothing needs
 *      compensating. The external-supplier seam is `fulfilment = EXTERNAL`,
 *      declared and unused.
 *   4. Money is frozen twice: on each child (its own net, sell, schedule) and
 *      on the item (its share of the package adjustment). Cancelling reads
 *      both and recomputes nothing.
 */

const { OPS, PARTNER, GUEST, SYSTEM } = ACTOR;

export const orderInclude = {
    partner: { select: { id: true, reference: true, name: true } },
    package: { select: { id: true, slug: true, name: true } },
    items: {
        orderBy: { slotIndex: 'asc' },
        include: {
            hotelBooking: { include: hotelBookingInclude },
            transferBooking: { include: transferBookingInclude },
            tourBooking: { include: tourBookingInclude },
            serviceBooking: { include: serviceBookingInclude }
        }
    }
};

const deriveIdempotencyKey = (input) =>
    input.idempotencyKey ??
    createHash('sha256')
        .update([input.packageToken, input.leadGuest.email.toLowerCase(), input.leadGuest.lastName.toLowerCase()].join('|'))
        .digest('base64url');

const actorKind = (viewer) => (isAdmin(viewer) ? OPS : viewer?.partnerId ? PARTNER : viewer ? PARTNER : GUEST);

/** The child booking an item points at, whichever product it is. */
export const childOf = (item) => item.hotelBooking ?? item.transferBooking ?? item.tourBooking ?? item.serviceBooking ?? null;

const CHILD_KEY = {
    HOTEL_STAY: 'hotelBookingId',
    TRANSFER: 'transferBookingId',
    TOUR: 'tourBookingId',
    SERVICE: 'serviceBookingId'
};

// --- prepare -----------------------------------------------------------------

const isGone = (error) =>
    error instanceof GoneError ||
    error instanceof NotFoundError ||
    (error instanceof ConflictError && ['UNAVAILABLE', 'ALREADY_COMMITTED', 'HOLD_INCONSISTENT', 'HOLD_EXPIRED', 'TOO_SOON'].includes(error.details?.reason)) ||
    (error instanceof UnprocessableEntityError && ['PARTY_SIZE', 'QUANTITY', 'PAST', 'BEYOND_HORIZON'].includes(error.details?.reason));

/** Prepares one slot through its product's own `prepare`, price drift allowed. */
const prepareSlot = async (slot, component, input, actor, lead) => {
    const hold = input.holdTokens?.[String(slot.slotIndex)] ?? null;
    const shared = { specialRequests: input.specialRequests, source: input.source ?? 'web' };

    switch (component.componentType) {
        case 'HOTEL_STAY':
            return prepareHotelBooking(
                {
                    ...(hold ? { holdToken: hold } : { offerToken: slot.token }),
                    leadGuest: lead,
                    guests: (input.travellers ?? []).map((traveller) => ({
                        type: traveller.type ?? 'ADULT',
                        firstName: traveller.firstName,
                        lastName: traveller.lastName,
                        age: traveller.age
                    })),
                    requests: input.requests,
                    ...shared
                },
                actor,
                { strict: false }
            );
        case 'TRANSFER':
            return prepareTransferBooking(
                {
                    quoteToken: slot.token,
                    leadPassenger: lead,
                    flightNumber: input.flightNumber,
                    pickupAddress: input.pickupAddress,
                    pickupPlace: input.pickupPlace,
                    preferredDriverId: input.preferredDriverId,
                    preferredFleetVehicleId: input.preferredFleetVehicleId,
                    ...shared
                },
                actor,
                { strict: false }
            );
        case 'TOUR':
            return prepareTourBooking(
                {
                    ...(hold ? { holdToken: hold } : { offerToken: slot.token }),
                    leadTraveller: lead,
                    travellers: input.travellers,
                    ...shared
                },
                actor,
                { strict: false }
            );
        case 'SERVICE':
            return prepareServiceBooking(
                {
                    serviceId: slot.service.serviceId,
                    date: slot.service.date,
                    time: slot.service.time,
                    days: slot.service.days,
                    quantity: slot.service.quantity,
                    pax: slot.service.pax,
                    quotedSellCents: slot.sellCents,
                    lead,
                    notes: input.specialRequests,
                    source: shared.source
                },
                actor,
                { strict: false }
            );
        default:
            throw new Error(`Unknown component type ${component.componentType}`);
    }
};

/** The shape the kosher validator reads, from a prepared child. */
const resolvedFromPrepared = async (component, prepared) => {
    switch (component.componentType) {
        case 'HOTEL_STAY': {
            const hotel = await prisma.hotel.findUnique({ where: { id: prepared.hotel.id }, include: kosherHotelInclude });

            return {
                componentType: 'HOTEL_STAY',
                component,
                hotel,
                ratePlan: { mealPlanCode: prepared.ratePlan.mealPlan?.code ?? null },
                checkIn: prepared.checkIn,
                checkOut: prepared.checkOut
            };
        }
        case 'TRANSFER':
            return { componentType: 'TRANSFER', component, legs: prepared.quote.legs };
        case 'TOUR':
            return { componentType: 'TOUR', component, date: prepared.date, endDate: prepared.endDate, tourKosher: component.tour?.kosher ?? null };
        case 'SERVICE':
        default:
            return { componentType: 'SERVICE', component };
    }
};

const snapshotPackage = (pkg, decoded, slots, kosher) => ({
    id: pkg.id,
    slug: pkg.slug,
    name: pkg.name,
    nights: pkg.nights,
    destinationName: pkg.destination?.name ?? null,
    adjustment: {
        kind: pkg.adjustmentKind,
        value: pkg.adjustmentValue,
        appliesTo: pkg.adjustmentAppliesTo,
        clawbackPolicy: 'PROPORTIONAL'
    },
    quotedTotalCents: decoded.quotedTotalCents,
    slots: slots.map((slot) => ({
        slotIndex: slot.component.slotIndex,
        componentType: slot.component.componentType,
        label: slot.component.label,
        required: slot.component.required,
        dayOffset: slot.component.dayOffset
    })),
    kosher: pkg.kosher
        ? {
              minServiceLevel: pkg.kosher.minServiceLevel,
              certifiedRequired: pkg.kosher.certifiedRequired,
              hotelRequestCodes: pkg.kosher.hotelRequestCodes,
              warnings: kosher?.warnings ?? [],
              overridden: kosher?.overridden ?? false
          }
        : null
});

/**
 * Everything that must be true before the transaction opens, computed once.
 *
 * Returns the prepared children in commit order, with each item's share of
 * the adjustment already allocated and frozen. Throws one 409 per kind of
 * refusal: PRICE_CHANGED listing every drifted slot, UNAVAILABLE listing
 * every slot that went, KOSHER_INELIGIBLE listing every blocker.
 */
export const prepareOrder = async (input, actor, { now = new Date() } = {}) => {
    const decoded = readPackageOfferToken(input.packageToken);
    const trade = isTrade(actor);
    const pkg = await findPackageOr404(decoded.packageId, { statuses: ['ACTIVE'], b2cOnly: !trade });
    const today = todayInTimezone(pkg.timezone, now);

    if ((pkg.sellableFrom && toDateOnly(pkg.sellableFrom) > today) || (pkg.sellableUntil && toDateOnly(pkg.sellableUntil) < today)) {
        throw new ConflictError('This package is not on sale today', { reason: 'NOT_ON_SALE' });
    }

    const lead = input.leadGuest;
    const party = { adults: decoded.adults, children: decoded.childAges.length, childAges: decoded.childAges };
    const endDate = addDays(decoded.startDate, pkg.nights);

    // Kosher requests the package attaches to every hotel stay, merged with
    // the buyer's own; the hotel's prepare refuses any the property cannot
    // honour before anything is written.
    const requests = [
        ...(input.requests ?? []),
        ...(pkg.kosher?.hotelRequestCodes ?? [])
            .filter((code) => !(input.requests ?? []).some((request) => request.code === code))
            .map((code) => ({ code }))
    ];

    const included = decoded.slots
        .filter((slot) => slot.included)
        .map((slot) => ({ slot, component: pkg.components.find((component) => component.slotIndex === slot.slotIndex) }));

    if (included.some(({ component }) => !component)) {
        throw new ConflictError('The package changed since it was quoted', { reason: 'PACKAGE_CHANGED' });
    }

    for (const component of pkg.components.filter((candidate) => candidate.required)) {
        if (!included.some(({ slot }) => slot.slotIndex === component.slotIndex)) {
            throw new ConflictError('The package changed since it was quoted', { reason: 'PACKAGE_CHANGED', slotIndex: component.slotIndex });
        }
    }

    const settled = await Promise.allSettled(
        included.map(({ slot, component }) => prepareSlot(slot, component, { ...input, requests }, actor, lead))
    );

    const drifted = [];
    const gone = [];
    const slots = [];

    settled.forEach((result, index) => {
        const { slot, component } = included[index];

        if (result.status === 'rejected') {
            if (isGone(result.reason)) {
                gone.push({ slotIndex: component.slotIndex, label: component.label, reason: result.reason.details?.reason ?? 'UNAVAILABLE' });

                return;
            }

            throw result.reason;
        }

        const prepared = result.value;

        if (prepared.currentCents !== slot.sellCents) {
            drifted.push({ slotIndex: component.slotIndex, label: component.label, quotedCents: slot.sellCents, currentCents: prepared.currentCents });
        }

        slots.push({ slot, component, prepared });
    });

    if (gone.length > 0) {
        throw new ConflictError('Part of this package is no longer available', { reason: 'UNAVAILABLE', slots: gone });
    }

    // The adjustment against today's prices, allocated exactly as the quote
    // allocated it, then the whole compared with what the buyer was shown.
    const eligible = slots.filter(({ component }) => pkg.adjustmentAppliesTo === 'ALL_ITEMS' || component.required);
    const eligibleSell = eligible.reduce((sum, { prepared }) => sum + prepared.currentCents, 0);
    const adjustmentCents = computeAdjustment(pkg, party, eligibleSell);
    const shares = allocate(adjustmentCents, eligible.map(({ prepared }) => prepared.currentCents));

    eligible.forEach((entry, index) => {
        entry.adjustmentCents = shares[index];
    });

    const componentsNet = slots.reduce((sum, { prepared }) => sum + (prepared.priced?.quote?.totals?.netCents ?? prepared.quote?.totals?.netCents ?? 0), 0);
    const componentsSell = slots.reduce((sum, { prepared }) => sum + prepared.currentCents, 0);
    const sellTotal = componentsSell + adjustmentCents;

    if (drifted.length > 0 || sellTotal !== decoded.quotedTotalCents) {
        throw new ConflictError('The price of this package has changed', {
            reason: 'PRICE_CHANGED',
            quotedCents: decoded.quotedTotalCents,
            currentCents: sellTotal,
            currency: pkg.currency,
            components: drifted
        });
    }

    let kosher = null;

    if (pkg.kosher) {
        const resolved = await Promise.all(slots.map(({ component, prepared }) => resolvedFromPrepared(component, prepared)));
        kosher = validateKosherQuote(pkg, pkg.kosher, resolved, { today, startDate: decoded.startDate, endDate });

        if (kosher.blockers.length > 0) {
            throw new ConflictError('This package no longer meets its kosher profile', { reason: 'KOSHER_INELIGIBLE', blockers: kosher.blockers });
        }
    }

    for (const entry of slots) {
        entry.adjustmentCents ??= 0;
        entry.lineTotalCents = entry.prepared.currentCents + entry.adjustmentCents;
        entry.netCents = entry.prepared.priced?.quote?.totals?.netCents ?? entry.prepared.quote?.totals?.netCents ?? 0;
    }

    // Commit order: hotels by room type, then tours by option, then the rest.
    // The claims inside the child confirms take their locks in this order in
    // every transaction on the platform.
    const rank = { HOTEL_STAY: 0, TOUR: 1, TRANSFER: 2, SERVICE: 3 };
    slots.sort((a, b) => rank[a.component.componentType] - rank[b.component.componentType] || String(a.prepared.lockKey ?? '').localeCompare(String(b.prepared.lockKey ?? '')));

    return {
        idempotencyKey: deriveIdempotencyKey(input),
        pkg,
        decoded,
        party,
        endDate,
        lead,
        slots,
        totals: { componentsNetCents: componentsNet, componentsSellCents: componentsSell, adjustmentCents, sellTotalCents: sellTotal },
        kosher,
        snapshot: snapshotPackage(pkg, decoded, slots, kosher)
    };
};

// --- confirm -----------------------------------------------------------------

const confirmChildInTx = (tx, entry, childKey, actor, req) => {
    const { component, prepared } = entry;

    switch (component.componentType) {
        case 'HOTEL_STAY':
            return confirmHotelBookingInTx(tx, prepared, { idempotencyKey: childKey }, actor, req);
        case 'TRANSFER':
            return confirmTransferBookingInTx(tx, prepared, { idempotencyKey: childKey }, actor, req);
        case 'TOUR':
            return confirmTourBookingInTx(tx, prepared, { idempotencyKey: childKey }, actor, req);
        case 'SERVICE':
        default:
            return confirmServiceBookingInTx(tx, prepared, { idempotencyKey: childKey }, actor, req);
    }
};

const childDeadline = (child) => child.requestDeadlineAt ?? null;

/**
 * Recomputes the order's status and deadline from its items. Called after
 * every change to an item; never bypassed.
 */
export const rollUpOrderStatus = async (tx, orderId, actor, req) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
    const next = impliedOrderStatus(order.items);
    const data = {};

    if (next !== order.status) {
        orderMachine.assertTransition(order.status, next, actorKind(actor) === GUEST ? GUEST : actorKind(actor));
        data.status = next;

        if (next === 'CONFIRMED' && !order.confirmedAt) data.confirmedAt = new Date();
        if (next === 'CANCELLED' && !order.cancelledAt) data.cancelledAt = new Date();
        if (next === 'COMPLETED') data.completedAt = new Date();
    }

    const deadlines = order.items
        .filter((item) => item.status === 'REQUESTED')
        .map((item) => childDeadline(childOf(item)))
        .filter(Boolean)
        .sort((a, b) => a - b);
    data.requestDeadlineAt = deadlines[0] ?? null;

    const updated = await tx.order.update({ where: { id: orderId }, data, include: orderInclude });

    if (next !== order.status) {
        await recordAudit(tx, {
            action: next === 'CONFIRMED' ? 'ORDER_CONFIRMED' : next === 'CANCELLED' ? 'ORDER_CANCELLED' : next === 'COMPLETED' ? 'ORDER_COMPLETED' : 'ORDER_AMENDED',
            actor,
            entityType: AUDIT_ENTITY.order,
            entityId: orderId,
            summary: `Order ${order.reference} is now ${next}`,
            metadata: { from: order.status, to: next },
            req
        });
    }

    return { order: updated, changed: next !== order.status, from: order.status, to: next };
};

export const confirmOrder = async (input, actor, req) => {
    const prepared = await prepareOrder(input, actor);
    const { idempotencyKey } = prepared;

    const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: orderInclude });

    // A replay is a read of the original, and is gated like one: the key
    // alone does not prove the caller made the request it names.
    const replayOf = (order) => {
        assertReplayOwner(() => assertMayRead(order, actor, { email: input.leadGuest?.email }));

        return { order, replayed: true };
    };

    if (existing) {
        return replayOf(existing);
    }

    try {
        const order = await prisma.$transaction(
            async (tx) => {
                const reference = await nextOrderReference(tx);
                const created = await tx.order.create({
                    data: {
                        reference,
                        status: 'PENDING_CONFIRMATION',
                        idempotencyKey,
                        partnerId: actor?.partnerId ?? null,
                        bookedByUserId: actor?.id ?? null,
                        kind: 'PACKAGE',
                        packageId: prepared.pkg.id,
                        startDate: dateOnlyToUtc(prepared.decoded.startDate),
                        endDate: dateOnlyToUtc(prepared.endDate),
                        adults: prepared.party.adults,
                        childAges: prepared.party.childAges,
                        rooms: prepared.decoded.rooms,
                        currency: prepared.pkg.currency,
                        componentsNetCents: prepared.totals.componentsNetCents,
                        componentsSellCents: prepared.totals.componentsSellCents,
                        adjustmentCents: prepared.totals.adjustmentCents,
                        sellTotalCents: prepared.totals.sellTotalCents,
                        leadName: `${prepared.lead.firstName} ${prepared.lead.lastName}`,
                        leadEmail: prepared.lead.email,
                        leadPhone: prepared.lead.phone ?? null,
                        specialRequests: input.specialRequests ?? null,
                        packageSnapshot: prepared.snapshot,
                        source: input.source ?? 'web'
                    }
                });

                for (const entry of prepared.slots) {
                    const child = await confirmChildInTx(tx, entry, `${idempotencyKey}:${entry.component.slotIndex}`, actor, req);
                    const requested = child.status === 'PENDING';

                    await tx.orderItem.create({
                        data: {
                            orderId: created.id,
                            slotIndex: entry.component.slotIndex,
                            componentType: entry.component.componentType,
                            label: entry.component.label,
                            required: entry.component.required,
                            status: requested ? 'REQUESTED' : 'CONFIRMED',
                            fulfilment: requested ? 'ON_REQUEST' : 'INTERNAL',
                            [CHILD_KEY[entry.component.componentType]]: child.id,
                            netCents: entry.netCents,
                            sellCents: entry.prepared.currentCents,
                            adjustmentCents: entry.adjustmentCents,
                            lineTotalCents: entry.lineTotalCents
                        }
                    });
                }

                await recordAudit(tx, {
                    action: 'ORDER_CREATED',
                    actor,
                    entityType: AUDIT_ENTITY.order,
                    entityId: created.id,
                    summary: `Order ${reference} for ${prepared.pkg.name}`,
                    metadata: {
                        reference,
                        packageId: prepared.pkg.id,
                        slots: prepared.slots.length,
                        totalCents: prepared.totals.sellTotalCents,
                        currency: prepared.pkg.currency
                    },
                    req
                });

                // The status the items imply, and the mail that follows it.
                const rolled = await tx.order.findUnique({ where: { id: created.id }, include: orderInclude });
                const status = impliedOrderStatus(rolled.items);
                const deadlines = rolled.items.filter((item) => item.status === 'REQUESTED').map((item) => childDeadline(childOf(item))).filter(Boolean).sort((a, b) => a - b);
                const finished = await tx.order.update({
                    where: { id: created.id },
                    data: { status, requestDeadlineAt: deadlines[0] ?? null, ...(status === 'CONFIRMED' ? { confirmedAt: new Date() } : {}) },
                    include: orderInclude
                });

                await enqueueEvent(tx, {
                    topic: status === 'CONFIRMED' ? TOPICS.ORDER_CONFIRMED : TOPICS.ORDER_REQUESTED,
                    payload: { orderId: created.id },
                    entityType: AUDIT_ENTITY.order,
                    entityId: created.id
                });

                return finished;
            },
            { timeout: config.order.txTimeoutMs, maxWait: config.order.txMaxWaitMs }
        );

        return { order, replayed: false };
    } catch (err) {
        if (err?.code === 'P2002') {
            const winner = await prisma.order.findUnique({ where: { idempotencyKey }, include: orderInclude });

            if (winner) {
                return replayOf(winner);
            }
        }

        const transfer = prepared.slots.find((entry) => entry.component.componentType === 'TRANSFER');
        const driverConflict = transfer ? driverConflictFor(err, transfer.prepared) : null;

        if (driverConflict) {
            throw driverConflict;
        }

        throw err;
    }
};

// --- holds -------------------------------------------------------------------

/**
 * Holds every slot with inventory — hotel rooms and tour seats — for the
 * checkout countdown, in one transaction. Transfers and services need none.
 */
export const holdOrderOffers = async (packageToken, actor) => {
    const decoded = readPackageOfferToken(packageToken);
    const holdTokens = {};
    let expiresAt = null;

    await prisma.$transaction(async (tx) => {
        for (const slot of decoded.slots.filter((candidate) => candidate.included && candidate.token)) {
            if (slot.componentType === 'HOTEL_STAY') {
                const offer = readOfferToken(slot.token);
                const priced = await revalidateOffer(offer, actor, { strict: false });
                const hold = await createHoldIn(tx, {
                    offer: {
                        roomTypeId: offer.roomTypeId,
                        ratePlanId: offer.ratePlanId,
                        checkIn: offer.checkIn,
                        checkOut: offer.checkOut,
                        rooms: offer.rooms,
                        adults: offer.adults,
                        childAges: offer.childAges
                    },
                    quote: priced.quote,
                    actor
                });
                holdTokens[slot.slotIndex] = hold.token;
                expiresAt = expiresAt === null || hold.expiresAt < expiresAt ? hold.expiresAt : expiresAt;
            } else if (slot.componentType === 'TOUR') {
                const offer = readTourOfferToken(slot.token);
                const priced = await revalidateTourOffer(offer, actor, { strict: false });
                const hold = await createTourHoldIn(tx, {
                    offer: { tourOptionId: offer.tourOptionId, date: offer.date, units: priced.units, adults: offer.adults, childAges: offer.childAges },
                    quote: priced.quote,
                    actor
                });
                holdTokens[slot.slotIndex] = hold.token;
                expiresAt = expiresAt === null || hold.expiresAt < expiresAt ? hold.expiresAt : expiresAt;
            }
        }
    });

    return { holdTokens, expiresAt };
};

export const releaseOrderHolds = async (holdTokens) => {
    for (const token of Object.values(holdTokens ?? {})) {
        // Either product's release is a no-op on a token it does not know.
        await releaseHoldByToken(token).catch(() => undefined);
        await releaseTourHoldByToken(token).catch(() => undefined);
    }
};

// --- reads -------------------------------------------------------------------

const assertMayRead = (order, viewer, { email } = {}) => {
    if (isAdmin(viewer)) return;

    if (viewer?.partnerId) {
        if (order.partnerId !== viewer.partnerId) {
            throw new NotFoundError('Order not found');
        }

        return;
    }

    if (order.partnerId === null && email && order.leadEmail.toLowerCase() === email.toLowerCase()) {
        return;
    }

    throw new ForbiddenError('That order is not yours to see');
};

export const findOrderOr404 = async (reference, viewer, options = {}) => {
    const order = await prisma.order.findUnique({ where: { reference }, include: orderInclude });

    if (!order) {
        throw new NotFoundError('Order not found');
    }

    assertMayRead(order, viewer, options);

    return order;
};

export const listOrders = async (query, viewer) => {
    const { page, pageSize, status, packageId, partnerId, from, to, search } = query;

    const where = {
        ...(isAdmin(viewer) ? { ...(partnerId ? { partnerId } : {}) } : { partnerId: viewer?.partnerId ?? '__none__' }),
        ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
        ...(packageId ? { packageId } : {}),
        ...(from || to ? { startDate: { ...(from ? { gte: dateOnlyToUtc(from) } : {}), ...(to ? { lte: dateOnlyToUtc(to) } : {}) } } : {}),
        ...(search
            ? {
                  OR: [
                      { reference: { contains: search, mode: 'insensitive' } },
                      { leadName: { contains: search, mode: 'insensitive' } },
                      { leadEmail: { contains: search, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, orders] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
            where,
            include: orderInclude,
            orderBy: status === 'PENDING_CONFIRMATION' ? [{ requestDeadlineAt: 'asc' }, { createdAt: 'desc' }] : { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { orders, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

// --- cancellation ------------------------------------------------------------

const childCancellationQuote = (item, at) => {
    const child = childOf(item);

    switch (item.componentType) {
        case 'HOTEL_STAY':
            return quoteHotelCancellation(child, at);
        case 'TRANSFER': {
            const quote = quoteTransferCancellation(child, at);

            return { chargeCents: quote.chargeCents, refundCents: quote.refundableCents ?? child.sellTotalCents - quote.chargeCents };
        }
        case 'TOUR':
            return quoteTourCancellation(child, at);
        case 'SERVICE':
        default:
            return quoteServiceCancellation(child, at);
    }
};

/**
 * What cancelling an item costs: the child's own charge under its frozen
 * terms, plus the forfeit of its share of the package discount. Two frozen
 * numbers, nothing recomputed — a template edited since cannot reach back.
 */
export const quoteItemCancellation = (item, at = new Date()) => {
    const child = childCancellationQuote(item, at);
    const childCharge = Math.min(child.chargeCents, item.sellCents);
    // A discount is a negative adjustment: its share comes off the refund.
    // A surcharge (positive) is refunded with the rest.
    const refundCents = Math.max(0, item.sellCents - childCharge + item.adjustmentCents);
    // Against what was paid for the line, not against the standalone price.
    const chargeCents = item.lineTotalCents - refundCents;
    // The discount share that is not handed back: what the child's own terms
    // would have refunded on its standalone price, less what is refunded here.
    const clawbackCents = Math.max(0, item.sellCents - childCharge - refundCents);

    return { chargeCents, refundCents, childChargeCents: childCharge, clawbackCents };
};

export const quoteOrderCancellation = (order, at = new Date()) => {
    const items = order.items
        .filter((item) => LIVE_ITEM_STATUSES.includes(item.status))
        .map((item) => ({ slotIndex: item.slotIndex, label: item.label, ...quoteItemCancellation(item, at) }));

    return {
        items,
        chargeCents: items.reduce((sum, item) => sum + item.chargeCents, 0),
        refundCents: items.reduce((sum, item) => sum + item.refundCents, 0),
        currency: order.currency
    };
};

const cancelChildInTx = (tx, item, options, actor, req) => {
    const child = childOf(item);

    switch (item.componentType) {
        case 'HOTEL_STAY':
            return cancelHotelBookingInTx(tx, child, options, actor, req);
        case 'TRANSFER':
            return cancelTransferBookingInTx(tx, child, options, actor, req);
        case 'TOUR':
            return cancelTourBookingInTx(tx, child, options, actor, req);
        case 'SERVICE':
        default:
            return cancelServiceBookingInTx(tx, child, options, actor, req);
    }
};

const cancelItemInTx = async (tx, order, item, { reason, waiveCharges = false }, actor, req) => {
    const quote = waiveCharges ? { chargeCents: 0, refundCents: item.lineTotalCents, clawbackCents: 0 } : quoteItemCancellation(item);

    await cancelChildInTx(tx, item, { reason, waiveCharges }, actor, req);

    const updated = await tx.orderItem.update({
        where: { id: item.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: quote.chargeCents }
    });

    await recordAudit(tx, {
        action: 'ORDER_ITEM_CANCELLED',
        actor,
        entityType: AUDIT_ENTITY.order,
        entityId: order.id,
        summary: `Cancelled ${item.label} on ${order.reference}`,
        metadata: { slotIndex: item.slotIndex, chargeCents: quote.chargeCents, clawbackCents: quote.clawbackCents, ...(reason ? { reason } : {}), ...(waiveCharges ? { waived: true } : {}) },
        req
    });

    return { item: updated, quote };
};

const assertLive = (item) => {
    if (!LIVE_ITEM_STATUSES.includes(item.status)) {
        throw new ConflictError('That item cannot be cancelled', { reason: 'NOT_CANCELLABLE', status: item.status });
    }
};

export const cancelOrderItem = async (reference, slotIndex, { reason, email } = {}, actor, req) =>
    prisma.$transaction(async (tx) => {
        const order = await findOrderOr404(reference, actor, { email });
        const item = order.items.find((candidate) => candidate.slotIndex === slotIndex);

        if (!item) {
            throw new NotFoundError('That slot is not on this order');
        }

        assertLive(item);

        // A package without its hotel is not a package, and dropping the hotel
        // while keeping the discounted transfer is the arbitrage the allocation
        // exists to prevent. Operations may override.
        if (item.required && !isAdmin(actor)) {
            throw new ConflictError('That part of the package cannot be cancelled on its own', {
                reason: 'REQUIRED_COMPONENT',
                slotIndex
            });
        }

        const { item: cancelled, quote } = await cancelItemInTx(tx, order, item, { reason }, actor, req);
        const { order: rolled } = await rollUpOrderStatus(tx, order.id, actor, req);

        return { order: rolled, item: cancelled, quote };
    }, { timeout: config.order.txTimeoutMs });

export const cancelOrderInTx = async (tx, order, { reason, waiveCharges = false }, actor, req) => {
    if (orderMachine.isTerminal(order.status)) {
        throw new ConflictError('That order cannot be cancelled', { reason: 'NOT_CANCELLABLE', status: order.status });
    }

    orderMachine.assertTransition(order.status, 'CANCELLED', actorKind(actor));

    let chargeCents = 0;
    let refundCents = 0;

    for (const item of order.items.filter((candidate) => LIVE_ITEM_STATUSES.includes(candidate.status))) {
        const { quote } = await cancelItemInTx(tx, order, item, { reason, waiveCharges }, actor, req);
        chargeCents += quote.chargeCents;
        refundCents += quote.refundCents;
    }

    const cancelled = await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationChargeCents: chargeCents, cancellationReason: reason ?? null, requestDeadlineAt: null },
        include: orderInclude
    });

    await recordAudit(tx, {
        action: 'ORDER_CANCELLED',
        actor,
        entityType: AUDIT_ENTITY.order,
        entityId: order.id,
        summary: `Cancelled order ${order.reference}`,
        metadata: { chargeCents, refundCents, currency: order.currency, ...(reason ? { reason } : {}), ...(waiveCharges ? { waived: true } : {}) },
        req
    });

    await enqueueEvent(tx, {
        topic: TOPICS.ORDER_CANCELLED,
        payload: { orderId: order.id, chargeCents, reason: reason ?? null },
        entityType: AUDIT_ENTITY.order,
        entityId: order.id
    });

    return { order: cancelled, quote: { chargeCents, refundCents, currency: order.currency } };
};

export const cancelOrder = (reference, { reason, email } = {}, actor, req) =>
    prisma.$transaction(async (tx) => cancelOrderInTx(tx, await findOrderOr404(reference, actor, { email }), { reason }, actor, req), {
        timeout: config.order.txTimeoutMs
    });

// --- on request --------------------------------------------------------------

const requestedItem = (order, slotIndex) => {
    const item = order.items.find((candidate) => candidate.slotIndex === slotIndex);

    if (!item) {
        throw new NotFoundError('That slot is not on this order');
    }

    if (item.status !== 'REQUESTED') {
        throw new ConflictError('That item is not awaiting an answer', { reason: 'NOT_PENDING', status: item.status });
    }

    return item;
};

export const confirmOrderItem = (reference, slotIndex, actor, req) =>
    prisma.$transaction(async (tx) => {
        const order = await findOrderOr404(reference, actor);
        const item = requestedItem(order, slotIndex);
        const child = childOf(item);

        if (item.componentType === 'TOUR') {
            await confirmPendingTourBookingInTx(tx, child, actor, req);
        } else if (item.componentType === 'SERVICE') {
            await confirmPendingServiceBookingInTx(tx, child, actor, req);
        } else {
            throw new ConflictError('That item is not an on-request product', { reason: 'NOT_PENDING' });
        }

        await tx.orderItem.update({ where: { id: item.id }, data: { status: 'CONFIRMED' } });

        await recordAudit(tx, {
            action: 'ORDER_ITEM_CONFIRMED',
            actor,
            entityType: AUDIT_ENTITY.order,
            entityId: order.id,
            summary: `Confirmed ${item.label} on ${order.reference}`,
            metadata: { slotIndex },
            req
        });

        const rolled = await rollUpOrderStatus(tx, order.id, actor, req);

        if (rolled.changed && rolled.to === 'CONFIRMED') {
            await enqueueEvent(tx, { topic: TOPICS.ORDER_CONFIRMED, payload: { orderId: order.id }, entityType: AUDIT_ENTITY.order, entityId: order.id });
        }

        return rolled.order;
    });

/**
 * Declining an item. Optional: it drops out at no charge and the order's
 * total shrinks. Required: the whole order is cancelled at zero charge — the
 * failure is the supplier's, not the buyer's — and the outbox says so.
 */
export const declineOrderItem = (reference, slotIndex, { reason }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const order = await findOrderOr404(reference, actor);
        const item = requestedItem(order, slotIndex);
        const child = childOf(item);

        if (item.componentType === 'TOUR') {
            await declinePendingTourBookingInTx(tx, child, { reason }, actor, req);
        } else if (item.componentType === 'SERVICE') {
            await declinePendingServiceBookingInTx(tx, child, { reason }, actor, req);
        } else {
            throw new ConflictError('That item is not an on-request product', { reason: 'NOT_PENDING' });
        }

        await tx.orderItem.update({
            where: { id: item.id },
            data: { status: 'DECLINED', cancelledAt: new Date(), cancellationChargeCents: 0 }
        });

        await recordAudit(tx, {
            action: 'ORDER_ITEM_DECLINED',
            actor,
            entityType: AUDIT_ENTITY.order,
            entityId: order.id,
            summary: `Declined ${item.label} on ${order.reference}`,
            metadata: { slotIndex, reason, required: item.required },
            req
        });

        if (item.required) {
            const fresh = await tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
            const { order: cancelled } = await cancelOrderInTx(tx, fresh, { reason: `Declined: ${reason}`, waiveCharges: true }, actor, req);

            return cancelled;
        }

        // The buyer pays for what survives.
        const survivors = order.items.filter((candidate) => candidate.id !== item.id && LIVE_ITEM_STATUSES.includes(candidate.status));
        await tx.order.update({
            where: { id: order.id },
            data: { sellTotalCents: survivors.reduce((sum, candidate) => sum + candidate.lineTotalCents, 0) }
        });

        const rolled = await rollUpOrderStatus(tx, order.id, actor, req);

        await enqueueEvent(tx, {
            topic: TOPICS.ORDER_ITEM_DECLINED,
            payload: { orderId: order.id, slotIndex, reason },
            entityType: AUDIT_ENTITY.order,
            entityId: order.id
        });

        if (rolled.changed && rolled.to === 'CONFIRMED') {
            await enqueueEvent(tx, { topic: TOPICS.ORDER_CONFIRMED, payload: { orderId: order.id }, entityType: AUDIT_ENTITY.order, entityId: order.id });
        }

        return rolled.order;
    });

// --- paperwork ---------------------------------------------------------------

export const amendOrder = (reference, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const order = await findOrderOr404(reference, actor, { email: input.email });

        if (orderMachine.isTerminal(order.status)) {
            throw new ConflictError('That order can no longer be amended', { status: order.status });
        }

        const lead = input.leadGuest ?? {};
        const [firstName, ...rest] = order.leadName.split(' ');
        const data = {
            ...(lead.firstName || lead.lastName ? { leadName: `${lead.firstName ?? firstName} ${lead.lastName ?? rest.join(' ')}`.trim() } : {}),
            ...(lead.email ? { leadEmail: lead.email } : {}),
            ...(lead.phone !== undefined ? { leadPhone: lead.phone } : {}),
            ...(input.specialRequests !== undefined ? { specialRequests: input.specialRequests } : {})
        };

        const updated = await tx.order.update({ where: { id: order.id }, data, include: orderInclude });

        await recordAudit(tx, {
            action: 'ORDER_AMENDED',
            actor,
            entityType: AUDIT_ENTITY.order,
            entityId: order.id,
            summary: `Amended order ${order.reference}`,
            metadata: { fields: Object.keys(data) },
            req
        });

        return updated;
    });

// --- sweepers ----------------------------------------------------------------

export const sweepOverdueOrderRequests = async ({ now = new Date(), limit = 100 } = {}) => {
    const due = await prisma.order.findMany({
        where: { status: 'PENDING_CONFIRMATION', requestDeadlineAt: { lt: now }, overdueAlertAt: null },
        select: { id: true },
        take: limit
    });

    let alerted = 0;

    for (const order of due) {
        await prisma.$transaction(async (tx) => {
            const { count } = await tx.order.updateMany({
                where: { id: order.id, status: 'PENDING_CONFIRMATION', overdueAlertAt: null },
                data: { overdueAlertAt: now }
            });

            if (count === 0) return;

            await enqueueEvent(tx, { topic: TOPICS.ORDER_REQUEST_OVERDUE, payload: { orderId: order.id }, entityType: AUDIT_ENTITY.order, entityId: order.id });
            alerted += 1;
        });
    }

    return { alerted };
};

/**
 * Orders whose travel has ended and whose surviving items have all finished
 * roll to COMPLETED. Every child table has its own completion sweep (hotel,
 * service, tour; transfers complete through dispatch), and server.js runs the
 * hotel and service sweeps immediately before this one so an order is judged
 * against parts that have already been given the chance to finish.
 */
export const sweepCompletedOrders = async ({ now = new Date(), limit = 200 } = {}) => {
    const yesterday = dateOnlyToUtc(addDays(now.toISOString().slice(0, 10), -1));
    const candidates = await prisma.order.findMany({
        where: { status: { in: ['CONFIRMED', 'PARTIALLY_CANCELLED'] }, endDate: { lte: yesterday } },
        include: orderInclude,
        take: limit
    });

    let completed = 0;

    for (const order of candidates) {
        const live = order.items.filter((item) => LIVE_ITEM_STATUSES.includes(item.status));
        const finished = live.every((item) => ['COMPLETED', 'NO_SHOW'].includes(childOf(item)?.status));

        if (!finished) continue;

        await prisma.$transaction(async (tx) => {
            await tx.orderItem.updateMany({
                where: { orderId: order.id, status: 'CONFIRMED' },
                data: { status: 'COMPLETED' }
            });
            await rollUpOrderStatus(tx, order.id, null, null);
            completed += 1;
        });
    }

    return { completed };
};

export const SYSTEM_ACTOR = SYSTEM;
export { HttpError };
