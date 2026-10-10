import { config } from '../config.js';
import { prisma } from '../db/index.js';
import { hashToken } from '../lib/tokens.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';
import { CAPABILITIES, can } from '../lib/permissions.js';
import { accessInclude, withAccess } from '../services/rbac/access.js';

/**
 * Whether a viewer is platform staff.
 *
 * Lives here next to the role lists rather than in a serializer, because more
 * than one serializer now decides what to show on the strength of it and an
 * authorization predicate kept in two places is one that eventually disagrees
 * with itself. Takes a viewer that may be undefined: an anonymous caller is
 * simply not an admin.
 */
export const isAdmin = (viewer) => can(viewer, CAPABILITIES.PLATFORM_ADMIN);

/**
 * Whether a viewer sits on the transfer operations board: reads the legs, the
 * drivers and the cars. Admins, dispatchers, and the management and
 * reservations desks. Moving anything on that board is `dispatch.write`.
 */
export const isTransferOps = (viewer) => can(viewer, CAPABILITIES.DISPATCH_READ);

/** Platform back office: reads the catalogue as the platform does, unpublished and B2B-only included. */
export const isStaff = (viewer) => can(viewer, CAPABILITIES.CATALOGUE_READ);

/** Whether a viewer reads every company's bookings, not just its own. */
export const readsAllBookings = (viewer) => can(viewer, CAPABILITIES.BOOKINGS_READ);

/**
 * Whether a viewer buys at trade.
 *
 * Trade means the non-public side of the catalogue: hotels, tours and services
 * not switched on for B2C, rate plans and options marked PARTNER_ONLY. Two
 * kinds of account qualify — an approved partner, and platform admins reading
 * as the platform. Nobody else: a driver, a dispatcher or a partner still
 * waiting for approval has a role and a session, and none of those is a
 * commercial agreement.
 *
 * This used to be `Boolean(viewer?.role)`, which every signed-in account
 * satisfies because `User.role` is not nullable, so "trade" quietly meant
 * "logged in". The partner check reads the relation when the session loaded
 * it (it always does); a bare `{ partnerId }` viewer built without one — a
 * system caller, a test — is taken at its word.
 */
export const isTrade = (viewer) => {
    // The booking desks read as the platform. A dispatcher reads the catalogue
    // to run the fleet, and that is not a commercial agreement either.
    if (readsAllBookings(viewer)) {
        return true;
    }

    if (!viewer?.partnerId) {
        return false;
    }

    return viewer.partner ? viewer.partner.status === 'APPROVED' : true;
};

/**
 * Whether a viewer owns this hotel.
 *
 * The `supplierId` comparison is the whole check, and it is what stops one
 * approved supplier reaching another's property by changing an id in a URL.
 * A hotel with no supplier belongs to the platform and only admins reach it.
 */
export const ownsHotel = (viewer, hotel) =>
    Boolean(viewer?.partnerId) && Boolean(hotel?.supplierId) && hotel.supplierId === viewer.partnerId;

/**
 * Whether a viewer may see the supplier side of the money.
 *
 * Admins always. A supplier for its own properties, because the net rate is
 * *its* rate — what it contracted with us — and hiding a supplier's own cost
 * from it would be absurd. Nobody else, ever: a guest seeing the net rate sees
 * the margin.
 */
export const canViewNetRates = (viewer, hotel) => canViewMargin(viewer) || ownsHotel(viewer, hotel);

/**
 * Whether a viewer may see the platform's side of the money: the markup, the
 * margin, and which agency bought.
 *
 * Deliberately narrower than `canViewNetRates`. A supplier is entitled to its
 * own net rate, but the markup on top of it is the platform's commercial
 * position, and the buying agency is that agency's business — a hotel that
 * could read both would know every competitor's terms with us.
 */
export function canViewMargin(viewer) {
    return can(viewer, CAPABILITIES.FINANCE_MARGIN_READ);
}

/**
 * Whether a viewer may see which agency bought a booking.
 *
 * Its own check rather than part of the margin, because the reservations desk
 * needs the agency to do its job and must still never see what we earn. A
 * supplier gets neither: the serializers give it `bookedVia` instead.
 */
export const canViewBuyer = (viewer) => can(viewer, CAPABILITIES.PARTNERS_READ);

