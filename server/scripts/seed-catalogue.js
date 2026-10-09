// `readFile` is no longer called directly — scripts/lib/client-images.js reads
// the local file now. The import stays so the original block in
// `uploadClientImage` (commented out below) can be restored as it was.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { publishHotel } from '../services/hotel/hotel.service.js';
import { uploadFile } from '../services/media/upload.service.js';
import { addDays, todayInTimezone, dateOnlyToUtc, weekdayOf } from '../lib/time.js';
import { ClientImageError, createClientImageSource } from './lib/client-images.js';
import { deleteFinanceForBookings } from './lib/finance-cleanup.js';

/**
 * Seeds the real catalogue from the client's editorial fixtures.
 *
 *   node scripts/seed-catalogue.js
 *
 * The prose in `db/seed/hotels.js` and `db/seed/destinations.js` is the
 * platform's actual content — nine Georgian properties and eight destinations,
 * written for this product. Both were client fixtures until the site started
 * reading the catalogue from the API; they moved here with the seed that loads
 * them, so the editorial source of truth lives beside the data model.
 *
 * What the fixtures cannot say, this file adds: the destination tree with real
 * coordinates, structured beds parsed from the prose bed lines, rate plans on
 * the platform policy templates, seasonal and weekend pricing, a year of
 * inventory, VAT, and images pushed through the real media pipeline into
 * object storage.
 *
 * Idempotent by slug: a destination or hotel that already exists is skipped,
 * so re-running after adding a fixture seeds only the new one. It never
 * deletes catalogue content — except `smoke-*` records, which were test
 * fixtures and are explicitly cleaned first.
 *
 * Prerequisite: `node scripts/seed-reference.js` (amenities, bed types, meal
 * plans, policy templates).
 *
 * Images: read from `client/public` when the monorepo is checked out, and
 * downloaded from APP_URL (the deployed client, same `/images/...` path) when
 * they are not on disk — which is the case inside the API's Docker image on
 * Render. See scripts/lib/client-images.js.
 */

const CLIENT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'client');

/**
 * Local-file-first, APP_URL-second source for catalogue images.
 *
 * APP_URL is taken from the project config, but only when it is actually set:
 * `config.appUrl` falls back to CLIENT_ORIGIN / localhost, and downloading from
 * a guessed address would hide the misconfiguration instead of reporting it.
 */
const clientImages = createClientImageSource({
    publicDir: join(CLIENT, 'public'),
    appUrl: process.env.APP_URL ? config.appUrl : undefined,
    maxBytes: config.media.maxImageBytes
});

/** Images that could not be obtained this run; reported, and fail the run, at the end. */
const imageFailures = [];

// The system actor: audit rows record 'system' when actor is null.
const ACTOR = null;

/** GEL per USD. Fixture prices are USD-denominated; the hotels contract in GEL. */
const GEL_PER_USD = 2.7;

/** How far ahead inventory and rates are written. */
const HORIZON_DAYS = 400;

/**
 * The destination tree the flat fixtures become.
 *
 * All eight sit directly under Georgia — honest for a single-country platform,
 * and the materialised path keeps "everything in Georgia" one prefix match.
 * Coordinates are the real places; the geo trigger derives the PostGIS point.
 */
const DESTINATION_META = {
    tbilisi: { type: 'CITY', latitude: 41.7151, longitude: 44.8271 },
    kazbegi: { type: 'CITY', latitude: 42.6577, longitude: 44.6431 },
    svaneti: { type: 'REGION', latitude: 43.0439, longitude: 42.7297 },
    kakheti: { type: 'REGION', latitude: 41.9198, longitude: 45.4731 },
    batumi: { type: 'CITY', latitude: 41.6168, longitude: 41.6367 },
    mtskheta: { type: 'CITY', latitude: 41.8455, longitude: 44.7185 },
    borjomi: { type: 'RESORT', latitude: 41.8389, longitude: 43.38 },
    gudauri: { type: 'RESORT', latitude: 42.4778, longitude: 44.4784 }
};

/**
 * Seasonality, as month-day windows and a multiplier.
 *
 * `wraps` marks a window that crosses new year (ski season). These become rate
 * rows, not rules — seasonal pricing is just rows with different values.
 */
