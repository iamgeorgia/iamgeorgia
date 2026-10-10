import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { approvalIdParamSchema, approvalQuerySchema, decisionSchema, requestApprovalSchema } from '../validation/approval.js';
import { toApproval } from '../serializers/approval.js';
import {
    approveRequest,
    cancelRequest,
    findApprovalOr404,
    listApprovals,
    rejectRequest,
    requestApproval
} from '../services/finance/approval.service.js';

/**
 * Approval requests: refunds and adjustments asked for by one person and
 * decided by another. Who may open one and who may decide is settled per
 * kind in the service (`finance.refunds.request` / `.approve`,
 * `finance.adjustments.request` / `.approve`); a requester reads their own,
 * an approver everything of the kinds they decide.
 */
export const adminApprovalRoutes = Router();

// Only someone with a part in approvals gets in at all — asking or
// deciding; a partner, a driver or a desk with neither is refused here, and
// which requests a caller then sees is decided per request in the service.
adminApprovalRoutes.use(
    authenticate,
    requireCapability(
        CAPABILITIES.FINANCE_REFUNDS_REQUEST,
        CAPABILITIES.FINANCE_ADJUSTMENTS_REQUEST,
        CAPABILITIES.FINANCE_REFUNDS_APPROVE,
        CAPABILITIES.FINANCE_ADJUSTMENTS_APPROVE
    )
);

adminApprovalRoutes.get('/', validate({ query: approvalQuerySchema }), async (req, res) => {
    const { requests, ...meta } = await listApprovals(req.valid.query, req.user);

    res.json({ data: requests.map(toApproval), ...meta });
});

adminApprovalRoutes.post('/', validate({ body: requestApprovalSchema }), async (req, res) => {
    res.status(201).json(toApproval(await requestApproval(req.valid.body, req.user, req)));
});

adminApprovalRoutes.get('/:id', validate({ params: approvalIdParamSchema }), async (req, res) => {
    res.json(toApproval(await findApprovalOr404(req.valid.params.id, req.user)));
});

adminApprovalRoutes.post('/:id/approve', validate({ params: approvalIdParamSchema, body: decisionSchema }), async (req, res) => {
    res.json(toApproval(await approveRequest(req.valid.params.id, req.valid.body, req.user, req)));
});

adminApprovalRoutes.post('/:id/reject', validate({ params: approvalIdParamSchema, body: decisionSchema }), async (req, res) => {
    res.json(toApproval(await rejectRequest(req.valid.params.id, req.valid.body, req.user, req)));
});

adminApprovalRoutes.post('/:id/cancel', validate({ params: approvalIdParamSchema }), async (req, res) => {
    res.json(toApproval(await cancelRequest(req.valid.params.id, req.user, req)));
});
