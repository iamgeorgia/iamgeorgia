import { createHash } from 'node:crypto';

import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import {
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnprocessableEntityError
} from '../../lib/errors.js';
import { assertReplayOwner } from '../../lib/idempotency.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { syncBookingInTx, syncBookingReceivableInTx, syncPayableInTx } from '../finance/ledger.service.js';
import { assertCreditInTx } from '../finance/credit.service.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { nextHotelBookingReference } from '../../lib/reference.js';
import { addDays, dateOnlyToUtc, nightsBetween, toDateOnly } from '../../lib/time.js';
import { readsAllBookings } from '../../middleware/auth.js';
import { CAPABILITIES, can } from '../../lib/permissions.js';
import { readOfferToken } from '../../lib/hotel/offerToken.js';
import { sourceFor } from '../../lib/booking/source.js';
import { approvalModeFor, approvalStampsFor, decidedByFor } from '../../lib/booking/approval.js';
import { AMENDABLE_BOOKING_STATUSES } from '../../lib/booking/machines.js';
import { ORDER_LINK_SELECT, RECEIVABLE_SUMMARY_SELECT } from '../../lib/finance/paymentStatus.js';
import { DESK_INCLUDE, applyAdjustmentToQuote, auditPriceAdjustment, deskColumns, deskFrom } from '../../lib/booking/desk.js';
import { syncBookingIndexInTx } from '../booking/index.service.js';
import { bookingOrderBy, bookingWhere } from '../../lib/listing/bookingFilters.js';
import { revalidateOffer } from './search.service.js';
import { buildCancellationSchedule, calculateRefund } from './policy.service.js';
import { categorise, DEFAULT_CHILD_POLICY } from './occupancy.service.js';
import { commitHold, createHold, createHoldIn, findUsableHold, releaseBookedUnits } from './availability.service.js';
import {
    ALWAYS_REQUESTABLE_CODES,
    KOSHER_AMENITY_CATEGORIES
} from '../../db/seed/kosherAmenities.js';

/**
 * Bookings.
 *
 * Two properties this file exists to guarantee:
 *
 *   1. **Nothing the client sends about money is believed.** The request carries
 *      identifiers, dates, guests and a token. Availability, occupancy, nightly
 *      rates, taxes and the final amount are all recomputed here, and a price
 *      that has moved is a 409 rather than a silent charge.
 *
 *   2. **The booking is a snapshot.** Hotel name, room name, board, cancellation
 *      terms and every night's price are frozen onto it. The foreign keys stay
 *      for reporting; nothing that a guest was promised is ever re-read from a
 *      record the hotel can edit afterwards.
 */

export const bookingInclude = {
    // `supplierId` is selected so the serializer can tell whether the viewer
    // owns this property, which decides whether it sees the net side.
    hotel: {
        select: { id: true, slug: true, name: true, timezone: true, currency: true, supplierId: true }
    },
    partner: { select: { id: true, reference: true, name: true } },
    rooms: {
        include: {
            nights: { orderBy: { date: 'asc' } },
            guests: true
        }
    },
    requests: { orderBy: { createdAt: 'asc' } },
    // Where the money stands: this booking's receivable, or its order's.
    receivable: RECEIVABLE_SUMMARY_SELECT,
    orderItem: ORDER_LINK_SELECT,
    ...DESK_INCLUDE
};

/**
 * A key derived from the request, so a retry is recognisable as one.
 *
 * The client may supply its own; when it does not, the hold token plus the
 * guest details is a natural key — the same checkout submitted twice hashes the
 * same way, and two genuinely different bookings never collide.
 */
const deriveIdempotencyKey = (input) =>
    input.idempotencyKey ??
    createHash('sha256')
        .update(
            [
                input.holdToken ?? input.offerToken ?? '',
                input.leadGuest.email,
                input.leadGuest.lastName,
                input.checkIn ?? '',
                input.checkOut ?? ''
            ].join('|')
        )
        .digest('base64url');

/**
 * What this property can actually be asked for.
 *
 * A capability says the hotel *can*; a request says this guest *needs*. Keeping
 * them apart is the whole reason requests are validated here rather than simply
 * stored: an agency that asks a hotel with no mikveh for a mikveh should be told
 * so at the point of booking, not discover it at the desk.
 *
 * The vocabulary is the hotel's own kosher amenities plus a small always-askable
 * set — a property that serves kosher food can be asked for a kosher meal even
 * if nobody remembered to tick the box, and refusing that would make the form
 * useless for exactly the properties it matters most to.
 */
const requestableCodes = async (client, hotelId) => {
    const amenities = await client.hotelAmenity.findMany({
        where: { hotelId, amenity: { category: { in: KOSHER_AMENITY_CATEGORIES } } },
        select: { amenity: { select: { code: true } } }
    });

    return new Set([...amenities.map((entry) => entry.amenity.code), ...ALWAYS_REQUESTABLE_CODES]);
};

/**
 * 422 naming exactly what the property does not do.
 *
 * A 422 rather than a 400: the request is well formed, it is the property that
 * cannot meet it — the same distinction the publish checklist already draws.
 */
const assertRequestsSupported = async (client, hotelId, requests) => {
    if (!requests?.length) {
        return;
    }

    const allowed = await requestableCodes(client, hotelId);
    const unsupported = requests.map(({ code }) => code).filter((code) => !allowed.has(code));

    if (unsupported.length > 0) {
        throw new UnprocessableEntityError(
            'This property does not offer some of those requirements',
            { unsupported }
        );
    }
};

const snapshotHotel = (hotel) => ({
    id: hotel.id,
    slug: hotel.slug,
    name: hotel.name,
    address: hotel.address ?? null,
    postalCode: hotel.postalCode ?? null,
    countryCode: hotel.countryCode,
    // The city and country as they read on a document; the destination join
    // is the fallback for rows snapshotted before these existed.
    city: hotel.destination?.name ?? null,
    country: hotel.destination?.countryCode ?? hotel.countryCode ?? null,
    phone: hotel.phone ?? null,
    email: hotel.email ?? null,
    timezone: hotel.timezone,
    starRating: hotel.starRating,
    propertyType: hotel.propertyType,
    checkIn: { from: hotel.checkInFrom ?? null, until: hotel.checkInUntil ?? null },
    checkOut: { from: hotel.checkOutFrom ?? null, until: hotel.checkOutUntil ?? null },
    latitude: hotel.latitude ?? null,
    longitude: hotel.longitude ?? null
});

