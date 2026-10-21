/**
 * Demo transfer bookings, for a panel that would otherwise be an empty table.
 *
 *     node scripts/seed-transfer-bookings.js          # 24 bookings
 *     node scripts/seed-transfer-bookings.js --count 60
 *     node scripts/seed-transfer-bookings.js --clear  # remove them again
 *
 * Every booking goes through the **real quote and confirmation path** rather
 * than being inserted directly. That is the whole point of the script: a row
 * written by hand would have a plausible-looking total and a made-up
 * cancellation schedule, and would prove nothing about whether the system
 * works. These are priced by the pricing engine, signed with a real quote
 * token, and confirmed through `confirmTransferBooking` — so if the seed runs,
 * the booking path runs.
 *
 * Every record is marked `source: 'demo'` and every passenger email ends
 * `@demo.iamgeorgia.test`, which is what `--clear` matches on. Nothing here can
 * collide with a real booking, and nothing real can be deleted by the cleanup.
 */

import { prisma, connect, disconnect } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { deleteFinanceForBookings } from './lib/finance-cleanup.js';
import { quotesForJourney } from '../services/transfer/quote.service.js';
import { confirmTransferBooking } from '../services/transfer/booking.service.js';

const DEMO_SOURCE = 'DEMO';
const DEMO_EMAIL_DOMAIN = '@demo.iamgeorgia.test';

/**
 * Names drawn from the countries the operator actually sells to, so the panel
 * reads like a real week rather than like Lorem Ipsum.
 */
const PASSENGERS = [
    { firstName: 'Ana', lastName: 'Beridze', phone: '+995 555 10 22 41' },
    { firstName: 'Giorgi', lastName: 'Kapanadze', phone: '+995 577 41 09 18' },
    { firstName: 'Nino', lastName: 'Tsiklauri', phone: '+995 599 63 77 05' },
    { firstName: 'Lasha', lastName: 'Gelashvili', phone: '+995 591 28 14 62' },
    { firstName: 'Sarah', lastName: 'Whitfield', phone: '+44 7700 900 118' },
    { firstName: 'James', lastName: 'O’Connor', phone: '+353 86 123 4567' },
    { firstName: 'Marta', lastName: 'Kowalska', phone: '+48 512 334 907' },
    { firstName: 'Elias', lastName: 'Haddad', phone: '+972 54 812 3390' },
    { firstName: 'Yulia', lastName: 'Sokolova', phone: '+7 916 442 18 05' },
    { firstName: 'Dmitri', lastName: 'Volkov', phone: '+7 903 771 26 14' },
    { firstName: 'Aylin', lastName: 'Demir', phone: '+90 532 447 11 90' },
    { firstName: 'Mehmet', lastName: 'Yıldız', phone: '+90 545 220 76 33' },
    { firstName: 'Sophie', lastName: 'Lambert', phone: '+33 6 12 88 40 71' },
    { firstName: 'Andreas', lastName: 'Richter', phone: '+49 151 2233 8890' },
    { firstName: 'Priya', lastName: 'Raman', phone: '+91 98200 41772' },
    { firstName: 'Noa', lastName: 'Shapiro', phone: '+972 52 663 4418' }
];

/**
 * The journeys, weighted the way real demand is: airport runs dominate, the
 * mountain routes cluster in ski season, and the long cross-country drives are
 * rare but valuable. A uniform spread across 396 routes would make the panel
 * look like a random-number generator, which is exactly what it must not do.
 */
