import { allocate } from '../package/quote.service.js';
import { toDateOnly } from '../../lib/time.js';

/**
 * The lines a document is made of, one per room and per transfer leg, each
 * with the structured description a buyer expects to read on an invoice:
 * the hotel and its city, the room and meal plan, the dates and times, the
 * names; the route, the flight, the vehicle, the passengers. Nothing here
 * is invented — a field the booking does not carry is left out.
 *
 * Money: the receivable's `amountCents` is the authority and the lines must
 * add up to it exactly. Weights (a room's subtotal, a leg's fare) decide the
 * split by largest remainder; the desk's price adjustment is its own line;
 * a cancelled booking is one line for the charge.
 */

const TITLES = { MR: 'MR.', MRS: 'MRS.', MS: 'MS.', MISS: 'MISS', MSTR: 'MSTR.' };
const DEFAULT_TZ = 'Asia/Tbilisi';

/** `12.06.2027` from a `@db.Date` (read in UTC, which is how the column round-trips). */
const dateText = (value) => {
    if (!value) return null;
    const [y, m, d] = toDateOnly(value).split('-');

    return `${d}.${m}.${y}`;
};

const partsIn = (instant, timeZone) =>
    Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
            .formatToParts(instant)
            .map((part) => [part.type, part.value])
    );

