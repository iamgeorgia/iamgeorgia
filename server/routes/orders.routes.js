import { Router } from 'express';

import {
    authenticate,
    optionalAuthenticate,
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
    amendOrderSchema,
    cancelOrderSchema,
    confirmOrderSchema,
    declineOrderItemSchema,
    orderGuestLookupSchema,
    orderHoldSchema,
    orderItemParamSchema,
    orderQuerySchema,
    orderReferenceParamSchema,
    orderReleaseSchema
} from '../validation/order.js';
import {
    amendOrder,
    cancelOrder,
    cancelOrderItem,
    confirmOrder,
    confirmOrderItem,
    declineOrderItem,
    findOrderOr404,
    holdOrderOffers,
    listOrders,
    quoteOrderCancellation,
    releaseOrderHolds
} from '../services/order/order.service.js';
import { toOrderCancellationQuote, toOrderDetail, toOrderSummary } from '../serializers/order.js';

/**
 * Orders: holds, confirmation, reading, cancellation. Public with a guest
 * email, a partner's own, or an admin's anything — the same three doors as
 * every booking register. Nothing here accepts an amount.
 */
export const orderRoutes = Router();

orderRoutes.use(optionalAuthenticate, rejectUnapprovedPartner);

/** Holds every slot with inventory for the checkout countdown. */
orderRoutes.post('/holds', validate({ body: orderHoldSchema }), async (req, res) => {
    res.status(201).json(await holdOrderOffers(req.valid.body.packageToken, req.user));
});

orderRoutes.delete('/holds', validate({ body: orderReleaseSchema }), async (req, res) => {
    await releaseOrderHolds(req.valid.body.holdTokens);

    res.status(204).end();
});

orderRoutes.post('/', validate({ body: confirmOrderSchema }), async (req, res) => {
    const { order, replayed } = await confirmOrder(
        { ...req.valid.body, idempotencyKey: idempotencyKeyFrom(req) },
        req.user,
        req
    );

    res.status(replayed ? 200 : 201).json(toOrderDetail(order, req.user));
});

orderRoutes.get('/:reference', validate({ params: orderReferenceParamSchema, query: orderGuestLookupSchema }), async (req, res) => {
    res.json(toOrderDetail(await findOrderOr404(req.valid.params.reference, req.user, req.valid.query), req.user));
});

orderRoutes.get(
    '/:reference/cancellation-quote',
    validate({ params: orderReferenceParamSchema, query: orderGuestLookupSchema }),
    async (req, res) => {
        const order = await findOrderOr404(req.valid.params.reference, req.user, req.valid.query);

        res.json(toOrderCancellationQuote(quoteOrderCancellation(order)));
    }
);

orderRoutes.patch('/:reference', validate({ params: orderReferenceParamSchema, body: amendOrderSchema }), async (req, res) => {
    res.json(toOrderDetail(await amendOrder(req.valid.params.reference, req.valid.body, req.user, req), req.user));
});

orderRoutes.post('/:reference/cancel', validate({ params: orderReferenceParamSchema, body: cancelOrderSchema }), async (req, res) => {
    const { order, quote } = await cancelOrder(req.valid.params.reference, req.valid.body, req.user, req);

    res.json({ ...toOrderDetail(order, req.user), cancellation: toOrderCancellationQuote(quote) });
});

orderRoutes.post(
    '/:reference/items/:slotIndex/cancel',
    validate({ params: orderItemParamSchema, body: cancelOrderSchema }),
    async (req, res) => {
        const { reference, slotIndex } = req.valid.params;
        const { order, quote } = await cancelOrderItem(reference, slotIndex, req.valid.body, req.user, req);

        res.json({ ...toOrderDetail(order, req.user), cancellation: toOrderCancellationQuote({ ...quote, currency: order.currency }) });
    }
);

// --- the partner's own register ----------------------------------------------

export const partnerOrderRoutes = Router();

partnerOrderRoutes.use(authenticate, requirePartner, requireApprovedPartner);

partnerOrderRoutes.get('/', validate({ query: orderQuerySchema }), async (req, res) => {
    const { orders, ...page } = await listOrders(req.valid.query, req.user);

    res.json({ data: orders.map((order) => toOrderSummary(order, req.user)), ...page });
});

// --- operations --------------------------------------------------------------

export const adminOrderRoutes = Router();

adminOrderRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.BOOKINGS_READ], write: [CAPABILITIES.BOOKINGS_WRITE] }));

adminOrderRoutes.get('/', validate({ query: orderQuerySchema }), async (req, res) => {
    const { orders, ...page } = await listOrders(req.valid.query, req.user);

    res.json({ data: orders.map((order) => toOrderSummary(order, req.user)), ...page });
});

adminOrderRoutes.get('/:reference', validate({ params: orderReferenceParamSchema }), async (req, res) => {
    res.json(toOrderDetail(await findOrderOr404(req.valid.params.reference, req.user), req.user));
});

adminOrderRoutes.get('/:reference/cancellation-quote', validate({ params: orderReferenceParamSchema }), async (req, res) => {
    res.json(toOrderCancellationQuote(quoteOrderCancellation(await findOrderOr404(req.valid.params.reference, req.user))));
});

adminOrderRoutes.post('/:reference/cancel', requireCapability(CAPABILITIES.BOOKINGS_CANCEL), validate({ params: orderReferenceParamSchema, body: cancelOrderSchema }), async (req, res) => {
    const { order, quote } = await cancelOrder(req.valid.params.reference, req.valid.body, req.user, req);

    res.json({ ...toOrderDetail(order, req.user), cancellation: toOrderCancellationQuote(quote) });
});

adminOrderRoutes.post('/:reference/items/:slotIndex/confirm', validate({ params: orderItemParamSchema }), async (req, res) => {
    const { reference, slotIndex } = req.valid.params;

    res.json(toOrderDetail(await confirmOrderItem(reference, slotIndex, req.user, req), req.user));
});

adminOrderRoutes.post(
    '/:reference/items/:slotIndex/decline',
    validate({ params: orderItemParamSchema, body: declineOrderItemSchema }),
    async (req, res) => {
        const { reference, slotIndex } = req.valid.params;

        res.json(toOrderDetail(await declineOrderItem(reference, slotIndex, req.valid.body, req.user, req), req.user));
    }
);

adminOrderRoutes.post(
    '/:reference/items/:slotIndex/cancel',
    requireCapability(CAPABILITIES.BOOKINGS_CANCEL), validate({ params: orderItemParamSchema, body: cancelOrderSchema }),
    async (req, res) => {
        const { reference, slotIndex } = req.valid.params;
        const { order, quote } = await cancelOrderItem(reference, slotIndex, req.valid.body, req.user, req);

        res.json({ ...toOrderDetail(order, req.user), cancellation: toOrderCancellationQuote({ ...quote, currency: order.currency }) });
    }
);
