import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { prisma, disconnect } from '../db/index.js';
import { MAX_ATTEMPTS, processEvent } from '../services/notifications/outbox.service.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeDriver,
    makeDriverUser,
    makePartner,
    makePartnerUser,
    makeTransferProvider,
    signIn
} from './support/factories.js';

/**
 * The admin and portal bells, and the outbox's dead letters.
 *
 * Every notification is one person's: the list, the count and the read
 * marks are scoped on the session, and someone else's row does not exist.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();

describe('admin and partner notifications', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    let finance;
    let management;
    let owner;

    const notice = (recipientUserId, overrides = {}) =>
        prisma.notification.create({
            data: {
                recipientUserId,
                kind: 'FINANCE_PAYABLE_DUE',
                title: 'Hotel Vera: 70% balance (GEL 336.00) due in 3 days',
                body: 'BKG-000321',
                payload: { payableId: 'pay1' },
                entityType: 'SupplierPayable',
                entityId: 'pay1',
                ...overrides
            }
        });

    before(async () => {
        // Two reservations users, not finance ones: another file's sweep or
        // drain running at the same time tells every finance-capable user
        // about its instalments, and these counts must be this file's alone.
        finance = await makeAdmin(tracker, { role: 'TOUR_OPERATOR' });
        management = await makeAdmin(tracker, { role: 'TOUR_OPERATOR' });
        cookies.ACCOUNTANT = (await signIn(app, finance.email)).cookie;
        cookies.MANAGEMENT = (await signIn(app, management.email)).cookie;

        const partner = await makePartner(tracker);
        owner = await makePartnerUser(tracker, partner);
        cookies.OWNER = (await signIn(app, owner.email)).cookie;
        cookies.OTHER_OWNER = (await signIn(app, (await makePartnerUser(tracker, await makePartner(tracker))).email)).cookie;

        const provider = tracker.transferProvider(await makeTransferProvider());
        const driver = await makeDriver(tracker, { providerId: provider.id });
        cookies.DRIVER = (await signIn(app, (await makeDriverUser(tracker, driver)).email)).cookie;
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    it('lists only the viewer’s own notices, unread first when asked, and counts them', async () => {
        const mine = await notice(finance.id);
        const read = await notice(finance.id, { readAt: new Date(), kind: 'FINANCE_PAYABLE_OVERDUE' });
        const theirs = await notice(management.id);

        const all = await request(app).get('/api/admin/notifications').set('Cookie', cookies.ACCOUNTANT);
        assert.equal(all.status, 200, JSON.stringify(all.body));
        const ids = all.body.data.map((row) => row.id);
        assert.ok(ids.includes(mine.id) && ids.includes(read.id));
        assert.ok(!ids.includes(theirs.id), 'somebody else’s notice is not listed');
        assert.equal(all.body.unreadCount, 1);
        assert.equal(all.body.data.find((row) => row.id === mine.id).entityType, 'SupplierPayable');

        const unread = await request(app).get('/api/admin/notifications?unread=true').set('Cookie', cookies.ACCOUNTANT);
        assert.deepEqual(unread.body.data.map((row) => row.id), [mine.id]);

        const count = await request(app).get('/api/admin/notifications/unread-count').set('Cookie', cookies.ACCOUNTANT);
        assert.deepEqual(count.body, { unreadCount: 1 });
    });

    it('marks one, then all, as read — and cannot touch another person’s', async () => {
        const mine = await notice(finance.id);
        const other = await notice(finance.id);
        const theirs = await notice(management.id);

        const refused = await request(app).post(`/api/admin/notifications/${theirs.id}/read`).set('Cookie', cookies.ACCOUNTANT);
        assert.equal(refused.status, 404);
        assert.equal((await prisma.notification.findUnique({ where: { id: theirs.id } })).readAt, null);

        const one = await request(app).post(`/api/admin/notifications/${mine.id}/read`).set('Cookie', cookies.ACCOUNTANT);
        assert.equal(one.status, 200);
        assert.ok(one.body.readAt);

        const all = await request(app).post('/api/admin/notifications/read-all').set('Cookie', cookies.ACCOUNTANT);
        assert.equal(all.status, 200);
        assert.ok(all.body.count >= 1);
        assert.ok((await prisma.notification.findUnique({ where: { id: other.id } })).readAt);

        const count = await request(app).get('/api/admin/notifications/unread-count').set('Cookie', cookies.ACCOUNTANT);
        assert.deepEqual(count.body, { unreadCount: 0 });
    });

    it('keeps the admin bell for staff and the portal bell for partners', async () => {
        const theirs = await notice(owner.id, { kind: 'FINANCE_PAYMENT_RECEIVED', title: 'Payment received: GEL 300.00' });

        assert.equal((await request(app).get('/api/admin/notifications').set('Cookie', cookies.OWNER)).status, 403);
        assert.equal((await request(app).get('/api/admin/notifications').set('Cookie', cookies.DRIVER)).status, 403);
        assert.equal((await request(app).get('/api/admin/notifications')).status, 401);

        const portal = await request(app).get('/api/partner/notifications').set('Cookie', cookies.OWNER);
        assert.equal(portal.status, 200, JSON.stringify(portal.body));
        assert.deepEqual(portal.body.data.map((row) => row.id), [theirs.id]);

        const count = await request(app).get('/api/partner/notifications/unread-count').set('Cookie', cookies.OWNER);
        assert.deepEqual(count.body, { unreadCount: 1 });

        const read = await request(app).post(`/api/partner/notifications/${theirs.id}/read`).set('Cookie', cookies.OWNER);
        assert.equal(read.status, 200);
        assert.equal((await request(app).post(`/api/partner/notifications/${theirs.id}/read`).set('Cookie', cookies.OTHER_OWNER)).status, 404, 'scoped on the session, whoever asks');
        assert.equal((await request(app).get('/api/partner/notifications').set('Cookie', cookies.ACCOUNTANT)).status, 403, 'staff use the admin bell');
    });
});

describe('outbox dead letters', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    const eventIds = [];

    const failed = async (overrides = {}) => {
        const event = await prisma.outboxEvent.create({
            data: {
                topic: 'finance.payable.instalment_due',
                payload: { instalmentId: 'no-such-instalment' },
                attempts: MAX_ATTEMPTS,
                lastError: 'Simulated delivery failure',
                processedAt: new Date(),
                nextAttemptAt: new Date('2099-01-01T00:00:00.000Z'),
                ...overrides
            }
        });
        eventIds.push(event.id);

        return event;
    };

    before(async () => {
        for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGEMENT', 'TOUR_OPERATOR']) {
            cookies[role] = (await signIn(app, (await makeAdmin(tracker, { role })).email)).cookie;
        }
    });

    after(async () => {
        await prisma.auditLog.deleteMany({ where: { entityId: { in: eventIds } } });
        await prisma.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
        await tracker.cleanup();
        await disconnect();
    });

    it('lists events that gave up, for whoever reads the audit trail', async () => {
        const event = await failed();
        const delivered = await failed({ attempts: MAX_ATTEMPTS, lastError: null });
        const stillTrying = await failed({ attempts: 3, processedAt: null });

        const res = await request(app).get('/api/admin/outbox/failed').set('Cookie', cookies.MANAGEMENT);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const ids = res.body.data.map((row) => row.id);
        assert.ok(ids.includes(event.id));
        assert.ok(!ids.includes(delivered.id), 'an event that was delivered is not a dead letter');
        assert.ok(!ids.includes(stillTrying.id), 'nor one the drain will still retry');
        const row = res.body.data.find((entry) => entry.id === event.id);
        assert.equal(row.attempts, MAX_ATTEMPTS);
        assert.equal(row.lastError, 'Simulated delivery failure');
        assert.equal(row.topic, 'finance.payable.instalment_due');

        assert.equal((await request(app).get('/api/admin/outbox/failed').set('Cookie', cookies.TOUR_OPERATOR)).status, 403);
    });

    it('re-queues a dead letter for one more attempt, audited, and refuses what has not failed', async () => {
        const event = await failed();

        assert.equal((await request(app).post(`/api/admin/outbox/${event.id}/retry`).set('Cookie', cookies.MANAGEMENT)).status, 403, 'reading is not re-sending');

        const res = await request(app).post(`/api/admin/outbox/${event.id}/retry`).set('Cookie', cookies.ADMIN);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.processedAt, null);
        assert.equal(res.body.attempts, MAX_ATTEMPTS, 'the count is kept, so a second failure gives up at once');
        assert.ok(new Date(res.body.nextAttemptAt) <= new Date());

        const audit = await prisma.auditLog.findFirst({ where: { action: 'OUTBOX_EVENT_RETRIED', entityId: event.id } });
        assert.ok(audit, 'audited');
        assert.match(audit.summary, /finance\.payable\.instalment_due/);

        // The handler finds no instalment and says nothing: delivered, error cleared.
        const requeued = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
        assert.equal(await processEvent(requeued), true);
        const done = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
        assert.ok(done.processedAt);
        assert.equal(done.lastError, null);

        const list = await request(app).get('/api/admin/outbox/failed').set('Cookie', cookies.SUPER_ADMIN);
        assert.ok(!list.body.data.some((row) => row.id === event.id), 'no longer a dead letter');

        const again = await request(app).post(`/api/admin/outbox/${event.id}/retry`).set('Cookie', cookies.SUPER_ADMIN);
        assert.equal(again.status, 409);
        assert.equal(again.body.error.details.reason, 'NOT_FAILED');

        const fresh = await failed({ attempts: 0, lastError: null, processedAt: null });
        assert.equal((await request(app).post(`/api/admin/outbox/${fresh.id}/retry`).set('Cookie', cookies.ADMIN)).status, 409);
        assert.equal((await request(app).post('/api/admin/outbox/nope/retry').set('Cookie', cookies.ADMIN)).status, 404);
    });
});