const bedText = (roomType) => {
    const beds = (roomType?.beds ?? []).filter((bed) => (bed.groupIndex ?? 0) === 0);

    if (beds.length === 0) {
        return null;
    }

    return beds.map((bed) => `${bed.quantity} x ${bed.bedType.name}`).join(' + ');
};

/**
 * Everything a confirmation needs that can be worked out *before* a
 * transaction is opened: the offer or the hold, a fresh price, the frozen
 * cancellation schedule and the requirement check. It reads a lot and holds
 * no locks, which is why it is not inside the transaction.
 *
 * Split from the commit so a package can prepare several products up front
 * and then commit them together in one transaction — see
 * `confirmHotelBookingInTx`. With `strict` (the default, and what the
 * standalone endpoint uses) a price that moved is thrown here as a 409; with
 * `strict: false` the result carries `priceChanged` and both figures instead,
 * so an orchestrator can report every drifted component at once rather than
 * the first one it happened to meet.
 */
export const prepareHotelBooking = async (input, actor, { strict = true } = {}) => {
    const offer = input.holdToken ? null : readOfferToken(input.offerToken);

    let hold = null;
    let priced;
    let quotedCents;

    if (input.holdToken) {
        hold = await findUsableHold(prisma, input.holdToken);

        // A hold names a room type and a rate plan but not a hotel, so the
        // property is resolved through the room it holds. Passing a null
        // hotelId into the revalidation query would be a Prisma validation
        // error rather than the 404 it looks like.
        const owner = await prisma.roomType.findUnique({
            where: { id: hold.roomTypeId },
            select: { hotelId: true }
        });

        if (!owner) {
            throw new NotFoundError('That room is no longer available');
        }

        priced = await revalidateOffer(
            {
                hotelId: owner.hotelId,
                roomTypeId: hold.roomTypeId,
                ratePlanId: hold.ratePlanId,
                checkIn: toDateOnly(hold.checkIn),
                checkOut: toDateOnly(hold.checkOut),
                adults: hold.adults,
                childAges: hold.childAges,
                rooms: hold.quantity,
                quotedSellCents: hold.quotedSellCents,
                currency: hold.currency
            },
            actor,
            // Price only: the hold is what guarantees the rooms, and asking the
            // availability query would have it trip over its own claim.
            { strict: false, requireAvailability: false }
        );

        quotedCents = hold.quotedSellCents;
    } else {
        // No hold: price it now, claim it in the transaction. Convenient for a
        // server-to-server partner booking, and the claim is identical.
        priced = await revalidateOffer(offer, actor, { strict });
        quotedCents = offer.quotedSellCents;
    }

    const currentCents = priced.quote.totals.totalCents;
    const priceChanged = currentCents !== quotedCents;

    // The hold guarantees the rooms, not the price. A rate the hotel moved
    // while the guest was typing is a question for the guest, not something to
    // absorb silently in either direction.
    if (strict && priceChanged) {
        throw new ConflictError('The price for this booking has changed', {
            reason: 'PRICE_CHANGED',
            quotedCents,
            currentCents,
            currency: priced.quote.currency
        });
    }

    const hotel = priced.hotel;
    const ratePlan = priced.ratePlan;
    const checkIn = hold ? toDateOnly(hold.checkIn) : offer.checkIn;
    const checkOut = hold ? toDateOnly(hold.checkOut) : offer.checkOut;
    const rooms = hold ? hold.quantity : offer.rooms;
    const adults = hold ? hold.adults : offer.adults;
    const childAges = hold ? hold.childAges : offer.childAges;

    const schedule = buildCancellationSchedule({
        rules: ratePlan.cancellationPolicy?.rules ?? [],
        checkInDate: checkIn,
        checkInTime: hotel.checkInFrom ?? '14:00',
        timezone: hotel.timezone,
        nightlyCents: priced.quote.nights.map((night) => night.sellCents),
        // The schedule is per room; the tax was priced for the whole stay.
        // Rounded down so that, across rooms, nothing is refunded twice.
        includedTaxCents: Math.floor(priced.quote.totals.taxIncludedCents / rooms),
        currency: priced.quote.currency,
        bookedAt: new Date()
    });

    const party = categorise(adults, childAges, DEFAULT_CHILD_POLICY);

    // Before anything is claimed. A requirement the property cannot meet should
    // fail the request outright rather than leave a booking somebody has to
    // unpick, and this is a read that has no business inside the transaction.
    await assertRequestsSupported(prisma, hotel.id, input.requests);

    return {
        kind: 'HOTEL',
        hold,
        priced,
        hotel,
        ratePlan,
        checkIn,
        checkOut,
        rooms,
        adults,
        childAges,
        schedule,
        party,
        leadGuest: input.leadGuest,
        guests: input.guests ?? [],
        requests: input.requests ?? [],
        specialRequests: input.specialRequests ?? null,
        source: sourceFor(actor, input.channel ?? null),
        // Whether this booking waits for the platform's yes (OD1), decided
        // once here so the write below and the facade's email agree.
        approval: approvalModeFor(actor, { manual: Boolean(input.manual), confirmNow: Boolean(input.confirmNow) }),
        desk: deskFrom(input),
        priceChanged,
        quotedCents,
        currentCents,
        currency: priced.quote.currency,
        // What an orchestrator claiming several products sorts on, so every
        // transaction takes its room-type locks in the same order.
        lockKey: ratePlan.roomTypeId
    };
};

/**
 * Writes a prepared booking inside the caller's transaction.
 *
 * The order in here matters. Inventory is claimed *first* — a fresh hold when
 * booking straight from an offer, taken on this transaction so it rolls back
 * with the booking — and moved from held to booked before the transaction
 * ends. If either fails there is no booking, rather than a booking with
 * nothing behind it or a hold with no booking in front of it. Everything in
 * between is bookkeeping that cannot fail for availability reasons.
 *
 * Nothing slow happens in here. No email, no payment call, no HTTP of any kind
 * — the connection is held for the duration and the pool is only
 * DATABASE_POOL_MAX per process.
 *
 * `holdTtlMs` on the inner hold is irrelevant on success (the hold commits
 * with the booking) and irrelevant on failure (it never existed); it only has
 * to be long enough that a sweeper on another connection cannot mistake a
 * hold created a moment ago for an expired one.
 */
