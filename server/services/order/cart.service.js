import { createHash } from 'node:crypto';

import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { ConflictError, UnprocessableEntityError } from '../../lib/errors.js';
import { assertReplayOwner } from '../../lib/idempotency.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { nextOrderReference } from '../../lib/reference.js';
import { dateOnlyToUtc } from '../../lib/time.js';
import { impliedOrderStatus } from '../../lib/order/machines.js';
import { approvalModeFor, approvalStampsFor } from '../../lib/booking/approval.js';
import { deskColumns, deskFrom } from '../../lib/booking/desk.js';
import { sourceFor } from '../../lib/booking/source.js';
import { readOfferToken } from '../../lib/hotel/offerToken.js';
import { readTourOfferToken } from '../../lib/tour/offerToken.js';
import { syncOrderReceivableInTx } from '../finance/ledger.service.js';
import { assertCreditInTx } from '../finance/credit.service.js';
import { createHoldIn } from '../hotel/availability.service.js';
import { revalidateOffer } from '../hotel/search.service.js';
import { createTourHoldIn } from '../tour/availability.service.js';
import { revalidateTourOffer } from '../tour/search.service.js';
import { driverConflictFor } from '../transfer/booking.service.js';
import { canViewMargin } from '../../middleware/auth.js';
import { allocate } from '../package/quote.service.js';
import {
    CHILD_KEY,
    assertMayRead,
    childDeadline,
    childOf,
    confirmChildInTx,
    holdOrderOffers,
    isGone,
    orderInclude,
    preparePackageGroup,
    prepareSlot
} from './order.service.js';

/**
 * The cart: hotels, transfers, tours, services and whole packages, booked as
 * one CUSTOM order (owner decision OD2).
 *
 * Everything a package order already does is reused — each item goes
 * through its product's own `prepare`, the children are committed in lock
 * order inside one transaction, the order is approved as one and paid
 * through one receivable. What a cart adds is the list: standalone items
 * beside flattened packages, each item keeping the package it came from and
 * its share of that package's discount (`groupKey`, `adjustmentSource`), so
 * nothing is counted twice and a cancellation still reads the item's own
 * frozen terms.
 */

const RANK = { HOTEL_STAY: 0, TOUR: 1, TRANSFER: 2, SERVICE: 3 };
const COMPONENT_OF = { HOTEL_STAY: 'HOTEL_STAY', TRANSFER: 'TRANSFER', TOUR: 'TOUR', SERVICE: 'SERVICE' };

const itemLabel = (item, prepared) => {
    switch (item.type) {
        case 'HOTEL_STAY':
            return item.label ?? `${prepared.hotel?.name ?? 'Hotel'}, ${prepared.rooms ?? 1} room${(prepared.rooms ?? 1) === 1 ? '' : 's'}`;
        case 'TRANSFER':
            return item.label ?? `${prepared.from?.name ?? 'Transfer'} → ${prepared.to?.name ?? ''}`.trim();
        case 'TOUR':
            return item.label ?? `${prepared.tour?.title ?? 'Tour'}${prepared.option?.name ? ` · ${prepared.option.name}` : ''}`;
        case 'SERVICE':
        default:
            return item.label ?? prepared.service?.name ?? 'Service';
    }
};

/** The first and last day a prepared child occupies, as `YYYY-MM-DD`. */
const datesOf = (type, prepared) => {
    switch (type) {
        case 'HOTEL_STAY':
            return { from: prepared.checkIn, to: prepared.checkOut };
        case 'TRANSFER':
            return { from: prepared.decoded.date, to: prepared.decoded.returnDate ?? prepared.decoded.date };
        case 'TOUR':
        case 'SERVICE':
        default:
            return { from: prepared.date, to: prepared.endDate ?? prepared.date };
    }
};

const partyOf = (type, prepared) => {
    switch (type) {
        case 'HOTEL_STAY':
            return { adults: prepared.adults, childAges: prepared.childAges ?? [], rooms: prepared.rooms ?? 1 };
        case 'TOUR':
            return { adults: prepared.adults, childAges: prepared.childAges ?? [], rooms: 1 };
        case 'TRANSFER':
            return { adults: prepared.decoded.adults, childAges: prepared.decoded.childAges ?? [], rooms: 1 };
        default:
            return { adults: prepared.pax ?? 1, childAges: [], rooms: 1 };
    }
};

