import { Prisma } from '../../generated/prisma/client.ts';
import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { AUDIT_ENTITY, recordAudit } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../lib/errors.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { CAPABILITIES, can } from '../../lib/permissions.js';
import { decidedByFor } from '../../lib/booking/approval.js';
import { readsAllBookings } from '../../middleware/auth.js';
import { namesFor, namedBlocks } from '../../lib/booking/names.js';
import { freeCancellationUntil, moveFreeCancellationUntil } from '../hotel/policy.service.js';
import { adjustReceivableInTx } from '../finance/settlement.service.js';

/**
 * Booking deadlines: when the money is due, until when cancelling is free,
 * by when a booking must be answered.
 *
 * `booking_deadlines` is a projection. The truth stays where it was —
 * `Receivable.dueAt`, the frozen `cancellationSchedule`, the approval and
 * request stamps — and `syncDeadlinesInTx` rewrites the rows from it after
 * every change (it rides on the booking index sync, which every status,
 * money and desk change already goes through). Moving a deadline by hand
 * writes the truth first, under its own rules, and the row follows.
 */

const DEFAULT_TZ = 'Asia/Tbilisi';
const DAY_MS = 86_400_000;

const RECEIVABLE = { select: { id: true, status: true, dueAt: true } };
const ORDER_LINK = { select: { order: { select: { id: true, reference: true, status: true, receivable: RECEIVABLE } } } };

const LOADERS = {
    HOTEL: (client, id) =>
        client.hotelBooking.findUnique({
            where: { id },
            include: { rooms: { select: { status: true, cancellationSchedule: true } }, receivable: RECEIVABLE, orderItem: ORDER_LINK }
        }),
    TRANSFER: (client, id) => client.transferBooking.findUnique({ where: { id }, include: { receivable: RECEIVABLE, orderItem: ORDER_LINK } }),
    TOUR: (client, id) => client.tourBooking.findUnique({ where: { id }, include: { tour: { select: { timezone: true } }, receivable: RECEIVABLE, orderItem: ORDER_LINK } }),
    SERVICE: (client, id) => client.serviceBooking.findUnique({ where: { id }, include: { service: { select: { timezone: true } }, receivable: RECEIVABLE, orderItem: ORDER_LINK } }),
    ORDER: (client, id) => client.order.findUnique({ where: { id }, include: { receivable: RECEIVABLE, items: { select: { status: true, tourBooking: { select: { requestDeadlineAt: true } }, serviceBooking: { select: { requestDeadlineAt: true } } } } } })
};

const MODEL = { HOTEL: 'hotelBooking', TRANSFER: 'transferBooking', TOUR: 'tourBooking', SERVICE: 'serviceBooking', ORDER: 'order' };
const ENTITY = { HOTEL: AUDIT_ENTITY.booking, TRANSFER: AUDIT_ENTITY.transferBooking, TOUR: AUDIT_ENTITY.tourBooking, SERVICE: AUDIT_ENTITY.serviceBooking, ORDER: AUDIT_ENTITY.order };

const SHAPES = {
    HOTEL: (row) => ({
        title: row.hotelSnapshot?.name ?? 'Hotel',
        leadName: row.leadGuestName,
        timezone: row.hotelSnapshot?.timezone ?? DEFAULT_TZ,
        freeUntil: earliest(row.rooms.filter((room) => room.status !== 'CANCELLED').map((room) => freeCancellationUntil(room.cancellationSchedule)))
    }),
    TRANSFER: (row) => ({
        title: `${row.routeSnapshot?.fromName ?? 'Transfer'} → ${row.routeSnapshot?.toName ?? ''}`.trim(),
        leadName: row.leadPassengerName,
        timezone: row.routeSnapshot?.fromTimezone ?? DEFAULT_TZ,
        freeUntil: freeCancellationUntil(row.cancellationSchedule)
    }),
    TOUR: (row) => ({
        title: `${row.tourSnapshot?.title ?? 'Tour'}${row.tourSnapshot?.option?.name ? ` · ${row.tourSnapshot.option.name}` : ''}`,
        leadName: row.leadTravellerName,
        timezone: row.tour?.timezone ?? DEFAULT_TZ,
        freeUntil: freeCancellationUntil(row.cancellationSchedule)
    }),
    SERVICE: (row) => ({
        title: row.serviceSnapshot?.name ?? 'Service',
        leadName: row.leadName,
        timezone: row.service?.timezone ?? DEFAULT_TZ,
        freeUntil: freeCancellationUntil(row.cancellationSchedule)
    }),
    ORDER: (row) => ({
        title: row.packageSnapshot?.name ?? (row.kind === 'CUSTOM' ? 'Custom order' : 'Package'),
        leadName: row.leadName,
        timezone: DEFAULT_TZ,
        freeUntil: null
    })
};