const SEASONS = {
    'gudauri-alpine-hotel': { from: '1215', to: '0315', factor: 1.35, wraps: true },
    'kazbegi-ridge-lodge': { from: '0601', to: '0930', factor: 1.25 },
    'mestia-tower-lodge': { from: '0615', to: '0930', factor: 1.25 },
    'batumi-marine-hotel': { from: '0615', to: '0915', factor: 1.35 },
    'alazani-vineyard-retreat': { from: '0901', to: '1031', factor: 1.2 },
    'borjomi-forest-spa': { from: '0701', to: '0831', factor: 1.15 }
};

/** Hotels that plausibly serve dinner get a half-board offer on top. */
const HALF_BOARD_HOTELS = new Set([
    'alazani-vineyard-retreat',
    'borjomi-forest-spa',
    'gudauri-alpine-hotel',
    'kazbegi-ridge-lodge',
    'mestia-tower-lodge'
]);

/** Units on sale per room type, largest room count first. */
const UNITS_BY_POSITION = [6, 4, 3, 2, 2];

/**
 * "1 king bed + 2 singles" → structured rows the bed vocabulary understands.
 *
 * The whole point of parsing rather than storing the string: capacity becomes
 * arithmetic, and the occupancy resolver can reason about it.
 */
const BED_WORDS = {
    single: 'SINGLE',
    singles: 'SINGLE',
    twin: 'TWIN',
    twins: 'TWIN',
    double: 'DOUBLE',
    queen: 'QUEEN',
    king: 'KING',
    sofa: 'SOFA',
    bunk: 'BUNK',
    bunks: 'BUNK',
    futon: 'FUTON'
};

const parseBeds = (text) =>
    text
        .toLowerCase()
        .split('+')
        .map((part) => {
            const quantity = Number.parseInt(part.trim(), 10) || 1;
            const word = Object.keys(BED_WORDS).find((candidate) => part.includes(candidate));

            return word ? { code: BED_WORDS[word], quantity } : null;
        })
        .filter(Boolean);

const usdToGelCents = (usd) => Math.round((usd * GEL_PER_USD * 100) / 500) * 500;