const netOf = (prepared) => prepared.priced?.quote?.totals?.netCents ?? prepared.quote?.totals?.netCents ?? 0;

export const deriveCartIdempotencyKey = (input) =>
    input.idempotencyKey ??
    createHash('sha256')
        .update(
            [
                ...input.items.map((item) => item.offerToken ?? item.holdToken ?? item.quoteToken ?? item.packageToken ?? `${item.serviceId}:${item.date}:${item.quantity ?? 1}`),
                input.leadGuest.email.toLowerCase(),
                input.leadGuest.lastName.toLowerCase()
            ].join('|')
        )
        .digest('base64url');

/** A standalone item through its product's `prepare`, via the same slot adapter a package uses. */
const prepareStandalone = async (item, index, input, actor) => {
    const component = { slotIndex: index, componentType: COMPONENT_OF[item.type], label: item.label ?? null, required: false };
    const slot = { slotIndex: index, token: item.offerToken ?? item.quoteToken ?? null, sellCents: null, service: item.type === 'SERVICE' ? item : null };
    const view = {
        ...input,
        holdTokens: item.holdToken ? { [String(index)]: item.holdToken } : {},
        travellers: item.travellers ?? input.travellers,
        requests: item.requests ?? input.requests,
        specialRequests: item.specialRequests ?? input.specialRequests,
        flightNumber: item.flightNumber ?? item.flights?.outbound ?? undefined,
        flights: item.flights,
        pickupAddress: item.pickupAddress,
        dropoffAddress: item.dropoffAddress,
        pickupPlace: item.pickupPlace,
        dropoffPlace: item.dropoffPlace,
        preferredDriverId: item.preferredDriverId,
        preferredFleetVehicleId: item.preferredFleetVehicleId
    };

    if (item.type === 'SERVICE') {
        slot.service = { serviceId: item.serviceId, date: item.date, time: item.time, days: item.days, quantity: item.quantity, pax: item.pax };
        slot.sellCents = item.quotedSellCents;
    }

    const prepared = await prepareSlot(slot, component, view, actor, input.leadGuest);

    return { component: { ...component, label: itemLabel(item, prepared) }, prepared, item, packageId: null, packageSlotIndex: null, groupKey: null, adjustmentCents: 0, adjustmentSource: 'NONE' };
};

/**
 * Everything that must be true before the transaction opens.
 *
 * Every item is prepared (packages as groups, through `preparePackageGroup`);
 * what went and what moved are collected and reported as one 409 each, as a
 * package order does; the currencies must agree; the lines are numbered in
 * one sequence and sorted into the platform's lock order.
 */
/** A quote has nobody travelling yet; the preparers still want a lead to key on. */
const QUOTE_LEAD = Object.freeze({ firstName: 'Quote', lastName: 'Quote', email: 'quote@cart.invalid' });

