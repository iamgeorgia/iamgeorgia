import { createHash } from 'node:crypto';

import { fileTypeFromBuffer } from 'file-type';

import { prisma } from '../../db/index.js';
import { config } from '../../config.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { isTransferOps } from '../../middleware/auth.js';
import { CAPABILITIES, can } from '../../lib/permissions.js';
import { newAssetFolder, objectKeyFor, extensionForMime } from '../../lib/media/keys.js';
import { processImage } from './image.service.js';
import { putObject, removeObjectPrefix, signedUrlForObject } from './storage.service.js';

/**
 * Uploads.
 *
 * Bytes are validated before anything is written anywhere. That is the reason
 * V1 uploads through the API rather than handing out a presigned PUT: a
 * presigned upload puts unexamined bytes in the bucket first and inspects them
 * afterwards, which needs a quarantine bucket, a completion callback and a
 * reaper for abandoned uploads. Uploading through here costs request time on a
 * low-traffic admin path, which is the right trade at this size. When admins
 * start pushing fifty-image galleries, this becomes presigned plus a job queue
 * and `FileAsset.status` is already PENDING/READY/FAILED for exactly that.
 */

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

const DOCUMENT_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
]);

/**
 * Visibility is decided by category, never by the caller.
 *
 * A contract cannot be uploaded as public even by a client that asks for it,
 * and a hotel photo cannot be filed somewhere it will never be served from.
 * Making this a lookup rather than a parameter removes the possibility.
 */
const VISIBILITY_FOR_CATEGORY = {
    HOTEL_IMAGE: 'PUBLIC',
    ROOM_IMAGE: 'PUBLIC',
    AMENITY_ICON: 'PUBLIC',
    CONTRACT: 'PRIVATE',
    RATE_SHEET: 'PRIVATE',
    INVOICE: 'PRIVATE',
    VOUCHER: 'PRIVATE',
    IMPORT: 'PRIVATE',
    // A scan of a signed certificate on a permanent public URL is a forgeable
    // artefact. The *facts* — authority, scope, validity — travel in the API
    // response for anyone to read; the image is reached through a signed,
    // audited request, like every other document.
    KOSHER_CERTIFICATE: 'PRIVATE',
    // A car and the driver who meets the traveller are shown, so their
    // photographs are public. Their licences, insurance and ID scans are not.
    FLEET_IMAGE: 'PUBLIC',
    DRIVER_PHOTO: 'PUBLIC',
    DRIVER_DOCUMENT: 'PRIVATE',
    VEHICLE_DOCUMENT: 'PRIVATE',
    OTHER: 'PRIVATE'
};

const isImageCategory = (category) =>
    ['HOTEL_IMAGE', 'ROOM_IMAGE', 'AMENITY_ICON', 'FLEET_IMAGE', 'DRIVER_PHOTO'].includes(category);

/**
 * Categories that accept a photograph as well as a document.
 *
 * A kosher certificate arrives as a PDF from an authority that has one and as a
 * phone photograph of a framed certificate from one that does not, and refusing
 * the second would mean refusing most of them. It is still not an *image*
 * category: it stays private and it is not resized into gallery renditions,
 * because nothing renders it in a gallery.
 */
const MIXED_MEDIA_CATEGORIES = new Set(['KOSHER_CERTIFICATE']);

/**
 * Establishes what a file actually is.
 *
 * The declared Content-Type is a claim by the uploader and is treated as one:
 * it has to agree with what the bytes say, and where the two differ the bytes
 * win and the upload is refused. `photo.jpg` that begins `MZ` is a Windows
 * executable, and the only safe answer is no.
 */
const sniff = async (buffer, declaredMimeType) => {
    const detected = await fileTypeFromBuffer(buffer);

    if (detected) {
        return detected.mime;
    }

    // CSV is the one legitimate format with no signature to find — it is just
    // text. Accept it only when it was declared as CSV *and* looks like text,
    // and refuse everything else that cannot be identified rather than letting
    // "unrecognised" become a way through.
    if (declaredMimeType === 'text/csv' && looksLikeText(buffer)) {
        return 'text/csv';
    }

    throw new BadRequestError('That file type could not be identified and was not accepted');
};

const looksLikeText = (buffer) => {
    const sample = buffer.subarray(0, 4096);

    // A null byte is the clearest signal that this is not a text file.
    return !sample.includes(0);
};