const JOURNEYS = [
    { from: 'tbilisi-airport', to: 'tbilisi', weight: 10, flight: true },
    { from: 'tbilisi-airport', to: 'gudauri', weight: 7, flight: true },
    { from: 'tbilisi-airport', to: 'kazbegi', weight: 4, flight: true },
    { from: 'tbilisi', to: 'tbilisi-airport', weight: 6 },
    { from: 'kutaisi-airport', to: 'batumi', weight: 7, flight: true },
    { from: 'kutaisi-airport', to: 'kutaisi', weight: 5, flight: true },
    { from: 'kutaisi-airport', to: 'mestia', weight: 3, flight: true },
    { from: 'batumi-airport', to: 'batumi', weight: 6, flight: true },
    { from: 'batumi-airport', to: 'kobuleti', weight: 3, flight: true },
    { from: 'tbilisi', to: 'sighnaghi', weight: 4 },
    { from: 'tbilisi', to: 'telavi', weight: 3 },
    { from: 'tbilisi', to: 'bakuriani', weight: 3 },
    { from: 'tbilisi', to: 'batumi', weight: 2 },
    { from: 'batumi', to: 'mestia', weight: 2 },
    { from: 'mestia', to: 'ushguli', weight: 2 }
];

/** Extras, as often as travellers actually ask for them. */
const EXTRA_ODDS = [
    { code: 'childSeat', chance: 0.18 },
    { code: 'meetGreet', chance: 0.12 },
    { code: 'skiEquipment', chance: 0.1 },
    { code: 'extraStop', chance: 0.08 }
];

const arg = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : process.argv[index + 1];
};

/**
 * A deterministic generator.
 *
 * Seeded so two runs on two machines produce the same demo data — a screenshot
 * in a bug report should describe the same booking the reader has in front of
 * them. `Math.random()` would make every run a different dataset.
 */
const makeRandom = (seed) => {
    let state = seed >>> 0;

    return () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
    };
};

const random = makeRandom(20_260_824);

const pick = (list) => list[Math.floor(random() * list.length)];

const pickJourney = () => {
    const total = JOURNEYS.reduce((sum, journey) => sum + journey.weight, 0);
    let roll = random() * total;

    for (const journey of JOURNEYS) {
        roll -= journey.weight;
        if (roll <= 0) return journey;
    }

    return JOURNEYS[0];
};

const pad = (value) => String(value).padStart(2, '0');