/** The earliest of several instants (ISO strings or Dates), or null. */
const earliest = (values) => {
    const instants = values.filter(Boolean).map((value) => new Date(value));

    return instants.length > 0 ? new Date(Math.min(...instants.map((d) => d.getTime()))) : null;
};

const LIVE = new Set(['PENDING_APPROVAL', 'PENDING', 'CONFIRMED', 'PENDING_CONFIRMATION', 'PARTIALLY_CANCELLED']);
const SETTLED = new Set(['PAID', 'WAIVED', 'VOID']);

/**
 * The rows a booking should have right now, from its own columns.
 *
 * A child of an order has no PAYMENT row (the order's receivable is what is
 * paid) and no CONFIRMATION row of its own while the order carries one.
 */
const desiredRows = (product, row, now) => {
    const shape = SHAPES[product](row);
    const inOrder = Boolean(row.orderItem);
    const receivable = product === 'ORDER' ? row.receivable : inOrder ? null : row.receivable;
    const live = LIVE.has(row.status);
    const rows = [];

    if (receivable?.dueAt) {
        rows.push({
            kind: 'PAYMENT',
            dueAt: receivable.dueAt,
            receivableId: receivable.id,
            status: SETTLED.has(receivable.status) ? 'MET' : row.status === 'CANCELLED' && receivable.status === 'VOID' ? 'CANCELLED' : receivable.dueAt < now ? 'MISSED' : 'OPEN',
            meta: {}
        });
    }

    if (product !== 'ORDER' && shape.freeUntil) {
        rows.push({
            kind: 'FREE_CANCELLATION',
            dueAt: shape.freeUntil,
            receivableId: null,
            status: !live ? 'CANCELLED' : shape.freeUntil < now ? 'MISSED' : 'OPEN',
            meta: {}
        });
    }

    const awaiting = row.status === 'PENDING_APPROVAL' && row.approvalDeadlineAt ? { at: row.approvalDeadlineAt, awaiting: 'PLATFORM' } : null;
    const requested =
        product === 'ORDER'
            ? row.status === 'PENDING_CONFIRMATION' && row.requestDeadlineAt
                ? { at: row.requestDeadlineAt, awaiting: 'SUPPLIER' }
                : null
            : row.status === 'PENDING' && row.requestDeadlineAt && !inOrder
              ? { at: row.requestDeadlineAt, awaiting: 'SUPPLIER' }
              : null;
    const confirmation = awaiting ?? requested;

    if (confirmation && !(inOrder && product !== 'ORDER' && awaiting)) {
        rows.push({ kind: 'CONFIRMATION', dueAt: confirmation.at, receivableId: null, status: confirmation.at < now ? 'MISSED' : 'OPEN', meta: { awaiting: confirmation.awaiting } });
    }

    return { shape, rows };
};

