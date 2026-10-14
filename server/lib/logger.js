import pino from 'pino';

import { config } from '../config.js';

/**
 * Paths that must never reach a log line.
 *
 * Both directions. The incoming cookie and bearer are the obvious ones; the
 * outgoing `Set-Cookie` is the one that was missed for a long time, and it is
 * worse: pino-http's default response serializer copies every response header
 * into the record, so without this entry each login wrote a freshly minted
 * session token to the log in plaintext. A log archive is not a place to keep
 * live credentials.
 */
export const REDACTED_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    // The InvoiceOcean webhook secret, when a manual test sends it as a header.
    'req.headers["x-webhook-secret"]',
    'res.headers["set-cookie"]'
];

// Structured JSON logs in production so a log shipper can parse them;
// pino-pretty (a devDependency) makes them readable while developing.
export const logger = pino({
    level: config.logLevel,
    transport:
        config.nodeEnv === 'development'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
            : undefined,
    redact: REDACTED_PATHS
});

export default logger;
