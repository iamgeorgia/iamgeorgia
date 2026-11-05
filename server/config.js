import dotenv from 'dotenv';

// quiet: dotenv's startup banner is noise in logs and test output.
// Variables already in the environment (docker, CI, --env-file) always win.
dotenv.config({ quiet: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Development and test are the only environments allowed to boot on the public
// defaults below. Anything else — staging, preview, a NODE_ENV someone
// mistyped — is reachable from outside and its tokens are just as forgeable,
// so it is held to the production list. `isProduction` keeps its narrower
// meaning everywhere else (cookie flags, log format, cache lifetimes).
const isDeployed = nodeEnv !== 'development' && nodeEnv !== 'test';

// Secrets and mail credentials have working defaults in development, but a
// production deploy without them would hand out unpeppered tokens and silently
// drop every invitation email, so they are required there.
const required = ['DATABASE_URL'];
const requiredInProduction = [
    'AUTH_TOKEN_PEPPER',
    'APP_URL',
    // The one origin allowlist in the system. Unset, it falls back to
    // localhost:3000 — which fails closed rather than open, but a deploy whose
    // CORS layer is pointed at a developer's laptop is a broken deploy, and it
    // should say so at boot rather than at the first sign-in.
    'CLIENT_ORIGIN',
    // No safe default exists. `false` behind a load balancer collapses every
    // client into one IP and the global limiter throttles the whole site;
    // `true` in front of one lets a client spoof its own address through
    // X-Forwarded-For. Only the operator knows which, so they must say.
    'TRUST_PROXY',
    // Same reasoning as AUTH_TOKEN_PEPPER: the development default is public,
    // and an offer token signed with it could be re-priced by anyone.
    'HOTEL_OFFER_TOKEN_SECRET',
    // Same again for transfer quotes, which carry their own secret so the two
    // can be rotated independently.
    'TRANSFER_QUOTE_TOKEN_SECRET',
    // And again for tour offers, with their own secret for the same reason.
    'TOUR_OFFER_TOKEN_SECRET',
    'PACKAGE_OFFER_TOKEN_SECRET',
    // And for the rating links emailed after a transfer: a guessable secret
    // would let anyone rate any driver.
    'TRANSFER_RATING_TOKEN_SECRET',
    // Without these every image upload fails at the point an admin tries to
    // publish a hotel, which is a bad place to discover missing configuration.
    'MEDIA_S3_ENDPOINT',
    'MEDIA_S3_ACCESS_KEY_ID',
    'MEDIA_S3_SECRET_ACCESS_KEY',
    'MEDIA_PUBLIC_BASE_URL'
];
// The transport decides which mail credentials a deploy needs. SMTP's are
// required on every deployed transport but `gmail`, which is exactly the list
// they were always on; the Gmail API's are checked with the rest of its
// configuration in assertGmailConfig.
const mailTransport = process.env.MAIL_TRANSPORT || (isProduction ? 'smtp' : 'log');
const requiredForMail = isDeployed && mailTransport !== 'gmail' ? ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] : [];
const missing = [...required, ...(isDeployed ? requiredInProduction : []), ...requiredForMail].filter(
    (key) => !process.env[key]
);

if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

/**
 * A numeric variable, or `fallback` when it is not set.
 *
 * The previous shape was `Number(process.env.X) || fallback`, which hides two
 * things: a mistyped value (`HOTEL_HOLD_TTL_MS=15m`) silently becomes the
 * default, and a deliberate `0` is indistinguishable from "not set". A value
 * that is present but not a number is a broken deploy, and the rest of this
 * file already refuses to boot on those rather than guessing.
 */
const numberEnv = (key, fallback) => {
    const raw = process.env[key];

    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }

    const value = Number(raw);

    if (!Number.isFinite(value)) {
        throw new Error(`${key} must be a number, got "${raw}"`);
    }

    return value;
};

/**
 * A comma-separated list of whole, non-negative days — "7,3,1,0" — read into
 * a sorted, de-duplicated array, largest first. Refuses anything else at boot
 * for the same reason `numberEnv` does: a reminder schedule that silently
 * became the default is one nobody would notice until a supplier chased.
 */
const parseOffsetDays = (key, fallback) => {
    const raw = process.env[key];
    const text = raw === undefined || raw.trim() === '' ? fallback : raw;
    const days = text.split(',').map((part) => part.trim()).filter(Boolean).map(Number);

    if (days.length === 0 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 365)) {
        throw new Error(`${key} must be whole days between 0 and 365, comma-separated, got "${raw}"`);
    }

    return [...new Set(days)].sort((a, b) => b - a);
};

// The names lib/mailer/index.js dispatches on. Checked here rather than at
// first send, because a mistyped MAIL_TRANSPORT on a deploy used to fall back
// to `log` — every email quietly printed instead of sent, discovered only when
// a partner asked where their invitation was.
const MAIL_TRANSPORTS = ['smtp', 'gmail', 'log', 'capture'];

// The one scope the transport sends with, and `email` beside it so the
// callback can read which account was linked from the ID token and refuse any
// other. Nothing that reads, lists or deletes mail.
export const GMAIL_SCOPES = Object.freeze(['https://www.googleapis.com/auth/gmail.send', 'email']);

// The drivers services/media/storage.service.js knows about.
const MEDIA_DRIVERS = ['local', 's3'];

// Express accepts a boolean, a hop count or a named subnet for `trust proxy`,
// and each means something different. Preserve the distinction rather than
// coercing everything to a boolean.
const parseTrustProxy = (value) => {
    if (value === undefined || value === '') {
        return false;
    }

    if (value === 'true' || value === 'false') {
        return value === 'true';
    }

    return /^\d+$/.test(value) ? Number(value) : value;
};

const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

