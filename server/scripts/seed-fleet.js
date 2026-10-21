/**
 * Demo drivers and cars, for a dispatch board that would otherwise be empty.
 *
 *     node scripts/seed-fleet.js                 # 8 drivers, 9 cars, dispatches upcoming demo legs
 *     node scripts/seed-fleet.js --no-assign     # drivers and cars only
 *     node scripts/seed-fleet.js --password s3cret
 *     node scripts/seed-fleet.js --clear         # remove them again
 *     node scripts/seed-fleet.js --no-images     # skip the photographs
 *
 * Photographs are generated on the fly — a coloured card with the car's name
 * and plate, an initials avatar for a driver — and pushed through the real
 * media pipeline (`uploadFile`: sniffed, re-encoded, renditions written to
 * whichever storage driver is configured), then attached exactly as the
 * panel would attach them. So if the seed runs, the upload path runs too.
 *
 * Everything lands under a house provider (`iamgeorgia-fleet`), every login
 * ends `@demo.iamgeorgia.test` and every plate starts `DM-`, which is what
 * `--clear` matches on. Nothing here can collide with a real record.
 *
 * Idempotent: a driver is keyed on their login email, a car on its plate, so
 * re-running updates rather than duplicates. Assignments go through the real
 * dispatch service — locks, occupancy check, audit row and outbox event — so
 * if the seed runs, the dispatch path runs.
 */

import { prisma, connect, disconnect } from '../db/index.js';
import { hashPassword } from '../lib/password.js';
import { logger } from '../lib/logger.js';
import sharp from 'sharp';

import { fleetGallery, normalisePlate } from '../services/transfer/fleet.service.js';
import { uploadFile } from '../services/media/upload.service.js';
import { primaryRoleIdFor } from '../services/rbac/access.js';
import { assignDriver } from '../services/transfer/dispatch.service.js';

const DEMO_EMAIL_DOMAIN = '@demo.iamgeorgia.test';
const PLATE_PREFIX = 'DM-';
const HOUSE_PROVIDER = { slug: 'iamgeorgia-fleet', name: 'I am Georgia fleet' };
const DEFAULT_PASSWORD = 'driver-demo-password';

const arg = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : process.argv[index + 1];
};

const flag = (name) => process.argv.includes(`--${name}`);

/** Plates in the Georgian style, all under the demo prefix. */
const CARS = [
    { plate: 'DM-101-AA', make: 'Toyota', model: 'Corolla', year: 2021, colour: 'White', body: 'sedan', classSlug: 'economy-sedan-private-transfer', seats: 3, bags: 2, features: ['airConditioning'] },
    { plate: 'DM-102-AA', make: 'Hyundai', model: 'Elantra', year: 2022, colour: 'Silver', body: 'sedan', classSlug: 'economy-sedan-private-transfer', seats: 3, bags: 2, features: ['airConditioning', 'bottledWater'] },
    { plate: 'DM-201-BB', make: 'Toyota', model: 'Camry', year: 2023, colour: 'Black', body: 'sedan', classSlug: 'comfort-sedan-private-transfer', seats: 3, bags: 2, features: ['airConditioning', 'wifi', 'bottledWater', 'englishDriver'] },
    { plate: 'DM-202-BB', make: 'Skoda', model: 'Superb', year: 2022, colour: 'Grey', body: 'sedan', classSlug: 'comfort-sedan-private-transfer', seats: 3, bags: 3, features: ['airConditioning', 'wifi', 'childSeat'] },
    { plate: 'DM-301-CC', make: 'Mercedes-Benz', model: 'E-Class', year: 2024, colour: 'Black', body: 'sedan', classSlug: 'executive-sedan-private-transfer', seats: 3, bags: 3, features: ['airConditioning', 'wifi', 'bottledWater', 'meetGreet', 'englishDriver'] },
    { plate: 'DM-401-DD', make: 'Toyota', model: 'Land Cruiser Prado', year: 2022, colour: 'White', body: 'suv', classSlug: 'premium-suv-private-transfer', seats: 4, bags: 4, features: ['airConditioning', 'wifi', 'bottledWater'] },
    { plate: 'DM-501-EE', make: 'Mercedes-Benz', model: 'Vito', year: 2021, colour: 'Silver', body: 'minivan', classSlug: 'comfort-minivan-private-transfer', seats: 6, bags: 6, features: ['airConditioning', 'wifi', 'childSeat', 'wheelchairAccessible'] },
    { plate: 'DM-502-EE', make: 'Toyota', model: 'Alphard', year: 2023, colour: 'Black', body: 'minivan', classSlug: 'comfort-minivan-private-transfer', seats: 6, bags: 5, features: ['airConditioning', 'wifi', 'bottledWater', 'meetGreet'] },
    { plate: 'DM-601-FF', make: 'Mercedes-Benz', model: 'Sprinter', year: 2020, colour: 'White', body: 'van', classSlug: 'group-van-private-transfer', seats: 12, bags: 12, features: ['airConditioning', 'wifi'] }
];

