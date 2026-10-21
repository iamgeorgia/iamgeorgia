/**
 * Where a booking came from, read off the actor rather than off the request.
 *
 * Every public booking route used to accept a `source` the client chose, and
 * every checkout form sent "web" — a partner's booking and an admin's test
 * booking were both "web" by the client's word. The session is the truth: a
 * partner's member books for the partner, a member of staff books at the
 * desk, and nobody at all is the website. Manual bookings name their own
 * channel (phone, email, …) and pass it in as `channel`.
 */
export const BOOKING_SOURCES = Object.freeze(['WEB', 'PARTNER', 'ADMIN', 'PHONE', 'EMAIL', 'EXTERNAL_AGENCY', 'DIRECT', 'DEMO']);

/** The channels the desk may name on a manual booking. */
export const MANUAL_CHANNELS = Object.freeze(['PHONE', 'EMAIL', 'EXTERNAL_AGENCY', 'DIRECT']);

export const sourceFor = (actor, channel = null) => {
    if (channel) return channel;
    if (actor?.partnerId) return 'PARTNER';
    if (actor?.id) return 'ADMIN';

    return 'WEB';
};