export const config = {
    nodeEnv,
    isProduction,
    // True anywhere reachable from outside — staging and preview included.
    // Cookie flags key off this rather than `isProduction`, because a session
    // cookie without `Secure` on a staging host is just as interceptable as
    // one in production.
    isDeployed,
    isTest: nodeEnv === 'test',
    port: numberEnv('PORT', 5000),
    clientOrigin,
    databaseUrl: process.env.DATABASE_URL,
    logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

    // Where the browser reaches the front end. Every emailed link is built from
    // this, so it is separate from clientOrigin only to allow a proxy in front.
    appUrl: process.env.APP_URL || clientOrigin,

    // Without this the rate limiters behind a reverse proxy see one IP for the
    // whole internet, which makes a per-IP login limit worse than useless.
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

    // Requests per minute per IP, across everything except /health. Raised
    // under test for the same reason the auth limiters are: a suite drives
    // hundreds of requests through one in-process counter, and a search suite
    // that exercises fifty fixtures is not an attack.
    globalRateLimit: numberEnv('RATE_LIMIT_GLOBAL', (nodeEnv === 'test' ? 100_000 : 100)),

    // Dated search per minute per visitor — the most expensive read, with its
    // own budget so one scraper cannot spend the global allowance on it.
    searchRateLimit: numberEnv('RATE_LIMIT_SEARCH', (nodeEnv === 'test' ? 10_000 : 30)),

    // The Next.js server renders search and the catalogue on a visitor's
    // behalf, so every one of its calls arrives from the same address. When
    // this is set, a request that presents the value in `x-client-token` may
    // name that visitor in `x-visitor-address`, and the per-IP limiters count
    // the visitor rather than the server relaying for them. Unset, nothing is
    // trusted and the relay shares one bucket — fine on a laptop, not behind a
    // single egress address in production.
    clientForwardToken: process.env.API_CLIENT_TOKEN || null,

    // Where the rate limiters keep their counters. Unset, they count in this
    // process's memory, which is correct for one instance and wrong for two:
    // a pair behind a load balancer each allow the full limit, and a restart
    // forgets every counter. Set this once there is more than one instance.
    redisUrl: process.env.REDIS_URL || null,

    auth: {
        cookieName: process.env.AUTH_COOKIE_NAME || 'iag_session',

        // Unset, the cookie is host-only: it belongs to the API's own host and
        // is never sent to the site. That is fine locally, where cookies ignore
        // ports, but a deployed site on its own host renders the panels on the
        // server with the cookies *it* received — so there the cookie must name
        // the domain both hosts share, e.g. `preview.iamgeorgia.com.ge` for
        // preview.iamgeorgia.com.ge + api.preview.iamgeorgia.com.ge. The
        // narrowest one: a parent domain would leak it to every other
        // environment under it.
        cookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,

        // Long-lived because the cookie is revocable server-side: a suspension
        // kills the session row, so a generous TTL costs nothing in safety.
        sessionTtlMs: numberEnv('SESSION_TTL_MS', 30 * 24 * 60 * 60 * 1000),

        // The ceiling `sessionTtlMs` slides up to but never past, measured from
        // when the session was created. Without it the sliding window renews
        // forever and a session that is used once a fortnight never expires —
        // which for a panel that approves partners and reads bank details is
        // not a session, it is a permanent credential.
        sessionAbsoluteTtlMs: numberEnv('SESSION_ABSOLUTE_TTL_MS', 90 * 24 * 60 * 60 * 1000),
        invitationTtlMs: numberEnv('INVITATION_TTL_MS', 7 * 24 * 60 * 60 * 1000),
        activationTtlMs: numberEnv('ACTIVATION_TTL_MS', 48 * 60 * 60 * 1000),
        passwordResetTtlMs: numberEnv('PASSWORD_RESET_TTL_MS', 60 * 60 * 1000),

        // Mixed into the sha256 of every token, so a leaked database dump alone
        // cannot be used to reconstruct a working invitation link.
        tokenPepper: process.env.AUTH_TOKEN_PEPPER || 'development-pepper',

        // Failed sign-ins per 15 minutes, per IP and account. Raised out of the
        // way under test, where hundreds of requests share one in-process
        // counter, and lowered again by the suite that exercises the 429 path.
        loginLimit: numberEnv('AUTH_LOGIN_LIMIT', (nodeEnv === 'test' ? 10_000 : 10)),
        // The two halves the pair-keyed limit leaves open: one address trying
        // many accounts, and many addresses trying one. Both wider than the
        // pair's so neither trips before it does under honest use.
        loginIpLimit: numberEnv('AUTH_LOGIN_IP_LIMIT', (nodeEnv === 'test' ? 10_000 : 30)),
        loginAccountLimit: numberEnv('AUTH_LOGIN_ACCOUNT_LIMIT', (nodeEnv === 'test' ? 10_000 : 50)),
        registrationLimit: numberEnv('AUTH_REGISTRATION_LIMIT', (nodeEnv === 'test' ? 10_000 : 5)),
        tokenLookupLimit: numberEnv('AUTH_TOKEN_LOOKUP_LIMIT', (nodeEnv === 'test' ? 10_000 : 30)),

        // Wrong current-password attempts per 15 minutes, per signed-in user.
        // Separate from `loginLimit` because the key is different: there is no
        // email in the body of a password change, so sharing the login limiter
        // would have counted every user behind one address together.
        passwordChangeLimit: numberEnv('AUTH_PASSWORD_CHANGE_LIMIT', (nodeEnv === 'test' ? 10_000 : 5)),

        // Invitations one signed-in user may send per fifteen minutes. A seat
        // costs nothing to create, which is exactly why a stolen staff session
        // must not be able to mint thousands of them.
        inviteLimit: numberEnv('AUTH_INVITE_LIMIT', (nodeEnv === 'test' ? 10_000 : 30)),

        // Reset links per 15 minutes for one address, counted regardless of
        // where the request came from. The per-IP limiter alone lets a rotating
        // client mail a victim a link every thirty seconds.
        forgotPasswordLimit: numberEnv('AUTH_FORGOT_PASSWORD_LIMIT', (nodeEnv === 'test' ? 10_000 : 5))
    },

    booking: {
        // Platform approval before a booking is confirmed (owner decision
        // OD1, 2026-10-20): every booking made without an online payment —
        // which is every booking — waits for an operator's yes, holding its
        // inventory meanwhile. Off by default so the schema and the code can
        // ship before the approvals screen does; on, every partner whose
        // `bookingApproval` is REQUIRED (the default) and every guest waits.
        approvalEnabled: process.env.BOOKING_APPROVAL_ENABLED === 'true',
        // How long operations have to answer before they are told it is
        // overdue. Nothing auto-rejects at the deadline: a late yes is still
        // a yes. A booking still waiting when its service date has passed is
        // rejected by the sweeper, because nobody can approve a stay that
        // has already begun.
        approvalSlaHours: numberEnv('BOOKING_APPROVAL_SLA_HOURS', 24),
        approvalSweepIntervalMs: numberEnv('BOOKING_APPROVAL_SWEEP_INTERVAL_MS', 10 * 60 * 1000),
        // The desk's shared mailbox: every booking waiting for approval, and
        // every one overdue, is also mailed here. Unset, in-app only.
        opsEmail: process.env.BOOKING_OPS_EMAIL || null,
        // The cart (OD2): hotels, transfers, tours and whole packages booked
        // as one CUSTOM order through `/orders/custom`. Off until the cart
        // pages ship; off, the public cart routes answer 404 `CART_DISABLED`
        // while the desk's own multi-item route stays open.
        cartEnabled: process.env.CART_ENABLED === 'true',

        // Deadline reminders (payment, free cancellation, confirmation) on the
        // schedule in `reminder_policies`. Off until the calendar ships, so
        // partners are not written to before anyone can see what about.
        deadlineRemindersEnabled: process.env.DEADLINE_REMINDERS_ENABLED === 'true',
        deadlineSweepIntervalMs: numberEnv('DEADLINE_SWEEP_INTERVAL_MS', 10 * 60 * 1000)
    },

    finance: {
        // Payables and receivables are dated in the supplier's (or Georgia's)
        // own time: an instalment "due on the 12th" is due at this local time.
        defaultTimezone: process.env.FINANCE_DEFAULT_TIMEZONE || 'Asia/Tbilisi',
        cutoffTime: process.env.FINANCE_CUTOFF_TIME || '10:00',
        // A buyer's deadline runs to the end of its last day.
        receivableCutoffTime: '23:59',
        // A guest without an account pays at booking; a partner has its own
        // days (Partner.paymentDueDays, D5).
        guestDueDays: numberEnv('FINANCE_GUEST_DUE_DAYS', 0),

        // Supplier payment reminders (owner decision D7). Each offset is a
        // calendar day before an instalment's due day, in the supplier's own
        // timezone: "7" fires on the morning seven days before, "0" on the
        // due day itself. Each fires once per instalment; the overdue alert
        // fires when the due time passes and again every `overdueRepeatDays`
        // while the money is still owed (0 = once only).
        reminderOffsetDays: parseOffsetDays('FINANCE_REMINDER_OFFSET_DAYS', '7,3,1,0'),
        reminderSweepIntervalMs: numberEnv('FINANCE_REMINDER_SWEEP_INTERVAL_MS', 10 * 60 * 1000),
        overdueRepeatDays: numberEnv('FINANCE_OVERDUE_REPEAT_DAYS', 1),

        // The shared finance mailbox every reminder is also emailed to, beside
        // the in-app notices. Unset, reminders are in-app only.
        opsEmail: process.env.FINANCE_OPS_EMAIL || null,

        // Invoicing through InvoiceOcean (Phase 4). Off by default: with
        // `enabled` false nothing is written to the outbox and nothing is
        // called, so the code can be deployed before the account is ready.
        // When it is on, every receivable gets a proforma at confirmation and
        // a VAT invoice on full payment, issued by the outbox drain.
        invoiceocean: {
            enabled: process.env.INVOICEOCEAN_ENABLED === 'true',
            // `acme` (for acme.invoiceocean.com), a full host, or a full URL —
            // the last so a stub server can stand in for the real thing.
            domain: process.env.INVOICEOCEAN_DOMAIN || null,
            apiToken: process.env.INVOICEOCEAN_API_TOKEN || null,
            // The secret the webhook was registered with; InvoiceOcean sends
            // it back with every delivery and nothing else is accepted.
            webhookSecret: process.env.INVOICEOCEAN_WEBHOOK_SECRET || null,
            // Owner decision D3: the account's default numbering series, one
            // department. Set when the account has more than one.
            departmentId: process.env.INVOICEOCEAN_DEPARTMENT_ID || null,
            // D2: the document language when the partner has none of its own.
            // InvoiceOcean's codes; it has no Georgian or Hebrew.
            lang: process.env.INVOICEOCEAN_LANG || 'en',
            // D4: VAT on every line, in basis points (1800 = 18%), unless a
            // finance user says otherwise on a hand-issued invoice.
            defaultTaxBps: numberEnv('INVOICEOCEAN_DEFAULT_TAX_BPS', 1800),
            // Ask InvoiceOcean to email each document to the buyer as soon as
            // it is issued. Off: the platform shows the PDF and Finance sends
            // by hand from the invoice page.
            autoSend: process.env.INVOICEOCEAN_AUTO_SEND === 'true',
            // Status changes made in InvoiceOcean arrive by webhook; the poll
            // is the fallback for deliveries that never came, and the apply
            // interval is how often stored events are worked through.
            pollIntervalMs: numberEnv('INVOICEOCEAN_POLL_INTERVAL_MS', 15 * 60 * 1000),
            syncApplyIntervalMs: numberEnv('INVOICEOCEAN_SYNC_APPLY_INTERVAL_MS', 60 * 1000),
            requestTimeoutMs: numberEnv('INVOICEOCEAN_REQUEST_TIMEOUT_MS', 15 * 1000)
        }
    },

    partners: {
        // Members a partner may have, invited ones included. A ceiling rather
        // than a plan limit: the number is there to stop a runaway script, not
        // to sell seats.
        teamMax: numberEnv('PARTNER_TEAM_MAX', 25),
        // The platform terms a company must accept: registration refuses any
        // other version, and the portal shuts for a company that accepted an
        // older one until its owner accepts this one.
        termsVersion: process.env.PARTNER_TERMS_VERSION || '2026-10',
        termsUrl: process.env.PARTNER_TERMS_URL || null
    },

    mail: {
        // smtp talks to a real server; log prints the message (links included)
        // through pino; capture collects into an in-memory outbox for tests.
        transport: mailTransport,
        from: process.env.MAIL_FROM || 'I am Georgia <no-reply@iamgeorgia.travel>',
        replyTo: process.env.MAIL_REPLY_TO,
        smtp: {
            host: process.env.SMTP_HOST,
            port: numberEnv('SMTP_PORT', 587),
            secure: process.env.SMTP_SECURE === 'true',
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,

            // Without these nodemailer waits on a silent SMTP server for as
            // long as the socket stays open, and the request that triggered
            // the email waits with it. Connect (and greet) is short because
            // an unreachable relay is known quickly; the socket budget is
            // longer because a large HTML body on a slow relay is not a fault.
            connectionTimeoutMs: numberEnv('SMTP_CONNECTION_TIMEOUT_MS', 10 * 1000),
            socketTimeoutMs: numberEnv('SMTP_SOCKET_TIMEOUT_MS', 30 * 1000)
        },

        // The Gmail API, as one company Google account authorised once by an
        // administrator. Usable as soon as the four identifiers are set,
        // whatever MAIL_TRANSPORT says, so the account can be connected and a
        // test sent from the panel before the transport is switched over.
        gmail: {
            clientId: process.env.GOOGLE_CLIENT_ID || null,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
            // Must match the OAuth client's registered redirect exactly: the
            // API's own /api/admin/mail/google/callback.
            redirectUri: process.env.GOOGLE_REDIRECT_URI || null,
            // The only account allowed to connect, and the address mail goes out as.
            senderEmail: (process.env.GMAIL_SENDER_EMAIL || '').trim().toLowerCase() || null,
            // Gmail rewrites a From it does not recognise to the account's own
            // address. A MAIL_FROM on another address is accepted only when the
            // operator says it is a verified "Send mail as" alias.
            fromAliasVerified: process.env.GMAIL_FROM_ALIAS_VERIFIED === 'true',
            // Optional: a refresh token from the environment, for a machine with
            // no admin flow (a developer laptop). A connected account wins.
            envRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || null,
            // Seals the stored refresh token. Development has a public default,
            // like every other secret here; a deploy must set its own.
            credentialsKey: process.env.MAIL_CREDENTIALS_KEY || null,
            requestTimeoutMs: numberEnv('GMAIL_REQUEST_TIMEOUT_MS', 15 * 1000),
            // Attempts per message within one send, for transient failures,
            // before the error goes back to the caller and the outbox's schedule.
            maxAttempts: numberEnv('GMAIL_MAX_ATTEMPTS', 3),
            retryBaseMs: numberEnv('GMAIL_RETRY_BASE_MS', 500),
            // A soft line, not a cap: past this many sends in 24 hours the
            // administrators are told, before Gmail's own daily limit refuses.
            dailyWarnAt: numberEnv('GMAIL_DAILY_SEND_WARN', 400),
            // Connect, disconnect and test sends per administrator per 15 minutes.
            adminActionLimit: numberEnv('GMAIL_ADMIN_ACTION_LIMIT', nodeEnv === 'test' ? 10_000 : 10),
            // A local stand-in for Google's token, certificate and Gmail hosts,
            // for the test suite. Refused at boot anywhere deployed: pointed
            // elsewhere it would hand the client secret and every token to it.
            stubUrl: process.env.GOOGLE_API_STUB_URL || null,
            // Set by assertGmailConfig: all four identifiers are present.
            configured: false
        }
    },

    hotel: {
        // How long checkout may hold a room before the sweeper takes it back.
        // Long enough to enter guest details and pay, short enough that an
        // abandoned checkout does not block the last room for an afternoon.
        holdTtlMs: numberEnv('HOTEL_HOLD_TTL_MS', 15 * 60 * 1000),

        // The sweeper is what turns an expired hold back into availability.
        // held_units is a counter, so until a sweep runs an abandoned checkout
        // still blocks inventory — this interval is the worst-case delay.
        holdSweepIntervalMs: numberEnv('HOTEL_HOLD_SWEEP_INTERVAL_MS', 30 * 1000),

        // How often confirmed stays whose check-out has passed roll to
        // COMPLETED. Hourly is plenty: nothing a guest sees depends on it, and
        // an order with a hotel in it waits on this to complete itself.
        completionSweepIntervalMs: numberEnv('HOTEL_COMPLETION_SWEEP_INTERVAL_MS', 60 * 60 * 1000),

        // How often to look for kosher certificates that are about to lapse.
        //
        // Daily, and deliberately unhurried, because unlike the hold sweep this
        // one changes no state: expiry is derived on every read, so the platform
        // is already correct the moment a certificate runs out. The job exists
        // only so a human hears about it before an agency does — which is why
        // its failure is a missing notice rather than wrong data.
        certificationSweepIntervalMs: numberEnv(
            'HOTEL_CERTIFICATION_SWEEP_INTERVAL_MS',
            24 * 60 * 60 * 1000
        ),

        // Signs the offer tokens search hands out, so a client can carry an
        // offer into checkout without being able to edit its price. The token
        // prevents tampering; the server re-quotes regardless.
        offerTokenSecret: process.env.HOTEL_OFFER_TOKEN_SECRET || 'development-offer-secret',
        offerTokenTtlMs: numberEnv('HOTEL_OFFER_TOKEN_TTL_MS', 30 * 60 * 1000),

        // Applied to net rates when no partner-specific rule exists. Basis
        // points, like Partner.commissionRateBps.
        defaultMarkupBps: numberEnv('HOTEL_DEFAULT_MARKUP_BPS', 1500),

        // Guard rails on the bulk inventory and rate editors: one call may not
        // rewrite more than two years, and a stay may not exceed 30 nights.
        maxBulkDays: numberEnv('HOTEL_MAX_BULK_DAYS', 730),
        maxStayNights: numberEnv('HOTEL_MAX_STAY_NIGHTS', 30),

        // How far ahead search will look when no explicit horizon is given.
        bookingHorizonDays: numberEnv('HOTEL_BOOKING_HORIZON_DAYS', 540)
    },

    transfer: {
        // Signs the quote tokens search hands out, so a client can carry a fare
        // into checkout without being able to edit it. Its own secret rather
        // than the hotel one: rotating the key for a compromised transfer quote
        // should not invalidate every hotel offer in flight.
        quoteTokenSecret: process.env.TRANSFER_QUOTE_TOKEN_SECRET || 'development-transfer-secret',
        quoteTokenTtlMs: numberEnv('TRANSFER_QUOTE_TOKEN_TTL_MS', 30 * 60 * 1000),

        // Applied to net fares when no partner-specific pricing rule matches.
        defaultMarkupBps: numberEnv('TRANSFER_DEFAULT_MARKUP_BPS', 1500),

        // Roads are not straight lines. 1.3 is a fair factor for Georgia, where
        // almost every long route crosses a ridge or follows a river valley
        // rather than going over the top.
        roadFactor: numberEnv('TRANSFER_ROAD_FACTOR', 1.3),

        // Blended average across motorway, trunk and mountain sections, and the
        // loading, terminal walk and getting clear of the kerb that no distance
        // calculation accounts for.
        averageSpeedKmh: numberEnv('TRANSFER_AVERAGE_SPEED_KMH', 62),
        fixedOverheadMinutes: numberEnv('TRANSFER_FIXED_OVERHEAD_MINUTES', 12),

        // A pick-up between these hours is a night transfer: the driver works
        // unsocial hours and the fare carries a surcharge in basis points.
        nightFromHour: numberEnv('TRANSFER_NIGHT_FROM_HOUR', 22),
        nightUntilHour: numberEnv('TRANSFER_NIGHT_UNTIL_HOUR', 6),
        nightSurchargeBps: numberEnv('TRANSFER_NIGHT_SURCHARGE_BPS', 2000),

        // How far ahead a transfer may be booked, and how little notice is
        // accepted. A car cannot be dispatched to an airport in ten minutes.
        bookingHorizonDays: numberEnv('TRANSFER_BOOKING_HORIZON_DAYS', 540),
        minimumNoticeMinutes: numberEnv('TRANSFER_MINIMUM_NOTICE_MINUTES', 180),

        // A party larger than this is a coach charter, quoted by a human.
        maxPassengers: numberEnv('TRANSFER_MAX_PASSENGERS', 50),

        // Dispatch: how a driver's and a car's time is claimed by a leg, and
        // what a driver may do when.
        dispatch: {
            // A driver is busy from this long before the pick-up: getting
            // there, parking, and standing in arrivals with a sign.
            preBufferMinutes: numberEnv('TRANSFER_DISPATCH_PRE_BUFFER_MINUTES', 45),
            // ...until this long after the drop-off: unloading and getting clear.
            postBufferMinutes: numberEnv('TRANSFER_DISPATCH_POST_BUFFER_MINUTES', 30),

            // Whether an offered leg waits for the driver to say yes. When
            // false, assigning is accepting.
            requireDriverAcceptance: (process.env.TRANSFER_DISPATCH_REQUIRE_ACCEPTANCE ?? 'true') !== 'false',

            // How early a driver may go "en route", and how late a driver may
            // still back out of an accepted job without phoning dispatch.
            maxEarlyStartMinutes: numberEnv('TRANSFER_DISPATCH_MAX_EARLY_START_MINUTES', 240),
            lateDeclineHours: numberEnv('TRANSFER_DISPATCH_LATE_DECLINE_HOURS', 12),

            // How long a driver waits at the kerb before a no-show can be
            // reported. Airports get longer: baggage reclaim is not the
            // passenger's fault.
            noShowWaitMinutes: numberEnv('TRANSFER_DISPATCH_NO_SHOW_WAIT_MINUTES', 30),
            noShowWaitMinutesAirport: numberEnv('TRANSFER_DISPATCH_NO_SHOW_WAIT_MINUTES_AIRPORT', 60),
            noShowRequiresConfirmation:
                (process.env.TRANSFER_DISPATCH_NO_SHOW_REQUIRES_CONFIRMATION ?? 'true') !== 'false',

            // When the driver's phone number becomes visible to the partner
            // and the passenger, in hours before pick-up.
            contactRevealHours: numberEnv('TRANSFER_DISPATCH_CONTACT_REVEAL_HOURS', 24),

            // How long after a completed leg a rating may still be left.
            ratingWindowDays: numberEnv('TRANSFER_RATING_WINDOW_DAYS', 30),

            // Signs the rating links emailed to passengers. Its own secret, so it
            // can be rotated without invalidating quotes in flight.
            ratingTokenSecret: process.env.TRANSFER_RATING_TOKEN_SECRET || 'development-rating-secret',

            // Where the "still no driver" alert goes, beside the in-app notice.
            opsEmail: process.env.TRANSFER_OPS_EMAIL || null,

            // How often the outbox is drained into emails and in-app notices,
            // and how often the time-driven events are looked for.
            outboxDrainIntervalMs: numberEnv('TRANSFER_OUTBOX_DRAIN_INTERVAL_MS', 5 * 1000),
            reminderSweepIntervalMs: numberEnv('TRANSFER_REMINDER_SWEEP_INTERVAL_MS', 60 * 1000)
        }
    },

    tour: {
        // Signs the offer tokens tour availability hands out. Its own secret
        // rather than the hotel one, so the two can be rotated independently.
        offerTokenSecret: process.env.TOUR_OFFER_TOKEN_SECRET || 'development-tour-secret',
        offerTokenTtlMs: numberEnv('TOUR_OFFER_TOKEN_TTL_MS', 30 * 60 * 1000),

        // How long checkout may hold seats before the sweeper takes them back,
        // and how often that sweeper runs. Same reasoning as the hotel pair.
        holdTtlMs: numberEnv('TOUR_HOLD_TTL_MS', 15 * 60 * 1000),
        holdSweepIntervalMs: numberEnv('TOUR_HOLD_SWEEP_INTERVAL_MS', 30 * 1000),

        // Applied to net prices when no partner-specific pricing rule matches.
        defaultMarkupBps: numberEnv('TOUR_DEFAULT_MARKUP_BPS', 1500),

        // How long an operator has to answer an on-request booking before
        // operations are told it is overdue. Nothing auto-declines: a late
        // answer is still an answer, and the traveller may cancel meanwhile.
        onRequestSlaHours: numberEnv('TOUR_ON_REQUEST_SLA_HOURS', 48),
        requestSweepIntervalMs: numberEnv('TOUR_REQUEST_SWEEP_INTERVAL_MS', 10 * 60 * 1000),

        // Bookings whose last day has passed are rolled to COMPLETED on this
        // interval, so an order made of them can complete too.
        completionSweepIntervalMs: numberEnv('TOUR_COMPLETION_SWEEP_INTERVAL_MS', 60 * 60 * 1000),

        // Guard rails on the bulk inventory editor, and the capacity an
        // "unlimited" on-demand option is written with — a number, because the
        // no-oversell CHECK needs one.
        maxBulkDays: numberEnv('TOUR_MAX_BULK_DAYS', 730),
        unlimitedUnits: numberEnv('TOUR_UNLIMITED_UNITS', 99),
        bookingHorizonDays: numberEnv('TOUR_BOOKING_HORIZON_DAYS', 540)
    },

    service: {
        // Applied to a service's net price when no pricing rule matches.
        defaultMarkupBps: numberEnv('SERVICE_DEFAULT_MARKUP_BPS', 1500),
        // The operator's answer window on an on-request service, as for tours.
        onRequestSlaHours: numberEnv('SERVICE_ON_REQUEST_SLA_HOURS', 48),
        bookingHorizonDays: numberEnv('SERVICE_BOOKING_HORIZON_DAYS', 540)
    },

    package: {
        // Signs the composite package offer tokens. Its own secret so it can
        // be rotated without touching the hotel, transfer or tour signers.
        offerTokenSecret: process.env.PACKAGE_OFFER_TOKEN_SECRET || 'development-package-secret',
        offerTokenTtlMs: numberEnv('PACKAGE_OFFER_TOKEN_TTL_MS', 30 * 60 * 1000),
        // How many hotels a slot with no fixed property considers.
        maxCandidates: numberEnv('PACKAGE_MAX_CANDIDATES', 5),
        // How many slots of one quote resolve at once.
        //
        // Bounded rather than "all of them" because each slot holds a
        // connection while it runs, and the pool is ten: a five-slot package
        // resolving wide would let two concurrent quotes exhaust it and stall
        // every other request behind them. Three turns a five-slot quote into
        // two waves instead of five serial calls, and still leaves room for
        // three quotes in flight beside ordinary traffic.
        slotConcurrency: numberEnv('PACKAGE_SLOT_CONCURRENCY', 3),
        // How often the cached "from" price on package cards is refreshed.
        priceFromSweepIntervalMs: numberEnv('PACKAGE_PRICE_FROM_SWEEP_INTERVAL_MS', 24 * 60 * 60 * 1000)
    },

    order: {
        // The one multi-product transaction on the platform. Everything slow
        // happens before it opens; this is the budget for the claims and
        // inserts alone, with a margin.
        txTimeoutMs: numberEnv('ORDER_TX_TIMEOUT_MS', 15_000),
        txMaxWaitMs: numberEnv('ORDER_TX_MAX_WAIT_MS', 5_000),
        // How often pending orders past their deadline are reported.
        requestSweepIntervalMs: numberEnv('ORDER_REQUEST_SWEEP_INTERVAL_MS', 10 * 60 * 1000),
        completionSweepIntervalMs: numberEnv('ORDER_COMPLETION_SWEEP_INTERVAL_MS', 60 * 60 * 1000)
    },

    media: {
        // `s3` talks to Cloudflare R2 (or AWS); `local` writes to disk and is
        // what the test suite and a fresh checkout use, so neither needs
        // credentials or a network. Chosen by whether an endpoint is
        // configured rather than by a separate flag that could disagree with
        // it — and never `s3` under test, because a suite that can reach a real
        // bucket is a suite that can leave objects in it.
        driver:
            process.env.MEDIA_DRIVER ||
            (nodeEnv !== 'test' && process.env.MEDIA_S3_ENDPOINT ? 's3' : 'local'),

        // Where the local driver writes. Gitignored; irrelevant under `s3`.
        localRoot: process.env.MEDIA_LOCAL_ROOT || '.media',

        // Cloudflare R2 speaks S3, so the AWS SDK drives both and switching
        // provider is a config change. Two buckets, because the public one sits
        // behind a CDN and the private one must never be reachable at all.
        endpoint: process.env.MEDIA_S3_ENDPOINT,
        region: process.env.MEDIA_S3_REGION || 'auto',
        accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY,
        publicBucket: process.env.MEDIA_PUBLIC_BUCKET || 'iag-public',
        privateBucket: process.env.MEDIA_PRIVATE_BUCKET || 'iag-private',

        // The SDK's defaults are no connect timeout and no request timeout,
        // so a bucket that stops answering would hold an upload request open
        // indefinitely. Uploads are synchronous in V1, which makes a bounded
        // wait the difference between a slow admin page and a stuck one.
        requestTimeoutMs: numberEnv('MEDIA_S3_REQUEST_TIMEOUT_MS', 30 * 1000),
        connectionTimeoutMs: numberEnv('MEDIA_S3_CONNECTION_TIMEOUT_MS', 5 * 1000),
        maxAttempts: numberEnv('MEDIA_S3_MAX_ATTEMPTS', 3),

        // Public URLs are composed from this plus the object key at
        // serialization time. The database stores keys, never URLs, so moving
        // CDN is a config change rather than a data migration.
        publicBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL || 'http://localhost:5000/media',

        // Private files are only ever reachable through a short-lived signed
        // URL issued after an authorization check.
        signedUrlTtlSeconds: numberEnv('MEDIA_SIGNED_URL_TTL_SECONDS', 60),

        maxImageBytes: numberEnv('MEDIA_MAX_IMAGE_BYTES', 10 * 1024 * 1024),
        maxDocumentBytes: numberEnv('MEDIA_MAX_DOCUMENT_BYTES', 25 * 1024 * 1024),

        // Which renditions to write. AVIF compresses better than WebP but costs
        // seconds per image in sharp, and uploads are synchronous in V1 — so it
        // is opt-in until image processing moves to a background job.
        imageFormats: (process.env.MEDIA_IMAGE_FORMATS || 'webp')
            .split(',')
            .map((format) => format.trim())
            .filter(Boolean)
    },

    // Connection pool. `max` is per process: Postgres defaults to 100
    // connections total, so this has to leave room for every process that
    // talks to the same database.
    databasePoolMax: numberEnv('DATABASE_POOL_MAX', 10),
    databaseIdleTimeoutMs: numberEnv('DATABASE_IDLE_TIMEOUT_MS', 30000),
    databaseConnectionTimeoutMs: numberEnv('DATABASE_CONNECTION_TIMEOUT_MS', 5000),

    // How long the server waits to receive a whole request, headers and body,
    // before dropping the connection with a 408. Node's default is five
    // minutes, which is a long time to let a slow-loris client keep a socket
    // — and an upload of the largest permitted document fits comfortably.
    requestTimeoutMs: numberEnv('REQUEST_TIMEOUT_MS', 30000),

    shutdownTimeoutMs: numberEnv('SHUTDOWN_TIMEOUT_MS', 10000)
};

