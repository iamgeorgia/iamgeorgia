import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireApprovedPartner, requireCapability, requirePartner } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    findDeadlineOr404,
    listDeadlines,
    listReminderPolicies,
    moveDeadline,
    putReminderPolicy,
    toDeadline,
    toReminderPolicy
} from '../services/booking/deadline.service.js';
import { deadlineParamSchema, deadlineQuerySchema, moveDeadlineSchema, reminderPolicyQuerySchema, reminderPolicySchema } from '../validation/deadline.js';

/**
 * The deadline calendar and the reminder schedule.
 *
 * Reading needs the bookings or the ledger (the latter sees PAYMENT rows
 * only; the service scopes it). Moving one is decided by its kind in the
 * service — Finance's rule for a payment, `bookings.deadlines.write` for
 * the rest — so the router only asks for a signed-in member of staff.
 */
export const adminDeadlineRoutes = Router();

adminDeadlineRoutes.use(authenticate, requireCapability(CAPABILITIES.BOOKINGS_READ, CAPABILITIES.FINANCE_RECEIVABLES_READ));

adminDeadlineRoutes.get('/', validate({ query: deadlineQuerySchema }), async (req, res) => {
    const { rows, ...page } = await listDeadlines(req.valid.query, req.user);

    res.json({ data: rows, ...page });
});

adminDeadlineRoutes.get('/:id', validate({ params: deadlineParamSchema }), async (req, res) => {
    const row = await findDeadlineOr404(req.valid.params.id, req.user);

    res.json(toDeadline(row, { history: row.history }));
});

adminDeadlineRoutes.patch('/:id', validate({ params: deadlineParamSchema, body: moveDeadlineSchema }), async (req, res) => {
    const row = await moveDeadline(req.valid.params.id, req.valid.body, req.user, req);

    res.json(toDeadline(row, { history: row.history }));
});

/** The reminder schedule: platform rows and partner overrides. */
export const adminReminderPolicyRoutes = Router();

adminReminderPolicyRoutes.use(authenticate, requireCapability(CAPABILITIES.BOOKINGS_READ, CAPABILITIES.SETTINGS_REMINDERS_WRITE));

adminReminderPolicyRoutes.get('/', validate({ query: reminderPolicyQuerySchema }), async (req, res) => {
    res.json({ data: (await listReminderPolicies(req.valid.query)).map(toReminderPolicy) });
});

adminReminderPolicyRoutes.put('/', requireCapability(CAPABILITIES.SETTINGS_REMINDERS_WRITE), validate({ body: reminderPolicySchema }), async (req, res) => {
    const policy = await putReminderPolicy(req.valid.body, req.user, req);

    res.json(policy ? toReminderPolicy(policy) : { removed: true });
});

/** A partner's own deadlines, scoped on the session. */
export const partnerDeadlineRoutes = Router();

partnerDeadlineRoutes.use(authenticate, requirePartner, requireApprovedPartner, requireCapability(CAPABILITIES.PARTNER_BOOKINGS_READ));

partnerDeadlineRoutes.get('/', validate({ query: deadlineQuerySchema }), async (req, res) => {
    const { rows, ...page } = await listDeadlines(req.valid.query, req.user);

    res.json({ data: rows, ...page });
});
