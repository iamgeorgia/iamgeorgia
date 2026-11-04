import { Router } from 'express';

import { config } from '../config.js';
import { ForbiddenError } from '../lib/errors.js';
import { verifyObjectKey } from '../lib/media/signing.js';
import { getObject } from '../services/media/storage.service.js';

/**
 * Serves objects held by the **local** storage driver.
 *
 * Mounted only when that driver is active. Under `s3` these bytes come from R2
 * through a CDN and from a presigned URL respectively, and this router does not
 * exist — which is the point: development and production differ in where the
 * bytes live, not in the rules about who may read them.
 *
 * Regular-expression routes rather than wildcards because an object key
 * contains slashes and has to arrive whole.
 */
export const mediaRoutes = Router();

const send = (res, buffer, contentType, { attachment = false } = {}) => {
    res.set('Content-Type', contentType);
    // Never let a browser second-guess the type of something we are serving
    // back from storage.
    res.set('X-Content-Type-Options', 'nosniff');

    if (attachment) {
        res.set('Content-Disposition', 'attachment');
    }

    res.send(buffer);
};

const contentTypeFor = (key) => {
    const extension = key.split('.').pop()?.toLowerCase();

    return (
        {
            jpg: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
            avif: 'image/avif',
            pdf: 'application/pdf',
            csv: 'text/csv',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }[extension] ?? 'application/octet-stream'
    );
};

// Private objects: the signature and the expiry are the credential. This is the
// local stand-in for a presigned R2 URL, and it fails the same way.
mediaRoutes.get(/^\/private\/(.+)$/, async (req, res) => {
    const key = req.params[0];
    const { expires, signature } = req.query;

    if (!verifyObjectKey(key, expires, signature)) {
        throw new ForbiddenError('This link is invalid or has expired');
    }

    send(res, await getObject({ key, visibility: 'PRIVATE' }), contentTypeFor(key), { attachment: true });
});

// Public objects: what the CDN would serve. Cached hard because an object key
// is generated per asset and its contents never change.
mediaRoutes.get(/^\/(.+)$/, async (req, res) => {
    const key = req.params[0];
    const buffer = await getObject({ key, visibility: 'PUBLIC' });

    res.set('Cache-Control', `public, max-age=${config.isProduction ? 31536000 : 60}, immutable`);
    // helmet() sends `Cross-Origin-Resource-Policy: same-origin` on every
    // response, which is right for the API and wrong for this route: these
    // bytes are what the public CDN serves, and the front end on another
    // origin (:3000) embeds them directly in `<img>`. Under same-origin the
    // browser refused them (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) and every
    // admin, driver and fleet photo rendered broken. Private objects above
    // keep the default: they are signed downloads, never embedded.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    send(res, buffer, contentTypeFor(key));
});
