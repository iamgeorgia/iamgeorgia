import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { approveBooking, listPendingApprovals, rejectBooking } from '../services/booking/approval.service.js';
import { approvalParamSchema, approvalQueueQuerySchema, approveBookingSchema, rejectBookingSchema } from '../validation/bookingApproval.js';
import { toBookingDetail } from '../serializers/booking.js';
import { toTransferBooking } from '../serializers/transfer.js';
import { toTourBookingDetail } from '../serializers/tourBooking.js';
import { toServiceBookingDetail } from '../serializers/service.js';
import { toOrderDetail } from '../serializers/order.js';

/**
 * The booking approvals queue (OD1): what waits for the platform's yes, and
 * the yes or no itself. One router for the five products because it is one
 * capability, one screen and one decision — the product is a path segment,
 * never a guess from the reference prefix.
 */
export const adminBookingApprovalRoutes = Router();

adminBookingApprovalRoutes.use(authenticate, requireCapability(CAPABILITIES.BOOKINGS_APPROVE));

const DETAIL = {
    HOTEL: toBookingDetail,
    TRANSFER: toTransferBooking,
    TOUR: toTourBookingDetail,
    SERVICE: toServiceBookingDetail,
    ORDER: toOrderDetail
};

adminBookingApprovalRoutes.get('/', validate({ query: approvalQueueQuerySchema }), async (req, res) => {
    const { rows, ...page } = await listPendingApprovals(req.valid.query);

    res.json({ data: rows, ...page });
});

adminBookingApprovalRoutes.post('/:product/:reference/approve', validate({ params: approvalParamSchema, body: approveBookingSchema }), async (req, res) => {
    const { product, reference } = req.valid.params;
    const decided = await approveBooking(product, reference, req.valid.body, req.user, req);

    res.json({ product, ...DETAIL[product](decided, req.user) });
});

adminBookingApprovalRoutes.post('/:product/:reference/reject', validate({ params: approvalParamSchema, body: rejectBookingSchema }), async (req, res) => {
    const { product, reference } = req.valid.params;
    const decided = await rejectBooking(product, reference, req.valid.body, req.user, req);

    res.json({ product, ...DETAIL[product](decided, req.user) });
});