const assertAcceptable = (mimeType, category, sizeBytes) => {
    const wantsImage = isImageCategory(category);
    const mixed = MIXED_MEDIA_CATEGORIES.has(category);

    let allowed;
    let message;

    if (wantsImage) {
        allowed = IMAGE_MIME_TYPES;
        message = 'Upload a JPEG, PNG, WebP or AVIF image';
    } else if (mixed) {
        // Spreadsheets are excluded deliberately: a certificate is a document
        // or a photograph of one, never a workbook, and a narrower list is a
        // smaller surface.
        allowed = new Set([...IMAGE_MIME_TYPES, 'application/pdf']);
        message = 'Upload a PDF or a JPEG, PNG, WebP or AVIF image of the certificate';
    } else {
        allowed = DOCUMENT_MIME_TYPES;
        message = 'Upload a PDF, Excel or CSV document';
    }

    if (!allowed.has(mimeType)) {
        throw new BadRequestError(message, { detectedMimeType: mimeType });
    }

    // A photograph of a certificate is sized like a photograph, so a mixed
    // category takes whichever limit suits the bytes that actually arrived.
    const limit =
        wantsImage || (mixed && IMAGE_MIME_TYPES.has(mimeType))
            ? config.media.maxImageBytes
            : config.media.maxDocumentBytes;

    if (sizeBytes > limit) {
        throw new BadRequestError('That file is too large', { sizeBytes, limitBytes: limit });
    }
};

export const uploadFile = async (
    { buffer, originalFilename, declaredMimeType, category, altText, partnerId },
    actor,
    req
) => {
    if (!buffer?.length) {
        throw new BadRequestError('No file was uploaded');
    }

    // SVG is rejected before anything else looks at it. It is a document
    // format that can carry script, and there is no version of "sanitised SVG"
    // worth owning when a raster format does the job.
    if (declaredMimeType === 'image/svg+xml') {
        throw new BadRequestError('SVG uploads are not accepted');
    }

    const mimeType = await sniff(buffer, declaredMimeType);
    assertAcceptable(mimeType, category, buffer.length);

    const visibility = VISIBILITY_FOR_CATEGORY[category] ?? 'PRIVATE';
    const folder = newAssetFolder(category);
    const written = [];

    let stored = { buffer, mimeType, width: null, height: null, sizeBytes: buffer.length };
    let renditions = [];

    if (isImageCategory(category)) {
        const processed = await processImage(buffer);
        stored = processed.original;
        renditions = processed.renditions;
    }

    const objectKey = objectKeyFor(folder, 'original', extensionForMime(stored.mimeType));

    try {
        await putObject({ key: objectKey, body: stored.buffer, contentType: stored.mimeType, visibility });
        written.push(objectKey);

        for (const rendition of renditions) {
            const key = objectKeyFor(folder, rendition.variant, rendition.format);
            await putObject({
                key,
                body: rendition.buffer,
                contentType: `image/${rendition.format}`,
                visibility
            });
            written.push(key);
            rendition.objectKey = key;
        }

        return await prisma.$transaction(async (tx) => {
            const asset = await tx.fileAsset.create({
                data: {
                    objectKey,
                    bucket: visibility === 'PRIVATE' ? config.media.privateBucket : config.media.publicBucket,
                    originalFilename,
                    mimeType: stored.mimeType,
                    sizeBytes: stored.sizeBytes,
                    checksumSha256: createHash('sha256').update(stored.buffer).digest('hex'),
                    width: stored.width,
                    height: stored.height,
                    category,
                    visibility,
                    // Everything is written before the row exists, so the asset
                    // is usable the moment it is readable. The PENDING state is
                    // kept for when processing moves to a background job.
                    status: 'READY',
                    altText: altText ?? null,
                    uploadedByUserId: actor?.id ?? null,
                    partnerId: partnerId ?? actor?.partnerId ?? null,
                    variants: {
                        create: renditions.map((rendition) => ({
                            variant: rendition.variant,
                            format: rendition.format,
                            objectKey: rendition.objectKey,
                            width: rendition.width,
                            height: rendition.height,
                            sizeBytes: rendition.sizeBytes
                        }))
                    }
                },
                include: { variants: true }
            });

            await recordAudit(tx, {
                action: 'MEDIA_UPLOADED',
                actor,
                entityType: AUDIT_ENTITY.fileAsset,
                entityId: asset.id,
                summary: `Uploaded ${originalFilename}`,
                metadata: { category, visibility, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes },
                req
            });

            return asset;
        });
    } catch (err) {
        // The objects went up before the row existed, so a failed insert would
        // otherwise leave them behind with nothing referencing them. One prefix
        // delete removes the original and every rendition together. The
        // original error is the one the caller sees; a failure here is logged
        // with the prefix so the orphans can still be found.
        if (written.length > 0) {
            await removeObjectPrefix({ prefix: folder, visibility }).catch((cleanupErr) =>
                logger.warn(
                    { err: cleanupErr, prefix: folder, visibility },
                    'Could not remove the objects of a failed upload'
                )
            );
        }

        throw err;
    }
};