export const prepareCustomOrder = async (input, actor, { now = new Date(), strict = true } = {}) => {
    const leadGuest = input.leadGuest?.email ? input.leadGuest : QUOTE_LEAD;
    const shared = {
        leadGuest,
        travellers: input.travellers,
        requests: input.requests,
        specialRequests: input.specialRequests,
        channel: input.channel ?? null,
        manual: Boolean(input.manual),
        confirmNow: Boolean(input.confirmNow),
        customerId: input.customerId ?? null,
        assignedManagerUserId: input.assignedManagerUserId ?? null
    };

    const settled = await Promise.allSettled(
        input.items.map(async (item, index) => {
            if (item.type === 'PACKAGE') {
                const group = await preparePackageGroup(
                    { ...shared, packageToken: item.packageToken, holdTokens: item.holdTokens, flightNumber: item.flightNumber, pickupAddress: item.pickupAddress, pickupPlace: item.pickupPlace, preferredDriverId: item.preferredDriverId, preferredFleetVehicleId: item.preferredFleetVehicleId, requests: item.requests ?? input.requests, travellers: item.travellers ?? input.travellers },
                    actor,
                    { now }
                );
                const groupKey = `pkg:${group.pkg.id}:${index}`;

                return group.slots.map((slot) => ({
                    component: { ...slot.component, label: `${group.pkg.name} · ${slot.component.label}` },
                    prepared: slot.prepared,
                    item,
                    packageId: group.pkg.id,
                    packageSlotIndex: slot.component.slotIndex,
                    groupKey,
                    adjustmentCents: slot.adjustmentCents,
                    adjustmentSource: slot.adjustmentCents ? 'PACKAGE' : 'NONE',
                    group
                }));
            }

            return [await prepareStandalone(item, index, shared, actor)];
        })
    );

    const gone = [];
    const drifted = [];
    const entries = [];

    settled.forEach((result, index) => {
        if (result.status === 'rejected') {
            const error = result.reason;

            if (isGone(error) || (error instanceof ConflictError && ['UNAVAILABLE', 'PACKAGE_CHANGED', 'NOT_ON_SALE', 'KOSHER_INELIGIBLE'].includes(error.details?.reason))) {
                gone.push({ index, type: input.items[index].type, reason: error.details?.reason ?? 'UNAVAILABLE', details: error.details ?? null });

                return;
            }

            if (error instanceof ConflictError && error.details?.reason === 'PRICE_CHANGED') {
                drifted.push({ index, type: input.items[index].type, quotedCents: error.details.quotedCents, currentCents: error.details.currentCents, components: error.details.components ?? [] });

                return;
            }

            throw error;
        }

        for (const entry of result.value) {
            if (entry.prepared.priceChanged && !entry.group) {
                drifted.push({ index, type: entry.item.type, quotedCents: entry.prepared.quotedCents, currentCents: entry.prepared.currentCents });
            }

            entries.push({ ...entry, index });
        }
    });

    if (gone.length > 0) {
        throw new ConflictError('Part of this order is no longer available', { reason: 'UNAVAILABLE', items: gone });
    }

    if (strict && drifted.length > 0) {
        throw new ConflictError('The price of this order has changed', { reason: 'PRICE_CHANGED', items: drifted });
    }

    if (entries.length === 0) {
        throw new UnprocessableEntityError('Nothing to book', { reason: 'EMPTY' });
    }

    const currencies = [...new Set(entries.map((entry) => entry.prepared.currency))];

    if (currencies.length > 1) {
        throw new UnprocessableEntityError('Everything in one order is paid in one currency', { reason: 'MIXED_CURRENCY', currencies });
    }

    // One sequence of slots, in the platform's lock order: hotels by room
    // type, then tours by option, then the rest — the same order every
    // transaction on the platform claims inventory in.
    entries.sort((a, b) => RANK[a.component.componentType] - RANK[b.component.componentType] || String(a.prepared.lockKey ?? '').localeCompare(String(b.prepared.lockKey ?? '')) || a.index - b.index);
    entries.forEach((entry, slotIndex) => {
        entry.component = { ...entry.component, slotIndex };
        entry.netCents = netOf(entry.prepared);
        entry.lineTotalCents = entry.prepared.currentCents + entry.adjustmentCents;
    });

    const dates = entries.map((entry) => datesOf(entry.item.type === 'PACKAGE' ? entry.component.componentType : entry.item.type, entry.prepared));
    const startDate = dates.map((d) => d.from).sort()[0];
    const endDate = dates.map((d) => d.to).sort().at(-1);
    const first = entries.find((entry) => entry.component.componentType === 'HOTEL_STAY') ?? entries.find((entry) => entry.component.componentType === 'TOUR') ?? entries[0];
    const party = input.party ?? partyOf(first.component.componentType, first.prepared);

    // The desk's adjustment (OD3) is spread over the items that carry no
    // package share — or over every item when the cart is all packages — so
    // the order's lines still add up to what the buyer pays.
    const manualCents = input.manual ? (input.priceAdjustment?.cents ?? 0) : 0;

    if (manualCents) {
        const own = entries.filter((entry) => !entry.group);
        const targets = own.length > 0 ? own : entries;
        const shares = allocate(manualCents, targets.map((entry) => Math.max(entry.prepared.currentCents, 1)));

        targets.forEach((entry, index) => {
            entry.adjustmentCents += shares[index];
            entry.adjustmentSource = 'MANUAL';
            entry.lineTotalCents = entry.prepared.currentCents + entry.adjustmentCents;
        });
    }

    const componentsNet = entries.reduce((sum, entry) => sum + entry.netCents, 0);
    const componentsSell = entries.reduce((sum, entry) => sum + entry.prepared.currentCents, 0);
    const adjustmentCents = entries.reduce((sum, entry) => sum + entry.adjustmentCents, 0);

    const groups = [...new Map(entries.filter((entry) => entry.group).map((entry) => [entry.groupKey, entry])).values()].map((entry) => ({
        groupKey: entry.groupKey,
        ...entry.group.snapshot
    }));

    return {
        idempotencyKey: deriveCartIdempotencyKey({ ...input, leadGuest }),
        currency: currencies[0],
        lead: leadGuest,
        party,
        startDate,
        endDate,
        entries,
        drifted,
        totals: { componentsNetCents: componentsNet, componentsSellCents: componentsSell, adjustmentCents, manualAdjustmentCents: manualCents, sellTotalCents: componentsSell + adjustmentCents },
        snapshot: {
            kind: 'CUSTOM',
            name: input.name ?? 'Your trip',
            items: entries.map((entry) => ({ slotIndex: entry.component.slotIndex, componentType: entry.component.componentType, label: entry.component.label, groupKey: entry.groupKey, packageId: entry.packageId, required: entry.component.required })),
            packages: groups
        }
    };
};

