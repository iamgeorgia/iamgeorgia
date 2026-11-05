import { Router } from 'express';

import { authenticate, requireDriver } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ACTOR } from '../lib/transfer/machines.js';
import { driverSelfUpdateSchema } from '../validation/driver.js';
import {
    assignmentParamSchema,
    driverAssignmentQuerySchema,
    legStatusSchema,
    optionalReasonSchema
} from '../validation/dispatch.js';
import { findDriverByUserId, updateDriverSelf } from '../services/transfer/driver.service.js';
import {
    findDriverAssignmentOr404,
    listDriverAssignments,
    respondToAssignment,
    transitionLeg
} from '../services/transfer/dispatch.service.js';
import { toDriverSelf } from '../serializers/driver.js';
import { toAssignmentForDriver } from '../serializers/dispatch.js';
import { toFleetVehiclePublic } from '../serializers/fleet.js';
import { driverRatingSummary } from '../services/transfer/rating.service.js';
import {
    listNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    toNotification
} from '../services/notifications/notification.service.js';
import { notificationParamSchema, notificationQuerySchema } from '../validation/dispatch.js';

/**
 * The driver panel's API.
 *
 * Every query is scoped on `req.driver.id`, which `requireDriver` resolved
 * from the session — never on anything the client sent. An assignment that
 * belongs to another driver does not exist here. Nothing under this router
 * ever serialises a fare.
 */
export const driverRoutes = Router();

driverRoutes.use(authenticate, requireDriver);

driverRoutes.get('/me', async (req, res) => {
    res.json(toDriverSelf(await findDriverByUserId(req.user.id)));
});

driverRoutes.patch('/me', validate({ body: driverSelfUpdateSchema }), async (req, res) => {
    res.json(toDriverSelf(await updateDriverSelf(req.driver.id, req.valid.body, req.user, req)));
});

/** The driver's standing: the average, the count and the distribution. Never the comments. */
driverRoutes.get('/me/ratings', async (req, res) => {
    res.json(await driverRatingSummary(req.driver.id));
});

driverRoutes.get('/vehicles', async (req, res) => {
    const driver = await findDriverByUserId(req.user.id);

    res.json({
        data: (driver?.vehicles ?? []).map((link) => ({ ...toFleetVehiclePublic(link.fleetVehicle), isPrimary: link.isPrimary }))
    });
});

driverRoutes.get('/assignments', validate({ query: driverAssignmentQuerySchema }), async (req, res) => {
    const { assignments, ...page } = await listDriverAssignments(req.driver.id, req.valid.query);

    res.json({ data: assignments.map(toAssignmentForDriver), ...page });
});

driverRoutes.get('/assignments/:id', validate({ params: assignmentParamSchema }), async (req, res) => {
    res.json(toAssignmentForDriver(await findDriverAssignmentOr404(req.driver.id, req.valid.params.id)));
});

driverRoutes.post('/assignments/:id/accept', validate({ params: assignmentParamSchema }), async (req, res) => {
    const assignment = await respondToAssignment(req.valid.params.id, 'accept', {}, req.driver, req.user, req);

    res.json(toAssignmentForDriver(assignment));
});

driverRoutes.post(
    '/assignments/:id/decline',
    validate({ params: assignmentParamSchema, body: optionalReasonSchema }),
    async (req, res) => {
        const assignment = await respondToAssignment(req.valid.params.id, 'decline', req.valid.body, req.driver, req.user, req);

        res.json(toAssignmentForDriver(assignment));
    }
);

/**
 * A milestone. The URL names the assignment so a superseded offer cannot
 * touch the leg; the service checks the driver holds the live one.
 */
driverRoutes.post(
    '/assignments/:id/status',
    validate({ params: assignmentParamSchema, body: legStatusSchema }),
    async (req, res) => {
        const assignment = await findDriverAssignmentOr404(req.driver.id, req.valid.params.id);

        await transitionLeg(
            assignment.legId,
            req.valid.body,
            { actorKind: ACTOR.DRIVER, driver: req.driver },
            req.user,
            req
        );

        res.json(toAssignmentForDriver(await findDriverAssignmentOr404(req.driver.id, req.valid.params.id)));
    }
);

// --- The bell -----------------------------------------------------------------

driverRoutes.get('/notifications', validate({ query: notificationQuerySchema }), async (req, res) => {
    const { notifications, ...page } = await listNotifications(req.user.id, req.valid.query);

    res.json({ data: notifications.map((row) => toNotification(row, 'driver')), ...page });
});

driverRoutes.post('/notifications/read-all', async (req, res) => {
    const { count } = await markAllNotificationsRead(req.user.id);

    res.json({ count });
});

driverRoutes.post('/notifications/:id/read', validate({ params: notificationParamSchema }), async (req, res) => {
    const { notification } = await markNotificationRead(req.user.id, req.valid.params.id);

    res.json(toNotification(notification, 'driver'));
});
