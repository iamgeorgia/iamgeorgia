/**
 * Public, human-quotable identifiers drawn from Postgres sequences.
 *
 * `nextval` is atomic and lock-free, so concurrent writers cannot be handed the
 * same number — a `SELECT max(...) + 1` or a counter row would need a lock to
 * promise that. The sequence is not transactional: a rolled-back registration
 * burns its number rather than returning it. That is the right trade, because a
 * reused Partner ID or booking reference would be far worse than a gap.
 *
 * Every helper takes the client explicitly so it can be called with a
 * transaction handle and commit alongside the row it belongs to.
 */

/** One entry per sequence. The prefix is what a customer reads over the phone. */
export const REFERENCE_KINDS = {
    partner: { sequence: 'partner_reference_seq', prefix: 'PTR', digits: 6 },
    hotelBooking: { sequence: 'hotel_booking_reference_seq', prefix: 'BKG', digits: 6 },
    transferBooking: { sequence: 'transfer_booking_reference_seq', prefix: 'TRF', digits: 6 },
    tourBooking: { sequence: 'tour_booking_reference_seq', prefix: 'TUR', digits: 6 },
    serviceBooking: { sequence: 'service_booking_reference_seq', prefix: 'SVC', digits: 6 },
    order: { sequence: 'order_reference_seq', prefix: 'ORD', digits: 6 },
    approval: { sequence: 'approval_reference_seq', prefix: 'APR', digits: 6 }
};

const kindOrThrow = (kind) => {
    const spec = REFERENCE_KINDS[kind];

    if (!spec) {
        throw new Error(`Unknown reference kind: ${kind}`);
    }

    return spec;
};

/** Draws the next reference for a kind, e.g. `nextReference(tx, 'partner')`. */
export const nextReference = async (client, kind) => {
    const { sequence, prefix, digits } = kindOrThrow(kind);
    // The sequence name comes from REFERENCE_KINDS, never from a caller, so
    // interpolating it into the statement cannot be turned into an injection.
    const [{ value }] = await client.$queryRawUnsafe(`SELECT nextval('${sequence}') AS value`);

    return `${prefix}-${String(value).padStart(digits, '0')}`;
};

/**
 * True when `value` looks like a reference of that kind. Format check only —
 * it says nothing about whether the row exists.
 *
 * Written without a regular expression on purpose: the pattern has to be built
 * from `prefix` and `digits`, and a literal backslash inside a template string
 * is the kind of thing that silently turns `\d` into `d` and quietly matches
 * nothing.
 */
export const isReference = (value, kind) => {
    const { prefix, digits } = kindOrThrow(kind);
    const head = `${prefix}-`;

    if (typeof value !== 'string' || !value.startsWith(head)) {
        return false;
    }

    const serial = value.slice(head.length);

    return serial.length >= digits && [...serial].every((char) => char >= '0' && char <= '9');
};

export const nextPartnerReference = (client) => nextReference(client, 'partner');
export const isPartnerReference = (value) => isReference(value, 'partner');

export const nextHotelBookingReference = (client) => nextReference(client, 'hotelBooking');
export const isHotelBookingReference = (value) => isReference(value, 'hotelBooking');

export const nextTransferBookingReference = (client) => nextReference(client, 'transferBooking');
export const isTransferBookingReference = (value) => isReference(value, 'transferBooking');

export const nextTourBookingReference = (client) => nextReference(client, 'tourBooking');
export const isTourBookingReference = (value) => isReference(value, 'tourBooking');

export const nextServiceBookingReference = (client) => nextReference(client, 'serviceBooking');
export const isServiceBookingReference = (value) => isReference(value, 'serviceBooking');

export const nextOrderReference = (client) => nextReference(client, 'order');
export const isOrderReference = (value) => isReference(value, 'order');