/**
 * The categories transfer operations staff work with. A dispatcher uploads a
 * car's photograph and reads a driver's licence scan; a dispatcher never
 * reaches a partner's contract.
 */
const OPS_CATEGORIES = new Set(['FLEET_IMAGE', 'DRIVER_PHOTO', 'DRIVER_DOCUMENT', 'VEHICLE_DOCUMENT']);

export const isOpsCategory = (category) => OPS_CATEGORIES.has(category);

/**
 * Whether a viewer reaches every file, contracts included: the back-office
 * desks. A dispatcher reaches the operations categories only.
 */
export const reachesAllFiles = (viewer) => can(viewer, CAPABILITIES.PARTNERS_READ);

/** Ownership, for supplier users. The desks reach everything; operations staff reach their own categories. */
const assertMayReach = (asset, viewer) => {
    if (reachesAllFiles(viewer)) {
        return;
    }

    if (isTransferOps(viewer) && isOpsCategory(asset.category)) {
        return;
    }

    // A 404 rather than a 403: a supplier probing ids must not learn which of
    // them exist.
    if (!asset.partnerId || asset.partnerId !== viewer?.partnerId) {
        throw new NotFoundError('File not found');
    }
};

export const findFileOr404 = async (id) => {
    const asset = await prisma.fileAsset.findFirst({
        where: { id, deletedAt: null },
        include: { variants: true }
    });

    if (!asset) {
        throw new NotFoundError('File not found');
    }

    return asset;
};

/**
 * A short-lived link to a private file, issued only after an authorization
 * check and always recorded.
 *
 * Every issuance writes an audit row. Reading a supplier contract is exactly
 * the sort of access that should be answerable after the fact.
 */
export const issueSignedUrl = async (id, actor, req) => {
    const asset = await findFileOr404(id);

    if (asset.visibility !== 'PRIVATE') {
        throw new BadRequestError('That file is public and already has a URL');
    }

    assertMayReach(asset, actor);

    const url = await signedUrlForObject({ key: asset.objectKey, visibility: 'PRIVATE' });
    const expiresAt = new Date(Date.now() + config.media.signedUrlTtlSeconds * 1000);

    await recordAudit(prisma, {
        action: 'PRIVATE_FILE_ACCESSED',
        actor,
        entityType: AUDIT_ENTITY.fileAsset,
        entityId: asset.id,
        summary: `Issued a signed link for ${asset.originalFilename}`,
        metadata: { category: asset.category, ttlSeconds: config.media.signedUrlTtlSeconds },
        req
    });

    return { url, expiresAt };
};

/**
 * Soft delete.
 *
 * The row stays and the objects stay. An asset referenced by a booking voucher
 * or a past invoice must not evaporate because somebody tidied a gallery, and
 * `hotel_images.file_asset_id` is Restrict for the same reason — a file still
 * on a hotel cannot be removed at all until it is detached.
 */
export const softDeleteFile = async (id, actor, req) => {
    const asset = await findFileOr404(id);
    assertMayReach(asset, actor);

    const attached = await prisma.hotelImage.count({ where: { fileAssetId: id } });

    if (attached > 0) {
        throw new ForbiddenError('Detach this file from its hotel before deleting it', { attached });
    }

    return prisma.$transaction(async (tx) => {
        const deleted = await tx.fileAsset.update({ where: { id }, data: { deletedAt: new Date() } });

        await recordAudit(tx, {
            action: 'MEDIA_DELETED',
            actor,
            entityType: AUDIT_ENTITY.fileAsset,
            entityId: id,
            summary: `Deleted ${asset.originalFilename}`,
            req
        });

        return deleted;
    });
};
