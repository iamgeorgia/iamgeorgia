import { Router } from 'express';
import multer from 'multer';

import { config } from '../config.js';
import { authenticate, requireAdmin, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES, can } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { idParamSchema, mediaQuerySchema, uploadSchema } from '../validation/media.js';
import {
    findFileOr404,
    isOpsCategory,
    issueSignedUrl,
    reachableCategories,
    reachesAllFiles,
    reachesCategory,
    softDeleteFile,
    uploadFile
} from '../services/media/upload.service.js';
import { prisma } from '../db/index.js';
import { toImageAsset, toPrivateFile } from '../serializers/media.js';

/**
 * Media administration.
 *
 * Files are held in memory rather than spooled to disk: they are validated,
 * re-encoded and forwarded to object storage within the request, so a temporary
 * file would only be another thing to clean up. The multer limit is the larger
 * of the two configured ceilings; the per-category limit is applied in the
 * service, once the file's real type is known.
 */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: Math.max(config.media.maxImageBytes, config.media.maxDocumentBytes),
        files: 1
    }
});

export const adminMediaRoutes = Router();

/**
 * Admins reach the whole library. Transfer operations staff reach the four
 * fleet and driver categories and nothing else — a dispatcher uploads the new
 * minivan's photographs and reads a licence scan, and never sees a contract.
 * The narrowing is applied per route below; the service applies it again for
 * signed links, so this router is not the only thing standing in the way.
 */
adminMediaRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.CATALOGUE_READ, CAPABILITIES.DISPATCH_READ], write: [CAPABILITIES.CATALOGUE_WRITE, CAPABILITIES.DISPATCH_WRITE] }));

adminMediaRoutes.get('/', validate({ query: mediaQuerySchema }), async (req, res) => {
    const { category, partnerId, page, pageSize } = req.valid.query;
    const requested = category ? (Array.isArray(category) ? category : [category]) : null;

    let categories = requested;

    if (!reachesAllFiles(req.user)) {
        const reachable = reachableCategories(req.user);
        categories = (requested ?? reachable).filter((category) => reachable.includes(category));

        if (categories.length === 0) {
            throw new ForbiddenError('Your role may not browse those files', { reachable });
        }
    }

    const where = {
        deletedAt: null,
        ...(partnerId ? { partnerId } : {}),
        ...(categories ? { category: { in: categories } } : {})
    };

    const [total, files] = await Promise.all([
        prisma.fileAsset.count({ where }),
        prisma.fileAsset.findMany({
            where,
            include: { variants: true },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    res.json({
        // A private file is never given a URL, even to an admin listing it. The
        // link is a separate, audited request.
        data: files.map((file) => (file.visibility === 'PUBLIC' ? toImageAsset(file) : toPrivateFile(file))),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    });
});

adminMediaRoutes.post('/', upload.single('file'), validate({ body: uploadSchema }), async (req, res) => {
    if (!can(req.user, CAPABILITIES.CATALOGUE_WRITE) && !isOpsCategory(req.valid.body.category)) {
        throw new ForbiddenError('Operations staff may upload fleet and driver files only', {
            category: req.valid.body.category
        });
    }

    const asset = await uploadFile(
        {
            buffer: req.file?.buffer,
            originalFilename: req.file?.originalname ?? 'upload',
            declaredMimeType: req.file?.mimetype,
            ...req.valid.body
        },
        req.user,
        req
    );

    res.status(201).json(asset.visibility === 'PUBLIC' ? toImageAsset(asset) : toPrivateFile(asset));
});

adminMediaRoutes.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
    const asset = await findFileOr404(req.valid.params.id);

    // A 404 rather than a 403: a dispatcher probing ids must not learn which
    // of a partner's contracts exist.
    if (!reachesCategory(req.user, asset.category)) {
        throw new NotFoundError('File not found');
    }

    res.json(asset.visibility === 'PUBLIC' ? toImageAsset(asset) : toPrivateFile(asset));
});

/**
 * The only way to reach a private file.
 *
 * Authorised, audited, and short-lived. There is no code path that turns a
 * private object key into a permanent URL.
 */
adminMediaRoutes.get('/:id/url', validate({ params: idParamSchema }), async (req, res) => {
    const { url, expiresAt } = await issueSignedUrl(req.valid.params.id, req.user, req);

    res.json({ url, expiresAt });
});

adminMediaRoutes.delete('/:id', requireAdmin, validate({ params: idParamSchema }), async (req, res) => {
    await softDeleteFile(req.valid.params.id, req.user, req);

    res.status(204).end();
});
