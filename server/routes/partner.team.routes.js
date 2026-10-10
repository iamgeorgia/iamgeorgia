import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireApprovedPartner, requireCapability, requirePartner } from '../middleware/auth.js';
import { inviteLimiter } from '../middleware/rateLimit.js';
import { CAPABILITIES } from '../lib/permissions.js';
import {
    inviteTeamMemberSchema,
    changeTeamRoleSchema,
    deactivateUserSchema,
    deleteUserSchema,
    userIdParamSchema,
    teamQuerySchema
} from '../validation/user.js';
import { setRolesSchema } from '../validation/rbac.js';
import { toUserSummary } from '../serializers/user.js';
import { toRole } from '../serializers/role.js';
import {
    listUsers,
    findUserOr404,
    inviteUser,
    resendActivation,
    changeRole,
    setUserRoles,
    grantable,
    deactivateUser,
    reactivateUser,
    revokeSessions,
    deleteUser,
    setPrimaryContact,
    deliverActivation
} from '../services/user.service.js';

/**
 * A partner's own team, managed by its owner or admin.
 *
 * Every call is scoped to the session's company — the scope is built from
 * `req.user.partnerId`, never from input — so another company's user id is
 * simply not found. Owners manage everyone including other owners; admins
 * manage agents and finance users only (`user.service.js` ceilings).
 */
export const partnerTeamRoutes = Router();

partnerTeamRoutes.use(
    authenticate,
    requirePartner,
    requireApprovedPartner,
    requireCapability(CAPABILITIES.PARTNER_TEAM_MANAGE)
);

const scopeOf = (req) => ({ partnerId: req.user.partnerId });

const activation = (req, issued) =>
    deliverActivation(issued, {
        template: 'accountActivation',
        data: { companyName: req.user.partner?.name ?? null }
    });

partnerTeamRoutes.get('/', validate({ query: teamQuerySchema }), async (req, res) => {
    const { users, ...meta } = await listUsers(scopeOf(req), req.valid.query);

    res.json({ data: users.map(toUserSummary), ...meta });
});

partnerTeamRoutes.post('/', inviteLimiter, validate({ body: inviteTeamMemberSchema }), async (req, res) => {
    const issued = await inviteUser(scopeOf(req), req.valid.body, req.user, req);

    res.status(201).json({ user: toUserSummary(issued.user), ...(await activation(req, issued)) });
});

/** What the caller may hand out: the company roles it dominates. Before `/:id`, so the word is a route. */
partnerTeamRoutes.get('/grantable', async (req, res) => {
    const { roles } = await grantable(scopeOf(req), req.user);

    res.json({ roles: roles.map(toRole) });
});

partnerTeamRoutes.get('/:id', validate({ params: userIdParamSchema }), async (req, res) => {
    res.json(toUserSummary(await findUserOr404(req.valid.params.id, scopeOf(req))));
});

partnerTeamRoutes.patch(
    '/:id/role',
    validate({ params: userIdParamSchema, body: changeTeamRoleSchema }),
    async (req, res) => {
        res.json(toUserSummary(await changeRole(scopeOf(req), req.valid.params.id, req.valid.body, req.user, req)));
    }
);

/** The whole set the member holds afterwards. */
partnerTeamRoutes.put('/:id/roles', validate({ params: userIdParamSchema, body: setRolesSchema }), async (req, res) => {
    res.json(toUserSummary(await setUserRoles(scopeOf(req), req.valid.params.id, req.valid.body, req.user, req)));
});

partnerTeamRoutes.patch('/:id/primary-contact', validate({ params: userIdParamSchema }), async (req, res) => {
    res.json(toUserSummary(await setPrimaryContact(scopeOf(req), req.valid.params.id, req.user, req)));
});

partnerTeamRoutes.post(
    '/:id/deactivate',
    validate({ params: userIdParamSchema, body: deactivateUserSchema }),
    async (req, res) => {
        res.json(
            toUserSummary(await deactivateUser(scopeOf(req), req.valid.params.id, req.valid.body, req.user, req))
        );
    }
);

partnerTeamRoutes.post('/:id/reactivate', validate({ params: userIdParamSchema }), async (req, res) => {
    res.json(toUserSummary(await reactivateUser(scopeOf(req), req.valid.params.id, req.user, req)));
});

partnerTeamRoutes.post('/:id/sessions/revoke', validate({ params: userIdParamSchema }), async (req, res) => {
    const { user, count } = await revokeSessions(scopeOf(req), req.valid.params.id, req.user, req);

    res.json({ user: toUserSummary(user), revoked: count });
});

partnerTeamRoutes.post(
    '/:id/activation/resend',
    inviteLimiter,
    validate({ params: userIdParamSchema }),
    async (req, res) => {
        const issued = await resendActivation(scopeOf(req), req.valid.params.id, req.user, req);

        res.json({ user: toUserSummary(issued.user), ...(await activation(req, issued)) });
    }
);

partnerTeamRoutes.delete(
    '/:id',
    validate({ params: userIdParamSchema, body: deleteUserSchema }),
    async (req, res) => {
        await deleteUser(scopeOf(req), req.valid.params.id, req.valid.body, req.user, req);

        res.status(204).end();
    }
);
