import { Router } from 'express';

import {
    authenticate,
    optionalAuthenticate,
    requireApprovedPartner,
    requirePartner,
    requireTransferOps
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKeyFrom } from '../lib/idempotency.js';
import {
    amendTransferSchema,
    cancelTransferSchema,
    confirmTransferSchema,
    guestLookupSchema,
    referenceParamSchema,
    transferBookingQuerySchema
} from '../validation/transfer.js';
import {
    amendTransferBooking,
    cancelTransferBooking,
    confirmTransferBooking,
    findTransferBookingOr404,
    listTransferBookings,
    quoteTransferCancellation,
    summarizeTransferBookings
} from '../services/transfer/booking.service.js';
import {
    toCancellationQuote,
    toTransferBooking,
    toTransferBookingSummary
} from '../serializers/transfer.js';
import { sendTransferVoucher } from '../services/transfer/notify.service.js';
import { submitRatingForBookingLeg } from '../services/transfer/rating.service.js';
import { legIndexParamSchema, submitRatingSchema } from '../validation/rating.js';
import { toRatingPublic } from '../serializers/rating.js';

/**
 * Transfer bookings.
 *
 * Nothing here accepts an amount. The request carries a signed quote token,
 * the people travelling and the paperwork a driver needs; every figure is
 * recomputed from the catalogue before anything is written.
 */
export const transferBookingRoutes = Router();

transferBookingRoutes.use(optionalAuthenticate);

/**
 * Confirms a transfer.
 *
 * Idempotent: an `Idempotency-Key` header, or a key derived from the request,
 * means a retry returns the original booking with 200 rather than dispatching a
 * second car with 201.
 */
transferBookingRoutes.post('/', validate({ body: confirmTransferSchema }), async (req, res) => {
    const { booking, replayed } = await confirmTransferBooking(
        {
            ...req.valid.body,
            idempotencyKey: idempotencyKeyFrom(req)
        },
        req.user,
        req
    );

    // After the commit, never inside it: the transaction should not be held
    // open for the length of an SMTP conversation, and a mail server that is
    // down must not roll back a confirmed booking.
    if (!replayed) {
        await sendTransferVoucher(booking);
    }

    res.status(replayed ? 200 : 201).json(toTransferBooking(booking, req.user));
});

transferBookingRoutes.get(
    '/:reference',
    validate({ params: referenceParamSchema, query: guestLookupSchema }),
    async (req, res) => {
        const booking = await findTransferBookingOr404(
            req.valid.params.reference,
            req.user,
            req.valid.query
        );

        res.json(toTransferBooking(booking, req.user));
    }
);

/** What cancelling would cost, read off the frozen schedule. */
transferBookingRoutes.get(
    '/:reference/cancellation-quote',
    validate({ params: referenceParamSchema, query: guestLookupSchema }),
    async (req, res) => {
        const booking = await findTransferBookingOr404(
            req.valid.params.reference,
            req.user,
            req.valid.query
        );

        res.json(toCancellationQuote(quoteTransferCancellation(booking)));
    }
);

/**
 * Amends the paperwork.
 *
 * The lead passenger, how to reach them, the flight and the two addresses.
 * Nothing that was priced is reachable, so this endpoint cannot change what a
 * transfer costs.
 */
transferBookingRoutes.patch(
    '/:reference',
    validate({ params: referenceParamSchema, body: amendTransferSchema }),
    async (req, res) => {
        const booking = await amendTransferBooking(
            req.valid.params.reference,
            req.valid.body,
            req.user,
            req
        );

        res.json(toTransferBooking(booking, req.user));
    }
);

transferBookingRoutes.post(
    '/:reference/cancel',
    validate({ params: referenceParamSchema, body: cancelTransferSchema }),
    async (req, res) => {
        const { booking, quote } = await cancelTransferBooking(
            req.valid.params.reference,
            req.valid.body,
            req.user,
            req
        );

        res.json({
            ...toTransferBookingSummary(booking, req.user),
            cancellation: toCancellationQuote(quote)
        });
    }
);

/** A partner's own transfer bookings, scoped in the query rather than after. */
export const partnerTransferBookingRoutes = Router();

// Approved partners only, as every other partner register: a partner still
// waiting for approval has a login, not a portal.
partnerTransferBookingRoutes.use(authenticate, requirePartner, requireApprovedPartner);

partnerTransferBookingRoutes.get(
    '/',
    validate({ query: transferBookingQuerySchema }),
    async (req, res) => {
        const { bookings, ...page } = await listTransferBookings(req.valid.query, req.user);

        res.json({
            data: bookings.map((booking) => toTransferBookingSummary(booking, req.user)),
            ...page
        });
    }
);

/**
 * One of the partner's bookings, with the driver on each leg once the driver
 * has accepted — and the driver's phone number once the pick-up is close.
 */
partnerTransferBookingRoutes.get(
    '/:reference',
    validate({ params: referenceParamSchema }),
    async (req, res) => {
        const booking = await findTransferBookingOr404(req.valid.params.reference, req.user);

        res.json(toTransferBooking(booking, req.user));
    }
);

/**
 * A partner's word on the driver of one leg. One per leg; a second is a 409.
 * Published straight away without a comment, held for a look with one.
 */
partnerTransferBookingRoutes.post(
    '/:reference/legs/:legIndex/rating',
    validate({ params: legIndexParamSchema, body: submitRatingSchema }),
    async (req, res) => {
        const { reference, legIndex } = req.valid.params;
        const rating = await submitRatingForBookingLeg(
            reference,
            legIndex,
            req.valid.body,
            { source: 'PARTNER', submittedByUserId: req.user.id, viewer: req.user },
            req.user,
            req
        );

        res.status(201).json(toRatingPublic(rating));
    }
);

/**
 * Every transfer booking on the platform, for operations staff. A dispatcher
 * reads the same list an admin does; the serializer withholds the net figures
 * from anyone who is not an admin.
 */
export const adminTransferBookingRoutes = Router();

adminTransferBookingRoutes.use(authenticate, requireTransferOps);

adminTransferBookingRoutes.get(
    '/',
    validate({ query: transferBookingQuerySchema }),
    async (req, res) => {
        const { bookings, ...page } = await listTransferBookings(req.valid.query, req.user);

        res.json({
            data: bookings.map((booking) => toTransferBookingSummary(booking, req.user)),
            ...page
        });
    }
);

/** The screen's tiles, aggregated. Before `/:reference`, so the word is a route. */
adminTransferBookingRoutes.get('/summary', async (req, res) => {
    res.json(await summarizeTransferBookings());
});

adminTransferBookingRoutes.get(
    '/:reference',
    validate({ params: referenceParamSchema }),
    async (req, res) => {
        const booking = await findTransferBookingOr404(req.valid.params.reference, req.user);

        res.json(toTransferBooking(booking, req.user));
    }
);

adminTransferBookingRoutes.post(
    '/:reference/cancel',
    validate({ params: referenceParamSchema, body: cancelTransferSchema }),
    async (req, res) => {
        const { booking, quote } = await cancelTransferBooking(
            req.valid.params.reference,
            req.valid.body,
            req.user,
            req
        );

        res.json({
            ...toTransferBookingSummary(booking, req.user),
            cancellation: toCancellationQuote(quote)
        });
    }
);