/** What the cart page shows before checkout: each item's availability and price today, nothing written. */
export const quoteCustomOrder = async (input, actor) => {
    try {
        const prepared = await prepareCustomOrder(input, actor, { strict: false });

        return {
            available: true,
            currency: prepared.currency,
            startDate: prepared.startDate,
            endDate: prepared.endDate,
            items: prepared.entries.map((entry) => ({
                index: entry.index,
                slotIndex: entry.component.slotIndex,
                type: entry.item.type,
                componentType: entry.component.componentType,
                label: entry.component.label,
                groupKey: entry.groupKey,
                quotedCents: entry.prepared.quotedCents,
                currentCents: entry.prepared.currentCents,
                adjustmentCents: entry.adjustmentCents,
                lineTotalCents: entry.lineTotalCents,
                priceChanged: Boolean(entry.prepared.priceChanged),
                dates: datesOf(entry.item.type === 'PACKAGE' ? entry.component.componentType : entry.item.type, entry.prepared)
            })),
            priceChanged: prepared.drifted.length > 0,
            drifted: prepared.drifted,
            // The supplier net is the platform's margin: staff's business only.
            totals: canViewMargin(actor) ? prepared.totals : { componentsSellCents: prepared.totals.componentsSellCents, adjustmentCents: prepared.totals.adjustmentCents, sellTotalCents: prepared.totals.sellTotalCents }
        };
    } catch (error) {
        if (error instanceof ConflictError && error.details?.reason === 'UNAVAILABLE') {
            return { available: false, reason: 'UNAVAILABLE', items: error.details.items };
        }

        if (error instanceof UnprocessableEntityError && error.details?.reason === 'MIXED_CURRENCY') {
            return { available: false, reason: 'MIXED_CURRENCY', currencies: error.details.currencies };
        }

        throw error;
    }
};

