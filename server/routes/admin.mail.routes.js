import { Router } from 'express';

import { authenticate, requireCapability } from '../middleware/auth.js';
import { mailProviderLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { logger } from '../lib/logger.js';
import {
    OAUTH_COOKIE,
    accountStatus,
    completeAuthorization,
    disconnectAccount,
    oauthCookieOptions,
    openConsent,
    sendTestEmail,
    settingsUrl,
    startAuthorization
} from '../services/mail/googleAccount.service.js';
import { googleCallbackQuerySchema, googleStartQuerySchema } from '../validation/mail.js';

/**
 * Settings → Email: the Google account outgoing mail is sent as.
 *
 * Reading the status is for anyone who administers the platform; connecting,
 * disconnecting and test-sending change who the platform speaks as, so they
 * take `settings.write`. The stop on the way to Google and the callback are
 * the two routes without a session — see
 * services/mail/googleAccount.service.js for what authorises them instead.
 */
export const adminMailRoutes = Router();

adminMailRoutes.get('/google/start', validate({ query: googleStartQuerySchema }), async (req, res) => {
    let outcome;

    try {
        outcome = await openConsent(req.valid.query, req);
    } catch (err) {
        logger.error({ err }, 'Gmail authorisation could not be opened');
        outcome = { ok: false, code: 'server' };
    }

    res.set('Cache-Control', 'no-store');
    // The URL carried a one-time ticket; keep it out of the next page's Referer.
    res.set('Referrer-Policy', 'no-referrer');

    if (!outcome.ok) {
        res.status(200).type('html').send(returnPage(settingsUrl(outcome)));

        return;
    }

    // Set here, on the host and path Google will return the browser to, so
    // the callback is certain to be sent it.
    res.cookie(OAUTH_COOKIE, outcome.state, oauthCookieOptions());
    res.redirect(302, outcome.url);
});

adminMailRoutes.get('/google/callback', validate({ query: googleCallbackQuerySchema }), async (req, res) => {
    const cookieState = req.cookies?.[OAUTH_COOKIE] ?? null;
    let outcome;

    try {
        outcome = await completeAuthorization({ ...req.valid.query, cookieState }, req);
    } catch (err) {
        logger.error({ err }, 'Gmail authorisation callback failed');
        outcome = { ok: false, code: 'server' };
    }

    // Spent either way; a fresh attempt starts with a fresh one.
    res.clearCookie(OAUTH_COOKIE, { ...oauthCookieOptions(), maxAge: undefined });
    res.set('Cache-Control', 'no-store');
    // The URL carried a one-time code; keep it out of the next page's Referer.
    res.set('Referrer-Policy', 'no-referrer');
    res.status(200).type('html').send(returnPage(settingsUrl(outcome)));
});

const escapeAttribute = (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * A page that sends the browser on to the panel, instead of a redirect.
 *
 * A 303 straight to the panel would keep the browser in a navigation that
 * began on accounts.google.com, and the browser treats every hop of that
 * chain as cross-site: the SameSite=Strict session cookie is withheld, the
 * panel renders signed out, and the administrator lands on the sign-in screen
 * — still signed in, but with every appearance of having been logged out.
 * Moving on from this page starts a fresh navigation from the API's own site,
 * which the panel shares, so the session goes with it. A meta refresh rather
 * than a script, because the API's Content-Security-Policy refuses inline
 * scripts; the link is there for a browser that ignores the refresh.
 */
const returnPage = (url) => {
    const href = escapeAttribute(url);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${href}">
<title>Returning to I am Georgia</title>
</head>
<body style="font:15px/1.6 system-ui,sans-serif;padding:40px;color:#20201d">
<p>Returning to the admin panel… <a href="${href}">Continue</a></p>
</body>
</html>`;
};

adminMailRoutes.use(authenticate);

adminMailRoutes.get('/google', requireCapability(CAPABILITIES.PLATFORM_ADMIN, CAPABILITIES.SETTINGS_WRITE), async (req, res) => {
    res.json(await accountStatus());
});

adminMailRoutes.post('/google/authorize', requireCapability(CAPABILITIES.SETTINGS_WRITE), mailProviderLimiter, async (req, res) => {
    res.json(await startAuthorization(req.user, req));
});

adminMailRoutes.post('/google/disconnect', requireCapability(CAPABILITIES.SETTINGS_WRITE), mailProviderLimiter, async (req, res) => {
    res.json(await disconnectAccount(req.user, req));
});

adminMailRoutes.post('/google/test', requireCapability(CAPABILITIES.SETTINGS_WRITE), mailProviderLimiter, async (req, res) => {
    res.json(await sendTestEmail(req.user, req));
});
