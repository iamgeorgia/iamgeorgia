import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { toOutboxEvent } from '../serializers/outbox.js';
import { listFailedEvents, retryEvent } from '../services/notifications/outbox.service.js';
import { outboxParamSchema, outboxQuerySchema } from '../validation/outbox.js';

/**
 * The outbox's dead letters.
 *
 * An event whose handler failed every attempt is marked processed with its
 * error kept, so the queue never blocks behind it — but until now nobody
 * could see that it had happened. This lists those events and lets an
 * administrator put one back in the queue. Reading is for whoever reads the
 * audit trail; re-queuing sends emails, so it takes an administrator.
 */
export const adminOutboxRoutes = Router();

adminOutboxRoutes.use(authenticate);

adminOutboxRoutes.get(
    '/failed',
    requireCapability(CAPABILITIES.AUDIT_READ, CAPABILITIES.SETTINGS_WRITE),
    validate({ query: outboxQuerySchema }),
    async (req, res) => {
        const { events, ...page } = await listFailedEvents(req.valid.query);

        res.json({ data: events.map(toOutboxEvent), ...page });
    }
);

adminOutboxRoutes.post(
    '/:id/retry',
    requireCapability(CAPABILITIES.PLATFORM_ADMIN, CAPABILITIES.SETTINGS_WRITE),
    validate({ params: outboxParamSchema }),
    async (req, res) => {
        res.json(toOutboxEvent(await retryEvent(req.valid.params.id, req.user, req)));
    }
);
