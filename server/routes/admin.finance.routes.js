import { Router } from 'express';

import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { idempotencyKeyFrom } from '../lib/idempotency.js';
import { addDays, todayInTimezone, zonedTimeToInstant } from '../lib/time.js';
import { NotFoundError } from '../lib/errors.js';
import {
    payableQuerySchema,
    receivableQuerySchema,
    paymentQuerySchema,
    recordPaymentSchema,
    allocatePaymentSchema,
    payInstalmentSchema,
    adjustPayableSchema,
    adjustReceivableSchema,
    summaryQuerySchema,
    marginQuerySchema,
    ageingQuerySchema,
    supplierTermsSchema,
    partnerTermsSchema,
    financeIdParamSchema,
    instalmentParamSchema,
    termsParamSchema
} from '../validation/finance.js';
import { toPayable, toReceivable, toPayment, toSupplierTerms } from '../serializers/finance.js';
import {
    listPayables,
    findPayableOr404,
    adjustPayable,
    listReceivables,
    findReceivableOr404,
    adjustReceivable,
    listPayments,
    findPaymentOr404
} from '../services/finance/settlement.service.js';
import { recordPayment, allocatePayment, payInstalment, paymentInclude } from '../services/finance/payment.service.js';
import { summary, margin, ageing, toCsv, recordExport } from '../services/finance/report.service.js';
import { getSupplierTerms, putSupplierTerms, updatePartnerTerms } from '../services/finance/terms.service.js';
import { prisma } from '../db/index.js';

/**
 * Operational finance: what we owe suppliers, what buyers owe us, the money
 * that moved, the terms behind them, and the reports.
 *
 * Each route names its own capability rather than the router naming one for
 * all, because the split is finer than read/write: management reads every
 * figure and changes nothing, finance records payments, and an export is its
 * own permission. Money is per currency throughout (D8).
 */
export const adminFinanceRoutes = Router();

adminFinanceRoutes.use(authenticate);

const C = CAPABILITIES;
const tz = () => config.finance.defaultTimezone;

/** A report's period: whole days in Tbilisi time, the last 30 by default. */
const period = ({ from, to }) => {
    const today = todayInTimezone(tz());
    const start = from ?? addDays(today, -29);
    const end = to ?? today;

    return {
        from: zonedTimeToInstant(start, '00:00', tz()),
        to: new Date(zonedTimeToInstant(addDays(end, 1), '00:00', tz()).getTime() - 1)
    };
};

const major = (cents) => (cents / 100).toFixed(2);

const sendCsv = (res, name, csv) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}-${todayInTimezone(tz())}.csv"`);
    res.send(csv);
};

/** CSV needs its own permission on top of reading the report. */
const exportGate = (req, res, next) =>
    req.valid.query.format === 'csv' ? requireCapability(C.FINANCE_EXPORT)(req, res, next) : next();

// --- Payables ----------------------------------------------------------------------

adminFinanceRoutes.get(
    '/payables',
    requireCapability(C.FINANCE_PAYABLES_READ),
    validate({ query: payableQuerySchema }),
    async (req, res) => {
        const { payables, ...meta } = await listPayables(req.valid.query);
        res.json({ data: payables.map(toPayable), ...meta });
    }
);

adminFinanceRoutes.get(
    '/payables/:id',
    requireCapability(C.FINANCE_PAYABLES_READ),
    validate({ params: financeIdParamSchema }),
    async (req, res) => {
        res.json(toPayable(await findPayableOr404(req.valid.params.id)));
    }
);

adminFinanceRoutes.patch(
    '/payables/:id',
    requireCapability(C.FINANCE_PAYMENTS_WRITE),
    validate({ params: financeIdParamSchema, body: adjustPayableSchema }),
    async (req, res) => {
        res.json(toPayable(await adjustPayable(req.valid.params.id, req.valid.body, req.user, req)));
    }
);

adminFinanceRoutes.post(
    '/payables/:id/instalments/:sequence/pay',
    requireCapability(C.FINANCE_PAYMENTS_WRITE),
    validate({ params: instalmentParamSchema, body: payInstalmentSchema }),
    async (req, res) => {
        const { id, sequence } = req.valid.params;
        const { payment, replayed } = await payInstalment(
            id,
            sequence,
            { ...req.valid.body, idempotencyKey: idempotencyKeyFrom(req) },
            req.user,
            req
        );

        res.status(replayed ? 200 : 201).json({ payment: toPayment(payment), replayed });
    }
);