/** Brings one booking's deadline rows into line with its own columns. */
export const syncDeadlinesInTx = async (tx, product, bookingId, { now = new Date() } = {}) => {
    const row = await LOADERS[product](tx, bookingId);

    if (!row) {
        await tx.bookingDeadline.deleteMany({ where: { product, bookingId } });

        return [];
    }

    const { shape, rows } = desiredRows(product, row, now);
    const existing = await tx.bookingDeadline.findMany({ where: { product, bookingId } });
    const byKind = new Map(existing.map((entry) => [entry.kind, entry]));
    const common = {
        reference: row.reference,
        timezone: shape.timezone,
        partnerId: row.partnerId ?? null,
        customerId: row.customerId ?? null,
        assignedManagerUserId: row.assignedManagerUserId ?? null,
        leadName: shape.leadName,
        title: shape.title
    };
    const result = [];

    for (const wanted of rows) {
        const current = byKind.get(wanted.kind);
        byKind.delete(wanted.kind);

        if (!current) {
            const created = await tx.bookingDeadline.create({
                data: { ...common, product, bookingId, ...wanted, completedAt: wanted.status === 'MET' ? now : null }
            });
            await tx.bookingDeadlineHistory.create({ data: { deadlineId: created.id, fromAt: null, toAt: wanted.dueAt, source: 'SYSTEM', reason: 'set' } });
            result.push(created);
            continue;
        }

        const moved = current.dueAt.getTime() !== new Date(wanted.dueAt).getTime();
        // A deadline that was answered (MET) stays met, and once a cancelled
        // booking's row is CANCELLED it stays so: the stamps are history.
        const status = current.status === 'MET' && wanted.status === 'OPEN' ? 'MET' : wanted.status;
        const updated = await tx.bookingDeadline.update({
            where: { id: current.id },
            data: {
                ...common,
                ...wanted,
                status,
                // A move the system found (an amendment, a ledger change) is the system's; a manual move stays manual until the truth moves again.
                source: moved ? 'SYSTEM' : current.source,
                completedAt: status === 'MET' ? current.completedAt ?? now : null
            }
        });

        if (moved) {
            await tx.bookingDeadlineHistory.create({ data: { deadlineId: current.id, fromAt: current.dueAt, toAt: wanted.dueAt, source: 'SYSTEM', reason: 'followed the booking' } });
        }

        result.push(updated);
    }

    // Kinds that no longer apply: the booking was cancelled, the request
    // answered, the money settled with no date. Kept as a record, closed.
    for (const stale of byKind.values()) {
        if (stale.status === 'OPEN' || stale.status === 'MISSED') {
            const closed = LIVE.has(row.status) && stale.kind === 'CONFIRMATION' ? 'MET' : 'CANCELLED';
            result.push(await tx.bookingDeadline.update({ where: { id: stale.id }, data: { status: closed, completedAt: closed === 'MET' ? now : null } }));
        } else {
            result.push(stale);
        }
    }

    return result;
};

// --- reading -----------------------------------------------------------------

const ADMIN_PATH = {
    HOTEL: (reference) => `/admin/bookings/${reference}`,
    TRANSFER: (reference) => `/admin/transfers/bookings/${reference}`,
    TOUR: (reference) => `/admin/tours/bookings/${reference}`,
    SERVICE: (reference) => `/admin/services/bookings/${reference}`,
    ORDER: (reference) => `/admin/orders/${reference}`
};

const many = (value) => (Array.isArray(value) ? value : [value]);

/**
 * The calendar's rows. Staff read everything (or only PAYMENT rows, when
 * they may read the ledger but not the bookings); a partner reads its own.
 */
