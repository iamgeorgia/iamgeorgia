import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import request from 'supertest';
import sharp from 'sharp';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeDestination,
    makeHotel,
    signIn
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

// --- fixtures --------------------------------------------------------------
// Real bytes, not stubs: the whole point of these tests is that the sniffing
// and the decoding actually happen.

const pngBuffer = (width = 1200, height = 800) =>
    sharp({
        create: { width, height, channels: 3, background: { r: 40, g: 80, b: 60 } }
    })
        .png()
        .toBuffer();

const jpegBuffer = (width = 900, height = 600) =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
        .jpeg()
        .toBuffer();

// A Windows executable. `MZ` is the whole giveaway, and it is exactly what a
// file called `photo.jpg` must not be allowed to be.
const exeBuffer = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024, 0x90)]);

const pdfBuffer = () =>
    Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
            'trailer<</Root 1 0 R>>\n%%EOF\n'
    );

const svgBuffer = () =>
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('media', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    let adminCookie;
    let hotel;

    before(async () => {
        const admin = await makeAdmin(tracker);
        adminCookie = (await signIn(app, admin.email)).cookie;

        const destination = await makeDestination(tracker);
        hotel = await makeHotel(tracker, { destination });
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
        // Best effort: the fleet suite runs in another process and writes to
        // the same scratch root, and a directory that is busy being written
        // to is not a failure of this suite.
        await rm(config.media.localRoot, { recursive: true, force: true }).catch(() => {});
    });

    /** Uploads through the real multipart route. */
    const upload = async (buffer, filename, contentType, category = 'HOTEL_IMAGE') => {
        const response = await request(app)
            .post('/api/admin/media')
            .set('Cookie', adminCookie)
            .field('category', category)
            .attach('file', buffer, { filename, contentType });

        if (response.status === 201) {
            tracker.file(response.body);
        }

        return response;
    };

    describe('validating what was uploaded', () => {
        it('accepts a real image and builds its renditions', async () => {
            const response = await upload(await pngBuffer(), 'lobby.png', 'image/png');

            assert.equal(response.status, 201);
            assert.ok(response.body.variants.length > 0, 'renditions should be written');

            const widths = response.body.variants.map((v) => v.width);
            assert.ok(widths.includes(320), 'a thumb should exist');
            assert.ok(widths.includes(640), 'a card should exist');
            // Every rendition is a real, fetchable object, not just a row.
            for (const variant of response.body.variants) {
                const fetched = await request(app).get(new URL(variant.url).pathname);
                assert.equal(fetched.status, 200, `${variant.variant}/${variant.format} should be served`);
                // Embedded by the front end on another origin, as the CDN's
                // copy would be; helmet's same-origin default blocked it.
                assert.equal(fetched.headers['cross-origin-resource-policy'], 'cross-origin');
            }
        });

        // The single most important test in this file.
        it('refuses an executable wearing a .jpg name and an image content type', async () => {
            // A name of its own: other suites' fixtures are also called
            // `photo.jpg`, and they run in parallel with this one, so counting
            // that name would count their rows too.
            const filename = `photo-${Date.now()}.jpg`;
            const response = await upload(exeBuffer(), filename, 'image/jpeg');

            assert.equal(response.status, 400);
            // The bytes win over both the extension and the declared type.
            assert.equal(await prisma.fileAsset.count({ where: { originalFilename: filename } }), 0);
        });

        it('refuses SVG outright', async () => {
            const response = await upload(svgBuffer(), 'logo.svg', 'image/svg+xml');

            assert.equal(response.status, 400);
            assert.match(response.body.error.message, /SVG/);
        });

        it('refuses a file type it cannot identify rather than letting it through', async () => {
            const response = await upload(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'mystery.bin', 'image/png');

            assert.equal(response.status, 400);
        });

        it('refuses a document uploaded into an image category', async () => {
            const response = await upload(pdfBuffer(), 'contract.pdf', 'application/pdf', 'HOTEL_IMAGE');

            assert.equal(response.status, 400);
            assert.match(response.body.error.message, /JPEG, PNG, WebP or AVIF/);
        });

        it('enforces the per-category size limit', async () => {
            // Mutated rather than uploading eleven megabytes, which would make
            // the suite measurably slower to prove the same branch.
            const original = config.media.maxImageBytes;
            config.media.maxImageBytes = 1024;

            try {
                const response = await upload(await pngBuffer(), 'huge.png', 'image/png');

                assert.equal(response.status, 400);
                assert.match(response.body.error.message, /too large/);
            } finally {
                config.media.maxImageBytes = original;
            }
        });

        it('accepts a CSV, which has no signature to sniff, only when it is declared as one', async () => {
            const csv = Buffer.from('hotel,room,rate\nBakuriani Inn,Deluxe,250\n');

            const accepted = await upload(csv, 'rates.csv', 'text/csv', 'IMPORT');
            assert.equal(accepted.status, 201);

            // The same text claiming to be a PDF is not identifiable and is refused.
            const refused = await upload(csv, 'rates.pdf', 'application/pdf', 'IMPORT');
            assert.equal(refused.status, 400);
        });
    });

    /**
     * Kosher certificates.
     *
     * The one category that takes a document *or* a photograph, because an
     * authority with no PDF hands over a framed certificate and a phone picture
     * of it is what actually arrives. It is still not an image category: it
     * stays private and grows no gallery renditions, because nothing renders a
     * certificate in a gallery.
     */
    describe('kosher certificates', () => {
        it('accepts a PDF', async () => {
            const response = await upload(
                pdfBuffer(),
                'certificate.pdf',
                'application/pdf',
                'KOSHER_CERTIFICATE'
            );

            assert.equal(response.status, 201);
        });

        it('accepts a photograph of one', async () => {
            const response = await upload(
                await pngBuffer(900, 1200),
                'certificate.png',
                'image/png',
                'KOSHER_CERTIFICATE'
            );

            assert.equal(response.status, 201);
        });

        it('stores it private, with no renditions and no public URL', async () => {
            const response = await upload(
                pdfBuffer(),
                'certificate.pdf',
                'application/pdf',
                'KOSHER_CERTIFICATE'
            );

            const asset = await prisma.fileAsset.findUnique({
                where: { id: response.body.id },
                include: { variants: true }
            });

            // Visibility is decided by category and never by the caller, so a
            // certificate cannot be uploaded public however anyone asks.
            assert.equal(asset.visibility, 'PRIVATE');
            assert.equal(asset.variants.length, 0);
            assert.ok(!('url' in response.body), 'a private asset carries no address');
        });

        it('still refuses an executable wearing a certificate name', async () => {
            const response = await upload(
                exeBuffer(),
                'certificate.pdf',
                'application/pdf',
                'KOSHER_CERTIFICATE'
            );

            assert.equal(response.status, 400);
        });

        it('refuses a spreadsheet — a certificate is not a workbook', async () => {
            const response = await upload(
                Buffer.from('a,b,c\n1,2,3\n'),
                'certificate.csv',
                'text/csv',
                'KOSHER_CERTIFICATE'
            );

            assert.equal(response.status, 400);
        });
    });

    describe('what gets stored', () => {
        it('generates the object key and never derives it from the filename', async () => {
            const nasty = '../../../etc/passwd.png';
            const response = await upload(await pngBuffer(400, 300), nasty, 'image/png');

            assert.equal(response.status, 201);

            const asset = await prisma.fileAsset.findUnique({ where: { id: response.body.id } });

            // Two independent layers, and this asserts both. Busboy strips the
            // directory portion before multer ever hands us a filename, so what
            // is stored for display is already just `passwd.png` — but the key
            // does not come from it either way.
            assert.ok(!asset.originalFilename.includes('/'), 'no path survives into the stored name');
            assert.ok(!asset.originalFilename.includes('..'));
            assert.ok(!asset.objectKey.includes('passwd'), 'the key owes nothing to the filename');
            assert.match(asset.objectKey, /^hotel-image\/[0-9a-f]{32}\/original\.png$/);
        });

        it('picks the extension from the sniffed type, not the supplied name', async () => {
            // A genuine PNG uploaded as `invoice.pdf`. The bytes decide.
            const response = await upload(await pngBuffer(300, 200), 'invoice.pdf', 'image/png');

            assert.equal(response.status, 201);
            const asset = await prisma.fileAsset.findUnique({ where: { id: response.body.id } });

            assert.ok(asset.objectKey.endsWith('.png'), 'stored as what it is');
            assert.equal(asset.mimeType, 'image/png');
        });

        it('strips EXIF, so a hotel gallery cannot republish a photographer location', async () => {
            const withExif = await sharp({
                create: { width: 500, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } }
            })
                .withExif({ IFD0: { Copyright: 'Someone', Software: 'TestCam' } })
                .jpeg()
                .toBuffer();

            assert.ok((await sharp(withExif).metadata()).exif, 'the fixture really does carry EXIF');

            const response = await upload(withExif, 'room.jpg', 'image/jpeg');
            assert.equal(response.status, 201);

            const served = await request(app).get(new URL(response.body.url).pathname);
            const storedMetadata = await sharp(served.body).metadata();

            assert.equal(storedMetadata.exif, undefined, 'the stored original must carry none');
        });

        it('does not upscale a small image into a larger rendition', async () => {
            const response = await upload(await pngBuffer(200, 150), 'small.png', 'image/png');

            for (const variant of response.body.variants) {
                assert.ok(variant.width <= 200, `${variant.variant} should not be enlarged`);
            }
        });
    });

    describe('private files', () => {
        const uploadContract = () => upload(pdfBuffer(), 'supplier-contract.pdf', 'application/pdf', 'CONTRACT');

        it('files a contract as private and gives it no URL, even to an admin', async () => {
            const response = await uploadContract();

            assert.equal(response.status, 201);
            assert.equal(response.body.url, undefined, 'a private file is never serialized with a URL');

            const asset = await prisma.fileAsset.findUnique({ where: { id: response.body.id } });
            // Visibility comes from the category, not from anything the client
            // sent, so a contract cannot be uploaded as public.
            assert.equal(asset.visibility, 'PRIVATE');
            assert.equal(asset.bucket, config.media.privateBucket);
        });

        it('issues a working short-lived link, and records that it did', async () => {
            const uploaded = await uploadContract();

            const link = await request(app)
                .get(`/api/admin/media/${uploaded.body.id}/url`)
                .set('Cookie', adminCookie);

            assert.equal(link.status, 200);
            const url = new URL(link.body.url);
            const fetched = await request(app).get(url.pathname + url.search);

            assert.equal(fetched.status, 200);
            assert.equal(fetched.headers['content-disposition'], 'attachment');
            assert.equal(fetched.headers['x-content-type-options'], 'nosniff');
            // Only public objects are opened up to other origins.
            assert.equal(fetched.headers['cross-origin-resource-policy'], 'same-origin');

            const audit = await prisma.auditLog.findFirst({
                where: { entityId: uploaded.body.id, action: 'PRIVATE_FILE_ACCESSED' }
            });
            assert.ok(audit, 'reading a contract must be answerable after the fact');
        });

        it('refuses an unauthenticated request for a link', async () => {
            const uploaded = await uploadContract();

            const response = await request(app).get(`/api/admin/media/${uploaded.body.id}/url`);

            assert.equal(response.status, 401);
        });

        it('refuses a tampered or expired signature', async () => {
            const uploaded = await uploadContract();
            const link = await request(app)
                .get(`/api/admin/media/${uploaded.body.id}/url`)
                .set('Cookie', adminCookie);

            const url = new URL(link.body.url);

            const tampered = new URL(url);
            tampered.searchParams.set('signature', 'not-the-signature');
            assert.equal((await request(app).get(tampered.pathname + tampered.search)).status, 403);

            // A link whose expiry has passed is refused even with a signature
            // that was valid for it.
            const expired = new URL(url);
            expired.searchParams.set('expires', String(Math.floor(Date.now() / 1000) - 10));
            assert.equal((await request(app).get(expired.pathname + expired.search)).status, 403);
        });

        it('has no unsigned path to a private object', async () => {
            const uploaded = await uploadContract();
            const asset = await prisma.fileAsset.findUnique({ where: { id: uploaded.body.id } });

            // The public route reads the public bucket, so a private key simply
            // is not there.
            assert.equal((await request(app).get(`/media/${asset.objectKey}`)).status, 404);
            assert.equal((await request(app).get(`/media/private/${asset.objectKey}`)).status, 403);
        });
    });

    describe('a hotel gallery', () => {
        const attach = (body) =>
            request(app).post(`/api/admin/hotels/${hotel.id}/images`).set('Cookie', adminCookie).send(body);

        it('makes the first image the cover and leaves the second alone', async () => {
            const first = await upload(await jpegBuffer(), 'one.jpg', 'image/jpeg');
            const second = await upload(await jpegBuffer(), 'two.jpg', 'image/jpeg');

            const a = await attach({ fileAssetId: first.body.id, category: 'Exterior' });
            const b = await attach({ fileAssetId: second.body.id, category: 'Lobby' });

            assert.equal(a.status, 201);
            assert.equal(a.body.isCover, true);
            assert.equal(b.body.isCover, false);
        });

        it('moves the cover rather than rejecting the second one', async () => {
            const [first, second] = [
                await upload(await jpegBuffer(), 'a.jpg', 'image/jpeg'),
                await upload(await jpegBuffer(), 'b.jpg', 'image/jpeg')
            ];
            const a = await attach({ fileAssetId: first.body.id });
            const b = await attach({ fileAssetId: second.body.id });

            const promoted = await request(app)
                .patch(`/api/admin/hotels/${hotel.id}/images/${b.body.hotelImageId}`)
                .set('Cookie', adminCookie)
                .send({ isCover: true });

            assert.equal(promoted.status, 200);
            assert.equal(promoted.body.isCover, true);

            const demoted = await prisma.hotelImage.findUnique({ where: { id: a.body.hotelImageId } });
            assert.equal(demoted.isCover, false, 'the old cover must have been cleared in the same transaction');
        });

        it('refuses a private file in a public gallery', async () => {
            const contract = await upload(pdfBuffer(), 'c.pdf', 'application/pdf', 'CONTRACT');

            const response = await attach({ fileAssetId: contract.body.id });

            assert.equal(response.status, 400);
            assert.match(response.body.error.message, /public images/);
        });

        it('refuses to delete a file that is still attached to a hotel', async () => {
            const image = await upload(await jpegBuffer(), 'attached.jpg', 'image/jpeg');
            await attach({ fileAssetId: image.body.id });

            const response = await request(app)
                .delete(`/api/admin/media/${image.body.id}`)
                .set('Cookie', adminCookie);

            assert.equal(response.status, 403);
            assert.match(response.body.error.message, /Detach/);
        });

        it('promotes the next image when the cover is detached', async () => {
            const fresh = await makeHotel(tracker, { destination: await makeDestination(tracker) });
            const [first, second] = [
                await upload(await jpegBuffer(), 'x.jpg', 'image/jpeg'),
                await upload(await jpegBuffer(), 'y.jpg', 'image/jpeg')
            ];

            const a = await request(app)
                .post(`/api/admin/hotels/${fresh.id}/images`)
                .set('Cookie', adminCookie)
                .send({ fileAssetId: first.body.id });
            await request(app)
                .post(`/api/admin/hotels/${fresh.id}/images`)
                .set('Cookie', adminCookie)
                .send({ fileAssetId: second.body.id });

            const removed = await request(app)
                .delete(`/api/admin/hotels/${fresh.id}/images/${a.body.hotelImageId}`)
                .set('Cookie', adminCookie);
            assert.equal(removed.status, 204);

            const remaining = await prisma.hotelImage.findMany({ where: { hotelId: fresh.id } });
            assert.equal(remaining.length, 1);
            assert.equal(remaining[0].isCover, true, 'a gallery must not be left without a cover');
        });

        it('reorders the whole gallery at once, and refuses a partial order', async () => {
            const fresh = await makeHotel(tracker, { destination: await makeDestination(tracker) });
            const ids = [];

            for (const name of ['1.jpg', '2.jpg', '3.jpg']) {
                const asset = await upload(await jpegBuffer(), name, 'image/jpeg');
                const attached = await request(app)
                    .post(`/api/admin/hotels/${fresh.id}/images`)
                    .set('Cookie', adminCookie)
                    .send({ fileAssetId: asset.body.id });
                ids.push(attached.body.hotelImageId);
            }

            const partial = await request(app)
                .put(`/api/admin/hotels/${fresh.id}/images/order`)
                .set('Cookie', adminCookie)
                .send({ order: [ids[0]] });
            assert.equal(partial.status, 400);

            const reversed = [...ids].reverse();
            const ordered = await request(app)
                .put(`/api/admin/hotels/${fresh.id}/images/order`)
                .set('Cookie', adminCookie)
                .send({ order: reversed });

            assert.equal(ordered.status, 200);
            const stored = await prisma.hotelImage.findMany({
                where: { hotelId: fresh.id },
                orderBy: { sortOrder: 'asc' }
            });
            assert.deepEqual(stored.map((image) => image.id), reversed);
        });
    });
});
