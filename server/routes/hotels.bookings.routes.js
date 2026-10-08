import { Router } from 'express';

import {
    authenticate,
    optionalAuthenticate,
    rejectUnapprovedPartner,
    requireApprovedPartner,
    requireCapability,
    requireCapabilityByMethod,
    requirePartner
} from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKeyFrom } from '../lib/idempotency.js';
import {
    amendBookingSchema,
    answerBookingRequestSchema,
    bookingQuerySchema,
    bookingRequestParamSchema,
    cancelBookingSchema,
    confirmBookingSchema,
    guestLookupSchema,
    holdSchema,
    holdTokenParamSchema,
    referenceParamSchema,
    bookingSummaryQuerySchema
} from '../validation/booking.js';
import {
    amendBooking,
    answerBookingRequest,
    cancelBooking,
    confirmBooking,
    findBookingOr404,
    holdOffer,
    listBookings,
    quoteCancellation,
    summarizeBookings
} from '../services/hotel/booking.service.js';
import { releaseHoldByToken } from '../services/hotel/availability.service.js';
import {
    toBookingDetail,
    toBookingSummary,
    toCancellationQuote,
    toHold
} from '../serializers/booking.js';

/**
 * Holds and bookings.
 *
 * `optionalAuthenticate`, because the same endpoints serve a guest checking out
 * on the website and a partner booking through the API. What differs is the
 * markup applied and what comes back in the response, and both are decided by
 * the session rather than by anything in the request.
 *
 * Nothing here accepts an amount. The request carries identifiers, dates and
 * people; every figure is recomputed.
 */
export const bookingRoutes = Router();

bookingRoutes.use(optionalAuthenticate, rejectUnapprovedPartner);

/** Secures the rooms while the guest fills in their details. */
bookingRoutes.post('/holds', validate({ body: holdSchema }), async (req, res) => {
    const { hold, priced } = await holdOffer(req.valid.body.token, req.user, req);

    res.status(201).json(toHold(hold, priced));
});

// Abandoning checkout gives the rooms back immediately rather than waiting for
// the sweeper, which is the difference between a room coming back now and in
// half a minute.
bookingRoutes.delete('/holds/:token', validate({ params: holdTokenParamSchema }), async (req, res) => {
    await releaseHoldByToken(req.valid.params.token);

    res.status(204).end();
});

/**
 * Confirms a booking.
 *
 * Idempotent: an `Idempotency-Key` header, or a key derived from the request,
 * means a retry returns the original booking with 200 rather than making a
 * second one with 201.
 */
bookingRoutes.post('/', validate({ body: confirmBookingSchema }), async (req, res) => {
    const { booking, replayed } = await confirmBooking(
        { ...req.valid.body, idempotencyKey: idempotencyKeyFrom(req) },
        req.user,
        req
    );

    res.status(replayed ? 200 : 201).json(toBookingDetail(booking, req.user));
});

bookingRoutes.get(
    '/:reference',
    validate({ params: referenceParamSchema, query: guestLookupSchema }),
    async (req, res) => {
        const booking = await findBookingOr404(req.valid.params.reference, req.user, req.valid.query);

        res.json(toBookingDetail(booking, req.user));
    }
);

/** What cancelling would cost, read off the frozen schedule. */
bookingRoutes.get(
    '/:reference/cancellation-quote',
    validate({ params: referenceParamSchema, query: guestLookupSchema }),
    async (req, res) => {
        const booking = await findBookingOr404(req.valid.params.reference, req.user, req.valid.query);

        res.json(toCancellationQuote(quoteCancellation(booking)));
    }
);

/**
 * Amends the paperwork on a booking.
 *
 * Deliberately narrow: the lead guest, how to reach them, and what the property
 * should know. Nothing that was priced is reachable, so this endpoint cannot
 * change what a booking costs — moving dates or rooms means cancelling and
 * booking again, which is the only way the inventory and the quote stay honest.
 */