export const confirmHotelBookingInTx = async (
    tx,
    prepared,
    { idempotencyKey, holdTtlMs = 60_000 } = {},
    actor,
    req
) => {
    const { hold, priced, hotel, ratePlan, checkIn, checkOut, rooms, adults, childAges, schedule } = prepared;

    // Claimed on this transaction, not its own, so the rooms and the booking
    // commit together or not at all: a hold that outlived a rolled-back
    // booking would block the room until the sweeper noticed.
    const claimedHold =
        hold ??
        (await createHoldIn(tx, {
            offer: {
                roomTypeId: ratePlan.roomTypeId,
                ratePlanId: ratePlan.id,
                checkIn,
                checkOut,
                rooms,
                adults,
                childAges
            },
            quote: priced.quote,
            actor,
            ttlMs: holdTtlMs
        }));

    const reference = await nextHotelBookingReference(tx);

    // CONFIRMED with `confirmedAt`, or PENDING_APPROVAL with the request
    // stamped (OD1). The rooms are claimed either way: a booking waiting for
    // the platform's answer holds its inventory exactly as an on-request tour
    // holds its seats, so that a yes never finds the room gone.
    const stamps = approvalStampsFor(prepared.approval ?? 'AUTO');
    const awaitingApproval = stamps.status === 'PENDING_APPROVAL';

    const created = await tx.hotelBooking.create({
        data: {
            reference,
            ...stamps,
            idempotencyKey: idempotencyKey ?? null,
            partnerId: actor?.partnerId ?? null,
            bookedByUserId: actor?.id ?? null,
            hotelId: hotel.id,
            checkIn: dateOnlyToUtc(checkIn),
            checkOut: dateOnlyToUtc(checkOut),
            nights: nightsBetween(checkIn, checkOut),
            currency: priced.quote.currency,
            netTotalCents: priced.quote.totals.netCents,
            sellTotalCents: priced.quote.totals.sellCents,
            taxTotalCents: priced.quote.totals.taxIncludedCents,
            payableAtPropertyCents: priced.quote.totals.payableAtPropertyCents,
            markupBps: priced.quote.totals.markupBps,
            // The agency's own rate at the time, beside the markup actually applied (a rule may have won).
            commissionRateBps: actor?.partner?.commissionRateBps ?? null,
            leadGuestName: `${prepared.leadGuest.firstName} ${prepared.leadGuest.lastName}`,
            leadGuestEmail: prepared.leadGuest.email,
            leadGuestPhone: prepared.leadGuest.phone ?? null,
            specialRequests: prepared.specialRequests,
            // Structured requirements, stored alongside the free text.
            // They deliberately do NOT hold the booking open: the rooms
            // are claimed and priced, so the reservation is CONFIRMED,
            // and each requirement carries its own answer. Making a meal
            // request gate the room would turn a secured booking into a
            // pending one and would put confirmed inventory into a state
            // cancellation and reconciliation do not expect.
            requests: {
                create: prepared.requests.map((request) => ({
                    code: request.code,
                    note: request.note ?? null
                }))
            },
            hotelSnapshot: snapshotHotel(hotel),
            source: prepared.source,
            ...deskColumns(prepared),
            rooms: {
                // One row per room: two rooms on one booking are two
                // rows, which is what makes cancelling one of them
                // possible later.
                create: Array.from({ length: rooms }, () => ({
                    roomTypeId: ratePlan.roomTypeId,
                    ratePlanId: ratePlan.id,
                    roomTypeName: ratePlan.roomType?.name ?? 'Room',
                    ratePlanName: ratePlan.name,
                    mealPlanCode: ratePlan.mealPlan?.code ?? 'RO',
                    mealPlanName: ratePlan.mealPlan?.name ?? 'Room Only',
                    bedConfigurationText: bedText(ratePlan.roomType),
                    adults,
                    childAges,
                    netSubtotalCents: Math.round(priced.quote.totals.netCents / rooms),
                    sellSubtotalCents: Math.round(priced.quote.totals.sellCents / rooms),
                    cancellationSummary: ratePlan.cancellationPolicy?.description ?? null,
                    cancellationSchedule: schedule,
                    nights: {
                        create: priced.quote.nights.map((night) => ({
                            date: dateOnlyToUtc(night.date),
                            netCents: night.netCents,
                            sellCents: night.sellCents
                        }))
                    },
                    guests: {
                        create: [
                            {
                                type: 'ADULT',
                                title: prepared.leadGuest.title ?? null,
                                firstName: prepared.leadGuest.firstName,
                                lastName: prepared.leadGuest.lastName,
                                isLead: true
                            },
                            ...prepared.guests.map((guest) => ({
                                type: guest.type ?? 'ADULT',
                                title: guest.title ?? null,
                                firstName: guest.firstName,
                                lastName: guest.lastName,
                                age: guest.age ?? null
                            }))
                        ]
                    }
                }))
            }
        }
    });

    await commitHold(tx, claimedHold, created.id);

    await recordAudit(tx, {
        action: 'BOOKING_CREATED',
        actor,
        entityType: AUDIT_ENTITY.booking,
        entityId: created.id,
        summary: `${awaitingApproval ? 'Requested' : 'Booked'} ${hotel.name} for ${checkIn} to ${checkOut}`,
        metadata: {
            reference,
            hotelId: hotel.id,
            ratePlanId: ratePlan.id,
            rooms,
            nights: created.nights,
            totalCents: created.sellTotalCents,
            currency: created.currency,
            status: created.status
        },
        req
    });

    await auditPriceAdjustment(tx, { entityType: AUDIT_ENTITY.booking, booking: created, prepared, catalogueCents: created.sellTotalCents + created.taxTotalCents }, actor, req);

    // The property hears about every reservation of its rooms, however it
    // was sold — once the platform has said yes. The guest's own email is
    // the facade's business: a booking inside an order is described by the
    // order's confirmation instead.
    if (!awaitingApproval) {
        await enqueueSupplierReceived(tx, created.id);
    }

    // What we now owe the property, on its terms. In this transaction, so a
    // booking never exists without its payable.
    await syncPayableInTx(tx, 'HOTEL', created.id, actor, req);

    return tx.hotelBooking.findUnique({ where: { id: created.id }, include: bookingInclude });
};