export const listDeadlines = async (query, viewer, { now = new Date() } = {}) => {
    const { kind, status, product, partnerId, managerId, customerId, reference, bookingId, from, to, page, pageSize, sort } = query;
    const staff = readsAllBookings(viewer);
    const financeOnly = !staff && !viewer?.partnerId && can(viewer, CAPABILITIES.FINANCE_RECEIVABLES_READ);

    const where = {
        ...(staff ? { ...(partnerId ? { partnerId } : {}) } : financeOnly ? { kind: 'PAYMENT' } : { partnerId: viewer?.partnerId ?? '__none__' }),
        ...(kind && !financeOnly ? { kind: { in: many(kind) } } : {}),
        ...(status ? { status: { in: many(status) } } : {}),
        ...(product ? { product: { in: many(product) } } : {}),
        ...(managerId ? { assignedManagerUserId: managerId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(reference ? { reference } : {}),
        ...(bookingId ? { bookingId } : {}),
        ...(from || to ? { dueAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
    };

    const [total, rows] = await Promise.all([
        prisma.bookingDeadline.count({ where }),
        prisma.bookingDeadline.findMany({ where, orderBy: sort === 'latest' ? [{ dueAt: 'desc' }] : [{ dueAt: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })
    ]);
    const names = await namesFor(rows);

    return { rows: rows.map((row) => toDeadline(row, { now, scope: viewer?.partnerId ? 'partner' : 'admin', names })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const toDeadline = (row, { now = new Date(), scope = 'admin', history = null, names = null } = {}) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    source: row.source,
    product: row.product,
    bookingId: row.bookingId,
    reference: row.reference,
    title: row.title,
    leadName: row.leadName,
    partnerId: row.partnerId,
    customerId: row.customerId,
    assignedManagerUserId: row.assignedManagerUserId,
    ...namedBlocks(row, names),
    receivableId: row.receivableId,
    dueAt: row.dueAt,
    timezone: row.timezone,
    overdue: row.status === 'OPEN' && row.dueAt < now,
    daysLeft: row.status === 'OPEN' ? Math.ceil((row.dueAt.getTime() - now.getTime()) / DAY_MS) : null,
    meta: row.meta ?? {},
    completedAt: row.completedAt,
    href: scope === 'admin' ? ADMIN_PATH[row.product](row.reference) : `/portal/bookings/${row.reference}`,
    updatedAt: row.updatedAt,
    ...(history ? { history: history.map((entry) => ({ id: entry.id, fromAt: entry.fromAt, toAt: entry.toAt, source: entry.source, reason: entry.reason, changedBy: entry.changedByName, at: entry.createdAt })) } : {})
});

export const findDeadlineOr404 = async (id, viewer) => {
    const row = await prisma.bookingDeadline.findUnique({ where: { id }, include: { history: { orderBy: { createdAt: 'asc' } } } });

    if (!row || (!readsAllBookings(viewer) && !(viewer?.partnerId && row.partnerId === viewer.partnerId) && !can(viewer, CAPABILITIES.FINANCE_RECEIVABLES_READ))) {
        throw new NotFoundError('Deadline not found');
    }

    return row;
};

// --- moving one by hand ---------------------------------------------------------

/**
 * Moves a deadline. The truth is written first, under its own rules:
 *
 *   PAYMENT            the receivable's due date, Finance's, through the same
 *                      path (and the same second-person rule) as the ledger;
 *   FREE_CANCELLATION  the frozen schedule's free window, so the charge and
 *                      the date can never disagree — `bookings.deadlines.write`;
 *   CONFIRMATION       the approval or request stamp the sweepers read —
 *                      `bookings.deadlines.write`.
 *
 * Then the row follows, marked MANUAL, with a history entry naming who and why.
 */
export const moveDeadline = (id, { dueAt, reason }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const row = await tx.bookingDeadline.findUnique({ where: { id } });

        if (!row) {
            throw new NotFoundError('Deadline not found');
        }

        if (row.status !== 'OPEN' && row.status !== 'MISSED') {
            throw new ConflictError('That deadline is closed', { reason: 'DEADLINE_CLOSED', status: row.status });
        }

        const at = dueAt instanceof Date ? dueAt : new Date(dueAt);

        if (row.kind === 'PAYMENT') {
            if (!row.receivableId) {
                throw new UnprocessableEntityError('This deadline has no receivable to move', { reason: 'NO_RECEIVABLE' });
            }

            if (!can(actor, CAPABILITIES.FINANCE_ADJUSTMENTS_EXECUTE)) {
                throw new ForbiddenError('Moving a payment deadline needs a second person: open an approval request', {
                    reason: 'APPROVAL_REQUIRED',
                    kind: 'RECEIVABLE_DUE_DATE',
                    receivableId: row.receivableId,
                    required: [CAPABILITIES.FINANCE_ADJUSTMENTS_EXECUTE]
                });
            }

            await adjustReceivableInTx(tx, row.receivableId, { dueAt: at, reason }, actor, req);
        } else {
            if (!can(actor, CAPABILITIES.BOOKINGS_DEADLINES_WRITE)) {
                throw new ForbiddenError('Moving this deadline needs bookings.deadlines.write', { reason: 'CAPABILITY_REQUIRED', required: [CAPABILITIES.BOOKINGS_DEADLINES_WRITE] });
            }

            if (row.kind === 'FREE_CANCELLATION') {
                await moveFreeCancellationInTx(tx, row, at);
            } else {
                await moveConfirmationInTx(tx, row, at);
            }
        }

        const by = decidedByFor(actor);

        await tx.bookingDeadlineHistory.create({
            data: { deadlineId: row.id, fromAt: row.dueAt, toAt: at, source: 'MANUAL', reason: reason ?? null, changedByUserId: by.userId, changedByName: by.name }
        });

        await recordAudit(tx, {
            action: 'BOOKING_DEADLINE_CHANGED',
            actor,
            entityType: ENTITY[row.product],
            entityId: row.bookingId,
            summary: `Moved the ${row.kind.toLowerCase().replace('_', ' ')} deadline of ${row.reference}`,
            metadata: { reference: row.reference, kind: row.kind, from: row.dueAt, to: at, reason: reason ?? null },
            req
        });

        // The row follows the truth; then it is marked as the hand's.
        await syncDeadlinesInTx(tx, row.product, row.bookingId);
        const synced = await tx.bookingDeadline.update({ where: { id: row.id }, data: { source: 'MANUAL' }, include: { history: { orderBy: { createdAt: 'asc' } } } });

        // The index shows the due date too.
        const { syncBookingIndexInTx } = await import('./index.service.js');
        await syncBookingIndexInTx(tx, row.product, row.bookingId);

        return synced;
    });

const moveFreeCancellationInTx = async (tx, row, at) => {
    if (row.product === 'HOTEL') {
        const rooms = await tx.hotelBookingRoom.findMany({ where: { bookingId: row.bookingId, status: { not: 'CANCELLED' } }, select: { id: true, cancellationSchedule: true } });

        for (const room of rooms) {
            await tx.hotelBookingRoom.update({ where: { id: room.id }, data: { cancellationSchedule: moveFreeCancellationUntil(room.cancellationSchedule, at) } });
        }

        return;
    }

    const model = MODEL[row.product];
    const booking = await tx[model].findUnique({ where: { id: row.bookingId }, select: { cancellationSchedule: true } });

    await tx[model].update({ where: { id: row.bookingId }, data: { cancellationSchedule: moveFreeCancellationUntil(booking.cancellationSchedule, at) } });
};

const moveConfirmationInTx = async (tx, row, at) => {
    const model = MODEL[row.product];
    const awaiting = row.meta?.awaiting ?? 'PLATFORM';
    const booking = await tx[model].findUnique({ where: { id: row.bookingId } });

    if (awaiting === 'PLATFORM') {
        const later = !booking.approvalDeadlineAt || at > booking.approvalDeadlineAt;

        await tx[model].update({ where: { id: row.bookingId }, data: { approvalDeadlineAt: at, ...(later ? { approvalOverdueAlertAt: null } : {}) } });

        return;
    }

    if (row.product === 'ORDER') {
        // The order's deadline is the earliest of its requested parts: move them all.
        const items = await tx.orderItem.findMany({ where: { orderId: row.bookingId, status: 'REQUESTED' }, select: { tourBookingId: true, serviceBookingId: true } });

        for (const item of items) {
            if (item.tourBookingId) await tx.tourBooking.update({ where: { id: item.tourBookingId }, data: { requestDeadlineAt: at, overdueAlertAt: null } });
            if (item.serviceBookingId) await tx.serviceBooking.update({ where: { id: item.serviceBookingId }, data: { requestDeadlineAt: at } });
        }

        await tx.order.update({ where: { id: row.bookingId }, data: { requestDeadlineAt: at, overdueAlertAt: null } });

        return;
    }

    const later = !booking.requestDeadlineAt || at > booking.requestDeadlineAt;

    await tx[model].update({
        where: { id: row.bookingId },
        data: { requestDeadlineAt: at, ...(later && 'overdueAlertAt' in booking ? { overdueAlertAt: null } : {}) }
    });
};

// --- policies ----------------------------------------------------------------

export const DEADLINE_KINDS = Object.freeze(['PAYMENT', 'FREE_CANCELLATION', 'CONFIRMATION']);

export const listReminderPolicies = async ({ partnerId = null } = {}) =>
    prisma.reminderPolicy.findMany({
        where: partnerId ? { OR: [{ scope: 'PLATFORM' }, { partnerId }] } : {},
        include: { partner: { select: { id: true, name: true, reference: true } } },
        orderBy: [{ scope: 'asc' }, { kind: 'asc' }]
    });

export const toReminderPolicy = (policy) => ({
    id: policy.id,
    kind: policy.kind,
    scope: policy.scope === 'PLATFORM' ? 'PLATFORM' : 'PARTNER',
    partner: policy.partner ? { id: policy.partner.id, name: policy.partner.name, reference: policy.partner.reference } : null,
    offsetsDays: policy.offsetsDays,
    channels: policy.channels,
    recipients: policy.recipients,
    enabled: policy.enabled,
    updatedAt: policy.updatedAt
});

/** Writes one policy row: the platform's for a kind, or a partner's override. Deleting an override is `{ remove: true }`. */
export const putReminderPolicy = (input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const scope = input.partnerId ?? 'PLATFORM';

        if (input.partnerId) {
            const partner = await tx.partner.findUnique({ where: { id: input.partnerId }, select: { id: true } });

            if (!partner) throw new NotFoundError('Partner not found');
        }

        if (input.remove) {
            if (scope === 'PLATFORM') throw new UnprocessableEntityError('The platform schedule cannot be removed; switch it off instead', { reason: 'PLATFORM_POLICY' });

            await tx.reminderPolicy.deleteMany({ where: { kind: input.kind, scope } });
        }

        const policy = input.remove
            ? null
            : await tx.reminderPolicy.upsert({
                  where: { kind_scope: { kind: input.kind, scope } },
                  create: { kind: input.kind, scope, partnerId: input.partnerId ?? null, offsetsDays: input.offsetsDays, channels: input.channels, recipients: input.recipients, enabled: input.enabled, updatedByUserId: actor?.id ?? null },
                  update: { offsetsDays: input.offsetsDays, channels: input.channels, recipients: input.recipients, enabled: input.enabled, updatedByUserId: actor?.id ?? null },
                  include: { partner: { select: { id: true, name: true, reference: true } } }
              });

        await recordAudit(tx, {
            action: 'REMINDER_POLICY_UPDATED',
            actor,
            entityType: 'ReminderPolicy',
            entityId: policy?.id ?? `${input.kind}:${scope}`,
            summary: `${input.remove ? 'Removed' : 'Set'} the ${input.kind.toLowerCase().replace('_', ' ')} reminder schedule${input.partnerId ? ' for one partner' : ''}`,
            metadata: { kind: input.kind, scope, ...(input.remove ? { removed: true } : { offsetsDays: input.offsetsDays, channels: input.channels, recipients: input.recipients, enabled: input.enabled }) },
            req
        });

        return policy;
    });

// --- the sweeper -------------------------------------------------------------

/**
 * Claims each (deadline, offset) once per the policy that applies — a
 * partner's own row when it has one, the platform's otherwise — collapses
 * several offsets claimed together to the smallest, and enqueues one event
 * per deadline. Rows whose moment has passed are marked MISSED. The
 * handler re-reads before writing, for the claim made a moment before a
 * payment landed or a booking was cancelled.
 */
export const sweepDeadlineReminders = ({ now = new Date() } = {}) =>
    prisma.$transaction(async (tx) => {
        const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('deadline_reminders')) AS locked`;

        if (!locked) {
            return { skipped: true, events: 0, missed: 0 };
        }

        const nowIso = now.toISOString();
        const policies = await tx.reminderPolicy.findMany({ where: { enabled: true } });
        const claimed = [];

        for (const policy of policies) {
            // A partner with its own row is left to that row; the platform row covers everyone else.
            const overridden = policy.scope === 'PLATFORM' ? policies.filter((other) => other.kind === policy.kind && other.scope !== 'PLATFORM').map((other) => other.partnerId) : [];
            const scopeSql =
                policy.scope === 'PLATFORM'
                    ? overridden.length > 0
                        ? Prisma.sql`AND (d.partner_id IS NULL OR d.partner_id NOT IN (${Prisma.join(overridden)}))`
                        : Prisma.empty
                    : Prisma.sql`AND d.partner_id = ${policy.partnerId}`;

            for (const offsetDays of policy.offsetsDays) {
                const rows = await tx.$queryRaw`
                    INSERT INTO deadline_reminders (id, deadline_id, offset_days, sent_at)
                    SELECT gen_random_uuid()::text, d.id, ${offsetDays}::int, ${now}::timestamp
                      FROM booking_deadlines d
                     WHERE d.status = 'OPEN'
                       AND d.kind = ${policy.kind}::deadline_kind
                       AND d.due_at > ${now}
                       AND ((d.due_at AT TIME ZONE 'UTC') AT TIME ZONE d.timezone)::date
                           - ((${nowIso}::timestamptz) AT TIME ZONE d.timezone)::date <= ${offsetDays}::int
                       ${scopeSql}
                       -- A deadline whose booking is being deleted this
                       -- moment holds its row FOR UPDATE: skipped, rather than
                       -- read here and gone by the foreign-key check, which
                       -- fails the whole sweep. KEY SHARE does not wait on a
                       -- desk request merely updating the row.
                       FOR KEY SHARE OF d SKIP LOCKED
                    ON CONFLICT (deadline_id, offset_days) DO NOTHING
                    RETURNING deadline_id, offset_days
                `;

                claimed.push(...rows.map((row) => ({ deadlineId: row.deadline_id, offsetDays: row.offset_days, policyId: policy.id })));
            }
        }

        const smallest = new Map();

        for (const claim of claimed) {
            const seen = smallest.get(claim.deadlineId);
            if (!seen || claim.offsetDays < seen.offsetDays) smallest.set(claim.deadlineId, claim);
        }

        for (const claim of smallest.values()) {
            await enqueueEvent(tx, { topic: TOPICS.DEADLINE_UPCOMING, payload: { deadlineId: claim.deadlineId, offsetDays: claim.offsetDays, policyId: claim.policyId }, entityType: 'BookingDeadline', entityId: claim.deadlineId });
        }

        // SKIP LOCKED: a desk request closing or moving a deadline at this
        // moment holds its row, and a plain bulk update would wait on it in
        // whatever order it met the rows — the other side waiting on one this
        // sweep already holds is a deadlock, and Postgres kills one of the
        // two. A row skipped here is still OPEN and past due, so the next
        // tick marks it, if the desk has not closed it first.
        const missed = await tx.$executeRaw`
            UPDATE booking_deadlines SET status = 'MISSED', updated_at = ${new Date()}::timestamp
             WHERE id IN (SELECT id FROM booking_deadlines WHERE status = 'OPEN' AND due_at < ${now} FOR UPDATE SKIP LOCKED)
        `;

        return { skipped: false, events: smallest.size, missed };
    });
