import MailComposer from 'nodemailer/lib/mail-composer';

import { MailDeliveryError } from './errors.js';

/**
 * A message object — the same shape nodemailer takes, and the one `sendMail`
 * has always built — compiled into an RFC 5322 message.
 *
 * nodemailer's own composer does the work: UTF-8 headers (a Georgian or
 * Hebrew subject is encoded, not mangled), multipart/alternative for text and
 * HTML, base64 attachments, address lists. Hand-assembled MIME is where
 * header injection and broken boundaries come from, so there is none here.
 */

const LINE_BREAK = /[\r\n]/;
const ADDRESS_FIELDS = ['from', 'to', 'cc', 'bcc', 'replyTo'];

const addressStrings = (value) => {
    if (value === undefined || value === null || value === '') return [];
    if (Array.isArray(value)) return value.flatMap(addressStrings);
    if (typeof value === 'object') return [value.name ?? '', value.address ?? ''];

    return [String(value)];
};

/**
 * Refuses an address carrying a line break — the shape of a header injection —
 * rather than trusting every caller to have validated it. A subject is folded
 * onto one line instead: it is built from a company or guest name, and a
 * stray newline there is a typo to tidy, not a reason to lose the email.
 */
export const sanitiseMessage = (message) => {
    for (const field of ADDRESS_FIELDS) {
        if (addressStrings(message[field]).some((part) => LINE_BREAK.test(part))) {
            throw new MailDeliveryError(`Refusing to send: the ${field} address contains a line break`, {
                kind: 'permanent',
                reason: 'headerInjection'
            });
        }
    }

    if (addressStrings(message.to).length === 0 && addressStrings(message.cc).length === 0 && addressStrings(message.bcc).length === 0) {
        throw new MailDeliveryError('Refusing to send: the message has no recipient', { kind: 'permanent', reason: 'noRecipient' });
    }

    return { ...message, subject: String(message.subject ?? '').replace(/[\r\n]+/g, ' ').trim() };
};

/**
 * The full message as bytes. Bcc stays in the headers: Gmail reads recipients
 * from it and strips it on delivery. Line endings are made CRLF throughout, as
 * RFC 5322 requires; the templates join their lines with a bare line feed,
 * which the SMTP transport normalises the same way on the wire.
 */
export const buildMimeMessage = async (message) => {
    const node = new MailComposer({ ...sanitiseMessage(message), newline: 'windows' }).compile();

    node.keepBcc = true;

    return node.build();
};