bookingRoutes.patch(
    '/:reference',
    validate({ params: referenceParamSchema, body: amendBookingSchema }),
    async (req, res) => {
        const booking = await amendBooking(
            req.valid.params.reference,
            req.valid.body,
            req.user,
            req
        );

        res.json(toBookingDetail(booking, req.user));
    }
);

bookingRoutes.post(
    '/:reference/cancel',
    validate({ params: referenceParamSchema, body: cancelBookingSchema }),
    async (req, res) => {
        const { booking, quote } = await cancelBooking(
            req.valid.params.reference,
            req.valid.body,
            req.user,
            req
        );

        res.json({ ...toBookingSummary(booking, req.user), cancellation: toCancellationQuote(quote) });
    }
);

/**
 * A partner's own bookings.
 *
 * Scoped in the query rather than filtered after, so there is no path by which
 * one partner reads another's.
 */
export const partnerBookingRoutes = Router();

// Status as well as identity: a suspended partner keeps its records, but the
// portal behind this gate is not readable while the suspension stands.
// `requireApprovedPartner` lets admins straight through, so the admin-scoped
// listing below still works.
partnerBookingRoutes.use(authenticate, requirePartner, requireApprovedPartner);

partnerBookingRoutes.get('/', validate({ query: bookingQuerySchema }), async (req, res) => {
    const { bookings, ...page } = await listBookings(req.valid.query, req.user);

    res.json({ data: bookings.map((booking) => toBookingSummary(booking, req.user)), ...page });
});

/** Every booking on the platform. */
export const adminBookingRoutes = Router();

adminBookingRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.BOOKINGS_READ], write: [CAPABILITIES.BOOKINGS_WRITE] }));

adminBookingRoutes.get('/', validate({ query: bookingQuerySchema }), async (req, res) => {
    const { bookings, ...page } = await listBookings(req.valid.query, req.user);

    res.json({ data: bookings.map((booking) => toBookingSummary(booking, req.user)), ...page });
});

/**
 * The overview's figures, aggregated here rather than summed over a page of
 * rows in the panel. Declared before `/:reference` so the word is a route,
 * not a booking that does not exist.
 */
adminBookingRoutes.get('/summary', validate({ query: bookingSummaryQuerySchema }), async (req, res) => {
    res.json(await summarizeBookings(req.valid.query));
});

adminBookingRoutes.get('/:reference', validate({ params: referenceParamSchema }), async (req, res) => {
    const booking = await findBookingOr404(req.valid.params.reference, req.user);

    res.json(toBookingDetail(booking, req.user));
});

/**
 * The property's answer to one requirement.
 *
 * Admin-only: this is the platform speaking for the hotel, and a partner
 * confirming its own request would be a booking that confirms itself.
 *
 * It does not touch the booking's status. The rooms were claimed and priced at
 * confirmation; a meal that is still being arranged does not put them back in
 * doubt, and pretending otherwise would break the one guarantee a confirmation
 * makes.
 */
adminBookingRoutes.post(
    '/:reference/requests/:requestId',
    validate({ params: bookingRequestParamSchema, body: answerBookingRequestSchema }),
    async (req, res) => {
        const { reference, requestId } = req.valid.params;
        const booking = await answerBookingRequest(reference, requestId, req.valid.body, req.user, req);

        res.json(toBookingDetail(booking, req.user));
    }
);

adminBookingRoutes.post(
    '/:reference/cancel',
    requireCapability(CAPABILITIES.BOOKINGS_CANCEL), validate({ params: referenceParamSchema, body: cancelBookingSchema }),
    async (req, res) => {
        const { booking, quote } = await cancelBooking(
            req.valid.params.reference,
            req.valid.body,
            req.user,
            req
        );

        res.json({ ...toBookingSummary(booking, req.user), cancellation: toCancellationQuote(quote) });
    }
);