/**
 * The instant a session stops being renewable, no matter how recently it was
 * used. `touch` slides `expiresAt` forward; this is the wall it slides into.
 */
const absoluteDeadline = (session) =>
    session.createdAt.getTime() + config.auth.sessionAbsoluteTtlMs;

/**
 * Every value the request carries for the session cookie, in the order the
 * browser sent them.
 *
 * `req.cookies` holds one value per name — the first — which is wrong when a
 * browser holds two cookies of that name: the host-only one the API set before
 * AUTH_COOKIE_DOMAIN existed and the `Domain=` one it sets now. Browsers send
 * both to the API host, and the older, dead one comes first. Reading the raw
 * header lets `resolveSession` try each, so a stale leftover cannot mask a
 * live session. The sign-in and sign-out responses also expire the leftover
 * (see services/auth.service.js), so this is the belt to that's braces.
 */
const sessionTokens = (req) => {
    const header = req.headers.cookie;

    if (!header) {
        return [];
    }

    const prefix = `${config.auth.cookieName}=`;

    return header
        .split(';')
        .map((pair) => pair.trim())
        .filter((pair) => pair.startsWith(prefix))
        .map((pair) => {
            const raw = pair.slice(prefix.length);

            // Tokens are URL-safe and never encoded, but a hand-edited cookie
            // could be anything and must not turn into a 500 here.
            try {
                return decodeURIComponent(raw);
            } catch {
                return raw;
            }
        })
        .filter(Boolean);
};

const resolveSession = async (req) => {
    // Sequential on purpose: one token in practice, two during the clean-up
    // of a leftover, and the first live one wins.
    for (const token of sessionTokens(req)) {
        const session = await resolveToken(token);

        if (session) {
            return session;
        }
    }

    return null;
};

const resolveToken = async (token) => {
    const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: { include: { partner: true, ...accessInclude } } }
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return null;
    }

    // A sliding window with no ceiling renews indefinitely. Checked here rather
    // than left to `expiresAt` alone, because the whole point is that the row's
    // own expiry has been moved forward past this line.
    if (absoluteDeadline(session) <= Date.now()) {
        return null;
    }

    // A deactivated account must lose access on its next request, not when its
    // cookie happens to expire. This is the whole reason sessions live in the
    // database rather than in a signed token.
    if (!session.user.isActive) {
        return null;
    }

    // What the account may do is settled here, once, from its roles and
    // overrides as they are now: a role edited or a capability taken away
    // applies on the next request, with no session to revoke.
    return { ...session, user: withAccess(session.user) };
};

/**
 * Slides the expiry forward once a session is past its halfway point, so an
 * active user is not signed out mid-task, without writing to the row on every
 * single request.
 *
 * Never past the absolute deadline: the last renewal before a session's ninety
 * days are up shortens it to whatever is left rather than granting another
 * thirty, so the deadline is what actually ends it.
 */
const touch = async (session) => {
    const remaining = session.expiresAt.getTime() - Date.now();

    if (remaining > config.auth.sessionTtlMs / 2) {
        return;
    }

    const expiresAt = Math.min(Date.now() + config.auth.sessionTtlMs, absoluteDeadline(session));

    // Already at the ceiling — nothing to extend, and no write worth making.
    if (expiresAt <= session.expiresAt.getTime()) {
        return;
    }

    await prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(expiresAt) }
    });
};

/**
 * Keeps an authenticated response out of every cache between here and the
 * browser.
 *
 * Express sets no cache headers on `res.json`, which leaves a shared proxy free
 * to apply its own heuristics to a 200 that happens to describe who is signed
 * in. Cheap insurance, applied wherever a session was resolved rather than
 * globally, so the public catalogue stays cacheable.
 */
const noStore = (res) => {
    res.set('Cache-Control', 'no-store');
    // `res.vary` appends; `res.set('Vary', …)` would overwrite whatever CORS
    // had already put there.
    res.vary('Cookie');
};

/**
 * The same thing as a middleware, for routes that answer with an identity
 * without going through `authenticate` — sign-in being the obvious one, which
 * returns both the session cookie and the user it belongs to.
 */
export const noStoreResponses = (req, res, next) => {
    noStore(res);
    next();
};