/** Holds every hotel room and tour seat in the cart for the checkout countdown, in one transaction. */
export const holdCustomOffers = async (items, actor) => {
    const holds = {};
    let expiresAt = null;
    const note = (at) => {
        expiresAt = expiresAt === null || at < expiresAt ? at : expiresAt;
    };

    await prisma.$transaction(async (tx) => {
        for (const [index, item] of items.entries()) {
            if (item.type === 'HOTEL_STAY' && item.offerToken) {
                const offer = readOfferToken(item.offerToken);
                const priced = await revalidateOffer(offer, actor, { strict: false });
                const hold = await createHoldIn(tx, {
                    offer: { roomTypeId: offer.roomTypeId, ratePlanId: offer.ratePlanId, checkIn: offer.checkIn, checkOut: offer.checkOut, rooms: offer.rooms, adults: offer.adults, childAges: offer.childAges },
                    quote: priced.quote,
                    actor
                });
                holds[index] = hold.token;
                note(hold.expiresAt);
            } else if (item.type === 'TOUR' && item.offerToken) {
                const offer = readTourOfferToken(item.offerToken);
                const priced = await revalidateTourOffer(offer, actor, { strict: false });
                const hold = await createTourHoldIn(tx, {
                    offer: { tourOptionId: offer.tourOptionId, date: offer.date, units: priced.units, adults: offer.adults, childAges: offer.childAges },
                    quote: priced.quote,
                    actor
                });
                holds[index] = hold.token;
                note(hold.expiresAt);
            }
        }
    });

    // Packages take their own holds, slot by slot, as a package order does.
    for (const [index, item] of items.entries()) {
        if (item.type === 'PACKAGE') {
            const held = await holdOrderOffers(item.packageToken, actor);
            holds[index] = held.holdTokens;
            if (held.expiresAt) note(held.expiresAt);
        }
    }

    return { holds, expiresAt };
};

/**
 * Books the cart: one transaction, every child in lock order, one order, one
 * receivable, one approval. Replays on the idempotency key like a package.
 */
