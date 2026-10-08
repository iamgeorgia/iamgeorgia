import { Router } from 'express';

import {
    authenticate,
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
    archiveServiceSchema,
    cancelServiceBookingSchema,
    confirmServiceBookingSchema,
    createServiceSchema,
    declineServiceBookingSchema,
    serviceBookingQuerySchema,
    serviceLocaleParamSchema,
    serviceParamSchema,
    serviceQuerySchema,
    serviceReferenceParamSchema,
    serviceTranslationSchema,
    updateServiceSchema
} from '../validation/service.js';
import {
    archiveService,
    buildServicePublishChecklist,
    createService,
    deleteService,
    findServiceOr404,
    listServiceTranslations,
    listServices,
    publishService,
    unpublishService,
    updateService,
    upsertServiceTranslation
} from '../services/service/service.service.js';
import {
    cancelServiceBooking,
    confirmPendingServiceBooking,
    confirmServiceBooking,
    declinePendingServiceBooking,
    findServiceBookingOr404,
    listServiceBookings,
    quoteServiceCancellation
} from '../services/service/booking.service.js';
import {
    toServiceBookingDetail,
    toServiceBookingSummary,
    toServiceCancellationQuote,
    toServiceDetail,
    toServiceSummary,
    toServiceTranslation
} from '../serializers/service.js';

/**
 * The service catalogue, for admins, and the service bookings register —
 * the operator's queue for on-request services, and where a partner or an
 * admin books one on its own.
 */
export const adminServiceRoutes = Router();

adminServiceRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.CATALOGUE_READ], write: [CAPABILITIES.CATALOGUE_WRITE] }));

const withChecklist = (service, viewer) => ({
    ...toServiceDetail(service, 'en', viewer),
    publishChecklist: buildServicePublishChecklist(service)
});

adminServiceRoutes.get('/', validate({ query: serviceQuerySchema }), async (req, res) => {
    const { services, ...page } = await listServices(req.valid.query);

    res.json({ data: services.map((service) => toServiceSummary(service, req.valid.query.locale, req.user)), ...page });
});

adminServiceRoutes.post('/', validate({ body: createServiceSchema }), async (req, res) => {
    const service = await createService(req.valid.body, req.user, req);

    res.status(201).json(withChecklist(service, req.user));
});

adminServiceRoutes.get('/:serviceId', validate({ params: serviceParamSchema }), async (req, res) => {
    res.json(withChecklist(await findServiceOr404(req.valid.params.serviceId), req.user));
});

adminServiceRoutes.patch('/:serviceId', validate({ params: serviceParamSchema, body: updateServiceSchema }), async (req, res) => {
    res.json(withChecklist(await updateService(req.valid.params.serviceId, req.valid.body, req.user, req), req.user));
});

adminServiceRoutes.post('/:serviceId/publish', validate({ params: serviceParamSchema }), async (req, res) => {
    res.json(withChecklist(await publishService(req.valid.params.serviceId, req.user, req), req.user));
});

adminServiceRoutes.post('/:serviceId/unpublish', validate({ params: serviceParamSchema }), async (req, res) => {
    res.json(withChecklist(await unpublishService(req.valid.params.serviceId, req.user, req), req.user));
});

adminServiceRoutes.post(
    '/:serviceId/archive',
    validate({ params: serviceParamSchema, body: archiveServiceSchema }),
    async (req, res) => {
        res.json(withChecklist(await archiveService(req.valid.params.serviceId, req.user, req, req.valid.body), req.user));
    }
);

adminServiceRoutes.delete('/:serviceId', validate({ params: serviceParamSchema }), async (req, res) => {
    await deleteService(req.valid.params.serviceId, req.user, req);

    res.status(204).end();
});

adminServiceRoutes.get('/:serviceId/translations', validate({ params: serviceParamSchema }), async (req, res) => {
    const translations = await listServiceTranslations(req.valid.params.serviceId);

    res.json({ data: translations.map(toServiceTranslation) });
});

adminServiceRoutes.put(
    '/:serviceId/translations/:locale',
    validate({ params: serviceLocaleParamSchema, body: serviceTranslationSchema }),
    async (req, res) => {
        const { serviceId, locale } = req.valid.params;

        res.json(toServiceTranslation(await upsertServiceTranslation(serviceId, locale, req.valid.body, req.user, req)));
    }
);

// --- bookings: the admin register -------------------------------------------