/**
 * The transport is checked by name at startup, for the reason given next to
 * MAIL_TRANSPORTS: an unknown value must fail here, not fall back to something
 * that looks like it worked.
 */
const assertMailConfig = () => {
    if (!MAIL_TRANSPORTS.includes(config.mail.transport)) {
        throw new Error(
            `MAIL_TRANSPORT must be one of ${MAIL_TRANSPORTS.join(', ')} — got "${config.mail.transport}"`
        );
    }

    assertGmailConfig();
};

/** The bare, lower-cased address out of `Name <address>` or a plain address. */
export const addressOf = (value) => {
    const text = String(value ?? '').trim();
    const angled = /<([^<>]+)>\s*$/.exec(text);

    return (angled ? angled[1] : text).trim().toLowerCase();
};

const GMAIL_KEYS = [
    ['GOOGLE_CLIENT_ID', 'clientId'],
    ['GOOGLE_CLIENT_SECRET', 'clientSecret'],
    ['GOOGLE_REDIRECT_URI', 'redirectUri'],
    ['GMAIL_SENDER_EMAIL', 'senderEmail']
];

/**
 * The Gmail API is all-or-nothing: half its identifiers is a connect button
 * that fails at Google, so a partial set refuses to boot. Selected as the
 * transport, it must also be able to send as MAIL_FROM, or Gmail would
 * quietly replace the sender with the account's own address.
 */
