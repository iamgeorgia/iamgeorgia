import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { BadRequestError } from '../../lib/errors.js';
import { parseCallbackBody } from '../../lib/integrations/flitt/parse.js';
import { verify } from '../../lib/integrations/flitt/signature.js';
import { logger } from '../../lib/logger.js';
import { enqueueEvent, TOPICS } from '../../lib/outbox.js';
import { modeNow, refreshFromProvider } from './psp-payment.service.js';

/**
 * Flitt's server-to-server callback: ingest, then apply.
 *
 * The callback is a *trigger*, not a source of truth. It is parsed without
 * altering a byte, its signature is checked, and it is stored in an inbox
 * keyed on the hash of its body — so a redelivery is a no-op — and answered
 * at once. Applying it means asking the gateway for the order's status
 * under our own signed request and handing that to `applyProviderStatus`.
 * A forged callback with a valid-looking status therefore moves nothing: the
 * gateway does not know the order, or says something else.
 *
 * This is the shape the InvoiceOcean webhook already has (ingest → re-read
 * → apply), and the house rule for PSP webhooks.
 */

const settings = () => config.payments.flitt;

const redact = (fields) => {
    const { signature, response_signature_string, ...rest } = fields;

    return rest;
};

const pick = (fields, key) => (fields[key] === undefined || fields[key] === null || fields[key] === '' ? null : String(fields[key]));

/**
 * `{ status, body }` for the HTTP answer, after the inbox row is written.
 * 200 for anything verified (stored, or a duplicate); 400 for anything that
 * does not verify — Flitt will retry on its schedule and every rejection is
 * on record. Throws only on a body that cannot be read at all.
 */
export const ingestCallback = async ({ raw, contentType, ip }) => {
    const { fields, bodyHash } = parseCallbackBody(raw, contentType);
    const mode = modeNow();
    const merchantOrderId = pick(fields, 'order_id');
    const providerPaymentId = pick(fields, 'payment_id');
    const orderStatus = pick(fields, 'order_status');

    const signatureValid = verify(settings().secretKey, fields);
    const merchantValid = pick(fields, 'merchant_id') === String(settings().merchantId);
    const ipKnown = !ip || settings().callbackIps.includes(ip);
    const ipAccepted = ipKnown || !settings().callbackIpEnforce;
    const accepted = signatureValid && merchantValid && ipAccepted;

    const payment = merchantOrderId ? await prisma.pspPayment.findFirst({ where: { provider: 'FLITT', mode, merchantOrderId }, select: { id: true, reference: true } }) : null;

    const { count } = await prisma.pspCallbackEvent.createMany({
        data: {
            provider: 'FLITT',
            mode,
            bodyHash,
            merchantOrderId,
            providerPaymentId,
            orderStatus,
            signatureValid: accepted,
            sourceIp: ip ?? null,
            payload: redact(fields),
            paymentId: payment?.id ?? null,
            ...(accepted ? {} : { processedAt: new Date(), error: !signatureValid ? 'INVALID_SIGNATURE' : !merchantValid ? 'WRONG_MERCHANT' : 'UNEXPECTED_SOURCE_IP' })
        },
        skipDuplicates: true
    });

    const duplicate = count === 0;

    if (!ipKnown && accepted) {
        logger.warn({ ip, merchantOrderId, paymentId: payment?.id }, 'Flitt callback from an address outside FLITT_CALLBACK_IPS (not enforced)');
    }

    if (!accepted) {
        const reason = !signatureValid ? 'INVALID_SIGNATURE' : !merchantValid ? 'WRONG_MERCHANT' : 'UNEXPECTED_SOURCE_IP';

        logger.error({ ip, merchantOrderId, providerPaymentId, orderStatus, reason, duplicate }, 'Flitt callback rejected');

        if (!duplicate) {
            await prisma.$transaction(async (tx) => {
                await recordAudit(tx, {
                    action: 'PSP_CALLBACK_REJECTED',
                    actor: null,
                    entityType: payment ? AUDIT_ENTITY.pspPayment : AUDIT_ENTITY.pspCallbackEvent,
                    entityId: payment?.id ?? bodyHash,
                    summary: `Flitt callback rejected (${reason})${merchantOrderId ? ` for ${merchantOrderId}` : ''}`,
                    metadata: { reason, ip: ip ?? null, merchantOrderId, providerPaymentId, orderStatus },
                    req: null
                });
                await enqueueEvent(tx, {
                    topic: TOPICS.PSP_ALERT,
                    payload: { kind: 'CALLBACK_REJECTED', reason, ip: ip ?? null, merchantOrderId, paymentId: payment?.id ?? null, paymentReference: payment?.reference ?? null },
                    entityType: AUDIT_ENTITY.pspCallbackEvent,
                    entityId: bodyHash
                });
            });
        }

        return { status: 400, body: { error: { message: 'Callback rejected' } } };
    }

    if (!payment) {
        logger.warn({ merchantOrderId, providerPaymentId, orderStatus, ip }, 'Flitt callback for an order this deploy does not know');
    }

    return { status: 200, body: { received: true, ...(duplicate ? { duplicate: true } : {}) }, paymentId: payment?.id ?? null, duplicate };
};

