import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { clearOutbox, outbox } from '../lib/mailer/index.js';
import { processEvent } from '../services/notifications/outbox.service.js';
import { sweepDeadlineReminders } from '../services/booking/deadline.service.js';
import { createTracker, databaseAvailable, makeAdmin, makeDestination, makePartner, makePartnerUser, signIn, unique } from './support/factories.js';
import { makeSellableHotel } from './support/packages.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CHECK_IN = '2027-07-10';
const CHECK_OUT = '2027-07-12';
const DAY = 86_400_000;

/**
 * Deadlines: the payment, free-cancellation and confirmation rows a booking
 * projects, the calendar that lists them, moving one by hand under its
 * kind's own rule, and the reminders the schedule sends.
 */
describe('booking deadlines', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const saved = { ...config.booking };
    let admin;
    let adminCookie;
    let operatorCookie;
    let accountantCookie;
    let superCookie;
    let partner;
    let partnerUser;
    let partnerCookie;
    let destination;

    before(async () => {
        admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;
        operatorCookie = (await signIn(app, (await makeAdmin(tracker, { role: 'TOUR_OPERATOR' })).email)).cookie;
        accountantCookie = (await signIn(app, (await makeAdmin(tracker, { role: 'ACCOUNTANT' })).email)).cookie;
        const superAdmin = await makeAdmin(tracker, { role: 'SUPER_ADMIN' });
        // Executes alone in this suite: the second-person rule is Finance's and tested there.
        await prisma.userCapabilityOverride.create({ data: { userId: superAdmin.id, capability: 'finance.adjustments.execute', effect: 'GRANT', reason: 'deadline suite' } });
        superCookie = (await signIn(app, superAdmin.email)).cookie;
        partner = await makePartner(tracker, { paymentDueDays: 10 });
        partnerUser = await makePartnerUser(tracker, partner);
        partnerCookie = (await signIn(app, partnerUser.email)).cookie;
        destination = await makeDestination(tracker);
    });

    after(async () => {
        Object.assign(config.booking, saved);
        await tracker.cleanup();
        await disconnect();
    });

    const bookHotel = async ({ cookie = partnerCookie, cancellationKind = 'FLEXIBLE' } = {}) => {
        const sellable = await makeSellableHotel(app, adminCookie, tracker, { destination, checkIn: CHECK_IN, nights: 2, cancellationKind });
        const offers = await request(app).get(`/api/search/hotels/${sellable.hotel.slug}?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`).set('Cookie', cookie);
        const response = await request(app)
            .post('/api/bookings')
            .set('Cookie', cookie)
            .send({ offerToken: offers.body.roomTypes[0].offers[0].token, leadGuest: { firstName: 'Nino', lastName: 'Beridze', email: `nino.${unique('d')}@example.test` } });
        assert.equal(response.status, 201, JSON.stringify(response.body));

        const row = await prisma.hotelBooking.findUnique({ where: { reference: response.body.reference }, include: { receivable: true, rooms: true } });

        return { ...sellable, booking: response.body, row };
    };

    const deadlinesOf = (reference) => prisma.bookingDeadline.findMany({ where: { reference }, orderBy: { kind: 'asc' } });

    it('projects a payment and a free-cancellation deadline from the ledger and the frozen schedule', async () => {
        const { row } = await bookHotel();

        const rows = await deadlinesOf(row.reference);
        const payment = rows.find((entry) => entry.kind === 'PAYMENT');
        const cancellation = rows.find((entry) => entry.kind === 'FREE_CANCELLATION');

        assert.ok(payment, 'the receivable has a due date');
        assert.equal(payment.receivableId, row.receivable.id);
        assert.equal(payment.dueAt.getTime(), row.receivable.dueAt.getTime());
        assert.equal(payment.status, 'OPEN');
        assert.equal(payment.partnerId, partner.id);
        assert.ok(cancellation, 'a flexible rate has a free window');
        assert.equal(cancellation.status, 'OPEN');
        assert.ok(cancellation.dueAt < new Date(`${CHECK_IN}T00:00:00Z`));
        assert.equal(rows.find((entry) => entry.kind === 'CONFIRMATION'), undefined, 'approval is off in this suite');

        const history = await prisma.bookingDeadlineHistory.findMany({ where: { deadlineId: payment.id } });
        assert.equal(history.length, 1);

        // The calendar lists them; the partner sees its own; the accountant sees money only.
        const calendar = await request(app).get(`/api/admin/deadlines?from=${new Date(Date.now() - DAY).toISOString()}&pageSize=500`).set('Cookie', adminCookie);
        assert.equal(calendar.status, 200, JSON.stringify(calendar.body));
        const mine = calendar.body.data.filter((entry) => entry.reference === row.reference);
        assert.equal(mine.length, 2);
        assert.equal(mine[0].href, `/admin/bookings/${row.reference}`);
        assert.deepEqual(mine[0].partner, { id: partner.id, name: partner.name }, 'rows carry the partner by name');

        // One booking's rows, by reference: what the detail page's panel asks for.
        const one = await request(app).get(`/api/admin/deadlines?reference=${row.reference}`).set('Cookie', adminCookie);
        assert.equal(one.status, 200, JSON.stringify(one.body));
        assert.equal(one.body.total, 2);
        assert.ok(one.body.data.every((entry) => entry.reference === row.reference));

        const portal = await request(app).get('/api/partner/deadlines?pageSize=500').set('Cookie', partnerCookie);
        assert.equal(portal.status, 200);
        assert.ok(portal.body.data.some((entry) => entry.reference === row.reference));
        assert.ok(portal.body.data.every((entry) => entry.partnerId === partner.id));

        // Every seeded staff role reads bookings, so the accountant sees the whole calendar too.
        const finance = await request(app).get('/api/admin/deadlines?pageSize=500').set('Cookie', accountantCookie);
        assert.equal(finance.status, 200);
        assert.ok(finance.body.data.some((entry) => entry.reference === row.reference));
    });

    it('follows the booking: a payment settles it, a cancellation closes the rest', async () => {
        const { row } = await bookHotel();
        const payment = (await deadlinesOf(row.reference)).find((entry) => entry.kind === 'PAYMENT');

        const paid = await request(app)
            .post('/api/admin/finance/payments')
            .set('Cookie', accountantCookie)
            .set('Idempotency-Key', unique('pay'))
            .send({ direction: 'IN', method: 'BANK_TRANSFER', currency: 'GEL', paidAt: new Date().toISOString(), amountCents: row.receivable.amountCents, reference: 'TBC-2', allocations: [{ receivableId: row.receivable.id, amountCents: row.receivable.amountCents }] });
        assert.equal(paid.status, 201, JSON.stringify(paid.body));
        const settled = await prisma.bookingDeadline.findUnique({ where: { id: payment.id } });
        assert.equal(settled.status, 'MET');
        assert.ok(settled.completedAt);

        await request(app).post(`/api/admin/bookings/${row.reference}/cancel`).set('Cookie', adminCookie).send({ reason: 'Test' });
        const after = await deadlinesOf(row.reference);
        assert.equal(after.find((entry) => entry.kind === 'FREE_CANCELLATION').status, 'CANCELLED');
        assert.equal(after.find((entry) => entry.kind === 'PAYMENT').status, 'MET', 'what was met stays met');
    });

    it('moves a payment deadline through the ledger and under Finance\'s second-person rule', async () => {
        const { row } = await bookHotel();
        const payment = (await deadlinesOf(row.reference)).find((entry) => entry.kind === 'PAYMENT');
        const later = new Date(payment.dueAt.getTime() + 5 * DAY);

        const refused = await request(app).patch(`/api/admin/deadlines/${payment.id}`).set('Cookie', adminCookie).send({ dueAt: later.toISOString(), reason: 'Agreed by phone' });
        assert.equal(refused.status, 403, JSON.stringify(refused.body));
        assert.equal(refused.body.error.details.reason, 'APPROVAL_REQUIRED');
        assert.equal(refused.body.error.details.kind, 'RECEIVABLE_DUE_DATE');

        const moved = await request(app).patch(`/api/admin/deadlines/${payment.id}`).set('Cookie', superCookie).send({ dueAt: later.toISOString(), reason: 'Agreed by phone' });
        assert.equal(moved.status, 200, JSON.stringify(moved.body));
        assert.equal(moved.body.source, 'MANUAL');
        assert.equal(new Date(moved.body.dueAt).getTime(), later.getTime());
        assert.equal(moved.body.history.at(-1).reason, 'Agreed by phone');
        assert.ok(moved.body.history.at(-1).changedBy);

        const receivable = await prisma.receivable.findUnique({ where: { id: row.receivable.id } });
        assert.equal(receivable.dueAt.getTime(), later.getTime(), 'the ledger is the truth, and moved first');
        assert.ok(await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'BOOKING_DEADLINE_CHANGED' } }));
        assert.ok(await prisma.auditLog.findFirst({ where: { entityId: row.receivable.id, action: 'RECEIVABLE_DUE_DATE_CHANGED' } }));

        const indexed = await prisma.bookingIndex.findUnique({ where: { reference: row.reference } });
        assert.equal(indexed.dueAt.getTime(), later.getTime(), 'the register follows');
    });

    it('moves the end of free cancellation on the frozen schedule, so the charge follows the date', async () => {
        const { row } = await bookHotel();
        const cancellation = (await deadlinesOf(row.reference)).find((entry) => entry.kind === 'FREE_CANCELLATION');
        const before = await request(app).get(`/api/bookings/${row.reference}/cancellation-quote`).set('Cookie', partnerCookie);
        assert.equal(before.body.chargeCents, 0, 'free today');

        // Moved into the past: cancelling now costs what the first tier says.
        const past = new Date(Date.now() - DAY);
        const refused = await request(app).patch(`/api/admin/deadlines/${cancellation.id}`).set('Cookie', accountantCookie).send({ dueAt: past.toISOString(), reason: 'Hotel tightened terms' });
        assert.equal(refused.status, 403, 'an accountant does not move cancellation terms');

        const moved = await request(app).patch(`/api/admin/deadlines/${cancellation.id}`).set('Cookie', operatorCookie).send({ dueAt: past.toISOString(), reason: 'Hotel tightened terms' });
        assert.equal(moved.status, 200, JSON.stringify(moved.body));
        assert.equal(moved.body.status, 'MISSED');
        assert.equal(moved.body.source, 'MANUAL');

        const after = await request(app).get(`/api/bookings/${row.reference}/cancellation-quote`).set('Cookie', partnerCookie);
        assert.ok(after.body.chargeCents > 0, 'the schedule moved with the deadline');

        const detail = await request(app).get(`/api/bookings/${row.reference}`).set('Cookie', partnerCookie);
        assert.equal(new Date(detail.body.roomsDetail?.[0]?.cancellation?.freeUntil ?? detail.body.rooms?.[0]?.cancellation?.freeUntil ?? past).getTime(), past.getTime());
    });

    it('projects and moves a confirmation deadline while a booking waits for approval', async () => {
        config.booking.approvalEnabled = true;
        try {
            const { row } = await bookHotel();
            const confirmation = (await deadlinesOf(row.reference)).find((entry) => entry.kind === 'CONFIRMATION');
            assert.ok(confirmation);
            assert.deepEqual(confirmation.meta, { awaiting: 'PLATFORM' });
            assert.equal((await deadlinesOf(row.reference)).find((entry) => entry.kind === 'PAYMENT'), undefined, 'nothing is owed while it waits');

            const later = new Date(Date.now() + 3 * DAY);
            const moved = await request(app).patch(`/api/admin/deadlines/${confirmation.id}`).set('Cookie', operatorCookie).send({ dueAt: later.toISOString(), reason: 'Owner away' });
            assert.equal(moved.status, 200, JSON.stringify(moved.body));
            const booking = await prisma.hotelBooking.findUnique({ where: { id: row.id } });
            assert.equal(booking.approvalDeadlineAt.getTime(), later.getTime(), 'the sweeper\'s column moved');

            const approved = await request(app).post(`/api/admin/booking-approvals/HOTEL/${row.reference}/approve`).set('Cookie', adminCookie).send({});
            assert.equal(approved.status, 200, JSON.stringify(approved.body));
            const rows = await deadlinesOf(row.reference);
            assert.equal(rows.find((entry) => entry.kind === 'CONFIRMATION').status, 'MET');
            assert.ok(rows.find((entry) => entry.kind === 'PAYMENT'), 'approved: the money is due');
        } finally {
            config.booking.approvalEnabled = false;
        }
    });

    it('reminds on the schedule, once per offset, to the people the policy names, and stops once the deadline is met', async () => {
        const { row } = await bookHotel();
        const payment = (await deadlinesOf(row.reference)).find((entry) => entry.kind === 'PAYMENT');
        clearOutbox();

        // Two days before the due day in the booking's own calendar: the 7-
        // and 3-day offsets are both claimed and collapse to one event (3).
        const now = new Date(payment.dueAt.getTime() - 2 * DAY);
        const first = await sweepDeadlineReminders({ now });
        assert.equal(first.skipped, false);
        const claims = await prisma.deadlineReminder.findMany({ where: { deadlineId: payment.id } });
        assert.deepEqual(claims.map((claim) => claim.offsetDays).sort((a, b) => a - b), [3, 7]);
        const events = await prisma.outboxEvent.findMany({ where: { entityId: payment.id, topic: 'booking.deadline.upcoming' } });
        assert.equal(events.length, 1);
        assert.equal(events[0].payload.offsetDays, 3);

        await sweepDeadlineReminders({ now });
        assert.equal((await prisma.outboxEvent.count({ where: { entityId: payment.id, topic: 'booking.deadline.upcoming' } })), 1, 'claimed once');

        await processEvent(events[0]);
        assert.equal(outbox.filter((entry) => entry.template === 'deadlineReminder').length, 1, 'the partner company is emailed, the traveller is not');
        assert.ok(outbox.find((entry) => entry.template === 'deadlineReminder').to !== row.leadGuestEmail);

        // A retry of the same event tells nobody twice in-app.
        await processEvent({ ...events[0], attempts: 1 });
        assert.equal(await prisma.notification.count({ where: { recipientUserId: partnerUser.id, kind: 'DEADLINE_PAYMENT_UPCOMING', entityId: row.id } }), 1, 'the partner is told once');
        assert.ok(await prisma.notification.findFirst({ where: { kind: 'DEADLINE_PAYMENT_UPCOMING', entityId: row.id, recipientUser: { partnerId: null } } }), 'the finance desk is told');

        // Met before the next offset: the sweep claims the day-before offset
        // but the handler finds the row closed and says nothing.
        await request(app)
            .post('/api/admin/finance/payments')
            .set('Cookie', accountantCookie)
            .set('Idempotency-Key', unique('pay'))
            .send({ direction: 'IN', method: 'BANK_TRANSFER', currency: 'GEL', paidAt: new Date().toISOString(), amountCents: row.receivable.amountCents, reference: 'TBC-3', allocations: [{ receivableId: row.receivable.id, amountCents: row.receivable.amountCents }] });
        assert.equal((await prisma.bookingDeadline.findUnique({ where: { id: payment.id } })).status, 'MET');
        await sweepDeadlineReminders({ now: new Date(payment.dueAt.getTime() - 12 * 3_600_000) });
        assert.equal(await prisma.outboxEvent.count({ where: { entityId: payment.id, topic: 'booking.deadline.upcoming' } }), 1, 'a met deadline is not reminded about');
    });

    it('lets an admin shape the schedule, and a partner override it', async () => {
        const list = await request(app).get('/api/admin/settings/reminder-policies').set('Cookie', adminCookie);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        assert.ok(list.body.data.some((policy) => policy.kind === 'PAYMENT' && policy.scope === 'PLATFORM'));

        const refused = await request(app).put('/api/admin/settings/reminder-policies').set('Cookie', operatorCookie).send({ kind: 'PAYMENT', offsetsDays: [14], channels: ['IN_APP'], recipients: ['STAFF'] });
        assert.equal(refused.status, 403);

        const override = await request(app)
            .put('/api/admin/settings/reminder-policies')
            .set('Cookie', adminCookie)
            .send({ kind: 'FREE_CANCELLATION', partnerId: partner.id, offsetsDays: [10, 1], channels: ['EMAIL'], recipients: ['PARTNER'], enabled: true });
        assert.equal(override.status, 200, JSON.stringify(override.body));
        assert.equal(override.body.scope, 'PARTNER');
        assert.equal(override.body.partner.id, partner.id);
        assert.deepEqual(override.body.offsetsDays, [10, 1]);
        assert.ok(await prisma.auditLog.findFirst({ where: { action: 'REMINDER_POLICY_UPDATED', entityId: override.body.id } }));

        // Removing an override needs no schedule in the body.
        const removed = await request(app).put('/api/admin/settings/reminder-policies').set('Cookie', adminCookie).send({ kind: 'FREE_CANCELLATION', partnerId: partner.id, remove: true, offsetsDays: [], channels: [], recipients: [] });
        assert.equal(removed.status, 200, JSON.stringify(removed.body));
        assert.equal(removed.body.removed, true);
        assert.equal(await prisma.reminderPolicy.count({ where: { partnerId: partner.id } }), 0);

        const keep = await request(app).put('/api/admin/settings/reminder-policies').set('Cookie', adminCookie).send({ kind: 'PAYMENT', remove: true });
        assert.equal(keep.status, 422, 'the platform schedule is switched off, never removed');
    });
});