/**
 * Confirms a booking on its own.
 *
 * The replay is answered before anything is claimed, so a retried request
 * never takes a second room; the preparation runs outside the transaction;
 * the transaction holds locks only for the claim and the writes.
 */
export const confirmBooking = async (input, actor, req) => {
    const idempotencyKey = deriveIdempotencyKey(input);

    const existing = await prisma.hotelBooking.findUnique({
        where: { idempotencyKey },
        include: bookingInclude
    });

    // A replay is a read of the original, and is gated like one: the key
    // alone does not prove the caller made the request it names.
    const replayOf = (booking) => {
        assertReplayOwner(() => assertMayRead(booking, actor, { email: input.leadGuest?.email }));

        return { booking, replayed: true };
    };

    if (existing) {
        return replayOf(existing);
    }

    const prepared = await prepareHotelBooking(input, actor);

    try {
        const booking = await prisma.$transaction(async (tx) => {
            // Before anything is claimed: a booking refused for credit holds no room.
            await assertCreditInTx(
                tx,
                actor?.partnerId,
                { addCents: prepared.priced.quote.totals.sellCents + prepared.priced.quote.totals.taxIncludedCents + prepared.desk.priceAdjustmentCents, currency: prepared.priced.quote.currency },
                actor,
                req
            );

            const created = await confirmHotelBookingInTx(tx, prepared, { idempotencyKey }, actor, req);

            // What the buyer owes. Here, not in the InTx above: inside an
            // order the order is what is owed, and the order says so itself.
            await syncBookingReceivableInTx(tx, 'HOTEL', created.id, actor, req);

            // Written with the booking, sent after it: the voucher and the
            // row commit together, and a mail server having a bad afternoon
            // cannot turn a confirmed room into a 500. A booking that waits
            // for approval gets the "we have your request" note instead, and
            // the voucher follows the yes.
            await enqueueEvent(
                tx,
                created.status === 'PENDING_APPROVAL'
                    ? {
                          topic: TOPICS.BOOKING_AWAITING_APPROVAL,
                          payload: { product: 'HOTEL', bookingId: created.id },
                          entityType: AUDIT_ENTITY.booking,
                          entityId: created.id
                      }
                    : {
                          topic: TOPICS.HOTEL_BOOKING_CONFIRMED,
                          payload: { bookingId: created.id },
                          entityType: AUDIT_ENTITY.booking,
                          entityId: created.id
                      }
            );

            await enqueueEvent(tx, { topic: TOPICS.BOOKING_CREATED, payload: { product: 'HOTEL', bookingId: created.id }, entityType: AUDIT_ENTITY.booking, entityId: created.id });

            // Re-read: the receivable the ledger just opened is part of the answer.
            return tx.hotelBooking.findUnique({ where: { id: created.id }, include: bookingInclude });
        }, { timeout: config.order.txTimeoutMs });

        return { booking, replayed: false, party: prepared.party };
    } catch (err) {
        // Two requests that raced past the replay check both try to insert the
        // same key; the loser is a replay, not a failure.
        if (err?.code === 'P2002') {
            const winner = await prisma.hotelBooking.findUnique({
                where: { idempotencyKey },
                include: bookingInclude
            });

            if (winner) {
                return replayOf(winner);
            }
        }

        throw err;
    }
};

/**
 * Who may read a booking.
 *
 * Three ways in, and the third is the one that needs care:
 *
 *   * An admin reads anything.
 *   * A partner reads its own and nothing else.
 *   * A guest who booked without an account reads theirs by quoting the
 *     reference **and** the lead guest email.
 *
 * The email is not decoration. References come from a sequence — BKG-000001,
 * BKG-000002 — so a reference alone is trivially enumerable, and "manage my
 * booking" pages that ask for reference plus email do so for exactly this
 * reason. Compared case-insensitively because nobody types their own address
 * back the same way twice.
 *
 * Every failure is a 404 rather than a 403, so none of this can be used to
 * discover which references exist.
 */
const assertMayRead = (booking, viewer, { email } = {}) => {
    if (readsAllBookings(viewer)) {
        return;
    }

    if (viewer?.partnerId) {
        if (booking.partnerId !== viewer.partnerId) {
            throw new NotFoundError('Booking not found');
        }

        return;
    }

    const guestBooking = booking.partnerId === null;
    const emailMatches =
        typeof email === 'string' && email.trim().toLowerCase() === booking.leadGuestEmail.toLowerCase();

    if (!guestBooking || !emailMatches) {
        throw new NotFoundError('Booking not found');
    }
};

/**
 * Who may change a booking: cancel it or amend its paperwork.
 *
 * Narrower than reading. Management and finance read every booking, but a
 * cancellation is money — it fixes the charge and the refund — so of the
 * platform side only the roles holding the capability pass (`bookings.cancel`
 * to cancel, `bookings.write` to amend). Everyone else needs the same proof a
 * read does: their own partner's booking, or the lead guest's email. Staff who
 * may read but not change are answered as a stranger would be, with a 404.
 */
const assertMayMutate = (booking, viewer, { capability, ...options }) => {
    if (can(viewer, capability)) {
        return;
    }

    if (readsAllBookings(viewer)) {
        throw new NotFoundError('Booking not found');
    }

    assertMayRead(booking, viewer, options);
};

export const findBookingOr404 = async (reference, viewer, options = {}) => {
    const booking = await prisma.hotelBooking.findFirst({
        where: { OR: [{ id: reference }, { reference }] },
        include: bookingInclude
    });

    if (!booking) {
        throw new NotFoundError('Booking not found');
    }

    assertMayRead(booking, viewer, options);

    return booking;
};

