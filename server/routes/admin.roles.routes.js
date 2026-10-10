import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { roleKeyParamSchema, roleQuerySchema, createRoleSchema, updateRoleSchema } from '../validation/rbac.js';
import { toRole } from '../serializers/role.js';
import { createRole, deleteRole, findRoleOr404, listRoles, updateRole } from '../services/rbac/role.service.js';
import { PROTECTED_CAPABILITIES } from '../services/rbac/grant.service.js';

/**
 * The roles themselves. Behind `roles.manage`, which a super admin holds and
 * nobody else does until given it — and even then, a capability only ever
 * goes into a role from someone who holds it.
 */
export const adminRoleRoutes = Router();

adminRoleRoutes.use(authenticate, requireCapability(CAPABILITIES.ROLES_MANAGE));

/** Every capability there is, grouped by area, for the editor. Before `/:key`, so the word is a route. */
adminRoleRoutes.get('/capabilities', (req, res) => {
    const all = Object.values(CAPABILITIES).sort();
    const groups = {};

    for (const capability of all) {
        const [area] = capability.split('.');
        (groups[area] ??= []).push(capability);
    }

    res.json({
        data: Object.entries(groups).map(([area, capabilities]) => ({ area, capabilities })),
        protected: [...PROTECTED_CAPABILITIES]
    });
});

adminRoleRoutes.get('/', validate({ query: roleQuerySchema }), async (req, res) => {
    res.json({ data: (await listRoles(req.valid.query)).map(toRole) });
});

adminRoleRoutes.post('/', validate({ body: createRoleSchema }), async (req, res) => {
    res.status(201).json(toRole(await createRole(req.valid.body, req.user, req)));
});

adminRoleRoutes.get('/:key', validate({ params: roleKeyParamSchema }), async (req, res) => {
    res.json(toRole(await findRoleOr404(req.valid.params.key)));
});

adminRoleRoutes.patch('/:key', validate({ params: roleKeyParamSchema, body: updateRoleSchema }), async (req, res) => {
    res.json(toRole(await updateRole(req.valid.params.key, req.valid.body, req.user, req)));
});

adminRoleRoutes.delete('/:key', validate({ params: roleKeyParamSchema }), async (req, res) => {
    await deleteRole(req.valid.params.key, req.user, req);

    res.status(204).end();
});