const dateOnly = (daysFromNow) => {
    const date = new Date(Date.now() + daysFromNow * 86_400_000);

    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** Pick-ups cluster around the times flights actually land. */
const pickTime = () => {
    const hours = [6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 21, 23];
    const minutes = [0, 15, 30, 45];

    return `${pad(pick(hours))}:${pad(pick(minutes))}`;
};

const clear = async () => {
    const bookings = await prisma.transferBooking.findMany({
        where: { source: DEMO_SOURCE, leadPassengerEmail: { endsWith: DEMO_EMAIL_DOMAIN } },
        select: { id: true }
    });

    if (bookings.length === 0) {
        logger.info('No demo transfer bookings to remove');
        return;
    }

    const ids = bookings.map(({ id }) => id);

    // Legs and extras cascade; audit rows deliberately do not, so they go by
    // hand — the same asymmetry the test tracker deals with.
    await deleteFinanceForBookings(prisma, { transferBooking: { id: { in: ids } } });
    await prisma.transferBooking.deleteMany({ where: { id: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });

    logger.info(`Removed ${ids.length} demo transfer bookings`);
};

const seed = async (count) => {
    const existing = await prisma.transferBooking.count({
        where: { source: DEMO_SOURCE, leadPassengerEmail: { endsWith: DEMO_EMAIL_DOMAIN } }
    });

    if (existing > 0) {
        logger.warn(
            `${existing} demo bookings already exist. Run with --clear first if you want a fresh set.`
        );
    }

    let made = 0;
    let cancelled = 0;
    let skipped = 0;

    for (let index = 0; index < count; index += 1) {
        const journey = pickJourney();
        const passenger = pick(PASSENGERS);

        // Two thirds ahead, a third behind: a panel that only shows future
        // bookings cannot demonstrate a completed one, and an operator's screen
        // is mostly history.
        const daysOut = random() < 0.66
            ? 3 + Math.floor(random() * 90)
            : -(2 + Math.floor(random() * 60));

        const adults = 1 + Math.floor(random() * 4);
        const children = random() < 0.25 ? 1 + Math.floor(random() * 2) : 0;
        const tripType = random() < 0.22 ? 'RETURN' : 'ONE_WAY';

        const date = dateOnly(daysOut);
        const extras = EXTRA_ODDS.filter((entry) => random() < entry.chance).map((entry) => ({
            code: entry.code,
            quantity: 1
        }));

        const query = {
            from: journey.from,
            to: journey.to,
            date,
            time: pickTime(),
            tripType,
            returnDate: tripType === 'RETURN' ? dateOnly(daysOut + 2 + Math.floor(random() * 6)) : null,
            returnTime: tripType === 'RETURN' ? pickTime() : null,
            adults,
            children,
            childAges: Array.from({ length: children }, () => 2 + Math.floor(random() * 9)),
            luggage: adults,
            cabinBags: Math.floor(random() * 2),
            extras
        };

        let offer;

        try {
            // A booking in the past cannot be quoted — the minimum-notice check
            // refuses it, correctly. Historic demo bookings are therefore
            // priced as if they were made in advance and back-dated afterwards.
            const quoteQuery =
                daysOut < 0 ? { ...query, date: dateOnly(30), returnDate: null, tripType: 'ONE_WAY' } : query;

            const result = await quotesForJourney(quoteQuery, null);

            offer = result.offers[Math.floor(random() * result.offers.length)];
        } catch (err) {
            // A road closed for those dates, or a party no vehicle fits. Both
            // are correct refusals; the seed just moves on.
            skipped += 1;
            continue;
        }

        if (!offer) {
            skipped += 1;
            continue;
        }

        const email = `${passenger.firstName}.${passenger.lastName}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/[^a-z.]/g, '')
            .concat(`.${index}`, DEMO_EMAIL_DOMAIN);

        const { booking } = await confirmTransferBooking(
            {
                quoteToken: offer.token,
                leadPassenger: { ...passenger, email },
                ...(journey.flight
                    ? { flightNumber: pick(['TK378', 'PC722', 'W64351', 'FZ1727', 'A9642', 'SU1876']) }
                    : {}),
                ...(random() < 0.3
                    ? { pickupAddress: pick(['Hotel reception', 'Terminal 1, arrivals', 'Rustaveli Ave 12']) }
                    : {}),
                ...(random() < 0.15 ? { specialRequests: 'Travelling with a folding wheelchair.' } : {}),
                source: DEMO_SOURCE,
                idempotencyKey: `demo-${index}-${journey.from}-${journey.to}-${date}`
            },
            null,
            null
        );

        made += 1;

        // Back-date the historic ones, and complete or cancel a realistic slice.
        const patch = {};

        if (daysOut < 0) {
            const pickupAt = new Date(`${date}T${query.time}:00Z`);

            patch.pickupAt = pickupAt;
            patch.createdAt = new Date(pickupAt.getTime() - 14 * 86_400_000);
            patch.status = random() < 0.12 ? 'CANCELLED' : 'COMPLETED';
        } else if (random() < 0.08) {
            patch.status = 'CANCELLED';
            patch.cancelledAt = new Date();
            patch.cancellationChargeCents = 0;
            patch.cancellationReason = 'Plans changed';
        }

        if (patch.status === 'CANCELLED') cancelled += 1;

        if (Object.keys(patch).length > 0) {
            await prisma.transferBooking.update({ where: { id: booking.id }, data: patch });
        }
    }

    logger.info(
        `Demo transfer bookings: ${made} created (${cancelled} cancelled), ${skipped} journeys skipped`
    );
};

const main = async () => {
    await connect();

    if (process.argv.includes('--clear')) {
        await clear();
        return;
    }

    const count = Number.parseInt(arg('count', '24'), 10);

    if (!Number.isFinite(count) || count < 1 || count > 500) {
        throw new Error('--count must be between 1 and 500');
    }

    await seed(count);

    const total = await prisma.transferBooking.count();
    logger.info(`Transfer bookings in the database: ${total}`);
};

try {
    await main();
} catch (err) {
    logger.error({ err }, 'Demo booking seed failed');
    process.exitCode = 1;
} finally {
    await disconnect();
}