const GIVE_UP_AFTER_MS = 48 * 3_600_000;
const BATCH = 50;

let applying = false;

/**
 * Works through verified, unprocessed inbox rows: each one is a status read
 * from the gateway for its payment. Idempotent and row-locked underneath, so
 * running twice at once wastes a request but changes nothing; this process
 * still runs one pass at a time.
 */
export const applyCallbackEvents = async () => {
    if (applying) {
        return { applied: 0, skipped: true };
    }

    applying = true;

    try {
        const events = await prisma.pspCallbackEvent.findMany({
            where: { signatureValid: true, processedAt: null },
            orderBy: { receivedAt: 'asc' },
            take: BATCH
        });

        let applied = 0;

        for (const event of events) {
            if (!event.paymentId) {
                // Known at ingest to belong to no payment here. Maybe another
                // deploy's order on the shared test merchant; maybe a forgery
                // that passed with a public key. On record, and finance hears.
                await prisma.$transaction(async (tx) => {
                    await tx.pspCallbackEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: 'UNKNOWN_ORDER' } });
                    await enqueueEvent(tx, {
                        topic: TOPICS.PSP_ALERT,
                        payload: { kind: 'UNKNOWN_ORDER', merchantOrderId: event.merchantOrderId, providerPaymentId: event.providerPaymentId, orderStatus: event.orderStatus, ip: event.sourceIp },
                        entityType: AUDIT_ENTITY.pspCallbackEvent,
                        entityId: event.id
                    });
                });
                continue;
            }

            try {
                await refreshFromProvider(event.paymentId, { source: 'callback' });
                await prisma.pspCallbackEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
                applied += 1;
            } catch (err) {
                const gaveUp = Date.now() - event.receivedAt.getTime() > GIVE_UP_AFTER_MS;

                logger.error({ eventId: event.id, paymentId: event.paymentId, err: err?.message, reason: err?.details?.reason, gaveUp }, 'Could not apply a Flitt callback');
                await prisma.pspCallbackEvent.update({
                    where: { id: event.id },
                    data: { error: String(err?.message ?? err).slice(0, 500), ...(gaveUp ? { processedAt: new Date() } : {}) }
                });
            }
        }

        return { applied, total: events.length };
    } finally {
        applying = false;
    }
};

/** For the route: the raw body must be a Buffer, or the raw parser was not mounted. */
export const assertRawBody = (body) => {
    if (!Buffer.isBuffer(body)) {
        throw new BadRequestError('Callback body is not raw', { reason: 'CALLBACK_MALFORMED' });
    }

    return body;
};