/** Names from the region the operator drives in; one is mid-verification, one unchecked. */
const DRIVERS = [
    { firstName: 'Levan', lastName: 'Gogoladze', phone: '+995 555 10 11 12', languages: ['ka', 'en', 'ru'], years: 12, bio: 'Tbilisi born, driving airport runs since 2013. Ask me about the wine roads.', verification: 'VERIFIED', cars: ['DM-201-BB', 'DM-301-CC'] },
    { firstName: 'Tamar', lastName: 'Kvaratskhelia', phone: '+995 555 20 21 22', languages: ['ka', 'en'], years: 8, bio: 'Careful with luggage, patient with late flights.', verification: 'VERIFIED', cars: ['DM-202-BB'] },
    { firstName: 'Nika', lastName: 'Tsereteli', phone: '+995 577 30 31 32', languages: ['ka', 'ru', 'tr'], years: 15, bio: 'Kutaisi and the west of Georgia — Svaneti in any season.', verification: 'VERIFIED', cars: ['DM-401-DD', 'DM-501-EE'] },
    { firstName: 'Mariam', lastName: 'Japaridze', phone: '+995 599 40 41 42', languages: ['ka', 'en', 'he'], years: 6, bio: 'Hebrew-speaking; happy to plan a Shabbat-friendly route.', verification: 'VERIFIED', cars: ['DM-502-EE'] },
    { firstName: 'Dato', lastName: 'Chkheidze', phone: '+995 551 50 51 52', languages: ['ka', 'ru'], years: 20, bio: 'Coaches and group vans. Twenty years without a scratch.', verification: 'VERIFIED', cars: ['DM-601-FF', 'DM-501-EE'] },
    { firstName: 'Ana', lastName: 'Lomidze', phone: '+995 555 60 61 62', languages: ['ka', 'en', 'de'], years: 4, bio: 'Studied in Munich; Tbilisi city runs and day trips.', verification: 'VERIFIED', cars: ['DM-101-AA'] },
    { firstName: 'Giorgi', lastName: 'Mchedlishvili', phone: '+995 577 70 71 72', languages: ['ka', 'ru'], years: 3, bio: null, verification: 'PENDING', cars: ['DM-102-AA'] },
    { firstName: 'Salome', lastName: 'Kikvidze', phone: '+995 599 80 81 82', languages: ['ka', 'en', 'fr'], years: 9, bio: 'Batumi and the coast.', verification: 'UNVERIFIED', cars: [] }
];

// --- Photographs ---------------------------------------------------------------

const DEMO_ALT_PREFIX = 'Demo fleet: ';

/** Whoever the audit trail names for these uploads. */
const ACTOR = { id: null, email: 'scripts/seed-fleet.js' };

const PAINT = {
    White: ['#e9e4dc', '#1c2b27'],
    Silver: ['#b9bfc4', '#1c2b27'],
    Grey: ['#6f767b', '#ffffff'],
    Black: ['#23272b', '#ffffff']
};

