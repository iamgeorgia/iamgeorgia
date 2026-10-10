import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { inviteLimiter } from '../middleware/rateLimit.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    inviteStaffSchema,
    changeStaffRoleSchema,
    deactivateUserSchema,
    deleteUserSchema,
    userIdParamSchema,
    staffQuerySchema
} from '../validation/user.js';
import { setRolesSchema, overrideSchema, overrideParamSchema } from '../validation/rbac.js';
import { toUserSummary, toUserDetail } from '../serializers/user.js';
import { toRole } from '../serializers/role.js';
import {
    listUsers,
    findUserOr404,
    inviteUser,
    resendActivation,
    changeRole,
    setUserRoles,
    grantable,
    grantOverride,
    revokeOverride,
    deactivateUser,
    reactivateUser,
    revokeSessions,
    deleteUser,
    deliverActivation
} from '../services/user.service.js';

/**
 * Staff accounts: everyone on the platform side of the role table except
 * drivers, who are managed with their profiles under /admin/transfers/drivers.
 *
 * Super admins only. An ADMIN runs the whole operation but does not hand out
 * seats in it; that stays with whoever owns the platform.
 */
export const adminUserRoutes = Router();

adminUserRoutes.use(authenticate, requireCapability(CAPABILITIES.USERS_STAFF_MANAGE));

const STAFF = { partnerId: null };

const ROLE_LABELS = {
    ADMIN: 'Administrator',
    MANAGEMENT: 'Management',
    TOUR_OPERATOR: 'Tour operator',
    ACCOUNTANT: 'Accountant',
    FINANCE_OPERATOR: 'Finance operator',
    DISPATCHER: 'Dispatcher'
};

const activation = (issued) =>
    deliverActivation(issued, {
        template: 'staffAccountActivation',
        data: { roleLabel: ROLE_LABELS[issued.user.role] ?? issued.user.role }
    });

adminUserRoutes.get('/', validate({ query: staffQuerySchema }), async (req, res) => {
    const { users, ...meta } = await listUsers(STAFF, req.valid.query);

    res.json({ data: users.map(toUserSummary), ...meta });
});

adminUserRoutes.post('/', inviteLimiter, validate({ body: inviteStaffSchema }), async (req, res) => {
    const issued = await inviteUser(STAFF, req.valid.body, req.user, req);

    res.status(201).json({ user: toUserSummary(issued.user), ...(await activation(issued)) });
});

adminUserRoutes.get('/:id', validate({ params: userIdParamSchema }), async (req, res) => {
    res.json(toUserDetail(await findUserOr404(req.valid.params.id, STAFF)));
});

/** What the caller may hand out here: the roles it dominates, the capabilities it may write by name. */
adminUserRoutes.get('/:id/grantable', validate({ params: userIdParamSchema }), async (req, res) => {
    await findUserOr404(req.valid.params.id, STAFF);
    const { roles, capabilities } = await grantable(STAFF, req.user);

    res.json({ roles: roles.map(toRole), capabilities });
});

adminUserRoutes.patch(
    '/:id/role',
    validate({ params: userIdParamSchema, body: changeStaffRoleSchema }),
    async (req, res) => {
        res.json(toUserDetail(await changeRole(STAFF, req.valid.params.id, req.valid.body, req.user, req)));
    }
);

/** The whole set the account holds afterwards. */
adminUserRoutes.put('/:id/roles', validate({ params: userIdParamSchema, body: setRolesSchema }), async (req, res) => {
    res.json(toUserDetail(await setUserRoles(STAFF, req.valid.params.id, req.valid.body, req.user, req)));
});

adminUserRoutes.post('/:id/overrides', validate({ params: userIdParamSchema, body: overrideSchema }), async (req, res) => {
    await grantOverride(STAFF, req.valid.params.id, req.valid.body, req.user, req);

    res.status(201).json(toUserDetail(await findUserOr404(req.valid.params.id, STAFF)));
});

adminUserRoutes.delete('/:id/overrides/:capability', validate({ params: overrideParamSchema }), async (req, res) => {
    await revokeOverride(STAFF, req.valid.params.id, req.valid.params.capability, req.user, req);

    res.json(toUserDetail(await findUserOr404(req.valid.params.id, STAFF)));
});

adminUserRoutes.post(
    '/:id/deactivate',
    validate({ params: userIdParamSchema, body: deactivateUserSchema }),
    async (req, res) => {
        res.json(toUserSummary(await deactivateUser(STAFF, req.valid.params.id, req.valid.body, req.user, req)));
    }
);

adminUserRoutes.post('/:id/reactivate', validate({ params: userIdParamSchema }), async (req, res) => {
    res.json(toUserSummary(await reactivateUser(STAFF, req.valid.params.id, req.user, req)));
});

adminUserRoutes.post('/:id/sessions/revoke', validate({ params: userIdParamSchema }), async (req, res) => {
    const { user, count } = await revokeSessions(STAFF, req.valid.params.id, req.user, req);

    res.json({ user: toUserSummary(user), revoked: count });
});

adminUserRoutes.post(
    '/:id/activation/resend',
    inviteLimiter,
    validate({ params: userIdParamSchema }),
    async (req, res) => {
        const issued = await resendActivation(STAFF, req.valid.params.id, req.user, req);

        res.json({ user: toUserSummary(issued.user), ...(await activation(issued)) });
    }
);

adminUserRoutes.delete('/:id', validate({ params: userIdParamSchema, body: deleteUserSchema }), async (req, res) => {
    await deleteUser(STAFF, req.valid.params.id, req.valid.body, req.user, req);

    res.status(204).end();
});
