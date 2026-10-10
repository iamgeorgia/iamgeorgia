import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { clearOutbox, outbox } from '../lib/mailer/index.js';
import { zonedTimeToInstant } from '../lib/time.js';
import { syncBookingInTx } from '../services/finance/ledger.service.js';
import { countDueInstalments, sweepFinanceReminders } from '../services/finance/reminder.service.js';
import { processEvent } from '../services/notifications/outbox.service.js';
import {
    createTracker,
    databaseAvailable,
    futureDate,
    makeAdmin,
    makePartner,
    makePartnerUser,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    signIn,
    unique
} from './support/factories.js';

/**
 * Phase 3: supplier payment reminders.
 *
 * The sweeper claims each (instalment, offset) once, collapses several
 * offsets to one event, stamps overdue rows once and then daily, and the
 * handlers tell the finance desk in-app and by email — unless the money was
 * paid in between, in which case they say nothing.
 *
 * Events are processed with `processEvent` on *copies* nobody else's drain
 * will claim (the runner gives every file its own process and mail outbox),
 * and notices are counted by the copy's id, so another file draining the
 * originals cannot change what is asserted here.
 */
const app = createApp();
const dbAvailable = await databaseAvailable();

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('finance reminders', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};
    const eventIds = new Set();
    let finance;
    let supplier;
    let agency;
    let agencyOwner;
    let provider;
    let vehicle;
    let from;
    let to;

    before(async () => {
        config.finance.opsEmail = 'finance-desk@example.test';
        finance = await makeAdmin(tracker, { role: 'FINANCE' });
        cookies.FINANCE = (await signIn(app, finance.email)).cookie;
        cookies.RESERVATIONS = (await signIn(app, (await makeAdmin(tracker, { role: 'RESERVATIONS' })).email)).cookie;

        supplier = await makePartner(tracker, { kind: 'TRANSPORT' });
        agency = await makePartner(tracker, { kind: 'TOUR_OPERATOR', paymentDueDays: 10 });
        agencyOwner = await makePartnerUser(tracker, agency);
        cookies.AGENCY = (await signIn(app, agencyOwner.email)).cookie;

        provider = tracker.transferProvider(await makeTransferProvider({ partnerId: supplier.id }));
        vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        from = tracker.transferPoint(await makeTransferPoint());
        to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
    });

    after(async () => {
        config.finance.opsEmail = null;
        if (eventIds.size > 0) {
            await prisma.outboxEvent.deleteMany({ where: { id: { in: [...eventIds] } } });
        }
        await tracker.cleanup();
        await disconnect();
    });

    /** A confirmed transfer with its payable (one undated balance of 170.00) and receivable (200.00, due in 10 days). */
    const booked = async () => {
        const booking = await makeTransferBooking(tracker, {
            vehicleId: vehicle.id,
            from,
            to,
            partnerId: agency.id,
            pickupAt: new Date(`${futureDate(40)}T08:00:00Z`)
        });
        await prisma.$transaction((tx) => syncBookingInTx(tx, 'TRANSFER', booking.id));

        return prisma.transferBooking.findUnique({
            where: { id: booking.id },
            include: { receivable: true, payable: { include: { instalments: { orderBy: { sequence: 'asc' } } } } }
        });
    };

    /** Dates the one instalment, as the supplier's terms would have. */
    const dueIn = async (ms) => {
        const booking = await booked();
        const dueAt = new Date(Date.now() + ms);
        const instalment = await prisma.payableInstalment.update({ where: { id: booking.payable.instalments[0].id }, data: { dueAt } });
        await prisma.supplierPayable.update({ where: { id: booking.payable.id }, data: { nextDueAt: dueAt } });

        return { booking, instalment, payable: booking.payable, receivable: booking.receivable };
    };

    const remindersFor = (instalmentId) => prisma.payableReminder.findMany({ where: { instalmentId }, orderBy: { offsetDays: 'desc' } });

    const copies = new Set();

    /** What the sweeper wrote about one row — the copies below excluded. */
    const eventsFor = async (topic, key, id) => {
        const events = await prisma.outboxEvent.findMany({ where: { topic, payload: { path: [key], equals: id } }, orderBy: { createdAt: 'asc' } });
        events.forEach((event) => eventIds.add(event.id));

        return events.filter((event) => !copies.has(event.id));
    };

    /** A copy only this process will run, dated so no drain picks it up. */
    const manualCopy = async (event) => {
        const copy = await prisma.outboxEvent.create({
            data: { topic: event.topic, payload: event.payload, entityType: event.entityType, entityId: event.entityId, nextAttemptAt: new Date('2099-01-01T00:00:00.000Z') }
        });
        eventIds.add(copy.id);
        copies.add(copy.id);

        return copy;
    };

    const noticesFrom = (eventId, recipientUserId) =>
        prisma.notification.findMany({ where: { recipientUserId, payload: { path: ['outboxEventId'], equals: eventId } } });

    const mailsTo = (address, template) => outbox.filter((entry) => entry.to === address && entry.template === template);

    it('computes a due instant from a calendar day and cutoff in the supplier timezone', () => {
        assert.equal(zonedTimeToInstant('2026-12-13', '10:00', 'Asia/Tbilisi').toISOString(), '2026-12-13T06:00:00.000Z');
    });

    it('claims the 7- and 3-day reminders at once for an instalment due in 3 days, as one event, once', async () => {
        const { instalment, payable } = await dueIn(3 * DAY);

        const first = await sweepFinanceReminders();
        assert.equal(first.skipped, undefined);

        const claimed = await remindersFor(instalment.id);
        assert.deepEqual(claimed.map((row) => row.offsetDays), [7, 3], 'both offsets inside the window are claimed together');

        const events = await eventsFor('finance.payable.instalment_due', 'instalmentId', instalment.id);
        assert.equal(events.length, 1, 'collapsed to one event');
        assert.equal(events[0].payload.offsetDays, 3, 'carrying the nearest offset');
        assert.equal(events[0].payload.payableId, payable.id);
        assert.equal(events[0].entityId, payable.id);

        await sweepFinanceReminders();
        assert.equal((await remindersFor(instalment.id)).length, 2, 'a second sweep claims nothing new');
        assert.equal((await eventsFor('finance.payable.instalment_due', 'instalmentId', instalment.id)).length, 1);

        // The desk hears about it in-app and the mailbox gets the email.
        clearOutbox();
        const copy = await manualCopy(events[0]);
        assert.equal(await processEvent(copy), true);

        const [notice] = await noticesFrom(copy.id, finance.id);
        assert.ok(notice, 'the finance user was told');
        assert.equal(notice.kind, 'FINANCE_PAYABLE_DUE');
        assert.match(notice.title, /due in 3 days/);
        assert.match(notice.title, /GEL/);
        assert.equal(notice.entityType, 'SupplierPayable');
        assert.equal(notice.entityId, payable.id);
        assert.equal(notice.payload.daysUntil, 3);

        const mails = mailsTo('finance-desk@example.test', 'financePayableDue').filter((m) => m.data.payableId === payable.id);
        assert.equal(mails.length, 1);
        assert.equal(mails[0].data.daysUntil, 3);
        assert.equal(mails[0].data.amountCents, 17_000);
        assert.equal(mails[0].data.supplierName, supplier.name);
    });

    it('says "due today" for an instalment due later today', async () => {
        const { instalment } = await dueIn(HOUR);

        await sweepFinanceReminders();
        assert.deepEqual((await remindersFor(instalment.id)).map((row) => row.offsetDays), [7, 3, 1, 0]);

        const [event] = await eventsFor('finance.payable.instalment_due', 'instalmentId', instalment.id);
        assert.equal(event.payload.offsetDays, 0);

        const copy = await manualCopy(event);
        await processEvent(copy);
        const [notice] = await noticesFrom(copy.id, finance.id);
        assert.match(notice.title, /due today/);
    });

    it('stops reminding once the instalment is paid, both at the claim and in the handler', async () => {
        const { instalment, payable } = await dueIn(3 * DAY);
        await sweepFinanceReminders();
        const [event] = await eventsFor('finance.payable.instalment_due', 'instalmentId', instalment.id);
        assert.ok(event);

        const paid = await request(app)
            .post(`/api/admin/finance/payables/${payable.id}/instalments/1/pay`)
            .set('Cookie', cookies.FINANCE)
            .set('Idempotency-Key', unique('pay'))
            .send({ method: 'BANK_TRANSFER', paidAt: new Date().toISOString() });
        assert.equal(paid.status, 201, JSON.stringify(paid.body));

        // The event claimed before the payment is processed after it: nothing is said.
        clearOutbox();
        const copy = await manualCopy(event);
        assert.equal(await processEvent(copy), true);
        assert.equal((await noticesFrom(copy.id, finance.id)).length, 0);
        assert.equal(mailsTo('finance-desk@example.test', 'financePayableDue').filter((m) => m.data.payableId === payable.id).length, 0);

        // And later offsets are never claimed for a paid instalment.
        await prisma.payableInstalment.update({ where: { id: instalment.id }, data: { dueAt: new Date(Date.now() + HOUR) } });
        await sweepFinanceReminders();
        assert.deepEqual((await remindersFor(instalment.id)).map((row) => row.offsetDays), [7, 3]);
    });

    it('alerts once when an instalment goes overdue, then again a day later', async () => {
        const { instalment, payable } = await dueIn(-HOUR);

        await sweepFinanceReminders();
        let row = await prisma.payableInstalment.findUnique({ where: { id: instalment.id } });
        assert.ok(row.overdueAlertAt, 'stamped');
        assert.equal((await remindersFor(instalment.id)).length, 0, 'no "due" reminder for something already overdue');

        let events = await eventsFor('finance.payable.instalment_overdue', 'instalmentId', instalment.id);
        assert.equal(events.length, 1);

        await sweepFinanceReminders();
        events = await eventsFor('finance.payable.instalment_overdue', 'instalmentId', instalment.id);
        assert.equal(events.length, 1, 'the same day, nothing more');

        clearOutbox();
        const copy = await manualCopy(events[0]);
        await processEvent(copy);
        const [notice] = await noticesFrom(copy.id, finance.id);
        assert.equal(notice.kind, 'FINANCE_PAYABLE_OVERDUE');
        assert.match(notice.title, /overdue/);
        const mails = mailsTo('finance-desk@example.test', 'financePayableOverdue').filter((m) => m.data.payableId === payable.id);
        assert.equal(mails.length, 1);
        assert.equal(mails[0].data.daysOverdue, 0);

        // Yesterday's alert is old enough to repeat.
        await prisma.payableInstalment.update({ where: { id: instalment.id }, data: { overdueAlertAt: new Date(Date.now() - 2 * DAY) } });
        await sweepFinanceReminders();
        events = await eventsFor('finance.payable.instalment_overdue', 'instalmentId', instalment.id);
        assert.equal(events.length, 2, 'repeated');
        row = await prisma.payableInstalment.findUnique({ where: { id: instalment.id } });
        assert.ok(row.overdueAlertAt > new Date(Date.now() - HOUR), 're-stamped now');
    });

    it('tells the desk and nudges the agency when a receivable goes overdue', async () => {
        const { receivable } = await booked();
        await prisma.receivable.update({ where: { id: receivable.id }, data: { dueAt: new Date(Date.now() - 2 * DAY - HOUR) } });

        await sweepFinanceReminders();
        const events = await eventsFor('finance.receivable.overdue', 'receivableId', receivable.id);
        assert.equal(events.length, 1);
        await sweepFinanceReminders();
        assert.equal((await eventsFor('finance.receivable.overdue', 'receivableId', receivable.id)).length, 1);

        clearOutbox();
        const copy = await manualCopy(events[0]);
        assert.equal(await processEvent(copy), true);

        const [deskNotice] = await noticesFrom(copy.id, finance.id);
        assert.equal(deskNotice.kind, 'FINANCE_RECEIVABLE_OVERDUE');
        assert.match(deskNotice.title, new RegExp(receivable.reference));
        const [ownerNotice] = await noticesFrom(copy.id, agencyOwner.id);
        assert.ok(ownerNotice, 'the agency owner was told in the portal');
        assert.match(ownerNotice.title, /Payment overdue/);

        const desk = mailsTo('finance-desk@example.test', 'financeReceivableOverdue').filter((m) => m.data.reference === receivable.reference);
        assert.equal(desk.length, 1);
        assert.equal(desk[0].data.daysOverdue, 2);
        const nudge = mailsTo(agency.email, 'receivableOverdue').filter((m) => m.data.reference === receivable.reference);
        assert.equal(nudge.length, 1, 'the agency itself was nudged');
        assert.equal(nudge[0].data.amountCents, 20_000);
    });

    it('does not nudge a guest who has no portal to pay from', async () => {
        const { receivable } = await booked();
        await prisma.receivable.update({
            where: { id: receivable.id },
            data: { debtorPartnerId: null, debtorEmail: 'guest@example.test', debtorName: 'A Guest', dueAt: new Date(Date.now() - HOUR) }
        });

        await sweepFinanceReminders();
        const [event] = await eventsFor('finance.receivable.overdue', 'receivableId', receivable.id);
        clearOutbox();
        const copy = await manualCopy(event);
        await processEvent(copy);

        assert.equal((await noticesFrom(copy.id, finance.id)).length, 1, 'the desk still hears');
        assert.equal(mailsTo('guest@example.test', 'receivableOverdue').length, 0);
    });

    it('sends the agency a receipt when its payment is recorded', async () => {
        const one = await booked();
        const two = await booked();

        clearOutbox();
        const res = await request(app)
            .post('/api/admin/finance/payments')
            .set('Cookie', cookies.FINANCE)
            .set('Idempotency-Key', unique('pay'))
            .send({
                direction: 'IN',
                method: 'BANK_TRANSFER',
                currency: 'GEL',
                amountCents: 35_000,
                paidAt: new Date().toISOString(),
                reference: 'TBC-1001',
                allocations: [
                    { receivableId: one.receivable.id, amountCents: 20_000 },
                    { receivableId: two.receivable.id, amountCents: 10_000 }
                ]
            });
        assert.equal(res.status, 201, JSON.stringify(res.body));

        const [event] = await eventsFor('finance.payment.recorded', 'paymentId', res.body.payment.id);
        assert.ok(event, 'recording the payment wrote the event in the same transaction');

        const copy = await manualCopy(event);
        assert.equal(await processEvent(copy), true);

        const [notice] = await noticesFrom(copy.id, agencyOwner.id);
        assert.equal(notice.kind, 'FINANCE_PAYMENT_RECEIVED');
        assert.match(notice.body, new RegExp(one.receivable.reference));
        assert.equal((await noticesFrom(copy.id, finance.id)).length, 0, 'Finance recorded it; it is not told again');

        const receipts = mailsTo(agency.email, 'paymentReceipt').filter((m) => m.data.reference === 'TBC-1001');
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].data.amountCents, 35_000);
        assert.equal(receipts[0].data.unallocatedCents, 5_000);
        assert.deepEqual(
            receipts[0].data.allocations.map((a) => a.amountCents),
            [20_000, 10_000]
        );
    });

    it('is safe to run from two places at once', async () => {
        const { instalment } = await dueIn(2 * DAY);

        const results = await Promise.all([sweepFinanceReminders(), sweepFinanceReminders()]);
        assert.ok(results.some((result) => !result.skipped), 'one of them did the work');

        assert.deepEqual((await remindersFor(instalment.id)).map((row) => row.offsetDays), [7, 3]);
        assert.equal((await eventsFor('finance.payable.instalment_due', 'instalmentId', instalment.id)).length, 1);
    });

    it('lists what is due and overdue for the desk, and counts it on the badge', async () => {
        const soon = await dueIn(2 * DAY);
        const late = await dueIn(-DAY);

        const res = await request(app).get('/api/admin/finance/due?days=7').set('Cookie', cookies.FINANCE);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.days, 7);

        const ids = res.body.instalments.map((row) => row.id);
        assert.ok(ids.includes(soon.instalment.id), 'due this week');
        assert.ok(ids.includes(late.instalment.id), 'overdue');
        const lateRow = res.body.instalments.find((row) => row.id === late.instalment.id);
        assert.equal(lateRow.overdue, true);
        assert.equal(lateRow.payable.id, late.payable.id);
        assert.equal(lateRow.payable.supplier.id, supplier.id);
        assert.equal(lateRow.outstandingCents, 17_000);
        assert.ok(res.body.totals.instalments.overdue >= 1);
        assert.ok(res.body.totals.instalments.outstandingByCurrency.GEL >= 34_000);
        assert.ok(Array.isArray(res.body.receivables), 'Finance reads both sides');
        assert.ok(res.body.instalments.every((row, index, rows) => index === 0 || rows[index - 1].dueAt <= row.dueAt), 'earliest first');

        assert.ok((await countDueInstalments({ days: 7 })) >= 2);
        const badges = await request(app).get('/api/admin/badges').set('Cookie', cookies.FINANCE);
        assert.equal(badges.status, 200);
        assert.ok(badges.body.paymentsDue >= 2);
        assert.equal(typeof badges.body.unreadNotifications, 'number');

        const desk = await request(app).get('/api/admin/badges').set('Cookie', cookies.RESERVATIONS);
        assert.equal(desk.body.paymentsDue, null, 'a role that may not read payables gets no count');

        const refused = await request(app).get('/api/admin/finance/due').set('Cookie', cookies.RESERVATIONS);
        assert.equal(refused.status, 403);
    });
});