// --- Receivables ----------------------------------------------------------------

adminFinanceRoutes.get(
    '/receivables',
    requireCapability(C.FINANCE_RECEIVABLES_READ),
    validate({ query: receivableQuerySchema }),
    async (req, res) => {
        const { receivables, ...meta } = await listReceivables(req.valid.query);
        res.json({ data: receivables.map(toReceivable), ...meta });
    }
);

adminFinanceRoutes.get(
    '/receivables/:id',
    requireCapability(C.FINANCE_RECEIVABLES_READ),
    validate({ params: financeIdParamSchema }),
    async (req, res) => {
        res.json(toReceivable(await findReceivableOr404(req.valid.params.id)));
    }
);

adminFinanceRoutes.patch(
    '/receivables/:id',
    requireCapability(C.FINANCE_PAYMENTS_WRITE),
    validate({ params: financeIdParamSchema, body: adjustReceivableSchema }),
    async (req, res) => {
        res.json(toReceivable(await adjustReceivable(req.valid.params.id, req.valid.body, req.user, req)));
    }
);

// --- Payments ------------------------------------------------------------------------

adminFinanceRoutes.get(
    '/payments',
    requireCapability(C.FINANCE_PAYMENTS_READ),
    validate({ query: paymentQuerySchema }),
    async (req, res) => {
        const { payments, ...meta } = await listPayments(req.valid.query, paymentInclude);
        res.json({ data: payments.map(toPayment), ...meta });
    }
);

adminFinanceRoutes.get(
    '/payments/:id',
    requireCapability(C.FINANCE_PAYMENTS_READ),
    validate({ params: financeIdParamSchema }),
    async (req, res) => {
        res.json(toPayment(await findPaymentOr404(req.valid.params.id, paymentInclude)));
    }
);

/** 201 with the payment; 200 and `replayed: true` for a retried Idempotency-Key. */
adminFinanceRoutes.post(
    '/payments',
    requireCapability(C.FINANCE_PAYMENTS_WRITE),
    validate({ body: recordPaymentSchema }),
    async (req, res) => {
        const { payment, replayed } = await recordPayment(
            { ...req.valid.body, idempotencyKey: idempotencyKeyFrom(req) },
            req.user,
            req
        );

        res.status(replayed ? 200 : 201).json({ payment: toPayment(payment), replayed });
    }
);

adminFinanceRoutes.post(
    '/payments/:id/allocations',
    requireCapability(C.FINANCE_PAYMENTS_WRITE),
    validate({ params: financeIdParamSchema, body: allocatePaymentSchema }),
    async (req, res) => {
        res.json(toPayment(await allocatePayment(req.valid.params.id, req.valid.body, req.user, req)));
    }
);

// --- Reports --------------------------------------------------------------------------

adminFinanceRoutes.get(
    '/reports/summary',
    requireCapability(C.FINANCE_REPORTS_READ),
    validate({ query: summaryQuerySchema }),
    exportGate,
    async (req, res) => {
        const report = await summary({ ...req.valid.query, ...period(req.valid.query) });

        if (req.valid.query.format !== 'csv') return res.json(report);

        await recordExport('summary', req.valid.query, req.user, req);
        sendCsv(
            res,
            'finance-summary',
            toCsv(
                [
                    { label: 'Currency', value: (r) => r.currency },
                    { label: 'Receivables open', value: (r) => major(r.receivables.openCents) },
                    { label: 'Receivables overdue', value: (r) => major(r.receivables.overdueCents) },
                    { label: 'Refunds due to buyers', value: (r) => major(r.receivables.refundDueCents) },
                    { label: 'Payables open', value: (r) => major(r.payables.openCents) },
                    { label: 'Payables overdue', value: (r) => major(r.payables.overdueCents) },
                    { label: 'Payables due this week', value: (r) => major(r.payables.dueThisWeekCents) },
                    { label: 'Cash in', value: (r) => major(r.cash.inCents) },
                    { label: 'Cash out', value: (r) => major(r.cash.outCents) },
                    { label: 'Refunds paid out', value: (r) => major(r.cash.refundsOutCents) },
                    { label: 'Refunds received', value: (r) => major(r.cash.refundsInCents) }
                ],
                report.currencies
            )
        );
    }
);