const assertGmailConfig = () => {
    const gmail = config.mail.gmail;
    const selected = config.mail.transport === 'gmail';
    const absent = GMAIL_KEYS.filter(([, field]) => !gmail[field]).map(([key]) => key);

    gmail.configured = absent.length === 0;

    if (gmail.stubUrl && isDeployed) {
        throw new Error('GOOGLE_API_STUB_URL is for the test suite and must not be set on a deployed instance');
    }

    if (!selected && absent.length === GMAIL_KEYS.length) {
        return;
    }

    if (absent.length > 0) {
        throw new Error(`${selected ? 'MAIL_TRANSPORT=gmail' : 'The Gmail API'} needs ${absent.join(', ')}`);
    }

    if (!gmail.senderEmail.includes('@')) {
        throw new Error(`GMAIL_SENDER_EMAIL is not an email address: "${gmail.senderEmail}"`);
    }

    let redirect;

    try {
        redirect = new URL(gmail.redirectUri);
    } catch {
        throw new Error(`GOOGLE_REDIRECT_URI must be an absolute URL, got "${gmail.redirectUri}"`);
    }

    if (isDeployed && redirect.protocol !== 'https:') {
        throw new Error('GOOGLE_REDIRECT_URI must use https on a deployed instance');
    }

    if (isDeployed && !gmail.credentialsKey) {
        throw new Error('The Gmail API needs MAIL_CREDENTIALS_KEY on a deployed instance: it seals the stored refresh token');
    }

    if (gmail.credentialsKey && Buffer.from(gmail.credentialsKey, 'base64').length !== 32) {
        throw new Error('MAIL_CREDENTIALS_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)');
    }

    if (!Number.isInteger(gmail.maxAttempts) || gmail.maxAttempts < 1 || gmail.maxAttempts > 10) {
        throw new Error(`GMAIL_MAX_ATTEMPTS must be a whole number between 1 and 10, got "${gmail.maxAttempts}"`);
    }

    if (selected && addressOf(config.mail.from) !== gmail.senderEmail && !gmail.fromAliasVerified) {
        throw new Error(
            `MAIL_FROM (${addressOf(config.mail.from)}) is not GMAIL_SENDER_EMAIL (${gmail.senderEmail}). ` +
                'Gmail would send as the account instead. Add the address as a verified "Send mail as" alias and set ' +
                'GMAIL_FROM_ALIAS_VERIFIED=true, or make MAIL_FROM the account itself.'
        );
    }
};