/**
 * Lists bookings for a viewer.
 *
 * `propertyScope` is the supplier extranet's door: the caller has already
 * proved it owns that hotel, and the list is then every booking at it,
 * whichever partner made it. It replaces the partner scoping, never widens
 * beyond the one property, and is the only way a non-admin reads bookings it
 * did not make.
 */
export const listBookings = async (query, viewer, { propertyScope = null } = {}) => {
    const { status, hotelId, partnerId, from, to, search, page, pageSize } = query;

    const where = {
        // A partner's list is scoped in the query, not filtered afterwards.
        ...(readsAllBookings(viewer) || propertyScope ? {} : { partnerId: viewer?.partnerId ?? '__none__' }),
        // The filters every register shares: payment, invoice, manager, customer, created, source, destination.
        ...bookingWhere(query, { destination: (id) => ({ hotel: { destinationId: id } }) }),
        ...(status ? { status: { in: Array.isArray(status) ? status : [status] } } : {}),
        ...(propertyScope ? { hotelId: propertyScope } : hotelId ? { hotelId } : {}),
        ...(readsAllBookings(viewer) && partnerId ? { partnerId } : {}),
        ...(from || to
            ? {
                  checkIn: {
                      ...(from ? { gte: dateOnlyToUtc(from) } : {}),
                      ...(to ? { lte: dateOnlyToUtc(to) } : {})
                  }
              }
            : {}),
        ...(search
            ? {
                  OR: [
                      { reference: { contains: search, mode: 'insensitive' } },
                      { leadGuestName: { contains: search, mode: 'insensitive' } },
                      { leadGuestEmail: { contains: search, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, bookings] = await Promise.all([
        prisma.hotelBooking.count({ where }),
        prisma.hotelBooking.findMany({
            where,
            include: bookingInclude,
            orderBy: bookingOrderBy(query.sort, { dateField: 'checkIn', fallback: { createdAt: 'desc' } }),
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { bookings, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/**
 * Quotes a cancellation without performing it.
 *
 * Read entirely from the frozen schedule. The hotel's current policy is not
 * consulted and must not be: what the guest is owed was settled at booking.
 */
export const quoteCancellation = (booking, at = new Date()) => {
    // A booking the platform has not yet said yes to costs nothing to withdraw.
    if (booking.status === 'PENDING_APPROVAL') {
        return { chargeCents: 0, refundCents: booking.sellTotalCents + (booking.taxTotalCents ?? 0), currency: booking.currency, rooms: [] };
    }

    const active = booking.rooms.filter((room) => room.status === 'CONFIRMED');

    const perRoom = active.map((room) => ({
        bookingRoomId: room.id,
        ...calculateRefund(room.cancellationSchedule, at)
    }));

    return applyAdjustmentToQuote(
        {
            chargeCents: perRoom.reduce((sum, room) => sum + room.chargeCents, 0),
            refundCents: perRoom.reduce((sum, room) => sum + room.refundCents, 0),
            currency: booking.currency,
            rooms: perRoom
        },
        booking,
        { tax: true }
    );
};

/**
 * Cancels an already-loaded booking inside the caller's transaction.
 *
 * `booking` must have been read with `bookingInclude` (and, for anything but
 * a system caller, been through `assertMayRead`). The charge is read off the
 * frozen schedule; `waiveCharges` is for the one case where the platform, not
 * the guest, is walking away — a package component the supplier declined —
 * and records a zero charge without consulting the schedule at all.
 */

/**
 * A booking that belongs to an order is cancelled through the order, whose
 * roll-up and clawback must not be bypassed. 409 with the order reference.
 */
const assertNotInOrder = async (client, column, bookingId) => {
    const item = await client.orderItem.findUnique({ where: { [column]: bookingId }, include: { order: { select: { reference: true } } } });

    if (item) {
        throw new ConflictError('This booking is part of an order; cancel it from the order', {
            reason: 'PART_OF_ORDER',
            orderReference: item.order.reference,
            slotIndex: item.slotIndex
        });
    }
};

export const cancelHotelBookingInTx = async (tx, booking, { reason, waiveCharges = false } = {}, actor, req) => {
    if (booking.status === 'CANCELLED') {
        throw new ConflictError('This booking is already cancelled', { status: booking.status });
    }

    if (booking.status === 'COMPLETED') {
        throw new ConflictError('A completed stay cannot be cancelled', { status: booking.status });
    }

    const quote = waiveCharges
        ? { chargeCents: 0, refundCents: booking.sellTotalCents, currency: booking.currency, rooms: [] }
        : quoteCancellation(booking);

    // Give the rooms back, one statement per room row.
    for (const room of booking.rooms.filter((candidate) => candidate.status === 'CONFIRMED')) {
        if (room.roomTypeId) {
            await releaseBookedUnits(tx, {
                roomTypeId: room.roomTypeId,
                checkIn: booking.checkIn,
                checkOut: booking.checkOut,
                quantity: 1
            });
        }
    }

    await tx.hotelBookingRoom.updateMany({
        where: { bookingId: booking.id, status: 'CONFIRMED' },
        data: { status: 'CANCELLED' }
    });

    // The status the charge was computed against is part of the WHERE, so two
    // cancellations racing past the check above cannot both write: the second
    // finds no row and is refused instead of recording a second charge.
    const cancelled = await tx.hotelBooking
        .update({
            where: { id: booking.id, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
            data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancellationChargeCents: quote.chargeCents,
                cancellationReason: reason ?? null
            }
        })
        .catch((err) => {
            if (err?.code === 'P2025') {
                throw new ConflictError('This booking can no longer be cancelled', { reason: 'STATUS_CHANGED' });
            }

            throw err;
        });

    await recordAudit(tx, {
        action: 'BOOKING_CANCELLED',
        actor,
        entityType: AUDIT_ENTITY.booking,
        entityId: booking.id,
        summary: `Cancelled ${booking.reference}`,
        metadata: {
            reference: booking.reference,
            chargeCents: quote.chargeCents,
            refundCents: quote.refundCents,
            currency: booking.currency,
            ...(reason ? { reason } : {}),
            ...(waiveCharges ? { waived: true } : {})
        },
        req
    });

    await enqueueEvent(tx, {
        topic: TOPICS.SUPPLIER_BOOKING_CANCELLED,
        payload: { product: 'hotel', bookingId: booking.id, reason: reason ?? null },
        entityType: AUDIT_ENTITY.booking,
        entityId: booking.id
    });

    // Both sides follow the charge: the buyer owes it, the property its share (D6).
    await syncBookingInTx(tx, 'HOTEL', booking.id, actor, req);

    return { booking: cancelled, quote };
};

/** The property's "a reservation arrived" note, written once the booking stands. */
const enqueueSupplierReceived = (tx, bookingId) =>
    enqueueEvent(tx, {
        topic: TOPICS.SUPPLIER_BOOKING_RECEIVED,
        payload: { product: 'hotel', bookingId, requested: false },
        entityType: AUDIT_ENTITY.booking,
        entityId: bookingId
    });

const assertAwaitingApproval = (booking) => {
    if (booking.status !== 'PENDING_APPROVAL') {
        throw new ConflictError('That booking is not waiting for approval', { reason: 'NOT_PENDING_APPROVAL', status: booking.status });
    }
};

const statusChanged = (err) => {
    if (err?.code === 'P2025') {
        throw new ConflictError('That booking has moved on since it was read', { reason: 'STATUS_CHANGED' });
    }

    throw err;
};

/**
 * The platform says yes (OD1). The rooms were claimed and priced when the
 * booking was written; this makes it owed — the property is told, the
 * ledger opens the payable and (for a standalone booking) the receivable,
 * which is what issues the proforma. The status is part of the WHERE, so
 * two approvals racing past the check cannot both write.
 */
export const approvePendingHotelBookingInTx = async (tx, booking, actor, req) => {
    assertAwaitingApproval(booking);

    const now = new Date();
    const by = decidedByFor(actor);

    const approved = await tx.hotelBooking
        .update({
            where: { id: booking.id, status: 'PENDING_APPROVAL' },
            data: { status: 'CONFIRMED', confirmedAt: now, approvedAt: now, approvedByUserId: by.userId, approvedByName: by.name },
            include: bookingInclude
        })
        .catch(statusChanged);

    await recordAudit(tx, {
        action: 'BOOKING_APPROVED',
        actor,
        entityType: AUDIT_ENTITY.booking,
        entityId: booking.id,
        summary: `Approved ${booking.reference}`,
        metadata: { reference: booking.reference, totalCents: booking.sellTotalCents, currency: booking.currency },
        req
    });

    await enqueueSupplierReceived(tx, booking.id);

    // The yes is what makes it owed, on both sides. A booking inside an order
    // is skipped on the buyer's side by the ledger itself.
    await syncBookingInTx(tx, 'HOTEL', booking.id, actor, req);

    // Re-read: the ledger has just written what the serializer shows as payment.
    return tx.hotelBooking.findUnique({ where: { id: booking.id }, include: bookingInclude });
};

/**
 * The platform says no, or the sweeper gives up on a booking whose stay has
 * begun unanswered. The rooms go back and nothing is charged; the ledger
 * writes nothing for a booking that was never confirmed.
 */
export const rejectPendingHotelBookingInTx = async (tx, booking, { reason, expired = false } = {}, actor, req) => {
    assertAwaitingApproval(booking);

    for (const room of booking.rooms.filter((candidate) => candidate.status === 'CONFIRMED')) {
        if (room.roomTypeId) {
            await releaseBookedUnits(tx, { roomTypeId: room.roomTypeId, checkIn: booking.checkIn, checkOut: booking.checkOut, quantity: 1 });
        }
    }

    await tx.hotelBookingRoom.updateMany({ where: { bookingId: booking.id, status: 'CONFIRMED' }, data: { status: 'CANCELLED' } });

    const now = new Date();
    const by = decidedByFor(actor);

    const rejected = await tx.hotelBooking
        .update({
            where: { id: booking.id, status: 'PENDING_APPROVAL' },
            data: {
                status: 'CANCELLED',
                cancelledAt: now,
                cancellationChargeCents: 0,
                cancellationReason: reason,
                rejectedAt: now,
                rejectedByUserId: by.userId,
                rejectedByName: by.name,
                rejectionReason: reason
            },
            include: bookingInclude
        })
        .catch(statusChanged);

    await recordAudit(tx, {
        action: expired ? 'BOOKING_APPROVAL_EXPIRED' : 'BOOKING_REJECTED',
        actor,
        entityType: AUDIT_ENTITY.booking,
        entityId: booking.id,
        summary: `${expired ? 'Expired' : 'Rejected'} ${booking.reference}`,
        metadata: { reference: booking.reference, reason },
        req
    });

    await syncBookingInTx(tx, 'HOTEL', booking.id, actor, req);

    return rejected;
};

export const cancelBooking = async (reference, { reason, email } = {}, actor, req) =>
    prisma.$transaction(async (tx) => {
        const booking = await tx.hotelBooking.findFirst({
            where: { OR: [{ id: reference }, { reference }] },
            include: bookingInclude
        });

        if (!booking) {
            throw new NotFoundError('Booking not found');
        }

        // Who may cancel is settled before anything about the booking is
        // revealed, including whether it sits inside an order.
        assertMayMutate(booking, actor, { capability: CAPABILITIES.BOOKINGS_CANCEL, email });

        await assertNotInOrder(tx, 'hotelBookingId', booking.id);

        const result = await cancelHotelBookingInTx(tx, booking, { reason }, actor, req);

        await enqueueEvent(tx, {
            topic: TOPICS.HOTEL_BOOKING_CANCELLED,
            payload: { bookingId: booking.id, chargeCents: result.quote.chargeCents, reason: reason ?? null },
            entityType: AUDIT_ENTITY.booking,
            entityId: booking.id
        });

        return result;
    });

/**
 * Amends a booking without repricing it.
 *
 * The only fields reachable here are the ones that do not touch the sale: the
 * lead guest's name and contact details, and what the property should be told.
 * Dates, rooms, board and every figure are deliberately unreachable — those are
 * a cancellation and a rebooking, because the inventory has to be given back
 * and re-claimed and the price re-quoted, and none of that can be done by
 * editing a row.
 *
 * Only a booking that is still ahead of the guest may be amended. Renaming the
 * lead guest on a stay that has already completed would rewrite history rather
 * than correct a record.
 *
 * The lead guest exists twice — denormalised onto the booking for lists and
 * lookups, and as a `BookingGuest` row per room for the rooming list the
 * property works from. Both are updated in the same transaction; a correction
 * that reached only one of them would put the wrong name on the door.
 */
const AMENDABLE_STATUSES = AMENDABLE_BOOKING_STATUSES;

export const amendBooking = async (reference, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const booking = await tx.hotelBooking.findFirst({
            where: { OR: [{ id: reference }, { reference }] },
            include: bookingInclude
        });

        if (!booking) {
            throw new NotFoundError('Booking not found');
        }

        // The booking desk, the partner that made it, or the guest who can
        // quote the lead email. Reading alone is not enough: a corrected lead
        // email is the guest's credential for everything else.
        assertMayMutate(booking, actor, { capability: CAPABILITIES.BOOKINGS_WRITE, email: input.email });

        if (!AMENDABLE_STATUSES.includes(booking.status)) {
            throw new ConflictError('This booking can no longer be amended', {
                status: booking.status
            });
        }

        const lead = input.leadGuest ?? {};
        const renamed = lead.firstName !== undefined || lead.lastName !== undefined;

        // The guest rows carry the name already split, so the denormalised
        // `leadGuestName` never has to be parsed back apart — which is what
        // would go wrong first for a double-barrelled surname.
        const current = booking.rooms.flatMap((room) => room.guests).find((guest) => guest.isLead);
        const firstName = lead.firstName ?? current?.firstName ?? booking.leadGuestName;
        const lastName = lead.lastName ?? current?.lastName ?? '';

        const data = {
            ...(renamed ? { leadGuestName: `${firstName} ${lastName}`.trim() } : {}),
            ...(lead.email !== undefined ? { leadGuestEmail: lead.email } : {}),
            ...(lead.phone !== undefined ? { leadGuestPhone: lead.phone ?? null } : {}),
            ...(input.specialRequests !== undefined
                ? { specialRequests: input.specialRequests ?? null }
                : {})
        };

        const requestChanges =
            input.requests === undefined
                ? null
                : await reconcileRequests(tx, booking, input.requests);

        const fields = Object.keys(data);

        // An empty amendment is not an error — a form submitted unchanged is an
        // ordinary thing — but it must not leave an audit row saying nothing
        // happened.
        if (fields.length === 0 && !requestChanges?.changed) {
            return booking;
        }

        if (renamed) {
            await tx.bookingGuest.updateMany({
                where: { bookingRoom: { bookingId: booking.id }, isLead: true },
                data: { firstName, lastName }
            });
        }

        if (fields.length > 0) {
            await tx.hotelBooking.update({ where: { id: booking.id }, data });
        }


        await recordAudit(tx, {
            action: 'BOOKING_AMENDED',
            actor,
            entityType: AUDIT_ENTITY.booking,
            entityId: booking.id,
            summary: `Amended ${booking.reference}`,
            metadata: {
                reference: booking.reference,
                fields,
                ...(requestChanges?.changed
                    ? {
                          requestsAdded: requestChanges.added,
                          requestsWithdrawn: requestChanges.withdrawn,
                          requestsRenoted: requestChanges.renoted
                      }
                    : {})
            },
            req
        });

        await enqueueEvent(tx, {
            topic: TOPICS.BOOKING_MODIFIED,
            payload: { product: 'HOTEL', bookingId: booking.id, fields, byUserId: actor?.id ?? null },
            entityType: AUDIT_ENTITY.booking,
            entityId: booking.id
        });

        await syncBookingIndexInTx(tx, 'HOTEL', booking.id);

        return tx.hotelBooking.findUnique({ where: { id: booking.id }, include: bookingInclude });
    });

/**
 * Brings the request set in line with what the amendment asked for.
 *
 * Sent whole rather than patched, so withdrawing one is sending the list
 * without it — the same shape the amenity checklist uses.
 *
 * Two rules, and both are about not letting an agency rewrite history:
 *
 *   * A request the property has already **answered** is left exactly as it is.
 *     Otherwise re-sending a declined requirement would quietly reset it to
 *     REQUESTED, and asking again would look like never having been refused.
 *   * A withdrawal is a status, not a delete. "They asked for a mikveh and
 *     changed their mind" is worth being able to see afterwards.
 */
const reconcileRequests = async (tx, booking, requested) => {
    await assertRequestsSupported(tx, booking.hotelId, requested);

    const existing = booking.requests ?? [];
    const byCode = new Map(existing.map((request) => [request.code, request]));
    const wanted = new Map(requested.map((request) => [request.code, request]));

    const added = [];
    const withdrawn = [];
    const renoted = [];

    for (const [code, request] of wanted) {
        const current = byCode.get(code);

        if (!current) {
            await tx.hotelBookingRequest.create({
                data: { bookingId: booking.id, code, note: request.note ?? null }
            });
            added.push(code);
            continue;
        }

        // Answered is final from this side. The note may still be corrected —
        // the agency clarifying which nights it meant is useful to the property
        // whichever way the answer went.
        if (request.note !== undefined && (request.note ?? null) !== (current.note ?? null)) {
            await tx.hotelBookingRequest.update({
                where: { id: current.id },
                data: { note: request.note ?? null }
            });

            // Counted as a change. Without this a note-only amendment writes to
            // the database and then returns the record as it was read at the
            // top of the transaction — so the caller sees its own edit missing,
            // and no audit row says it happened.
            renoted.push(code);
        }

        if (current.status === 'WITHDRAWN') {
            await tx.hotelBookingRequest.update({
                where: { id: current.id },
                data: { status: 'REQUESTED', respondedAt: null, respondedByUserId: null, responseNote: null }
            });
            added.push(code);
        }
    }

    for (const request of existing) {
        if (wanted.has(request.code) || request.status === 'WITHDRAWN') {
            continue;
        }

        await tx.hotelBookingRequest.update({
            where: { id: request.id },
            data: { status: 'WITHDRAWN', respondedAt: new Date() }
        });
        withdrawn.push(request.code);
    }

    return {
        changed: added.length > 0 || withdrawn.length > 0 || renoted.length > 0,
        added,
        withdrawn,
        renoted
    };
};

/**
 * The property's answer to one requirement.
 *
 * Admin-only, because it is the platform speaking for the hotel: a partner
 * saying its own request is confirmed would be a booking that confirms itself.
 *
 * Answering does not touch the booking's own status. The rooms were secured and
 * priced at confirmation and nothing here changes that — which is the whole
 * distinction between a reservation and a requirement attached to it.
 */
export const answerBookingRequest = async (reference, requestId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const booking = await tx.hotelBooking.findFirst({
            where: { OR: [{ id: reference }, { reference }] },
            include: bookingInclude
        });

        if (!booking) {
            throw new NotFoundError('Booking not found');
        }

        const request = booking.requests.find((entry) => entry.id === requestId);

        if (!request) {
            throw new NotFoundError('Requirement not found');
        }

        if (request.status === 'WITHDRAWN') {
            throw new ConflictError('That requirement was withdrawn', { status: request.status });
        }

        if (request.status === input.status) {
            throw new ConflictError(`That requirement is already ${input.status}`, {
                status: request.status
            });
        }

        await tx.hotelBookingRequest.update({
            where: { id: requestId },
            data: {
                status: input.status,
                respondedAt: new Date(),
                respondedByUserId: actor?.id ?? null,
                responseNote: input.responseNote ?? null
            }
        });

        await recordAudit(tx, {
            action: 'BOOKING_REQUEST_ANSWERED',
            actor,
            entityType: AUDIT_ENTITY.bookingRequest,
            entityId: requestId,
            summary: `${input.status === 'CONFIRMED' ? 'Confirmed' : 'Declined'} "${request.code}" on ${booking.reference}`,
            metadata: {
                reference: booking.reference,
                hotelId: booking.hotelId,
                code: request.code,
                from: request.status
            },
            req
        });

        return tx.hotelBooking.findUnique({ where: { id: booking.id }, include: bookingInclude });
    });

/**
 * Takes a hold from an offer token.
 *
 * Separate from confirmation so a checkout page can secure the rooms while the
 * guest fills in details, which is the whole reason holds exist.
 */
export const holdOffer = async (token, actor, req) => {
    const offer = readOfferToken(token);
    const priced = await revalidateOffer(offer, actor);

    const hold = await createHold({
        offer: {
            roomTypeId: priced.ratePlan.roomTypeId,
            ratePlanId: priced.ratePlan.id,
            checkIn: offer.checkIn,
            checkOut: offer.checkOut,
            rooms: offer.rooms,
            adults: offer.adults,
            childAges: offer.childAges
        },
        quote: priced.quote,
        actor
    });

    return { hold, priced };
};

/** The include an order needs to read this product's bookings by the same shape. */
/**
 * Rolls confirmed stays whose check-out has passed to COMPLETED.
 *
 * Check-out is a calendar date; a stay is over once that date is behind us
 * everywhere, so the cutoff is "check-out on or before yesterday, UTC" — a
 * guest leaving Tbilisi at noon on the 10th is completed by the sweep on the
 * 11th, never on the 10th while they are still at breakfast.
 *
 * No advisory lock: the conditional update is the guard. Two instances that
 * both find the same row race to `updateMany where status = CONFIRMED`, one
 * changes a row and writes the audit line, the other changes nothing and
 * writes nothing. That is the same shape the service sweep uses, and it is
 * safer than a session-scoped lock taken through a connection pool.
 *
 * Orders wait on this: `sweepCompletedOrders` completes an order only when
 * every surviving part has, so this runs first in the same chain.
 */
export const sweepCompletedHotelBookings = async ({ now = new Date(), limit = 500 } = {}) => {
    const yesterday = dateOnlyToUtc(addDays(now.toISOString().slice(0, 10), -1));

    const due = await prisma.hotelBooking.findMany({
        where: { status: 'CONFIRMED', checkOut: { lte: yesterday } },
        select: { id: true, reference: true },
        take: limit
    });

    let completed = 0;

    for (const row of due) {
        await prisma.$transaction(async (tx) => {
            const { count } = await tx.hotelBooking.updateMany({
                where: { id: row.id, status: 'CONFIRMED' },
                data: { status: 'COMPLETED', completedAt: now }
            });

            if (count === 0) {
                return;
            }

            await recordAudit(tx, {
                action: 'BOOKING_COMPLETED',
                actor: null,
                entityType: AUDIT_ENTITY.booking,
                entityId: row.id,
                summary: `Completed ${row.reference}`,
                metadata: { reference: row.reference }
            });
            completed += 1;
        });
    }

    return { completed };
};

export const hotelBookingInclude = bookingInclude;

/** A hotel booking that still owes the operator something. */
const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'];

/**
 * Sums grouped by currency, largest first — the dashboard shows the leading
 * figure and says how many currencies stand behind it, rather than adding
 * lari to dollars.
 */
const byCurrency = (rows) =>
    rows
        .map((row) => ({
            currency: row.currency,
            amountCents: row._sum.sellTotalCents ?? 0,
            count: row._count._all
        }))
        .sort((a, b) => b.amountCents - a.amountCents);

/**
 * The overview's figures: how many bookings are live, and what was booked
 * in the last `days` days.
 *
 * Aggregates in the database rather than a page of rows summed in the
 * client, which is what the dashboard did — capped at a hundred bookings and
 * therefore wrong past the hundredth. "Booked" means created: the window is
 * on `createdAt`, as the label on the tile says, not on the stay's check-in.
 */
export const summarizeBookings = async ({ days }) => {
    const from = new Date(Date.now() - days * 86_400_000);

    const [activeCount, grouped] = await Promise.all([
        prisma.hotelBooking.count({ where: { status: { in: ACTIVE_STATUSES } } }),
        prisma.hotelBooking.groupBy({
            by: ['currency'],
            where: { status: { in: ACTIVE_STATUSES }, createdAt: { gte: from } },
            _sum: { sellTotalCents: true },
            _count: { _all: true }
        })
    ]);

    return { activeCount, recent: { days, from: from.toISOString(), byCurrency: byCurrency(grouped) } };
};
