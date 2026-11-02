/**
 * Errors that carry an HTTP status. Anything thrown in a route that is not an
 * HttpError is treated as an unexpected 500 by the error middleware, so
 * internal failures never leak their message to a client.
 */
export class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.details = details;
        Error.captureStackTrace?.(this, this.constructor);
    }
}

export class BadRequestError extends HttpError {
    constructor(message = 'Bad request', details) {
        super(400, message, details);
    }
}

export class NotFoundError extends HttpError {
    constructor(message = 'Not found', details) {
        super(404, message, details);
    }
}

export class ConflictError extends HttpError {
    constructor(message = 'Conflict', details) {
        super(409, message, details);
    }
}

export class UnauthorizedError extends HttpError {
    constructor(message = 'Authentication required', details) {
        super(401, message, details);
    }
}

export class ForbiddenError extends HttpError {
    constructor(message = 'Forbidden', details) {
        super(403, message, details);
    }
}

// Invitation and activation links are deliberately perishable. 410 says the
// link was real and is now permanently spent, which 404 would not.
export class GoneError extends HttpError {
    constructor(message = 'Gone', details) {
        super(410, message, details);
    }
}

export class TooManyRequestsError extends HttpError {
    constructor(message = 'Too many requests', details) {
        super(429, message, details);
    }
}

// The request was well-formed but the resource is not in a state that allows
// it — a hotel that cannot be published because it has no room types yet.
// Distinct from 400 so the client can render a completeness checklist rather
// than a field error.
export class UnprocessableEntityError extends HttpError {
    constructor(message = 'Unprocessable entity', details) {
        super(422, message, details);
    }
}

// An upstream we depend on failed or answered nonsense. Reserved for external
// availability providers and channel managers: their outage is not our bug,
// and a 502 says so without pretending the request was invalid.
export class BadGatewayError extends HttpError {
    constructor(message = 'Upstream service failed', details) {
        super(502, message, details);
    }
}

// A feature that is switched off, or an upstream we know to be down. 503
// says "not now" rather than "not ever" (404) or "you asked wrong" (4xx).
export class ServiceUnavailableError extends HttpError {
    constructor(message = 'Service unavailable', details) {
        super(503, message, details);
    }
}
