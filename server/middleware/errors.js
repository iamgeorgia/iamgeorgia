import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

export const notFoundHandler = (req, res) => {
    res.status(404).json({ error: { message: `Cannot ${req.method} ${req.path}` } });
};

// Prisma reports constraint violations through error codes rather than types,
// so the common ones are translated into the status a client expects.
//
// The 5-digit entries are Postgres SQLSTATEs, which surface unwrapped when a
// service uses $queryRaw / $executeRaw — the availability claim and the bulk
// inventory writes both do. 23514 is the one that matters: it is what the
// room_inventory no-oversell CHECK raises, and it must read as a conflict
// rather than an internal error, because losing that race is a normal outcome.
const constraintStatus = {
    P2002: { status: 409, message: 'A record with these unique values already exists' },
    P2003: { status: 409, message: 'Related record constraint failed' },
    P2025: { status: 404, message: 'Record not found' },
    // An interactive transaction that could not get a connection in time, or
    // ran out of it: the database is busy, nothing was written, and the same
    // request can simply be tried again — a 503 that says so, not a 500.
    P2028: { status: 503, message: 'The server is busy. Please try again in a moment.', retryAfterSeconds: 2 },
    23505: { status: 409, message: 'A record with these unique values already exists' },
    23503: { status: 409, message: 'Related record constraint failed' },
    23514: { status: 409, message: 'The request conflicts with current availability' },
    // exclusion_violation: the driver or vehicle no-overlap constraints on
    // transfer_assignments. Losing that race is a normal outcome too.
    '23P01': { status: 409, message: 'That driver or vehicle is already scheduled in this window' }
};

/**
 * The Postgres SQLSTATE behind an error, wherever the driver adapter put it.
 *
 * A raw statement surfaces it as `err.code`. A statement Prisma built itself
 * wraps it: the code Prisma knows about becomes a P-code, the ones it does
 * not (an exclusion constraint, say) are left on the cause. Checked in that
 * order so a P2002 keeps its own mapping.
 */
export const sqlStateOf = (err) => {
    const candidates = [
        err?.code,
        err?.meta?.code,
        err?.cause?.code,
        err?.meta?.driverAdapterError?.cause?.code,
        err?.meta?.driverAdapterError?.cause?.originalCode
    ];

    // A SQLSTATE is five alphanumerics. So is a Prisma code, which is why the
    // P-and-four-digits shape is excluded: P2002 is Prisma's *reading* of the
    // error, and for an exclusion constraint that reading is "unique
    // violation", which is close but names the wrong message.
    const isSqlState = (code) => typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !/^P[1-9]\d{3}$/.test(code);

    const direct = candidates.find(isSqlState);

    if (direct) {
        return direct;
    }

    // Prisma 7 with a driver adapter quotes the SQLSTATE in the message of
    // the error it wraps it in ("Database error. Code: `23P01`. …").
    return /\bCode: `?([0-9A-Z]{5})`?/.exec(err?.message ?? '')?.[1] ?? null;
};

// Express 5 forwards rejected promises from handlers here, so routes do not
// need a try/catch of their own. Must keep all four arguments: Express
// identifies error middleware by arity.
// eslint-disable-next-line no-unused-vars
// Multer rejects an oversized or unexpected upload with its own error type
// that carries no status, so without this a file one byte over the limit would
// read as an internal failure rather than as the client error it is.
const multerStatus = {
    LIMIT_FILE_SIZE: { status: 413, message: 'That file is too large' },
    LIMIT_FILE_COUNT: { status: 400, message: 'Upload one file at a time' },
    LIMIT_UNEXPECTED_FILE: { status: 400, message: 'Unexpected file field' }
};

export const errorHandler = (err, req, res, next) => {
    // The Postgres SQLSTATE is consulted before Prisma's own code: Prisma
    // reports an exclusion-constraint violation as P2002, and the message for
    // that would tell a dispatcher about "unique values" when the truth is
    // "that driver is busy".
    const sqlState = sqlStateOf(err);
    const mapped =
        (err?.name === 'MulterError' && multerStatus[err.code]) ||
        (sqlState && constraintStatus[sqlState]) ||
        (err?.code && constraintStatus[err.code]);

    // Express middleware (body-parser, cors) throws http-errors objects that
    // already carry a status and an `expose` flag saying whether the message
    // is safe to return — a 413 from express.json() must not become a 500.
    const httpErrorStatus = err?.status ?? err?.statusCode;
    const status =
        err instanceof HttpError
            ? err.status
            : mapped?.status ?? (Number.isInteger(httpErrorStatus) ? httpErrorStatus : 500);

    if (mapped?.retryAfterSeconds && !(err instanceof HttpError)) {
        res.set('Retry-After', String(mapped.retryAfterSeconds));
    }

    if (status >= 500) {
        (req.log ?? console).error({ err }, 'Unhandled error');
    } else {
        (req.log ?? console).warn({ err: err.message }, 'Request failed');
    }

    // Only errors that were raised deliberately — ours, Prisma's mapped codes,
    // or an http-error marked `expose` — are safe to describe to a client.
    const message =
        err instanceof HttpError
            ? err.message
            : mapped?.message ?? (err?.expose && status < 500 ? err.message : 'Internal server error');

    res.status(status).json({
        error: {
            message,
            // `details` is our own HttpError convention. A third-party error
            // that happens to carry a property of that name is not ours to
            // describe to a client, whatever it contains.
            ...(err instanceof HttpError && err.details ? { details: err.details } : {}),
            ...(config.nodeEnv === 'development' && status >= 500 ? { stack: err.stack } : {})
        }
    });
};