export const authenticate = async (req, res, next) => {
    const session = await resolveSession(req);

    if (!session) {
        throw new UnauthorizedError('Authentication required');
    }

    req.user = session.user;
    req.session = session;
    noStore(res);
    await touch(session);

    next();
};

/** Resolves a session when one is present, but does not require it. */
export const optionalAuthenticate = async (req, res, next) => {
    const session = await resolveSession(req);

    if (session) {
        req.user = session.user;
        req.session = session;
        noStore(res);
    }

    next();
};

/**
 * Gates a route on a capability rather than a role name.
 *
 * Several capabilities mean "any of them". 401 without a session, 403 with
 * one that lacks them — and the 403 names what was required, so the client
 * can say "you need finance access" rather than a bare "forbidden". The
 * older role-list guards below are kept as aliases built on this, so a router
 * that has not been converted yet behaves exactly as before.
 */
export const requireCapability =
    (...anyOf) =>
    (req, res, next) => {
        if (!req.user) {
            throw new UnauthorizedError('Authentication required');
        }

        if (!can(req.user, ...anyOf)) {
            throw new ForbiddenError('Insufficient permissions', {
                reason: 'INSUFFICIENT_CAPABILITY',
                required: anyOf
            });
        }

        next();
    };

export const requireAdmin = requireCapability(CAPABILITIES.PLATFORM_ADMIN);

export const requireTransferOps = requireCapability(CAPABILITIES.DISPATCH_READ);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Some fields on an otherwise ordinary update are a different matter from the
 * rest: the supplier and currency on a hotel, the discount on a package, the
 * commission on a partner. A request that carries any of them needs the
 * capability named here as well as the router's — and is refused, never
 * quietly stripped: a save that answers 200 with different data from what
 * was sent is the kind of surprise that gets "fixed" by sending it again.
 */
export const requireFieldsCapability =
    (fields, ...anyOf) =>
    (req, res, next) => {
        const present = fields.filter((field) => req.body?.[field] !== undefined);

        if (present.length > 0 && !can(req.user, ...anyOf)) {
            throw new ForbiddenError('Your role cannot change these fields', {
                reason: 'INSUFFICIENT_CAPABILITY',
                fields: present,
                required: anyOf
            });
        }

        next();
    };

/**
 * The usual shape of a back-office router: reading needs one capability,
 * changing anything needs another. Decided by HTTP method, which holds because
 * every POST, PUT, PATCH and DELETE under /admin is a change — the matrix test
 * pins that down. A route that needs more than its router says adds its own
 * `requireCapability` after this.
 */
export const requireCapabilityByMethod = ({ read, write }) => {
    const reading = requireCapability(...read);
    const writing = requireCapability(...write);

    return (req, res, next) => (READ_METHODS.has(req.method) ? reading : writing)(req, res, next);
};

/**
 * A partner user — or an admin acting for the platform, which the partner
 * routers have always allowed.
 *
 * Exists because the partner routers used to rely on `authenticate` alone and
 * scope by `viewer.partnerId`. That was sound while every non-admin account
 * belonged to a partner; a driver or a dispatcher does not, and although
 * `partnerId ?? '__none__'` fails closed for them, a router that names its
 * audience is one that stays closed when the next role arrives.
 */
export const requirePartner = (req, res, next) => {
    if (!req.user) {
        throw new UnauthorizedError('Authentication required');
    }

    // A company's person, or an admin acting for the platform. A driver, a
    // dispatcher or a desk is neither, whatever else it may do.
    if (!req.user.partnerId && !isAdmin(req.user)) {
        throw new ForbiddenError('Insufficient permissions');
    }

    next();
};

/**
 * Gates the driver panel.
 *
 * Loads the profile here rather than joining it into every session lookup:
 * only driver requests need it, and the two flags it checks are the two that
 * end a driver's access — an unlinked account cannot be dispatched to, and a
 * deactivated profile is refused even if the user row is still active. Puts
 * the profile on `req.driver` so the routes scope on `req.driver.id`, never
 * on anything the client sent.
 */