/** `12.06.2027 / 10:30` for an instant, in the place's own time. */
const instantText = (instant, timeZone = DEFAULT_TZ) => {
    if (!instant) return { date: null, time: null };
    const p = partsIn(instant, timeZone);

    return { date: `${p.day}.${p.month}.${p.year}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
};

/** `BERIDZE / NINO MRS.`, `BERIDZE / LUKA (CHD 7)`, `BERIDZE / ANA (INF)`. */
const paxText = (person) => {
    const name = `${(person.lastName ?? '').toUpperCase()} / ${(person.firstName ?? '').toUpperCase()}`.trim();
    const honorific = person.title && TITLES[person.title] ? ` ${TITLES[person.title]}` : '';

    if (person.type === 'CHILD') return `${name}${honorific} (CHD${person.age !== null && person.age !== undefined ? ` ${person.age}` : ''})`;
    if (person.type === 'INFANT') return `${name}${honorific} (INF)`;

    return `${name}${honorific}`;
};

const pax = (people) =>
    (people ?? []).map((person) => ({
        lastName: person.lastName,
        firstName: person.firstName,
        title: person.title ?? null,
        type: person.type ?? 'ADULT',
        age: person.age ?? null,
        text: paxText(person)
    }));

const line = ({ kind, description, quantity = 1, unitCents = null, taxRateBps, totalGrossCents, bookingReference, detail = null }) => ({
    kind,
    description,
    quantity,
    unitCents,
    taxRateBps,
    totalGrossCents,
    bookingReference,
    detail
});

const place = (hotelSnapshot, destination) => {
    const city = hotelSnapshot?.city ?? destination?.name ?? null;
    const country = hotelSnapshot?.country ?? destination?.countryCode ?? hotelSnapshot?.countryCode ?? null;

    return { city, country, text: [country, city].filter(Boolean).join(' / ') || null };
};

/** Weights that cannot all be zero: an equal split when nothing is priced. */
const split = (total, weights) => (weights.some((w) => w > 0) ? allocate(total, weights) : allocate(total, weights.map(() => 1)));

// --- per product ----------------------------------------------------------------------------

const hotelLines = (hotel, { amountCents, taxRateBps, reference, prefix = '' }) => {
    const where = place(hotel.hotelSnapshot, hotel.hotel?.destination);
    const checkIn = dateText(hotel.checkIn);
    const checkOut = dateText(hotel.checkOut);
    const nights = hotel.nights ?? 1;
    const checkInFrom = hotel.hotelSnapshot?.checkIn?.from ?? null;
    const checkOutUntil = hotel.hotelSnapshot?.checkOut?.until ?? null;
    const name = hotel.hotelSnapshot?.name ?? 'Hotel';
    const rooms = (hotel.rooms ?? []).filter((room) => room.status !== 'CANCELLED');
    const adjustment = hotel.priceAdjustmentCents ?? 0;
    const roomsTotal = amountCents - adjustment;

    if (hotel.status === 'CANCELLED' || rooms.length === 0 || roomsTotal <= 0) {
        return [
            line({
                kind: hotel.status === 'CANCELLED' ? 'CANCELLATION_CHARGE' : 'HOTEL_ROOM',
                description: `${prefix}${name}${hotel.status === 'CANCELLED' ? ' (cancellation charge)' : ''}: ${checkIn} – ${checkOut} · ${hotel.reference}`,
                taxRateBps,
                totalGrossCents: amountCents,
                bookingReference: reference,
                detail: { kind: 'HOTEL_STAY', hotel: { name, ...where }, checkIn: { date: checkIn, from: checkInFrom }, checkOut: { date: checkOut, until: checkOutUntil }, nights, text: `HOTEL ${name}${where.text ? ` · ${where.text}` : ''}\nCheck-in ${checkIn}${checkInFrom ? ` / ${checkInFrom}` : ''} · Check-out ${checkOut}${checkOutUntil ? ` / ${checkOutUntil}` : ''} · ${nights} night${nights === 1 ? '' : 's'}` }
            })
        ];
    }

    const shares = split(roomsTotal, rooms.map((room) => room.sellSubtotalCents ?? 0));

    const roomLines = rooms.map((room, index) => {
        const people = pax(room.guests);
        const guestsText = people.map((person) => person.text).join(', ');
        const occupancy = `${room.adults} adult${room.adults === 1 ? '' : 's'}${room.childAges?.length ? `, ${room.childAges.length} child${room.childAges.length === 1 ? '' : 'ren'}` : ''}`;

        return line({
            kind: 'HOTEL_ROOM',
            description: `${prefix}${name} · ${room.roomTypeName}, ${room.mealPlanName} · ${checkIn} – ${checkOut} (${nights} night${nights === 1 ? '' : 's'}) · ${hotel.reference}`,
            quantity: nights,
            unitCents: Math.round(shares[index] / nights),
            taxRateBps,
            totalGrossCents: shares[index],
            bookingReference: reference,
            detail: {
                kind: 'HOTEL_ROOM',
                hotel: { name, ...where },
                room: { typeName: room.roomTypeName, ratePlanName: room.ratePlanName, mealPlan: room.mealPlanName, mealPlanCode: room.mealPlanCode ?? null, occupancy },
                checkIn: { date: checkIn, from: checkInFrom },
                checkOut: { date: checkOut, until: checkOutUntil },
                nights,
                rooms: rooms.length,
                pax: people,
                text: [
                    `HOTEL ${name}${where.text ? ` · ${where.text}` : ''}`,
                    `Room: ${room.roomTypeName} · Meal plan: ${room.mealPlanName}${rooms.length > 1 ? ` · Room ${index + 1} of ${rooms.length}` : ''}`,
                    `Check-in ${checkIn}${checkInFrom ? ` / ${checkInFrom}` : ''} · Check-out ${checkOut}${checkOutUntil ? ` / ${checkOutUntil}` : ''} · ${nights} night${nights === 1 ? '' : 's'}`,
                    guestsText ? `PAX: ${guestsText}` : null
                ]
                    .filter(Boolean)
                    .join('\n')
            }
        });
    });

    return [...roomLines, ...adjustmentLine(adjustment, { taxRateBps, reference: hotel.reference, bookingReference: reference, reason: hotel.priceAdjustmentReason })];
};

const transferLines = (transfer, { amountCents, taxRateBps, reference, prefix = '' }) => {
    const legs = transfer.legs ?? [];
    const adjustment = transfer.priceAdjustmentCents ?? 0;
    const extrasTotal = (transfer.extras ?? []).reduce((sum, extra) => sum + (extra.totalCents ?? 0), 0);
    const journeysTotal = amountCents - adjustment;
    const vehicle = transfer.vehicleSnapshot?.name ?? null;
    const passengers = (transfer.adults ?? 0) + (transfer.children ?? 0);

    if (transfer.status === 'CANCELLED' || legs.length === 0 || journeysTotal <= 0) {
        const first = legs[0];
        const route = first ? `${first.fromPointName} → ${first.toPointName}${legs.length > 1 ? ' and return' : ''}` : 'Transfer';
        const when = instantText(transfer.pickupAt, first?.fromPoint?.timezone ?? transfer.routeSnapshot?.fromTimezone ?? DEFAULT_TZ);

        return [
            line({
                kind: transfer.status === 'CANCELLED' ? 'CANCELLATION_CHARGE' : 'TRANSFER_LEG',
                description: `${prefix}Transfer ${route}${transfer.status === 'CANCELLED' ? ' (cancellation charge)' : ''}, ${when.date} · ${transfer.reference}`,
                taxRateBps,
                totalGrossCents: amountCents,
                bookingReference: reference,
                detail: { kind: 'TRANSFER', route, date: when.date, time: when.time, vehicle, passengers, text: `TRANSFER ${route}\nDate: ${when.date}${when.time ? ` · Pick-up: ${when.time}` : ''}${vehicle ? ` · Vehicle: ${vehicle}` : ''} · Passengers: ${passengers}` }
            })
        ];
    }

    const weights = [...legs.map((leg) => leg.sellCents ?? 0), ...(extrasTotal > 0 ? [extrasTotal] : [])];
    const shares = split(journeysTotal, weights);

    const legLines = legs.map((leg, index) => {
        const fromKind = leg.fromPoint?.kind ?? null;
        const toKind = leg.toPoint?.kind ?? null;
        const label = fromKind === 'AIRPORT' ? 'ARRIVAL' : toKind === 'AIRPORT' ? 'DEPARTURE' : leg.direction === 'RETURN' ? 'RETURN' : 'TRANSFER';
        const timeZone = leg.fromPoint?.timezone ?? transfer.routeSnapshot?.fromTimezone ?? DEFAULT_TZ;
        const when = instantText(leg.pickupAt, timeZone);
        const flight = leg.flightNumber ?? (leg.direction === 'OUTBOUND' ? transfer.flightNumber ?? null : null);
        const route = `${leg.fromPointName} → ${leg.toPointName}`;
        const heading = label === 'TRANSFER' ? 'TRANSFER' : `TRANSFER — ${label}`;

        return line({
            kind: 'TRANSFER_LEG',
            description: `${prefix}${label === 'TRANSFER' ? 'Transfer' : `${label[0]}${label.slice(1).toLowerCase()} transfer`} ${route}, ${when.date}${when.time ? ` ${when.time}` : ''} · ${transfer.reference}`,
            taxRateBps,
            totalGrossCents: shares[index],
            bookingReference: reference,
            detail: {
                kind: 'TRANSFER_LEG',
                label,
                direction: leg.direction,
                from: leg.fromPointName,
                to: leg.toPointName,
                date: when.date,
                time: when.time,
                flightNumber: flight,
                vehicle,
                passengers,
                text: [
                    heading,
                    `From: ${leg.fromPointName} · To: ${leg.toPointName}`,
                    `${label === 'DEPARTURE' ? 'Departure' : label === 'ARRIVAL' ? 'Arrival' : 'Pick-up'} date: ${when.date}${when.time ? ` · ${label === 'DEPARTURE' ? 'Pick-up' : 'Time'}: ${when.time}` : ''}`,
                    flight ? `Flight: ${flight}` : null,
                    `${vehicle ? `Vehicle: ${vehicle} · ` : ''}Passengers: ${passengers}`
                ]
                    .filter(Boolean)
                    .join('\n')
            }
        });
    });

    const extraLines =
        extrasTotal > 0
            ? [
                  line({
                      kind: 'EXTRA',
                      description: `${prefix}Extras: ${(transfer.extras ?? []).map((extra) => `${extra.quantity > 1 ? `${extra.quantity} × ` : ''}${extra.name}`).join(', ')} · ${transfer.reference}`,
                      taxRateBps,
                      totalGrossCents: shares[legs.length],
                      bookingReference: reference,
                      detail: { kind: 'EXTRA', items: (transfer.extras ?? []).map((extra) => ({ name: extra.name, quantity: extra.quantity })), text: `Extras: ${(transfer.extras ?? []).map((extra) => `${extra.quantity > 1 ? `${extra.quantity} × ` : ''}${extra.name}`).join(', ')}` }
                  })
              ]
            : [];

    return [...legLines, ...extraLines, ...adjustmentLine(adjustment, { taxRateBps, reference: transfer.reference, bookingReference: reference, reason: transfer.priceAdjustmentReason })];
};

const tourLines = (tour, { amountCents, taxRateBps, reference, prefix = '' }) => {
    const adjustment = tour.priceAdjustmentCents ?? 0;
    const title = tour.tourSnapshot?.title ?? 'Tour';
    const option = tour.tourSnapshot?.option?.name ?? null;
    const date = dateText(tour.date);
    const endDate = tour.endDate ? dateText(tour.endDate) : null;
    const people = pax(tour.travellers);
    const travellers = people.length || (tour.adults ?? 0) + (tour.childAges?.length ?? 0);
    const departure = tour.tourSnapshot?.option?.departureTime ?? tour.tourSnapshot?.meetingTime ?? null;
    const meetingPoint = tour.tourSnapshot?.meetingPointName ?? tour.tourSnapshot?.meetingPoint ?? null;
    const cancelled = tour.status === 'CANCELLED';

    return [
        line({
            kind: cancelled ? 'CANCELLATION_CHARGE' : 'TOUR',
            description: `${prefix}${title}${option ? ` (${option})` : ''}${cancelled ? ' (cancellation charge)' : ''}, ${date}, ${travellers} traveller${travellers === 1 ? '' : 's'} · ${tour.reference}`,
            taxRateBps,
            totalGrossCents: cancelled ? amountCents : amountCents - adjustment,
            bookingReference: reference,
            detail: {
                kind: 'TOUR',
                title,
                option,
                date,
                endDate: endDate && endDate !== date ? endDate : null,
                departureTime: departure,
                meetingPoint,
                travellers,
                pax: people,
                text: [
                    `TOUR ${title}${option ? ` · ${option}` : ''}`,
                    `Date: ${date}${endDate && endDate !== date ? ` – ${endDate}` : ''}${departure ? ` · Departs ${departure}` : ''}${meetingPoint ? ` · Meeting point: ${meetingPoint}` : ''}`,
                    people.length > 0 ? `PAX: ${people.map((person) => person.text).join(', ')}` : `Travellers: ${travellers}`
                ].join('\n')
            }
        }),
        ...(cancelled ? [] : adjustmentLine(adjustment, { taxRateBps, reference: tour.reference, bookingReference: reference, reason: tour.priceAdjustmentReason }))
    ];
};

const serviceLines = (service, { amountCents, taxRateBps, reference, prefix = '' }) => {
    const adjustment = service.priceAdjustmentCents ?? 0;
    const name = service.serviceSnapshot?.name ?? 'Service';
    const date = dateText(service.date);
    const endDate = service.endDate ? dateText(service.endDate) : null;
    const cancelled = service.status === 'CANCELLED';
    const quantity = service.quantity ?? 1;

    return [
        line({
            kind: cancelled ? 'CANCELLATION_CHARGE' : 'SERVICE',
            description: `${prefix}${name}${cancelled ? ' (cancellation charge)' : ''}, ${date} · ${service.reference}`,
            taxRateBps,
            totalGrossCents: cancelled ? amountCents : amountCents - adjustment,
            bookingReference: reference,
            detail: {
                kind: 'SERVICE',
                name,
                date,
                endDate: endDate && endDate !== date ? endDate : null,
                quantity,
                pax: service.pax ?? null,
                days: service.days ?? null,
                text: `SERVICE ${name}\nDate: ${date}${endDate && endDate !== date ? ` – ${endDate}` : ''}${quantity > 1 ? ` · Quantity: ${quantity}` : ''}${service.pax ? ` · Persons: ${service.pax}` : ''}`
            }
        }),
        ...(cancelled ? [] : adjustmentLine(adjustment, { taxRateBps, reference: service.reference, bookingReference: reference, reason: service.priceAdjustmentReason }))
    ];
};

const adjustmentLine = (cents, { taxRateBps, reference, bookingReference, reason }) =>
    cents
        ? [
              line({
                  kind: 'ADJUSTMENT',
                  description: `${cents < 0 ? 'Discount' : 'Surcharge'}${reason ? `: ${reason}` : ''} · ${reference}`,
                  taxRateBps,
                  totalGrossCents: cents,
                  bookingReference,
                  detail: { kind: 'ADJUSTMENT', reason: reason ?? null, text: `${cents < 0 ? 'Discount' : 'Surcharge'}${reason ? `: ${reason}` : ''}` }
              })
          ]
        : [];

const CHILD_BUILDERS = { hotelBooking: hotelLines, transferBooking: transferLines, tourBooking: tourLines, serviceBooking: serviceLines };

const orderLines = (order, { amountCents, taxRateBps, reference }) => {
    const name = order.packageSnapshot?.name ?? (order.kind === 'CUSTOM' ? 'Order' : 'Package');
    const owed = (item) => (item.status === 'DECLINED' || item.status === 'AWAITING_APPROVAL' ? 0 : item.status === 'CANCELLED' ? Math.max(0, item.cancellationChargeCents ?? 0) : item.lineTotalCents);
    const items = order.items.filter((item) => owed(item) > 0);

    if (items.length > 0 && items.reduce((sum, item) => sum + owed(item), 0) === amountCents) {
        return items.flatMap((item) => {
            const childKey = Object.keys(CHILD_BUILDERS).find((key) => item[key]);
            const child = childKey ? item[childKey] : null;

            if (!child) {
                return [
                    line({
                        kind: item.status === 'CANCELLED' ? 'CANCELLATION_CHARGE' : 'MANUAL',
                        description: `${name} · ${item.label}${item.status === 'CANCELLED' ? ' (cancellation charge)' : ''} · ${order.reference}`,
                        taxRateBps,
                        totalGrossCents: owed(item),
                        bookingReference: reference,
                        detail: null
                    })
                ];
            }

            // The item's price is the line's: the child's own split (rooms,
            // legs) is kept in the detail, the money follows the order.
            const built = CHILD_BUILDERS[childKey]({ ...child, status: item.status === 'CANCELLED' ? 'CANCELLED' : child.status, priceAdjustmentCents: 0 }, { amountCents: owed(item), taxRateBps, reference, prefix: `${name} · ` });

            if (built.length === 1) return built;

            return [
                line({
                    kind: built[0].kind,
                    description: `${name} · ${item.label}${item.status === 'CANCELLED' ? ' (cancellation charge)' : ''} · ${order.reference}`,
                    taxRateBps,
                    totalGrossCents: owed(item),
                    bookingReference: reference,
                    detail: { ...built[0].detail, text: built.map((entry) => entry.detail?.text).filter(Boolean).join('\n\n') }
                })
            ];
        });
    }

    return [line({ kind: 'MANUAL', description: `${name}, from ${dateText(order.startDate)} · ${order.reference}`, taxRateBps, totalGrossCents: amountCents, bookingReference: reference, detail: null })];
};

/** The lines a document is made of, adding up to exactly what is owed. */
export const buildDetailedLines = (receivable, { taxRateBps, amountCents }) => {
    const { hotelBooking: hotel, transferBooking: transfer, tourBooking: tour, serviceBooking: service, order } = receivable;
    const common = { amountCents, taxRateBps, reference: receivable.reference };

    if (order) return orderLines(order, common);
    if (hotel) return hotelLines(hotel, common);
    if (transfer) return transferLines(transfer, common);
    if (tour) return tourLines(tour, common);
    if (service) return serviceLines(service, common);

    return [line({ kind: 'MANUAL', description: `Booking ${receivable.reference}`, taxRateBps, totalGrossCents: amountCents, bookingReference: receivable.reference })];
};

/** The columns a line carries: what `draftInTx` writes and what is copied to a chained document. */
export const LINE_FIELDS = Object.freeze(['kind', 'description', 'quantity', 'unitCents', 'taxRateBps', 'totalGrossCents', 'bookingReference', 'detail']);

export const pickLine = (source) => Object.fromEntries(LINE_FIELDS.map((key) => [key, source[key] ?? (key === 'quantity' ? 1 : null)]));
