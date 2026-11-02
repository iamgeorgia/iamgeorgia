import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { createTracker, databaseAvailable, makeAdmin, makeDestination, makeTour, makeTourOption, makeTransferProvider, signIn, unique } from './support/factories.js';

/**
 * Payment rules for the products that are not hotels: the template
 * catalogue, attaching a template to a tour option, a package and a transfer
 * provider, and the fences — a hotel template never reaches a tour, a tour
 * template never reaches a package, and hotel lists never show product
 * templates.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();

describe('payment policy templates', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    const createdPolicyIds = [];

    before(async () => {
        for (const role of ['ADMIN', 'TOUR_OPERATOR', 'DISPATCHER']) {
            const user = await makeAdmin(tracker, { role });
            cookies[role] = (await signIn(app, user.email)).cookie;
        }
    });

    after(async () => {
        await tracker.cleanup();
        await prisma.paymentPolicy.deleteMany({ where: { id: { in: createdPolicyIds } } });
        await disconnect();
    });

    const createTemplate = async (body, cookie = cookies.ADMIN) => {
        const res = await request(app).post('/api/admin/payment-policies').set('Cookie', cookie).send(body);
        if (res.status === 201) createdPolicyIds.push(res.body.id);
        return res;
    };

    it('creates, lists and updates templates per product kind, with the card fields', async () => {
        const name = unique('Pay now by card');
        const created = await createTemplate({ productKind: 'TOUR', name, timing: 'PAY_NOW', unpaidCancelHours: 12, description: 'Card required' });

        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.timing, 'PAY_NOW');
        assert.equal(created.body.unpaidCancelHours, 12);
        assert.equal(created.body.cardOptional, false);
        assert.equal(created.body.productKind, 'TOUR');
        assert.equal(created.body.isTemplate, true);

        const list = await request(app).get('/api/admin/payment-policies?productKind=TOUR').set('Cookie', cookies.TOUR_OPERATOR);
        assert.equal(list.status, 200);
        assert.ok(list.body.data.some((p) => p.id === created.body.id));
        assert.ok(list.body.data.every((p) => p.productKind === 'TOUR'));

        const updated = await request(app).patch(`/api/admin/payment-policies/${created.body.id}`).set('Cookie', cookies.ADMIN).send({ unpaidCancelHours: 48, cardOptional: true });
        assert.equal(updated.status, 200, JSON.stringify(updated.body));
        assert.equal(updated.body.unpaidCancelHours, 48);
        assert.equal(updated.body.cardOptional, true);

        assert.equal((await createTemplate({ productKind: 'PACKAGE', name: unique('Deposit'), timing: 'DEPOSIT' })).status, 400, 'a deposit needs a percentage');
        assert.equal((await createTemplate({ productKind: 'HOTEL', name: unique('x'), timing: 'PAY_NOW' })).status, 400, 'hotel templates live in the hotel catalogue');
        assert.equal((await request(app).patch(`/api/admin/payment-policies/${created.body.id}`).set('Cookie', cookies.ADMIN).send({ unpaidCancelHours: 5000 })).status, 400);
    });

    it('keeps the catalogue write-only for catalogue writers', async () => {
        assert.equal((await createTemplate({ productKind: 'TOUR', name: unique('nope'), timing: 'PAY_LATER' }, cookies.DISPATCHER)).status, 403);
        assert.equal((await request(app).get('/api/admin/payment-policies')).status, 401);
    });

    it('attaches a TOUR template or a tour-owned policy to a tour option, and nothing else', async () => {
        const destination = await makeDestination(tracker);
        const tour = await makeTour(tracker, { destination });
        const option = await makeTourOption(tour);

        const template = await createTemplate({ productKind: 'TOUR', name: unique('Tour pay now'), timing: 'PAY_NOW', unpaidCancelHours: 24 });
        const packageTemplate = await createTemplate({ productKind: 'PACKAGE', name: unique('Package pay now'), timing: 'PAY_NOW' });

        const attached = await request(app).patch(`/api/admin/tours/${tour.id}/options/${option.id}`).set('Cookie', cookies.ADMIN).send({ paymentPolicyId: template.body.id });
        assert.equal(attached.status, 200, JSON.stringify(attached.body));
        assert.equal(attached.body.payment?.id, template.body.id);
        assert.equal(attached.body.payment?.timing, 'PAY_NOW');

        const wrongKind = await request(app).patch(`/api/admin/tours/${tour.id}/options/${option.id}`).set('Cookie', cookies.ADMIN).send({ paymentPolicyId: packageTemplate.body.id });
        assert.equal(wrongKind.status, 400);

        const owned = await prisma.paymentPolicy.create({ data: { name: unique('Owned by tour'), timing: 'PAY_LATER', tourId: tour.id, productKind: 'TOUR' } });
        createdPolicyIds.push(owned.id);
        const ownedAttached = await request(app).patch(`/api/admin/tours/${tour.id}/options/${option.id}`).set('Cookie', cookies.ADMIN).send({ paymentPolicyId: owned.id });
        assert.equal(ownedAttached.status, 200, JSON.stringify(ownedAttached.body));

        const cleared = await request(app).patch(`/api/admin/tours/${tour.id}/options/${option.id}`).set('Cookie', cookies.ADMIN).send({ paymentPolicyId: null });
        assert.equal(cleared.status, 200);
        assert.equal(cleared.body.payment, null);
    });

    it('attaches a TRANSFER template to a provider and shows it in the provider list', async () => {
        const provider = tracker.transferProvider(await makeTransferProvider());
        const template = await createTemplate({ productKind: 'TRANSFER', name: unique('Driver pay now'), timing: 'PAY_NOW', unpaidCancelHours: 3 });
        const tourTemplate = await createTemplate({ productKind: 'TOUR', name: unique('Tour later'), timing: 'PAY_LATER' });

        const set = await request(app).patch(`/api/admin/transfers/providers/${provider.id}`).set('Cookie', cookies.ADMIN).send({ paymentPolicyId: template.body.id });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal(set.body.payment?.id, template.body.id);

        assert.equal((await request(app).patch(`/api/admin/transfers/providers/${provider.id}`).set('Cookie', cookies.ADMIN).send({ paymentPolicyId: tourTemplate.body.id })).status, 400);

        const list = await request(app).get('/api/admin/transfers/providers').set('Cookie', cookies.ADMIN);
        const row = list.body.data.find((p) => p.id === provider.id);
        assert.equal(row?.payment?.timing, 'PAY_NOW');

        const cleared = await request(app).patch(`/api/admin/transfers/providers/${provider.id}`).set('Cookie', cookies.ADMIN).send({ paymentPolicyId: null });
        assert.equal(cleared.body.payment, null);
    });

    it('keeps product templates out of a hotel\'s payment policy list', async () => {
        const { makeHotel } = await import('./support/factories.js');
        const destination = await makeDestination(tracker);
        const hotel = await makeHotel(tracker, { destination });
        const tourTemplate = await createTemplate({ productKind: 'TOUR', name: unique('Tour only'), timing: 'PAY_LATER' });

        const res = await request(app).get(`/api/admin/hotels/${hotel.id}/policies/payment?includeTemplates=true`).set('Cookie', cookies.ADMIN);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.ok(!res.body.data.some((p) => p.id === tourTemplate.body.id));
        assert.ok(res.body.data.every((p) => p.productKind === null || p.productKind === 'HOTEL'));
    });
});