export const requireDriver = async (req, res, next) => {
    if (!req.user) {
        throw new UnauthorizedError('Authentication required');
    }

    if (!can(req.user, CAPABILITIES.DRIVER_PANEL)) {
        throw new ForbiddenError('Driver account required');
    }

    const driver = await prisma.transferDriver.findUnique({
        where: { userId: req.user.id },
        select: {
            id: true,
            providerId: true,
            firstName: true,
            lastName: true,
            isActive: true,
            verificationStatus: true,
            provider: { select: { status: true, partner: { select: { status: true } } } }
        }
    });

    if (!driver) {
        throw new ForbiddenError('No driver profile is linked to this account', { reason: 'DRIVER_UNLINKED' });
    }

    if (!driver.isActive) {
        throw new ForbiddenError('Driver profile is not active', { reason: 'DRIVER_INACTIVE' });
    }

    // A supplier that has been suspended or rejected takes its drivers with
    // it: their sessions were ended at the time, and this is what keeps them
    // from simply signing in again.
    const partnerStatus = driver.provider?.partner?.status;

    if (driver.provider?.status === 'ARCHIVED' || partnerStatus === 'SUSPENDED' || partnerStatus === 'REJECTED') {
        throw new ForbiddenError('Your transfer company is not active on the platform', {
            reason: 'DRIVER_PROVIDER_INACTIVE'
        });
    }

    req.driver = driver;
    next();
};

/**
 * Gates the B2B platform itself.
 *
 * A PENDING_APPROVAL partner is deliberately allowed to sign in and read
 * `/api/partner/me` — that is what renders the "application under review"
 * page — but nothing behind this middleware. The status travels in `details`
 * so the client can route to the right explanation instead of showing a bare
 * "forbidden", while the decision itself stays on the server.
 */
export const requireApprovedPartner = (req, res, next) => {
    if (!req.user) {
        throw new UnauthorizedError('Authentication required');
    }

    if (isAdmin(req.user)) {
        return next();
    }

    const status = req.user.partner?.status;

    if (status !== 'APPROVED') {
        throw new ForbiddenError('Partner account is not active', { partnerStatus: status ?? null });
    }

    next();
};

const PARTNER_BOOKING_CHANGES = [CAPABILITIES.PARTNER_BOOKINGS_WRITE, CAPABILITIES.PARTNER_BOOKINGS_CANCEL];
const STAFF_BOOKING_CHANGES = [CAPABILITIES.BOOKINGS_WRITE, CAPABILITIES.BOOKINGS_CANCEL];

/**
 * Gates the public booking routers for signed-in sessions.
 *
 * Those routers serve guests as well, so they cannot require a session; but a
 * request that *does* carry a partner session books in that partner's name and
 * at its negotiated terms. Signing in is allowed in every partner status (the
 * portal explains each one), so without this a suspended, rejected or
 * still-pending partner could keep creating, amending and cancelling bookings
 * here long after `requireApprovedPartner` had shut the portal. Guests pass
 * straight through.
 *
 * It is also where a role is asked whether it books at all: any change here —
 * booking, holding, amending, cancelling — needs a booking capability. A
 * PARTNER_FINANCE user reads the company's bookings and changes none of them;
 * and on the platform side the same question is put to staff, because these
 * routers see the whole catalogue at trade and a management or finance desk
 * that reads every booking must not be able to make one. Which exact
 * capability a change needs (`bookings.write` to amend, `bookings.cancel` to
 * cancel) is settled in the service against the booking itself.
 */
export const rejectUnapprovedPartner = (req, res, next) => {
    if (!req.user) {
        return next();
    }

    if (!req.user.partnerId) {
        if (!READ_METHODS.has(req.method) && !can(req.user, ...STAFF_BOOKING_CHANGES)) {
            throw new ForbiddenError('Your role cannot make or change bookings', {
                reason: 'INSUFFICIENT_CAPABILITY',
                required: STAFF_BOOKING_CHANGES
            });
        }

        return next();
    }

    const status = req.user.partner?.status;

    if (status !== 'APPROVED') {
        throw new ForbiddenError('Partner account is not active', { partnerStatus: status ?? null });
    }

    if (!READ_METHODS.has(req.method) && !can(req.user, ...PARTNER_BOOKING_CHANGES)) {
        throw new ForbiddenError('Your role cannot make or change bookings', {
            reason: 'INSUFFICIENT_CAPABILITY',
            required: PARTNER_BOOKING_CHANGES
        });
    }

    next();
};
