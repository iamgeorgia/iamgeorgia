import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { webhookSchema } from '../validation/invoice.js';
import { ingestWebhook } from '../services/invoicing/sync.service.js';

/**
 * InvoiceOcean's webhook. Public — there is no session on the other end —
 * and guarded by the secret the webhook was registered with, which
 * InvoiceOcean sends back as `api_token` in the body (an `X-Webhook-Secret`
 * header is accepted too, for a manual test with curl). The delivery is
 * stored and answered at once; the work happens on the sync applier.
 *
 * The global rate limiter and the 100 kB body limit apply as to any route.
 */
export const invoiceOceanWebhookRoutes = Router();

invoiceOceanWebhookRoutes.post('/webhook', validate({ body: webhookSchema }), async (req, res) => {
    const presented = req.get('x-webhook-secret') ?? (typeof req.body?.api_token === 'string' ? req.body.api_token : null);
    const result = await ingestWebhook(req.body, presented);

    res.status(200).json({ received: true, duplicate: result.duplicate });
});
