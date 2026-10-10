import { Router } from 'express';
import { z } from 'zod';

import { config } from '../config.js';
import { prisma } from '../db/index.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireApprovedPartner, requireCapability, requirePartner } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { addDays, todayInTimezone, zonedTimeToInstant } from '../lib/time.js';
import { summaryQuerySchema } from '../validation/finance.js';
import { toStatementReceivable, toSupplierStatementPayable } from '../serializers/finance.js';
import { creditPosition } from '../services/finance/credit.service.js';
import { commission } from '../services/finance/report.service.js';

/**
 * A partner's own money, read from the portal.
 *
 * Owners, partner admins and finance users (`partner.statement.read`). Scoped
 * by the session's company in every query — the id never comes from input —
 * so one partner can never see another's balance.
 */
export const partnerFinanceRoutes = Router();

partnerFinanceRoutes.use(
    authenticate,
    requirePartner,
    requireApprovedPartner,
    requireCapability(CAPABILITIES.PARTNER_STATEMENT_READ)
);

const STATUSES = ['OPEN', 'PARTIAL', 'PAID', 'VOID', 'WAIVED'];

const statementQuerySchema = z.object({
    status: z
        .union([z.enum(STATUSES), z.array(z.enum(STATUSES))])
        .transform((value) => (Array.isArray(value) ? value : [value]))
        .optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

const pageOf = (total, { page, pageSize }) => ({ total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

/** What the agency owes, by booking, with its balance per currency. */
partnerFinanceRoutes.get('/statement', validate({ query: statementQuerySchema }), async (req, res) => {
    const partnerId = req.user.partnerId;
    const { status, page, pageSize } = req.valid.query;
    const where = { debtorPartnerId: partnerId, ...(status ? { status: { in: status } } : {}) };

    const [total, receivables, balances] = await Promise.all([
        prisma.receivable.count({ where }),
        prisma.receivable.findMany({
            where,
            include: {
                order: { select: { id: true, reference: true, status: true } },
                hotelBooking: { select: { id: true, reference: true, status: true } },
                transferBooking: { select: { id: true, reference: true, status: true } },
                tourBooking: { select: { id: true, reference: true, status: true } },
                serviceBooking: { select: { id: true, reference: true, status: true } },
                allocations: {
                    include: { paymentRecord: { select: { paidAt: true, method: true, reference: true } } },
                    orderBy: { createdAt: 'asc' }
                }
            },
            orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        }),
        prisma.$queryRaw`
            SELECT currency,
                   COALESCE(SUM(amount_cents - paid_cents) FILTER (WHERE status IN ('OPEN', 'PARTIAL')), 0)::bigint AS "outstandingCents",
                   COALESCE(SUM(amount_cents - paid_cents) FILTER (WHERE status IN ('OPEN', 'PARTIAL') AND due_at < now()), 0)::bigint AS "overdueCents",
                   COALESCE(SUM(GREATEST(paid_cents - amount_cents, 0)), 0)::bigint AS "creditCents"
              FROM receivables
             WHERE debtor_partner_id = ${partnerId}
             GROUP BY currency
             ORDER BY currency`
    ]);

    res.json({
        balances: balances.map((row) => ({
            currency: row.currency,
            outstandingCents: Number(row.outstandingCents),
            overdueCents: Number(row.overdueCents),
            // Paid beyond what is now owed — after a cancellation — and due back.
            creditCents: Number(row.creditCents)
        })),
        data: receivables.map(toStatementReceivable),
        ...pageOf(total, req.valid.query)
    });
});

/** What a supplier is owed by us, for its own bookings: its net and its schedule. */
partnerFinanceRoutes.get('/payables', validate({ query: statementQuerySchema }), async (req, res) => {
    const { status, page, pageSize } = req.valid.query;
    const where = { supplierPartnerId: req.user.partnerId, ...(status ? { status: { in: status } } : {}) };

    const [total, payables] = await Promise.all([
        prisma.supplierPayable.count({ where }),
        prisma.supplierPayable.findMany({
            where,
            include: { instalments: { orderBy: { sequence: 'asc' } } },
            orderBy: [{ nextDueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    res.json({ data: payables.map(toSupplierStatementPayable), ...pageOf(total, req.valid.query) });
});

/** The company's credit limit and what is open against it. */
partnerFinanceRoutes.get('/credit', async (req, res) => {
    res.json(await creditPosition(req.user.partnerId));
});

/** What the company's own bookings were sold and bought for, by product, over a period (last 30 days by default). */
partnerFinanceRoutes.get('/commission', validate({ query: summaryQuerySchema }), async (req, res) => {
    const { from, to, currency } = req.valid.query;
    const today = todayInTimezone(config.finance.defaultTimezone);
    const toDay = to ?? today;
    const fromDay = from ?? addDays(toDay, -30);

    res.json(
        await commission({
            from: zonedTimeToInstant(fromDay, '00:00', config.finance.defaultTimezone),
            to: zonedTimeToInstant(toDay, '23:59', config.finance.defaultTimezone),
            currency,
            groupBy: 'product',
            partnerId: req.user.partnerId
        })
    );
});
