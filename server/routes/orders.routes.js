import { z } from 'zod';
import { Router } from 'express';
import { createManualBooking, updateDesk } from '../services/booking/manual.service.js';
import { deskUpdateSchema, manualCartSchema, manualOrderSchema } from '../validation/manualBooking.js';

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
import { config } from '../config.js';
import { NotFoundError } from '../lib/errors.js';
import {
    amendOrderSchema,
    cancelOrderSchema,
    confirmCustomOrderSchema,
    confirmOrderSchema,
    customHoldSchema,
    quoteCustomOrderSchema,
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
import { confirmCustomOrder, holdCustomOffers, quoteCustomOrder } from '../services/order/cart.service.js';
import { actAsPartner } from '../lib/booking/onBehalf.js';

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

// --- the cart ----------------------------------------------------------------
//
// Several products for one buyer, booked as one CUSTOM order (OD2). The same
// three doors as a package order, the same approval, the same receivable.
// Behind `CART_ENABLED` until the cart pages ship: off, the routes are not
// there (404), so nothing on the public site can reach them by accident.

const cartEnabled = (req, res, next) => {
    if (!config.booking.cartEnabled) {
        return next(new NotFoundError('The cart is not open', { reason: 'CART_DISABLED' }));
    }

    return next();
};

// The desk quotes and holds a cart as the buyer it will be booked for, like
// every search route; the booking itself goes through `/admin/orders/custom/manual`.
orderRoutes.use('/custom', cartEnabled, actAsPartner);

/** What the cart page shows: each item's availability and price today. Nothing is written. */
orderRoutes.post('/custom/quote', validate({ body: quoteCustomOrderSchema }), async (req, res) => {
    res.json(await quoteCustomOrder(req.valid.body, req.user));
});

/** Holds every hotel room and tour seat in the cart for the checkout countdown. */
orderRoutes.post('/custom/holds', validate({ body: customHoldSchema }), async (req, res) => {
    res.status(201).json(await holdCustomOffers(req.valid.body.items, req.user));
});

/** Lets the cart's holds go. A package's holds arrive nested, as they were given. */
orderRoutes.delete('/custom/holds', validate({ body: orderReleaseSchema.or(z.object({ holds: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.string())])) }).strict()) }), async (req, res) => {
    const nested = req.valid.body.holds ?? req.valid.body.holdTokens ?? {};
    const flat = Object.values(nested).flatMap((value) => (typeof value === 'string' ? [value] : Object.values(value ?? {})));

    await releaseOrderHolds(Object.fromEntries(flat.map((token, index) => [String(index), token])));

    res.status(204).end();
});

orderRoutes.post('/custom', validate({ body: confirmCustomOrderSchema }), async (req, res) => {
    const { order, replayed } = await confirmCustomOrder({ ...req.valid.body, idempotencyKey: idempotencyKeyFrom(req) }, req.user, req);

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

/**
 * A booking made at the desk (manual bookings): by phone, by email, through
 * another agency, or face to face. The same product, the same confirmation
 * body, made as the buyer; see `services/booking/manual.service.js`.
 */
adminOrderRoutes.post('/manual', validate({ body: manualOrderSchema }), async (req, res) => {
    const body = req.valid.body;
    const result = await createManualBooking(
        'ORDER',
        { ...body, booking: { ...body.booking, idempotencyKey: idempotencyKeyFrom(req) ?? body.booking.idempotencyKey } },
        req.user,
        req
    );

    res.status(result.replayed ? 200 : 201).json(toOrderDetail(result.booking ?? result.order, req.user));
});

/** The cart at the desk: several products for one buyer, one CUSTOM order, the same envelope. */
adminOrderRoutes.post('/custom/manual', validate({ body: manualCartSchema }), async (req, res) => {
    const body = req.valid.body;
    const result = await createManualBooking(
        'CART',
        { ...body, booking: { ...body.booking, idempotencyKey: idempotencyKeyFrom(req) ?? body.booking.idempotencyKey } },
        req.user,
        req
    );

    res.status(result.replayed ? 200 : 201).json(toOrderDetail(result.order, req.user));
});

/** The desk's fields after the fact: who is looking after it, and the notes. */
adminOrderRoutes.patch('/:reference/desk', validate({ params: orderReferenceParamSchema, body: deskUpdateSchema }), async (req, res) => {
    res.json(toOrderDetail(await updateDesk('ORDER', req.valid.params.reference, req.valid.body, req.user, req), req.user));
});

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