adminFinanceRoutes.get(
    '/reports/margin',
    requireCapability(C.FINANCE_REPORTS_READ),
    validate({ query: marginQuerySchema }),
    exportGate,
    async (req, res) => {
        const report = await margin({ ...req.valid.query, ...period(req.valid.query) });

        if (req.valid.query.format !== 'csv') return res.json(report);

        await recordExport('margin', req.valid.query, req.user, req);
        sendCsv(
            res,
            `finance-margin-by-${report.groupBy}`,
            toCsv(
                [
                    { label: report.groupBy === 'product' ? 'Product' : report.groupBy === 'supplier' ? 'Supplier' : 'Partner', value: (r) => r.label },
                    { label: 'Currency', value: (r) => r.currency },
                    { label: 'Bookings', value: (r) => r.bookings },
                    { label: 'Revenue', value: (r) => major(r.revenueCents) },
                    { label: 'Cost', value: (r) => major(r.costCents) },
                    { label: 'Margin', value: (r) => major(r.marginCents) },
                    { label: 'Margin %', value: (r) => (r.marginBps === null ? '' : (r.marginBps / 100).toFixed(2)) }
                ],
                report.rows
            )
        );
    }
);

adminFinanceRoutes.get(
    '/reports/ageing',
    requireCapability(C.FINANCE_REPORTS_READ),
    validate({ query: ageingQuerySchema }),
    exportGate,
    async (req, res) => {
        const report = await ageing(req.valid.query);

        if (req.valid.query.format !== 'csv') return res.json(report);

        await recordExport('ageing', req.valid.query, req.user, req);
        sendCsv(
            res,
            `finance-ageing-${report.side}`,
            toCsv(
                [
                    { label: report.side === 'payables' ? 'Supplier' : 'Debtor', value: (r) => r.label },
                    { label: 'Currency', value: (r) => r.currency },
                    { label: 'Not yet due', value: (r) => major(r.current) },
                    { label: '1-30 days', value: (r) => major(r.d1_30) },
                    { label: '31-60 days', value: (r) => major(r.d31_60) },
                    { label: '61-90 days', value: (r) => major(r.d61_90) },
                    { label: 'Over 90 days', value: (r) => major(r.d90_plus) },
                    { label: 'Total', value: (r) => major(r.totalCents) }
                ],
                report.rows
            )
        );
    }
);

// --- Terms ------------------------------------------------------------------------------

/** URL segment → the product terms hang off. */
const TERMS_KINDS = { hotels: 'hotel', 'transfer-providers': 'transferProvider', tours: 'tour', services: 'service' };

const termsKind = (req) => {
    const kind = TERMS_KINDS[req.params.kind];
    if (!kind) throw new NotFoundError('Not found');
    return kind;
};

adminFinanceRoutes.get(
    '/terms/:kind/:id',
    requireCapability(C.FINANCE_PAYABLES_READ, C.CATALOGUE_WRITE),
    validate({ params: termsParamSchema.extend({ kind: termsParamSchema.shape.id }) }),
    async (req, res) => {
        res.json(toSupplierTerms(await getSupplierTerms(termsKind(req), req.valid.params.id)));
    }
);

adminFinanceRoutes.put(
    '/terms/:kind/:id',
    requireCapability(C.FINANCE_TERMS_WRITE),
    validate({ params: termsParamSchema.extend({ kind: termsParamSchema.shape.id }), body: supplierTermsSchema }),
    async (req, res) => {
        res.json(toSupplierTerms(await putSupplierTerms(termsKind(req), req.valid.params.id, req.valid.body, req.user, req)));
    }
);

adminFinanceRoutes.get(
    '/partners/:id/terms',
    requireCapability(C.FINANCE_RECEIVABLES_READ, C.PARTNERS_WRITE),
    validate({ params: financeIdParamSchema }),
    async (req, res) => {
        const partner = await prisma.partner.findUnique({
            where: { id: req.valid.params.id },
            select: { id: true, paymentDueDays: true, paymentDueAnchor: true, paymentTermsNote: true }
        });
        if (!partner) throw new NotFoundError('Partner not found');
        res.json(partner);
    }
);

adminFinanceRoutes.patch(
    '/partners/:id/terms',
    requireCapability(C.FINANCE_TERMS_WRITE),
    validate({ params: financeIdParamSchema, body: partnerTermsSchema }),
    async (req, res) => {
        res.json(await updatePartnerTerms(req.valid.params.id, req.valid.body, req.user, req));
    }
);
