import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { auditQuerySchema } from '../validation/user.js';
import { toAuditEntry } from '../serializers/partner.js';
import { listAuditLog } from '../services/audit.service.js';

/** The whole trail, for the roles whose job includes checking it. */
export const adminAuditRoutes = Router();

adminAuditRoutes.use(authenticate, requireCapability(CAPABILITIES.AUDIT_READ));

adminAuditRoutes.get('/', validate({ query: auditQuerySchema }), async (req, res) => {
    const { entries, ...meta } = await listAuditLog(req.valid.query);

    res.json({ data: entries.map(toAuditEntry), ...meta });
});
