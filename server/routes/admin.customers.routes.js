import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { createCustomer, customerBookings, findCustomerOr404, listCustomers, toCustomer, updateCustomer } from '../services/booking/customer.service.js';
import { customerParamSchema, customerQuerySchema, customerSchema, updateCustomerSchema } from '../validation/customer.js';

/**
 * Desk customers: the buyers a manual booking is made for when there is no
 * partner account. Read by whoever reads bookings; written by the desk.
 */
export const adminCustomerRoutes = Router();

adminCustomerRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.BOOKINGS_READ], write: [CAPABILITIES.BOOKINGS_WRITE] }));

adminCustomerRoutes.get('/', validate({ query: customerQuerySchema }), async (req, res) => {
    const { customers, ...page } = await listCustomers(req.valid.query);

    res.json({ data: customers.map(toCustomer), ...page });
});

adminCustomerRoutes.post('/', validate({ body: customerSchema }), async (req, res) => {
    res.status(201).json(toCustomer(await createCustomer(req.valid.body, req.user, req)));
});

adminCustomerRoutes.get('/:id', validate({ params: customerParamSchema }), async (req, res) => {
    const customer = await findCustomerOr404(req.valid.params.id);

    res.json({ ...toCustomer(customer), bookings: await customerBookings(customer.id) });
});

adminCustomerRoutes.patch('/:id', validate({ params: customerParamSchema, body: updateCustomerSchema }), async (req, res) => {
    res.json(toCustomer(await updateCustomer(req.valid.params.id, req.valid.body, req.user, req)));
});
