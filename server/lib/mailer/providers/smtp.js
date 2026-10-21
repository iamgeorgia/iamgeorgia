import nodemailer from 'nodemailer';

import { config } from '../../../config.js';

let smtpTransport;

// Built on first use, not at import: a development process that never sends an
// email should not open a connection to an SMTP server it has no credentials
// for, and the test suite should not need one to exist at all.
const getSmtpTransport = () => {
    smtpTransport ??= nodemailer.createTransport({
        host: config.mail.smtp.host,
        port: config.mail.smtp.port,
        secure: config.mail.smtp.secure,
        auth: config.mail.smtp.user ? { user: config.mail.smtp.user, pass: config.mail.smtp.pass } : undefined,
        // Bounded, because a relay that accepts the TCP connection and then
        // says nothing would otherwise hold the request that triggered the
        // email for as long as the socket lived.
        connectionTimeout: config.mail.smtp.connectionTimeoutMs,
        greetingTimeout: config.mail.smtp.connectionTimeoutMs,
        socketTimeout: config.mail.smtp.socketTimeoutMs
    });

    return smtpTransport;
};

/**
 * The relay, exactly as before the Gmail transport existed. Its errors are
 * passed through unclassified: an SMTP 5xx is not reliably permanent (a
 * sandbox answers "550 too many emails per second"), so every failure stays
 * a thrown error the outbox retries, as it always was.
 */
export const sendViaSmtp = async (message) => {
    const info = await getSmtpTransport().sendMail(message);

    return { transport: 'smtp', messageId: info?.messageId ?? null };
};