export const adminServiceBookingRoutes = Router();

adminServiceBookingRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.BOOKINGS_READ], write: [CAPABILITIES.BOOKINGS_WRITE] }));

adminServiceBookingRoutes.get('/', validate({ query: serviceBookingQuerySchema }), async (req, res) => {
    const { bookings, ...page } = await listServiceBookings(req.valid.query, req.user);

    res.json({ data: bookings.map((booking) => toServiceBookingSummary(booking, req.user)), ...page });
});

adminServiceBookingRoutes.get('/:reference', validate({ params: serviceReferenceParamSchema }), async (req, res) => {
    res.json(toServiceBookingDetail(await findServiceBookingOr404(req.valid.params.reference, req.user), req.user));
});

adminServiceBookingRoutes.get(
    '/:reference/cancellation-quote',
    validate({ params: serviceReferenceParamSchema }),
    async (req, res) => {
        const booking = await findServiceBookingOr404(req.valid.params.reference, req.user);

        res.json(toServiceCancellationQuote(quoteServiceCancellation(booking)));
    }
);

adminServiceBookingRoutes.post('/:reference/confirm', validate({ params: serviceReferenceParamSchema }), async (req, res) => {
    res.json(toServiceBookingDetail(await confirmPendingServiceBooking(req.valid.params.reference, req.user, req), req.user));
});

adminServiceBookingRoutes.post(
    '/:reference/decline',
    validate({ params: serviceReferenceParamSchema, body: declineServiceBookingSchema }),
    async (req, res) => {
        res.json(
            toServiceBookingDetail(
                await declinePendingServiceBooking(req.valid.params.reference, req.valid.body, req.user, req),
                req.user
            )
        );
    }
);

adminServiceBookingRoutes.post(
    '/:reference/cancel',
    requireCapability(CAPABILITIES.BOOKINGS_CANCEL), validate({ params: serviceReferenceParamSchema, body: cancelServiceBookingSchema }),
    async (req, res) => {
        const { booking, quote } = await cancelServiceBooking(req.valid.params.reference, req.valid.body, req.user, req);

        res.json({ ...toServiceBookingSummary(booking, req.user), cancellation: toServiceCancellationQuote(quote) });
    }
);

// --- bookings: partners and staff booking a service on its own --------------

/**
 * Mounted at /service-bookings. A signed-in partner or admin may book a
 * service standalone; the public site does not (services travel inside
 * packages there), which is why this is not under /services.
 */
export const serviceBookingRoutes = Router();

// Approved partners only, for reading as well as booking: a partner still
// waiting for approval has a login, not a portal.
serviceBookingRoutes.use(authenticate, requirePartner, requireApprovedPartner, rejectUnapprovedPartner);

serviceBookingRoutes.post('/', validate({ body: confirmServiceBookingSchema }), async (req, res) => {
    const { booking, replayed } = await confirmServiceBooking(
        { ...req.valid.body, idempotencyKey: idempotencyKeyFrom(req) },
        req.user,
        req
    );

    res.status(replayed ? 200 : 201).json(toServiceBookingDetail(booking, req.user));
});

serviceBookingRoutes.get('/', validate({ query: serviceBookingQuerySchema }), async (req, res) => {
    const { bookings, ...page } = await listServiceBookings(req.valid.query, req.user);

    res.json({ data: bookings.map((booking) => toServiceBookingSummary(booking, req.user)), ...page });
});

serviceBookingRoutes.get('/:reference', validate({ params: serviceReferenceParamSchema }), async (req, res) => {
    res.json(toServiceBookingDetail(await findServiceBookingOr404(req.valid.params.reference, req.user), req.user));
});

serviceBookingRoutes.get(
    '/:reference/cancellation-quote',
    validate({ params: serviceReferenceParamSchema }),
    async (req, res) => {
        res.json(toServiceCancellationQuote(quoteServiceCancellation(await findServiceBookingOr404(req.valid.params.reference, req.user))));
    }
);

serviceBookingRoutes.post(
    '/:reference/cancel',
    validate({ params: serviceReferenceParamSchema, body: cancelServiceBookingSchema }),
    async (req, res) => {
        const { booking, quote } = await cancelServiceBooking(req.valid.params.reference, req.valid.body, req.user, req);

        res.json({ ...toServiceBookingSummary(booking, req.user), cancellation: toServiceCancellationQuote(quote) });
    }
);