/**
 * Media configuration is checked here rather than discovered at first upload.
 *
 * The mistake this catches is a specific and easy one: pasting the bucket's
 * public URL into the bucket *name*. Cloudflare shows both on the same page and
 * they are trivially confusable. Without this the misconfiguration survives
 * startup and surfaces as "Bucket name shouldn't contain '/'" from inside the
 * AWS SDK, at the moment an admin tries to publish a hotel.
 */
const assertMediaConfig = () => {
    // Same failure mode as MAIL_TRANSPORT: a mistyped driver name used to fall
    // back to `local`, so a production deploy would write uploads to its own
    // disk and lose them on the next redeploy.
    if (!MEDIA_DRIVERS.includes(config.media.driver)) {
        throw new Error(`MEDIA_DRIVER must be one of ${MEDIA_DRIVERS.join(', ')} — got "${config.media.driver}"`);
    }

    for (const key of ['publicBucket', 'privateBucket']) {
        const value = config.media[key];

        if (/^https?:\/\//i.test(value) || value.includes('/')) {
            throw new Error(
                `config.media.${key} is a bucket name, not a URL — got "${value}". ` +
                    'The public URL belongs in MEDIA_PUBLIC_BASE_URL.'
            );
        }
    }

    if (config.media.publicBucket === config.media.privateBucket) {
        throw new Error(
            'MEDIA_PUBLIC_BUCKET and MEDIA_PRIVATE_BUCKET must be different buckets — ' +
                'sharing one would put contracts behind a public URL.'
        );
    }

    if (config.media.driver === 's3' && !config.media.endpoint) {
        throw new Error('MEDIA_S3_ENDPOINT is required when the media driver is s3');
    }
};