/** "October 2025" → a Date. Reviews carry display strings in the fixtures. */
const parseReviewDate = (text) => {
    const parsed = new Date(text);

    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

// --- media -------------------------------------------------------------------

/**
 * Uploads one client image through the real pipeline, once.
 *
 * Deduped by path: several hotels share gallery photographs, and the same
 * FileAsset can hang in many galleries. A missing file is skipped with a note
 * rather than failing the seed — the prose matters more than one photograph.
 */
const assetCache = new Map();

const uploadClientImage = async (publicPath, altText) => {
    if (assetCache.has(publicPath)) {
        return assetCache.get(publicPath);
    }

    // --- ORIGINAL: local file only --------------------------------------------
    // Disabled in favour of the local-then-APP_URL source below. To go back to
    // the old behaviour (a file missing on disk is skipped, never downloaded),
    // uncomment this block and delete the "NEW" block that follows it.
    //
    // let buffer;
    //
    // try {
    //     buffer = await readFile(join(CLIENT, 'public', publicPath));
    // } catch {
    //     console.log(`    (missing on disk, skipped: ${publicPath})`);
    //     assetCache.set(publicPath, null);
    //     return null;
    // }
    // --- END ORIGINAL ---------------------------------------------------------

    // --- NEW: local file first, then APP_URL ---------------------------------
    // Same Buffer either way, handed to the same uploadFile call below. A
    // download that fails is skipped like a missing file used to be, but it is
    // also recorded, and the run exits non-zero once every hotel is done.
    let buffer;
    let source;

    try {
        const loaded = await clientImages.load(publicPath);
        buffer = loaded.buffer;
        source = loaded;

        if (loaded.source === 'remote') {
            console.log(`    (not on disk, downloaded: ${loaded.location})`);
        }
    } catch (err) {
        if (!(err instanceof ClientImageError)) throw err;

        console.log(`    (image unavailable, skipped: ${err.message})`);
        imageFailures.push(err);
        assetCache.set(publicPath, null);
        return null;
    }
    // --- END NEW --------------------------------------------------------------

    const category = publicPath.includes('/rooms/') ? 'ROOM_IMAGE' : 'HOTEL_IMAGE';

    let asset;

    try {
        asset = await uploadFile(
            {
                buffer,
                originalFilename: publicPath.split('/').pop(),
                declaredMimeType: 'image/jpeg',
                category,
                altText
            },
            ACTOR
        );
    } catch (err) {
        // Still fatal, as before — storage that refuses one image refuses them
        // all. The message now says which image, from where, into which driver.
        throw new Error(
            `Could not store image ${publicPath} (read from ${source.location}) ` +
                `in media storage (driver: ${config.media.driver}): ${err.message}`,
            { cause: err }
        );
    }

    assetCache.set(publicPath, asset);
    return asset;
};

/** Where a gallery image belongs on the hotel, guessed from its folder. */
const imageCategory = (publicPath) => {
    if (publicPath.includes('/rooms/')) return 'Room';
    if (publicPath.includes('/culture/') || publicPath.includes('/destinations/')) return 'View';
    if (publicPath.includes('/experiences/')) return 'Facilities';
    return 'Exterior';
};

// --- cleanup -----------------------------------------------------------------

/**
 * Removes the smoke-test fixtures the panel currently shows.
 *
 * Bookings first (the hotel FK is Restrict, which is the whole point of it),
 * then the hotel, then the destinations deepest-first. Audit rows are left
 * alone: the trail outliving the record is by design, smoke test or not.
 */
const removeSmokeData = async () => {
    const smokeHotels = await prisma.hotel.findMany({
        where: { slug: { startsWith: 'smoke-' } },
        select: { id: true, slug: true }
    });

    for (const hotel of smokeHotels) {
        const bookings = await prisma.hotelBooking.findMany({
            where: { hotelId: hotel.id },
            select: { id: true, reference: true }
        });

        if (bookings.length > 0) {
            const ids = bookings.map((booking) => booking.id);
            await prisma.bookingHold.updateMany({
                where: { bookingId: { in: ids } },
                data: { bookingId: null }
            });
            await deleteFinanceForBookings(prisma, { hotelBooking: { id: { in: ids } } });
            await prisma.hotelBooking.deleteMany({ where: { id: { in: ids } } });
            console.log(`  removed ${bookings.length} booking(s): ${bookings.map((b) => b.reference).join(', ')}`);
        }

        await prisma.hotel.delete({ where: { id: hotel.id } });
        console.log(`  removed hotel ${hotel.slug}`);
    }

    // Holds against the smoke rooms went with the hotel: BookingHold cascades
    // from RoomType, and the inventory rows those holds counted against died in
    // the same cascade — so no counter is left stranded. Holds on *other*
    // hotels are deliberately not touched here; deleting a hold row without
    // moving its held_units back is exactly the drift the reconciler exists to
    // catch, and a seed script must not create it.

    const smokeDestinations = await prisma.destination.findMany({
        where: { slug: { startsWith: 'smoke-' } },
        orderBy: { path: 'desc' }
    });

    for (const destination of smokeDestinations) {
        await prisma.destination.delete({ where: { id: destination.id } });
        console.log(`  removed destination ${destination.slug}`);
    }

    if (smokeHotels.length === 0 && smokeDestinations.length === 0) {
        console.log('  nothing to remove');
    }
};

// --- destinations ------------------------------------------------------------

const seedDestinations = async (fixtures) => {
    let georgia = await prisma.destination.findUnique({ where: { slug: 'georgia' } });

    if (!georgia) {
        georgia = await prisma.destination.create({
            data: {
                slug: 'georgia',
                name: 'Georgia',
                type: 'COUNTRY',
                path: '/georgia',
                countryCode: 'GE',
                timezone: 'Asia/Tbilisi',
                latitude: 42.3154,
                longitude: 43.3569,
                tagline: 'The country at the crossroads of Europe and Asia',
                summary:
                    'Mountains, vineyards, sulphur baths and a supra table that never quite ends.',
                featured: true
            }
        });
        console.log('  created georgia');
    }

    const bySlug = { georgia };

    for (const fixture of fixtures) {
        const existing = await prisma.destination.findUnique({ where: { slug: fixture.slug } });

        if (existing) {
            bySlug[fixture.slug] = existing;
            console.log(`  exists ${fixture.slug}`);
            continue;
        }

        const meta = DESTINATION_META[fixture.slug] ?? { type: 'CITY' };

        bySlug[fixture.slug] = await prisma.destination.create({
            data: {
                slug: fixture.slug,
                name: fixture.name,
                type: meta.type,
                parentId: georgia.id,
                path: `/georgia/${fixture.slug}`,
                countryCode: 'GE',
                timezone: 'Asia/Tbilisi',
                latitude: meta.latitude,
                longitude: meta.longitude,
                tagline: fixture.tagline,
                summary: fixture.summary,
                description: fixture.description,
                heroImage: fixture.heroImage,
                coverImage: fixture.coverImage,
                gallery: fixture.gallery,
                idealFor: fixture.idealFor,
                attractions: fixture.attractions,
                travelInfo: fixture.travelInfo,
                featured: fixture.featured
            }
        });
        console.log(`  created ${fixture.slug}`);
    }

    return bySlug;
};

// --- hotels ------------------------------------------------------------------

const seedHotel = async (fixture, destination, templates) => {
    const existing = await prisma.hotel.findUnique({ where: { slug: fixture.slug } });

    if (existing) {
        console.log(`  exists ${fixture.slug}`);
        return;
    }

    console.log(`  ${fixture.name}`);

    // Small deterministic offset so nine hotels do not share one map pin.
    const jitter = (fixture.slug.length % 7) * 0.0011;

    const hotel = await prisma.hotel.create({
        data: {
            slug: fixture.slug,
            name: fixture.name,
            propertyType: fixture.propertyType,
            status: 'DRAFT',
            // Everything starts B2B-only — the whole catalogue is for
            // partners, and a property reaches the public site only when an
            // admin switches it on for B2C from the panel.
            b2cEnabled: false,
            destinationId: destination.id,
            countryCode: 'GE',
            timezone: 'Asia/Tbilisi',
            currency: 'GEL',
            address: fixture.address,
            latitude: destination.latitude + jitter,
            longitude: destination.longitude - jitter,
            starRating: fixture.starRating,
            guestScore: fixture.guestScore,
            reviewCount: fixture.reviewCount,
            shortDescription: fixture.summary,
            summary: fixture.summary,
            description: fixture.description,
            categoryScores: fixture.categoryScores,
            policies: fixture.policies,
            nearby: fixture.nearby ?? [],
            featured: fixture.featured,
            // Wall-clock times, read loosely from the prose policies.
            checkInFrom: fixture.policies.checkIn?.match(/\d{2}:\d{2}/)?.[0] ?? '14:00',
            checkInUntil: '23:00',
            checkOutFrom: '07:00',
            checkOutUntil: fixture.policies.checkOut?.match(/\d{2}:\d{2}/)?.[0] ?? '12:00'
        }
    });

    // Amenities: fixture codes match the seeded vocabulary one for one.
    const amenities = await prisma.amenity.findMany({
        where: { code: { in: fixture.amenities } },
        select: { id: true }
    });
    await prisma.hotelAmenity.createMany({
        data: amenities.map(({ id }) => ({ hotelId: hotel.id, amenityId: id }))
    });

    // Georgian VAT: 18%, always included in the displayed price.
    await prisma.hotelTaxFee.create({
        data: {
            hotelId: hotel.id,
            name: 'VAT',
            basis: 'PERCENT',
            value: 1800,
            currency: 'GEL',
            includedInRate: true
        }
    });

    // Gallery, through the real media pipeline. First image is the cover.
    let sortOrder = 0;
    for (const image of fixture.gallery) {
        const asset = await uploadClientImage(image.src, image.alt);

        if (!asset) continue;

        await prisma.hotelImage.create({
            data: {
                hotelId: hotel.id,
                fileAssetId: asset.id,
                category: imageCategory(image.src),
                caption: image.alt,
                sortOrder,
                isCover: sortOrder === 0
            }
        });
        sortOrder += 1;
    }

    // Reviews: real prose, display dates parsed to the first of the month.
    await prisma.review.createMany({
        data: fixture.reviews.map((review) => ({
            hotelId: hotel.id,
            author: review.author,
            country: review.country,
            date: parseReviewDate(review.date),
            score: review.score,
            title: review.title,
            body: review.body,
            tripType: review.tripType
        }))
    });

    const season = SEASONS[fixture.slug] ?? null;
    const today = todayInTimezone('Asia/Tbilisi');
    let cheapestNightCents = Number.POSITIVE_INFINITY;

    for (const [index, room] of fixture.rooms.entries()) {
        const beds = parseBeds(room.bedConfiguration);
        const hasSofa = beds.some((bed) => bed.code === 'SOFA');
        const baseCents = usdToGelCents(room.pricePerNight);
        cheapestNightCents = Math.min(cheapestNightCents, baseCents);

        const roomType = await prisma.roomType.create({
            data: {
                hotelId: hotel.id,
                code: room.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                name: room.name,
                description: room.amenities.join(' · '),
                roomSizeSqm: room.sizeSqm,
                maxOccupancy: room.maxGuests,
                maxAdults: room.maxGuests,
                maxChildren: Math.max(0, room.maxGuests - 1),
                minAdults: 1,
                standardOccupancy: Math.min(2, room.maxGuests),
                extraBedCapacity: hasSofa ? 1 : 0,
                sortOrder: index
            }
        });

        const bedTypes = await prisma.bedType.findMany({
            where: { code: { in: beds.map((bed) => bed.code) } }
        });
        const bedIdByCode = new Map(bedTypes.map((bed) => [bed.code, bed.id]));
        await prisma.roomBed.createMany({
            data: beds.map((bed) => ({
                roomTypeId: roomType.id,
                bedTypeId: bedIdByCode.get(bed.code),
                quantity: bed.quantity,
                groupIndex: 0
            }))
        });

        // The room's own photograph, as its cover.
        const roomAsset = await uploadClientImage(room.image, `${fixture.name} — ${room.name}`);
        if (roomAsset) {
            await prisma.roomTypeImage.create({
                data: { roomTypeId: roomType.id, fileAssetId: roomAsset.id, isCover: true }
            });
        }

        // The offers. One room, several plans — never several rooms.
        const board = room.breakfastIncluded ? 'BB' : 'RO';
        const plans = [
            { code: 'flex', name: `${board === 'BB' ? 'Breakfast' : 'Room only'} · flexible`, board, policy: templates.flexible, priceFactor: 1 },
            { code: 'nonref', name: `${board === 'BB' ? 'Breakfast' : 'Room only'} · non-refundable`, board, policy: templates.nonRefundable, priceFactor: 0.88 }
        ];

        if (HALF_BOARD_HOTELS.has(fixture.slug)) {
            plans.push({ code: 'hb-flex', name: 'Half board · flexible', board: 'HB', policy: templates.flexible, priceFactor: 1.25 });
        }

        for (const [planIndex, plan] of plans.entries()) {
            const ratePlan = await prisma.ratePlan.create({
                data: {
                    roomTypeId: roomType.id,
                    code: plan.code,
                    name: plan.name,
                    mealPlanId: templates.mealPlans.get(plan.board),
                    cancellationPolicyId: plan.policy,
                    paymentPolicyId: templates.payNow,
                    currency: 'GEL',
                    baseOccupancy: Math.min(2, room.maxGuests),
                    sortOrder: planIndex
                }
            });

            // A year of nightly rates: weekends up 15%, the season on top.
            const rows = [];

            for (let day = 0; day < HORIZON_DAYS; day += 1) {
                const date = addDays(today, day);
                const monthDay = date.slice(5, 7) + date.slice(8, 10);
                const weekend = [5, 6].includes(weekdayOf(date));
                const inSeason = season
                    ? season.wraps
                        ? monthDay >= season.from || monthDay <= season.to
                        : monthDay >= season.from && monthDay <= season.to
                    : false;

                const net =
                    Math.round(
                        (baseCents * plan.priceFactor * (weekend ? 1.15 : 1) * (inSeason ? season.factor : 1)) / 100
                    ) * 100;

                rows.push({
                    ratePlanId: ratePlan.id,
                    date: dateOnlyToUtc(date),
                    currency: 'GEL',
                    netCents: net,
                    singleOccupancyCents: room.maxGuests >= 2 ? Math.round((net * 0.85) / 100) * 100 : null,
                    extraAdultCents: Math.round((net * 0.25) / 100) * 100,
                    extraChildCents: Math.round((net * 0.125) / 100) * 100
                });
            }

            await prisma.rate.createMany({ data: rows });
        }

        // Inventory: one row per night, sized by how prominent the room is.
        const totalUnits = UNITS_BY_POSITION[Math.min(index, UNITS_BY_POSITION.length - 1)];
        await prisma.roomInventory.createMany({
            data: Array.from({ length: HORIZON_DAYS }, (unused, day) => ({
                roomTypeId: roomType.id,
                date: dateOnlyToUtc(addDays(today, day)),
                totalUnits
            }))
        });
    }

    // The un-dated browse price, from the cheapest nightly net.
    await prisma.hotel.update({
        where: { id: hotel.id },
        data: { priceFromCents: cheapestNightCents, priceFromCurrency: 'GEL' }
    });

    // Publish through the real service, so the checklist proves the seed made
    // a property that is genuinely sellable — not just rows that look right.
    // A failure names its hotel and leaves it DRAFT rather than killing the
    // run; the checklist in the error says exactly what the fixture lacked.
    try {
        await publishHotel(hotel.id, ACTOR);
        console.log(`    published, from ${cheapestNightCents / 100} GEL/night`);
    } catch (err) {
        console.log(`    LEFT AS DRAFT: ${err.message}`);
        if (err.details?.missing) {
            for (const item of err.details.missing) console.log(`      - ${item.message}`);
        }
    }
};

// --- run ---------------------------------------------------------------------

const run = async () => {
    const [{ hotels }, { destinations }] = await Promise.all([
        import('../db/seed/hotels.js'),
        import('../db/seed/destinations.js')
    ]);

    const [flexible, nonRefundable, payNow, mealPlanRows] = await Promise.all([
        prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'FLEXIBLE' } }),
        prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'NON_REFUNDABLE' } }),
        prisma.paymentPolicy.findFirst({ where: { hotelId: null, timing: 'PAY_NOW' } }),
        prisma.mealPlan.findMany({ where: { code: { in: ['RO', 'BB', 'HB'] } } })
    ]);

    if (!flexible || !nonRefundable || !payNow || mealPlanRows.length < 3) {
        throw new Error('Reference data is missing — run `node scripts/seed-reference.js` first.');
    }

    const templates = {
        flexible: flexible.id,
        nonRefundable: nonRefundable.id,
        payNow: payNow.id,
        mealPlans: new Map(mealPlanRows.map((plan) => [plan.code, plan.id]))
    };

    // Before anything is written: every image a new hotel needs must be either
    // on disk or downloadable from a usable APP_URL. Failing here leaves the
    // database untouched instead of half a hotel that a re-run would skip.
    const existingHotelSlugs = new Set(
        (
            await prisma.hotel.findMany({
                where: { slug: { in: hotels.map((fixture) => fixture.slug) } },
                select: { slug: true }
            })
        ).map((row) => row.slug)
    );
    const pendingImagePaths = hotels
        .filter((fixture) => !existingHotelSlugs.has(fixture.slug))
        .flatMap((fixture) => [...fixture.gallery.map((image) => image.src), ...fixture.rooms.map((room) => room.image)]);
    const imagePlan = await clientImages.preflight(pendingImagePaths);

    console.log(
        `Images for new hotels: ${imagePlan.local} on disk, ${imagePlan.remote} to download` +
            (imagePlan.remote > 0 ? ` from ${new URL(config.appUrl).origin}` : '')
    );

    console.log('Removing smoke-test data');
    await removeSmokeData();

    console.log('\nDestinations');
    const destinationBySlug = await seedDestinations(destinations);

    console.log('\nHotels');
    for (const fixture of hotels) {
        const destination = destinationBySlug[fixture.destinationSlug];

        if (!destination) {
            console.log(`  skipped ${fixture.slug}: no destination ${fixture.destinationSlug}`);
            continue;
        }

        await seedHotel(fixture, destination, templates);
    }

    const [hotelCount, roomCount, planCount, rateCount, inventoryCount] = await Promise.all([
        prisma.hotel.count({ where: { status: 'ACTIVE' } }),
        prisma.roomType.count(),
        prisma.ratePlan.count(),
        prisma.rate.count(),
        prisma.roomInventory.count()
    ]);

    console.log(
        `\nCatalogue: ${hotelCount} hotels on sale, ${roomCount} room types, ` +
            `${planCount} rate plans, ${rateCount.toLocaleString()} rates, ` +
            `${inventoryCount.toLocaleString()} inventory nights.`
    );

    if (imageFailures.length > 0) {
        console.error(`\n${imageFailures.length} image(s) could not be obtained:`);
        for (const err of imageFailures) console.error(`  - ${err.message}`);
        console.error(
            '\nThe hotels above were created without those images (a hotel with none is left as DRAFT). ' +
                'Fix the cause, then run `node scripts/clear-hotels.js` and this seed again — ' +
                'a re-run on its own skips hotels that already exist.'
        );
        process.exitCode = 1;
    }
};

run()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(disconnect);
