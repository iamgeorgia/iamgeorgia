import { Readable } from 'node:stream';

import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { cancelInvoiceSchema, invoiceIdParamSchema, invoiceQuerySchema, sendInvoiceSchema, syncEventQuerySchema } from '../validation/invoice.js';
import { toInvoice, toSyncEvent } from '../serializers/invoice.js';
import { cancelProforma, findInvoiceOr404, listInvoices, requestSend, retryInvoice, streamPdf } from '../services/invoicing/invoice.service.js';
import { listUnmatchedSyncEvents } from '../services/invoicing/sync.service.js';
import { config, INVOICEOCEAN_LANGS } from '../config.js';

/**
 * Invoices, for the finance desk.
 *
 * Reading is `invoices.read` (every finance reader and management); sending,
 * cancelling and retrying are `invoices.write` (the accountant and the
 * finance operator). Issuing one by hand lives on the receivable it is for,
 * under /admin/finance/receivables/:id/invoices.
 */
export const adminInvoiceRoutes = Router();

adminInvoiceRoutes.use(authenticate);

const C = CAPABILITIES;

adminInvoiceRoutes.get('/', requireCapability(C.INVOICES_READ), validate({ query: invoiceQuerySchema }), async (req, res) => {
    const { invoices, ...meta } = await listInvoices(req.valid.query);

    res.json({ data: invoices.map(toInvoice), ...meta });
});

/**
 * What the screens need to know before offering anything: whether invoicing
 * is switched on at all (a server with the flag off still lists what was
 * issued before), the languages a document can be printed in, and the
 * defaults a hand-issued one starts from. No secret is in here.
 */
adminInvoiceRoutes.get('/settings', requireCapability(C.INVOICES_READ), (req, res) => {
    const io = config.finance.invoiceocean;

    res.json({
        enabled: Boolean(io.enabled),
        provider: 'INVOICEOCEAN',
        languages: [...INVOICEOCEAN_LANGS],
        defaultLang: io.lang,
        defaultTaxBps: io.defaultTaxBps,
        autoSend: Boolean(io.autoSend)
    });
});

/** Status reports from the provider that matched nothing here, or could not be applied. */
adminInvoiceRoutes.get('/sync-events', requireCapability(C.INVOICES_READ), validate({ query: syncEventQuerySchema }), async (req, res) => {
    const { events, ...meta } = await listUnmatchedSyncEvents(req.valid.query);

    res.json({ data: events.map(toSyncEvent), ...meta });
});

adminInvoiceRoutes.get('/:id', requireCapability(C.INVOICES_READ), validate({ params: invoiceIdParamSchema }), async (req, res) => {
    res.json(toInvoice(await findInvoiceOr404(req.valid.params.id)));
});

/** The document itself, streamed from the provider: the provider's own link is never handed out. */
export const sendPdf = async (res, pdf) => {
    res.status(200);
    res.set('Content-Type', pdf.contentType);
    res.set('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.set('Cache-Control', 'private, no-store');
    if (pdf.contentLength) res.set('Content-Length', String(pdf.contentLength));

    await new Promise((resolve, reject) => {
        const stream = Readable.fromWeb(pdf.stream);
        stream.on('error', reject);
        res.on('close', resolve);
        res.on('finish', resolve);
        stream.pipe(res);
    });
};

adminInvoiceRoutes.get('/:id/pdf', requireCapability(C.INVOICES_READ), validate({ params: invoiceIdParamSchema }), async (req, res) => {
    await sendPdf(res, await streamPdf(req.valid.params.id));
});

adminInvoiceRoutes.post('/:id/send', requireCapability(C.INVOICES_WRITE), validate({ params: invoiceIdParamSchema, body: sendInvoiceSchema }), async (req, res) => {
    const invoice = await requestSend(req.valid.params.id, { to: req.valid.body.to ?? null }, req.user, req);

    res.status(202).json({ invoice: toInvoice(invoice), queued: true });
});

adminInvoiceRoutes.post('/:id/cancel', requireCapability(C.INVOICES_WRITE), validate({ params: invoiceIdParamSchema, body: cancelInvoiceSchema }), async (req, res) => {
    res.json(toInvoice(await cancelProforma(req.valid.params.id, req.valid.body, req.user, req)));
});

adminInvoiceRoutes.post('/:id/retry', requireCapability(C.INVOICES_WRITE), validate({ params: invoiceIdParamSchema }), async (req, res) => {
    res.status(202).json({ invoice: toInvoice(await retryInvoice(req.valid.params.id, req.user, req)), queued: true });
});