export const confirmCustomOrder = async (input, actor, req) => {
    const idempotencyKey = deriveCartIdempotencyKey(input);
    const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: orderInclude });

    const replayOf = (order) => {
        assertReplayOwner(() => assertMayRead(order, actor, { email: input.leadGuest?.email }));

        return { order, replayed: true };
    };

    if (existing) {
        return replayOf(existing);
    }

    const prepared = await prepareCustomOrder(input, actor);

    try {
        const order = await prisma.$transaction(
            async (tx) => {
                await assertCreditInTx(tx, actor?.partnerId, { addCents: prepared.totals.sellTotalCents, currency: prepared.currency }, actor, req);

                const reference = await nextOrderReference(tx);
                const approval = approvalModeFor(actor, { manual: Boolean(input.manual), confirmNow: Boolean(input.confirmNow) });
                const { status: _status, confirmedAt: _at, ...approvalStamps } = approvalStampsFor(approval);

                const created = await tx.order.create({
                    data: {
                        reference,
                        status: 'PENDING_CONFIRMATION',
                        ...approvalStamps,
                        idempotencyKey,
                        partnerId: actor?.partnerId ?? null,
                        bookedByUserId: actor?.id ?? null,
                        kind: 'CUSTOM',
                        packageId: null,
                        startDate: dateOnlyToUtc(prepared.startDate),
                        endDate: dateOnlyToUtc(prepared.endDate),
                        adults: prepared.party.adults,
                        childAges: prepared.party.childAges,
                        rooms: prepared.party.rooms ?? 1,
                        currency: prepared.currency,
                        componentsNetCents: prepared.totals.componentsNetCents,
                        componentsSellCents: prepared.totals.componentsSellCents,
                        adjustmentCents: prepared.totals.adjustmentCents,
                        sellTotalCents: prepared.totals.sellTotalCents,
                        commissionRateBps: actor?.partner?.commissionRateBps ?? null,
                        leadName: `${prepared.lead.firstName} ${prepared.lead.lastName}`,
                        leadEmail: prepared.lead.email,
                        leadPhone: prepared.lead.phone ?? null,
                        specialRequests: input.specialRequests ?? null,
                        packageSnapshot: prepared.snapshot,
                        source: sourceFor(actor, input.channel ?? null),
                        ...deskColumns({ desk: deskFrom(input) }, { adjustment: false })
                    }
                });

                for (const entry of prepared.entries) {
                    const child = await confirmChildInTx(tx, entry, `${idempotencyKey}:${entry.component.slotIndex}`, actor, req);
                    const requested = child.status === 'PENDING';
                    const awaiting = child.status === 'PENDING_APPROVAL';

                    await tx.orderItem.create({
                        data: {
                            orderId: created.id,
                            slotIndex: entry.component.slotIndex,
                            componentType: entry.component.componentType,
                            label: entry.component.label,
                            required: entry.component.required,
                            status: awaiting ? 'AWAITING_APPROVAL' : requested ? 'REQUESTED' : 'CONFIRMED',
                            fulfilment: requested ? 'ON_REQUEST' : 'INTERNAL',
                            [CHILD_KEY[entry.component.componentType]]: child.id,
                            netCents: entry.netCents,
                            sellCents: entry.prepared.currentCents,
                            adjustmentCents: entry.adjustmentCents,
                            lineTotalCents: entry.lineTotalCents,
                            packageId: entry.packageId,
                            packageSlotIndex: entry.packageSlotIndex,
                            groupKey: entry.groupKey,
                            adjustmentSource: entry.adjustmentSource
                        }
                    });
                }

                await recordAudit(tx, {
                    action: 'ORDER_CREATED',
                    actor,
                    entityType: AUDIT_ENTITY.order,
                    entityId: created.id,
                    summary: `Order ${reference} from the cart: ${prepared.entries.length} item${prepared.entries.length === 1 ? '' : 's'}`,
                    metadata: { reference, kind: 'CUSTOM', items: prepared.entries.length, packages: prepared.snapshot.packages.length, totalCents: prepared.totals.sellTotalCents, currency: prepared.currency },
                    req
                });

                if (prepared.totals.manualAdjustmentCents) {
                    await recordAudit(tx, {
                        action: 'BOOKING_PRICE_ADJUSTED',
                        actor,
                        entityType: AUDIT_ENTITY.order,
                        entityId: created.id,
                        summary: `${reference} sold at ${prepared.totals.manualAdjustmentCents > 0 ? '+' : ''}${(prepared.totals.manualAdjustmentCents / 100).toFixed(2)} ${prepared.currency} on the catalogue price`,
                        metadata: { reference, catalogueCents: prepared.totals.componentsSellCents, adjustmentCents: prepared.totals.manualAdjustmentCents, reason: input.priceAdjustment?.reason ?? null },
                        req
                    });
                }

                const rolled = await tx.order.findUnique({ where: { id: created.id }, include: orderInclude });
                const status = impliedOrderStatus(rolled.items);
                const deadlines = rolled.items.filter((item) => item.status === 'REQUESTED').map((item) => childDeadline(childOf(item))).filter(Boolean).sort((a, b) => a - b);
                const finished = await tx.order.update({
                    where: { id: created.id },
                    data: { status, requestDeadlineAt: deadlines[0] ?? null, ...(status === 'CONFIRMED' ? { confirmedAt: new Date() } : {}) },
                    include: orderInclude
                });

                await syncOrderReceivableInTx(tx, created.id, actor, req);

                await enqueueEvent(tx, {
                    topic: status === 'PENDING_APPROVAL' ? TOPICS.BOOKING_AWAITING_APPROVAL : status === 'CONFIRMED' ? TOPICS.ORDER_CONFIRMED : TOPICS.ORDER_REQUESTED,
                    payload: status === 'PENDING_APPROVAL' ? { product: 'ORDER', bookingId: created.id } : { orderId: created.id },
                    entityType: AUDIT_ENTITY.order,
                    entityId: created.id
                });
                await enqueueEvent(tx, { topic: TOPICS.BOOKING_CREATED, payload: { product: 'ORDER', bookingId: created.id }, entityType: AUDIT_ENTITY.order, entityId: created.id });

                return tx.order.findUnique({ where: { id: finished.id }, include: orderInclude });
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

        const transfer = prepared.entries.find((entry) => entry.component.componentType === 'TRANSFER');
        const driverConflict = transfer ? driverConflictFor(err, transfer.prepared) : null;

        if (driverConflict) {
            throw driverConflict;
        }

        throw err;
    }
};