const escapeXml = (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** A car "photograph": a coloured card with a simple silhouette, the name and the plate. */
const carImage = (car, view) => {
    const [background, ink] = PAINT[car.colour] ?? PAINT.Grey;
    const label = `${car.make} ${car.model}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="1200" height="800" fill="${background}"/>
  <rect x="0" y="560" width="1200" height="240" fill="${ink}" fill-opacity="0.08"/>
  <g fill="${ink}" fill-opacity="0.9">
    <rect x="270" y="360" width="660" height="150" rx="40"/>
    <path d="M370 360 L440 260 L760 260 L830 360 Z"/>
    <circle cx="420" cy="520" r="60"/>
    <circle cx="780" cy="520" r="60"/>
  </g>
  <circle cx="420" cy="520" r="26" fill="${background}"/>
  <circle cx="780" cy="520" r="26" fill="${background}"/>
  <text x="600" y="640" font-family="Helvetica, Arial, sans-serif" font-size="56" font-weight="700" text-anchor="middle" fill="${ink}">${escapeXml(label)}</text>
  <text x="600" y="705" font-family="Courier New, monospace" font-size="40" text-anchor="middle" fill="${ink}" fill-opacity="0.8">${escapeXml(car.plate)} · ${escapeXml(view)}</text>
</svg>`;

    return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
};

/** A driver "photograph": an initials avatar. */
const driverImage = (driver, index) => {
    const tones = [
        ['#1f6f5c', '#ffffff'],
        ['#b8632f', '#ffffff'],
        ['#3b5b8a', '#ffffff'],
        ['#7a4b8c', '#ffffff'],
        ['#8a6d3b', '#ffffff']
    ];
    const [background, ink] = tones[index % tones.length];
    const initials = `${driver.firstName[0]}${driver.lastName[0]}`.toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">
  <rect width="640" height="640" fill="${background}"/>
  <circle cx="320" cy="250" r="110" fill="${ink}" fill-opacity="0.9"/>
  <path d="M110 640 C110 480 220 420 320 420 C420 420 530 480 530 640 Z" fill="${ink}" fill-opacity="0.9"/>
  <text x="320" y="285" font-family="Helvetica, Arial, sans-serif" font-size="104" font-weight="700" text-anchor="middle" fill="${background}">${escapeXml(initials)}</text>
</svg>`;

    return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
};

const upload = (buffer, filename, category, altText) =>
    uploadFile(
        { buffer, originalFilename: filename, declaredMimeType: 'image/jpeg', category, altText: DEMO_ALT_PREFIX + altText },
        ACTOR
    );

const emailFor = (driver) =>
    `${driver.firstName}.${driver.lastName}`.toLowerCase().replace(/[^a-z.]/g, '') + DEMO_EMAIL_DOMAIN;

const seed = async () => {
    const password = arg('password', DEFAULT_PASSWORD);
    const passwordHash = await hashPassword(password);

    const provider = await prisma.transferProvider.upsert({
        where: { slug: HOUSE_PROVIDER.slug },
        create: { ...HOUSE_PROVIDER, verified: true, yearsActive: 6, status: 'ACTIVE' },
        update: { name: HOUSE_PROVIDER.name, status: 'ACTIVE' }
    });

    const classes = await prisma.transferVehicle.findMany({
        where: { slug: { in: [...new Set(CARS.map((car) => car.classSlug))] } },
        select: { id: true, slug: true }
    });
    const classBySlug = new Map(classes.map((row) => [row.slug, row.id]));

    const carByPlate = new Map();

    for (const car of CARS) {
        const vehicleClassId = classBySlug.get(car.classSlug);

        if (!vehicleClassId) {
            logger.warn({ plate: car.plate, classSlug: car.classSlug }, 'Vehicle class missing — run seed-transfers.js first; skipping car');
            continue;
        }

        const plateNormalized = normalisePlate(car.plate);
        const data = {
            providerId: provider.id,
            vehicleClassId,
            make: car.make,
            model: car.model,
            year: car.year,
            colour: car.colour,
            body: car.body,
            plateNumber: car.plate,
            plateNormalized,
            passengerCapacity: car.seats,
            luggageCapacity: car.bags,
            cabinBagCapacity: car.seats,
            features: car.features,
            description: `${car.colour} ${car.make} ${car.model}, ${car.year}.`,
            internalNotes: 'Demo car from scripts/seed-fleet.js',
            status: 'ACTIVE'
        };

        const existing = await prisma.transferFleetVehicle.findFirst({ where: { plateNormalized, status: { not: 'ARCHIVED' } } });
        const row = existing
            ? await prisma.transferFleetVehicle.update({ where: { id: existing.id }, data })
            : await prisma.transferFleetVehicle.create({ data });

        carByPlate.set(car.plate, row.id);

        if (!flag('no-images')) {
            const already = await prisma.transferFleetVehicleImage.count({ where: { fleetVehicleId: row.id } });

            if (already === 0) {
                for (const view of ['front', 'side']) {
                    const asset = await upload(
                        await carImage(car, view),
                        `${normalisePlate(car.plate).toLowerCase()}-${view}.jpg`,
                        'FLEET_IMAGE',
                        `${car.make} ${car.model} ${car.plate} (${view})`
                    );

                    // The first one becomes the cover, and the cover is the
                    // main image the partner and the passenger see.
                    await fleetGallery.attach(row.id, { fileAssetId: asset.id, caption: view }, ACTOR, null);
                }
            }
        }
    }

    const airport = await prisma.transferPoint.findFirst({ where: { slug: 'tbilisi-airport' }, select: { id: true } });
    const driverIds = [];

    for (const driver of DRIVERS) {
        const email = emailFor(driver);
        const verified = driver.verification === 'VERIFIED';

        const profileData = {
            providerId: provider.id,
            firstName: driver.firstName,
            lastName: driver.lastName,
            phone: driver.phone.replace(/\s/g, ''),
            email,
            languages: driver.languages,
            yearsExperience: driver.years,
            bio: driver.bio,
            licenceNumber: `GE-${driver.lastName.slice(0, 3).toUpperCase()}-${String(driver.years).padStart(2, '0')}4471`,
            licenceExpiresOn: new Date('2029-06-30T00:00:00Z'),
            internalNotes: 'Demo driver from scripts/seed-fleet.js',
            verificationStatus: driver.verification,
            verifiedAt: verified ? new Date() : null,
            isActive: true,
            homeBasePointId: airport?.id ?? null
        };

        const user = await prisma.user.upsert({
            where: { email },
            create: {
                email,
                primaryRoleId: await primaryRoleIdFor(prisma, 'DRIVER'),
                firstName: driver.firstName,
                lastName: driver.lastName,
                phone: profileData.phone,
                passwordHash,
                isActive: true
            },
            update: { passwordHash, isActive: true, firstName: driver.firstName, lastName: driver.lastName }
        });

        const existing = await prisma.transferDriver.findUnique({ where: { userId: user.id } });
        const profile = existing
            ? await prisma.transferDriver.update({ where: { id: existing.id }, data: profileData })
            : await prisma.transferDriver.create({ data: { ...profileData, userId: user.id } });

        if (!flag('no-images') && !profile.photoFileAssetId) {
            const asset = await upload(
                await driverImage(driver, DRIVERS.indexOf(driver)),
                `${email.split('@')[0].replace('.', '-')}.jpg`,
                'DRIVER_PHOTO',
                `${driver.firstName} ${driver.lastName}`
            );

            await prisma.transferDriver.update({ where: { id: profile.id }, data: { photoFileAssetId: asset.id } });
        }

        await prisma.transferDriverVehicle.deleteMany({ where: { driverId: profile.id } });

        const links = driver.cars.map((plate) => carByPlate.get(plate)).filter(Boolean);

        if (links.length > 0) {
            await prisma.transferDriverVehicle.createMany({
                data: links.map((fleetVehicleId, index) => ({ driverId: profile.id, fleetVehicleId, isPrimary: index === 0 }))
            });
        }

        driverIds.push({ id: profile.id, name: `${driver.firstName} ${driver.lastName}`, verified, primaryCar: links[0] ?? null, seats: driver.cars[0] ? CARS.find((car) => car.plate === driver.cars[0]).seats : 0 });
    }

    const photographs = await prisma.fileAsset.count({ where: { altText: { startsWith: DEMO_ALT_PREFIX }, deletedAt: null } });

    console.log(`Provider ${provider.name}: ${carByPlate.size} cars, ${driverIds.length} drivers, ${photographs} photographs.`);
    console.log(`Driver logins end ${DEMO_EMAIL_DOMAIN}, e.g. ${emailFor(DRIVERS[0])}`);
    console.log(`Password for every demo driver: ${password}`);

    if (flag('no-assign')) {
        return;
    }

    // Upcoming, undriven legs of the demo bookings, dispatched through the
    // real service by the first active admin, so the board has work on it.
    const admin = await prisma.user.findFirst({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: true } });

    if (!admin) {
        console.log('No admin account to dispatch as — skipping assignments (create one with scripts/create-admin.js).');
        return;
    }

    const legs = await prisma.transferBookingLeg.findMany({
        where: {
            status: 'UNASSIGNED',
            pickupAt: { gt: new Date() },
            booking: { status: 'CONFIRMED', source: 'DEMO' }
        },
        include: { booking: { select: { adults: true, children: true, luggage: true, reference: true } } },
        orderBy: { pickupAt: 'asc' },
        take: Number(arg('assign', 12))
    });

    const eligible = driverIds.filter((driver) => driver.verified && driver.primaryCar);
    let assigned = 0;
    let skipped = 0;

    for (const [index, leg] of legs.entries()) {
        const party = leg.booking.adults + leg.booking.children;
        const candidates = eligible.filter((driver) => driver.seats >= party);
        const driver = candidates[index % Math.max(1, candidates.length)];

        if (!driver) {
            skipped += 1;
            continue;
        }

        try {
            await assignDriver(
                leg.id,
                {
                    driverId: driver.id,
                    fleetVehicleId: driver.primaryCar,
                    // Every other one is left waiting for the driver's answer,
                    // so both halves of the driver panel have something in them.
                    acceptOnBehalf: index % 2 === 0,
                    overrideClassMismatch: true,
                    overrideVehicleLink: true,
                    overrideUnverified: false,
                    note: 'Seeded by scripts/seed-fleet.js'
                },
                admin,
                null
            );
            assigned += 1;
        } catch (err) {
            skipped += 1;
            logger.warn({ reference: leg.booking.reference, err: err.message }, 'Could not dispatch demo leg');
        }
    }

    console.log(`Dispatched ${assigned} upcoming demo legs (${skipped} skipped).`);
};

const clear = async () => {
    const drivers = await prisma.transferDriver.findMany({
        where: { user: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
        select: { id: true, userId: true }
    });
    const cars = await prisma.transferFleetVehicle.findMany({
        where: { plateNormalized: { startsWith: normalisePlate(PLATE_PREFIX) } },
        select: { id: true }
    });
    const driverIds = drivers.map((row) => row.id);
    const carIds = cars.map((row) => row.id);

    // Assignments hold their driver and car with Restrict; the legs they were
    // on go back to the board rather than being left pointing at nothing.
    const assignments = await prisma.transferAssignment.findMany({
        where: { OR: [{ driverId: { in: driverIds } }, { fleetVehicleId: { in: carIds } }] },
        select: { id: true, legId: true, status: true }
    });
    const liveLegIds = assignments.filter((row) => ['OFFERED', 'ACCEPTED'].includes(row.status)).map((row) => row.legId);

    await prisma.transferBookingLeg.updateMany({
        where: { id: { in: liveLegIds }, status: { in: ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'ON_BOARD'] } },
        data: { status: 'UNASSIGNED', statusChangedAt: new Date() }
    });
    await prisma.transferDriverRating.deleteMany({ where: { driverId: { in: driverIds } } });
    await prisma.transferAssignment.deleteMany({ where: { id: { in: assignments.map((row) => row.id) } } });
    await prisma.transferDriver.deleteMany({ where: { id: { in: driverIds } } });
    await prisma.transferFleetVehicle.deleteMany({ where: { id: { in: carIds } } });
    await prisma.notification.deleteMany({ where: { recipientUser: { email: { endsWith: DEMO_EMAIL_DOMAIN } } } });
    const users = await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN }, primaryRole: { key: 'DRIVER' } } });

    // The bytes stay in storage, as every soft delete leaves them; the rows
    // stop being listed. Nothing references them any more: the gallery rows
    // went with the cars and the driver photos went with the profiles.
    const photographs = await prisma.fileAsset.updateMany({
        where: { altText: { startsWith: DEMO_ALT_PREFIX }, deletedAt: null },
        data: { deletedAt: new Date() }
    });

    console.log(`Removed ${driverIds.length} drivers, ${users.count} logins, ${carIds.length} cars, ${assignments.length} assignments and ${photographs.count} photographs.`);
};

await connect();

try {
    if (flag('clear')) {
        await clear();
    } else {
        await seed();
    }
} finally {
    await disconnect();
}
