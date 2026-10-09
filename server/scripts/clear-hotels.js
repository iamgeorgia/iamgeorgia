import { prisma, disconnect } from '../db/index.js';
import { removeObjectPrefix } from '../services/media/storage.service.js';
import { deleteFinanceForBookings } from './lib/finance-cleanup.js';

/**
 * Clears the hotel catalogue completely — bookings, holds, hotels and every
 * hotel and room image, database rows and stored bytes both.
 *
 *   node scripts/clear-hotels.js
 *
 * Development tooling only: it walks straight past every "a hotel is never
 * deleted" rule in the services, which is exactly why it lives here and not
 * behind an endpoint. Reference data (amenities, bed types, meal plans, the
 * policy templates) and the destination tree survive, so `seed-reference.js`
 * does not need to run again and `seed-catalogue.js` can rebuild the catalogue
 * immediately afterwards.
 */

// Image assets are found by category up front, because once the hotels are
// gone nothing links an asset back to the catalogue it belonged to.
const assets = await prisma.fileAsset.findMany({
    where: { category: { in: ['HOTEL_IMAGE', 'ROOM_IMAGE'] } },
    select: { id: true, objectKey: true, visibility: true }
});

// Child-first: bookings and holds block or reference hotel rows.
const holds = await prisma.bookingHold.deleteMany({});
// Finance rows hold their booking with Restrict; they go with it.
await deleteFinanceForBookings(prisma, { hotelBooking: {}, order: { items: { some: { hotelBookingId: { not: null } } } } });
const bookings = await prisma.hotelBooking.deleteMany({});

// Cascades take room types, rate plans, rates, inventory, galleries, reviews,
// hotel-scoped policies and pricing rules, and translations with the rows.
const hotels = await prisma.hotel.deleteMany({});

// The gallery join rows are gone, so the assets delete cleanly (variants
// cascade). Bytes go last and best-effort — an object that is already missing
// must not stop the sweep.
const files = await prisma.fileAsset.deleteMany({ where: { id: { in: assets.map(({ id }) => id) } } });

const prefixes = new Map();

for (const { objectKey, visibility } of assets) {
    const slash = objectKey.lastIndexOf('/');
    prefixes.set(slash === -1 ? objectKey : objectKey.slice(0, slash), visibility);
}

await Promise.all(
    [...prefixes].map(([prefix, visibility]) =>
        removeObjectPrefix({ prefix, visibility }).catch(() => {})
    )
);

console.log(
    `Cleared ${hotels.count} hotels, ${bookings.count} bookings, ${holds.count} holds, ` +
        `${files.count} image assets (${prefixes.size} storage folders).`
);

await disconnect();