/**
 * The reminder cadence is validated when it is read (see `parseOffsetDays`);
 * what is checked here is the mailbox, which a production deploy almost
 * certainly wants and which nothing else would complain about if it were
 * missing — reminders would simply stay in-app, unread over a weekend.
 */
const assertFinanceConfig = () => {
    if (config.finance.overdueRepeatDays < 0 || !Number.isInteger(config.finance.overdueRepeatDays)) {
        throw new Error(`FINANCE_OVERDUE_REPEAT_DAYS must be a whole number of days (0 = alert once), got "${config.finance.overdueRepeatDays}"`);
    }

    if (config.finance.opsEmail && !config.finance.opsEmail.includes('@')) {
        throw new Error(`FINANCE_OPS_EMAIL is not an email address: "${config.finance.opsEmail}"`);
    }

    if (isDeployed && !config.finance.opsEmail) {
        console.warn('FINANCE_OPS_EMAIL is not set: supplier payment reminders will be in-app only');
    }

    if (config.booking.opsEmail && !config.booking.opsEmail.includes('@')) {
        throw new Error(`BOOKING_OPS_EMAIL is not an email address: "${config.booking.opsEmail}"`);
    }

    if (!Number.isInteger(config.booking.approvalSlaHours) || config.booking.approvalSlaHours < 1) {
        throw new Error(`BOOKING_APPROVAL_SLA_HOURS must be a whole number of hours, got "${config.booking.approvalSlaHours}"`);
    }
};

