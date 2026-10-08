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
    amendTourBookingSchema,
    cancelTourBookingSchema,
    confirmTourBookingSchema,
    declineTourBookingSchema,
    tourBookingQuerySchema,
    tourGuestLookupSchema,
    tourHoldSchema,
    tourHoldTokenParamSchema,
    tourReferenceParamSchema
} from '../validation/tourBooking.js';
import {
    amendTourBooking,
    cancelTourBooking,
    confirmPendingTourBooking,
    confirmTourBooking,
    declinePendingTourBooking,
    findTourBookingOr404,
    holdTourOffer,
    listTourBookings,
    quoteTourCancellation
} from '../services/tour/booking.service.js';
import { releaseTourHoldByToken } from '../services/tour/availability.service.js';
import {
    toTourBookingDetail,
    toTourBookingSummary,
    toTourCancellationQuote,
    toTourHold
} from '../serializers/tourBooking.js';

/**
 * Tour holds and bookings.
 *
 * The same three routers as hotels — public checkout, the partner's own
 * register, the admin register — under `/tours/bookings` so a TUR reference
 * never shares an endpoint with a BKG one. Nothing here accepts an amount.
 */
export const tourBookingRoutes = Router();

tourBookingRoutes.use(optionalAuthenticate, rejectUnapprovedPartner);

tourBookingRoutes.post('/holds', validate({ body: tourHoldSchema }), async (req, res) => {
    const { hold, priced } = await holdTourOffer(req.valid.body.token, req.user);

    res.status(201).json(toTourHold(hold, priced));
});

tourBookingRoutes.delete('/holds/:token', validate({ params: tourHoldTokenParamSchema }), async (req, res) => {
    await releaseTourHoldByToken(req.valid.params.token);

    res.status(204).end();
});

/**
 * Confirms — or, for an on-request option, requests — a booking. Idempotent:
 * an `Idempotency-Key` header or a key derived from the request means a retry
 * returns the original with 200 rather than a second one with 201.
 */
tourBookingRoutes.post('/', validate({ body: confirmTourBookingSchema }), async (req, res) => {
    const { booking, replayed } = await confirmTourBooking(
        { ...req.valid.body, idempotencyKey: idempotencyKeyFrom(req) },
        req.user,
        req
    );

    res.status(replayed ? 200 : 201).json(toTourBookingDetail(booking, req.user));
});

tourBookingRoutes.get(
    '/:reference',
    validate({ params: tourReferenceParamSchema, query: tourGuestLookupSchema }),
    async (req, res) => {
        const booking = await findTourBookingOr404(req.valid.params.reference, req.user, req.valid.query);

        res.json(toTourBookingDetail(booking, req.user));
    }
);

tourBookingRoutes.get(
    '/:reference/cancellation-quote',
    validate({ params: tourReferenceParamSchema, query: tourGuestLookupSchema }),
    async (req, res) => {
        const booking = await findTourBookingOr404(req.valid.params.reference, req.user, req.valid.query);

        res.json(toTourCancellationQuote(quoteTourCancellation(booking)));
    }
);

tourBookingRoutes.patch(
    '/:reference',
    validate({ params: tourReferenceParamSchema, body: amendTourBookingSchema }),
    async (req, res) => {
        const booking = await amendTourBooking(req.valid.params.reference, req.valid.body, req.user, req);

        res.json(toTourBookingDetail(booking, req.user));
    }
);

tourBookingRoutes.post(
    '/:reference/cancel',
    validate({ params: tourReferenceParamSchema, body: cancelTourBookingSchema }),
    async (req, res) => {
        const { booking, quote } = await cancelTourBooking(req.valid.params.reference, req.valid.body, req.user, req);

        res.json({ ...toTourBookingSummary(booking, req.user), cancellation: toTourCancellationQuote(quote) });
    }
);

/** A partner's own tour bookings, scoped in the query. */
export const partnerTourBookingRoutes = Router();

partnerTourBookingRoutes.use(authenticate, requirePartner, requireApprovedPartner);

partnerTourBookingRoutes.get('/', validate({ query: tourBookingQuerySchema }), async (req, res) => {
    const { bookings, ...page } = await listTourBookings(req.valid.query, req.user);

    res.json({ data: bookings.map((booking) => toTourBookingSummary(booking, req.user)), ...page });
});

/**
 * Every tour booking on the platform, and the operator's answer to a request.
 *
 * Confirming and declining are admin actions because it is the platform
 * speaking for the operator; a partner confirming its own request would be a
 * booking that confirms itself.
 */
export const adminTourBookingRoutes = Router();

adminTourBookingRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.BOOKINGS_READ], write: [CAPABILITIES.BOOKINGS_WRITE] }));

adminTourBookingRoutes.get('/', validate({ query: tourBookingQuerySchema }), async (req, res) => {
    const { bookings, ...page } = await listTourBookings(req.valid.query, req.user);

    res.json({ data: bookings.map((booking) => toTourBookingSummary(booking, req.user)), ...page });
});

adminTourBookingRoutes.get('/:reference', validate({ params: tourReferenceParamSchema }), async (req, res) => {
    const booking = await findTourBookingOr404(req.valid.params.reference, req.user);

    res.json(toTourBookingDetail(booking, req.user));
});

adminTourBookingRoutes.post('/:reference/confirm', validate({ params: tourReferenceParamSchema }), async (req, res) => {
    const booking = await confirmPendingTourBooking(req.valid.params.reference, req.user, req);

    res.json(toTourBookingDetail(booking, req.user));
});

adminTourBookingRoutes.post(
    '/:reference/decline',
    validate({ params: tourReferenceParamSchema, body: declineTourBookingSchema }),
    async (req, res) => {
        const booking = await declinePendingTourBooking(req.valid.params.reference, req.valid.body, req.user, req);

        res.json(toTourBookingDetail(booking, req.user));
    }
);

adminTourBookingRoutes.post(
    '/:reference/cancel',
    requireCapability(CAPABILITIES.BOOKINGS_CANCEL), validate({ params: tourReferenceParamSchema, body: cancelTourBookingSchema }),
    async (req, res) => {
        const { booking, quote } = await cancelTourBooking(req.valid.params.reference, req.valid.body, req.user, req);

        res.json({ ...toTourBookingSummary(booking, req.user), cancellation: toTourCancellationQuote(quote) });
    }
);
