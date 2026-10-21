import { createHash } from 'node:crypto';

import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { logger } from '../logger.js';
import { currentOutboxEvent } from '../outbox.js';
import { isPermanentMailError } from './errors.js';
import { noteGmailVolume, sendViaGmail } from './providers/gmail.js';
import { sendViaSmtp } from './providers/smtp.js';
import { templates } from './templates.js';

export * from './templates.js';
export { MailDeliveryError } from './errors.js';

/**
 * Messages the capture transport has collected. Exported so the test suite can
 * assert that approving a partner actually emailed them, rather than trusting
 * that the call was made.
 */
export const outbox = [];

export const clearOutbox = () => {
    outbox.length = 0;
};

/**
 * Addresses the capture transport refuses to deliver to.
 *
 * A test seam and nothing else: it is read only inside `capture`, so it can
 * never affect a real send. It exists so the suite can watch what the outbox
 * does when the relay says no — the one path a green SMTP server never shows.
 */
export const failDeliveryTo = new Set();

/**
 * The transports, by the name MAIL_TRANSPORT gives. Each takes the same
 * message object and resolves to `{ transport, messageId? }` or throws; a
 * provider added here (Postmark, SES) needs nothing changed above it.
 */
const dispatch = {
    smtp: (message) => sendViaSmtp(message),

    gmail: (message) => sendViaGmail(message),

    // The link is the part a developer actually needs, and it is buried in the
    // body, so it is pulled out to the top level of the log line.
    log: (message, meta) => {
        logger.info(
            { to: message.to, subject: message.subject, url: meta.url },
            `Email (${meta.template}) not sent: MAIL_TRANSPORT=log`
        );
        logger.debug({ text: message.text }, 'Email body');

        return Promise.resolve({ transport: 'log' });
    },

    capture: (message, meta) => {
        if (failDeliveryTo.has(message.to)) {
            return Promise.reject(new Error(`Simulated delivery failure to ${message.to}`));
        }

        outbox.push({ ...message, template: meta.template, url: meta.url, data: meta.data, sentAt: new Date() });

        return Promise.resolve({ transport: 'capture' });
    }
};

// Transports whose sends are logged even outside an outbox handler: the ones
// that actually deliver, where "did it go?" is a question someone will ask.
const DELIVERING = new Set(['smtp', 'gmail']);

const listOf = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

const recipientsOf = (message) =>
    [...listOf(message.to), ...listOf(message.cc), ...listOf(message.bcc)]
        .map((entry) => (typeof entry === 'object' ? entry.address : entry))
        .map((entry) => String(entry).trim().toLowerCase())
        .join(', ');

/**
 * The identity of one email within one outbox event. Rendered content is part
 * of it, so two different emails to the same address from the same handler
 * (the partner's and the guest's copy of a reminder) are not mistaken for
 * one another.
 */
const dedupeKeyFor = (event, template, message) =>
    createHash('sha256')
        .update([event.id, template, recipientsOf(message), message.subject, message.text].join('\u0000'))
        .digest('hex');

const writeLog = async (entry) => {
    try {
        await prisma.mailLog.createMany({ data: [entry], skipDuplicates: true });
    } catch (err) {
        // After a successful send this must never throw: an outbox handler
        // would be retried and the email sent a second time.
        logger.error({ err, template: entry.template }, 'Could not record the email in the mail log');
    }
};

const errorText = (err) => String(err?.message ?? err).slice(0, 1000);

/**
 * Renders and sends one notification.
 *
 * Throws when the transport fails. Callers decide whether that matters: an
 * invitation whose email never left is worth failing the request over, because
 * the admin would otherwise believe a link is on its way that is not.
 *
 * Inside an outbox handler two things differ. An email this event already
 * sent on an earlier attempt is skipped, so a retry after a later failure
 * does not repeat it. And a permanent refusal (a malformed address) is logged
 * and returns null instead of throwing, so the handler goes on to its other
 * recipients rather than failing at the same address on every attempt.
 *
 * `cc`, `bcc` and `attachments` take nodemailer's shapes. `transport` is for
 * the administrator's test send, which must try Gmail before it is selected.
 */
export const sendMail = async ({ to, cc, bcc, attachments, template, data = {} }, { transport: transportName = config.mail.transport } = {}) => {
    const render = templates[template];

    if (!render) {
        throw new Error(`Unknown email template: ${template}`);
    }

    const { subject, text, html } = render(data);

    const message = {
        from: config.mail.from,
        ...(config.mail.replyTo ? { replyTo: config.mail.replyTo } : {}),
        to,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        subject,
        text,
        html,
        ...(attachments?.length ? { attachments } : {})
    };

    const transport = dispatch[transportName];

    // config.js refuses to boot on a name that is not in `dispatch`, so this
    // cannot be reached — but the alternative of falling back to `log` is how a
    // deploy once printed every email instead of sending it, and that must not
    // quietly come back.
    if (!transport) {
        throw new Error(`Unknown mail transport: ${transportName}`);
    }

    const event = currentOutboxEvent();
    const dedupeKey = event ? dedupeKeyFor(event, template, message) : null;
    const logged = Boolean(event) || DELIVERING.has(transportName);
    const entry = {
        provider: transportName,
        template,
        recipients: recipientsOf(message).slice(0, 1000),
        subject: String(subject).slice(0, 500),
        outboxEventId: event?.id ?? null
    };

    if (dedupeKey) {
        const already = await prisma.mailLog.findUnique({ where: { dedupeKey }, select: { id: true } });

        if (already) {
            logger.info({ template, eventId: event.id }, 'Email already sent on an earlier attempt of this event; not sending again');

            return message;
        }
    }

    let result;

    try {
        result = await transport(message, { template, url: data.url, data });
    } catch (err) {
        if (logged) {
            await writeLog({ ...entry, status: 'FAILED', error: errorText(err) });
        }

        if (event && isPermanentMailError(err)) {
            logger.error({ err, template, to, eventId: event.id }, 'Email refused permanently; not retrying it');

            return null;
        }

        throw err;
    }

    if (logged) {
        await writeLog({ ...entry, status: 'SENT', providerMessageId: result?.messageId ?? null, dedupeKey });
    }

    if (transportName === 'gmail') {
        await noteGmailVolume();
    }

    return message;
};

/**
 * Sends without letting a mail failure fail the request.
 *
 * Used for notifications that report something already committed — an approval
 * has happened whether or not the email describing it arrived, and rolling the
 * approval back because a mail server was briefly down would be worse than a
 * missing notification.
 */
export const sendMailQuietly = async (options) => {
    try {
        return await sendMail(options);
    } catch (err) {
        logger.error({ err, template: options.template, to: options.to }, 'Notification email failed');

        return null;
    }
};