// Languages InvoiceOcean can print a document in. Georgian and Hebrew are not
// among them (owner decision D2), which is why a partner's own locale is never
// used as-is.
export const INVOICEOCEAN_LANGS = Object.freeze([
    'en', 'pl', 'de', 'fr', 'es', 'it', 'nl', 'cz', 'hr', 'sk', 'ru', 'tr', 'ar', 'pt', 'et', 'lt', 'lv', 'hu', 'ro', 'bg', 'el', 'sv', 'da', 'fi', 'no', 'uk', 'sl', 'sr', 'zh', 'ja', 'ko', 'ee'
]);

/**
 * Invoicing is checked at boot for the same reason the mail transport is: a
 * deploy that thinks it is issuing invoices and is not would be found out by
 * an accountant weeks later. Switched off, none of it is required.
 */
const assertInvoicingConfig = () => {
    const io = config.finance.invoiceocean;

    if (!Number.isInteger(io.defaultTaxBps) || io.defaultTaxBps < 0 || io.defaultTaxBps > 10_000) {
        throw new Error(`INVOICEOCEAN_DEFAULT_TAX_BPS must be whole basis points between 0 and 10000, got "${io.defaultTaxBps}"`);
    }

    if (!INVOICEOCEAN_LANGS.includes(io.lang)) {
        throw new Error(`INVOICEOCEAN_LANG must be a language InvoiceOcean prints (${INVOICEOCEAN_LANGS.join(', ')}), got "${io.lang}"`);
    }

    if (!io.enabled) {
        return;
    }

    const missingKeys = [
        ['INVOICEOCEAN_DOMAIN', io.domain],
        ['INVOICEOCEAN_API_TOKEN', io.apiToken],
        ...(isDeployed ? [['INVOICEOCEAN_WEBHOOK_SECRET', io.webhookSecret]] : [])
    ]
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missingKeys.length > 0) {
        throw new Error(`INVOICEOCEAN_ENABLED=true needs ${missingKeys.join(', ')}`);
    }

    if (io.webhookSecret && io.webhookSecret.length < 16) {
        throw new Error('INVOICEOCEAN_WEBHOOK_SECRET must be at least 16 characters');
    }
};

assertMailConfig();
assertMediaConfig();
assertFinanceConfig();
assertInvoicingConfig();

export default config;
