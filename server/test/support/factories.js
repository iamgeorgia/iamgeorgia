import { randomBytes } from 'node:crypto';

import request from 'supertest';

import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { hashPassword } from '../../lib/password.js';
import { primaryRoleIdFor } from '../../services/rbac/access.js';
import { createToken, hashToken, expiresIn } from '../../lib/tokens.js';
import { nextPartnerReference, nextTransferBookingReference } from '../../lib/reference.js';

/**
 * Shared fixtures for the auth and partner suites.
 *
 * The catalogue tests keep their builders as module-local consts, which is
 * right for two files that share nothing. Eight suites all needing an admin, a
 * partner and a signed-in cookie is a different problem, so these live in one
 * place — outside the `test/*.test.js` glob, so the runner does not collect
 * this file as a suite of its own.
 */

export const TEST_PASSWORD = 'seventeen-lilac-donkeys';

let counter = 0;

/**
 * Collision-proof across parallel files and repeated runs on one database.
 *
 * The runner gives each test file its own process, so a timestamp and an
 * in-process counter are not enough on their own: two files starting in the
 * same millisecond both begin counting at one. The pid separates the processes
 * and the random suffix covers a pid reused within the same millisecond.
 */
export const unique = (prefix) =>
    [prefix, process.pid.toString(36), Date.now().toString(36), (counter += 1), randomBytes(2).toString('hex')].join(
        '-'
    );

export const testEmail = (prefix = 'user') => `${unique(prefix)}@example.test`;

// Hashing costs ~165 ms by design. Every fixture uses the same password, so it
// is derived once per process instead of once per user — the suite is testing
// the flows, and password.test.js is what tests the hashing.
let sharedHash;
const testPasswordHash = async () => (sharedHash ??= await hashPassword(TEST_PASSWORD));

/**
 * Tracks what a suite created so `after` can remove exactly that.
 *
 * Deleting a partner cascades to its users, bank details and invitations, but
 * deliberately not to its audit rows — that is the point of the audit table —
 * so those are removed by hand.
 */
const createdInvitationIds = new Set();

/**
 * Deletes the finance rows that hang off a tracker's records: allocations and
 * the payments they belong to, then payables (instalments cascade) and
 * receivables. Matched by the booking's product, the order's package or
 * partner, the debtor or supplier partner, and the user who recorded a
 * payment, so every way a test can create one is covered.
 */
export const purgeFinance = async ({
    partnerIds = [],
    hotelIds = [],
    tourIds = [],
    serviceIds = [],
    packageIds = [],
    transferBookingIds = [],
    transferVehicleIds = [],
    transferRouteIds = [],
    userIds = []
} = {}) => {
    const orderMatch = {
        OR: [
            { packageId: { in: packageIds } },
            { partnerId: { in: partnerIds } },
            { bookedByUserId: { in: userIds } },
            { items: { some: { hotelBooking: { hotelId: { in: hotelIds } } } } },
            { items: { some: { tourBooking: { tourId: { in: tourIds } } } } },
            { items: { some: { serviceBooking: { serviceId: { in: serviceIds } } } } }
        ]
    };
    const transferMatch = {
        OR: [
            { id: { in: transferBookingIds } },
            { vehicleId: { in: transferVehicleIds } },
            { routeId: { in: transferRouteIds } },
            { partnerId: { in: partnerIds } },
            { bookedByUserId: { in: userIds } }
        ]
    };
    const bookingMatch = (product) => ({
        OR: [{ [product]: { in: product === 'hotelId' ? hotelIds : product === 'tourId' ? tourIds : serviceIds } }, { partnerId: { in: partnerIds } }, { bookedByUserId: { in: userIds } }]
    });

    const [receivables, payables] = await Promise.all([
        prisma.receivable.findMany({
            where: {
                OR: [
                    { debtorPartnerId: { in: partnerIds } },
                    { hotelBooking: bookingMatch('hotelId') },
                    { tourBooking: bookingMatch('tourId') },
                    { serviceBooking: bookingMatch('serviceId') },
                    { transferBooking: transferMatch },
                    { order: orderMatch }
                ]
            },
            select: { id: true }
        }),
        prisma.supplierPayable.findMany({
            where: {
                OR: [
                    { supplierPartnerId: { in: partnerIds } },
                    { hotelBooking: bookingMatch('hotelId') },
                    { tourBooking: bookingMatch('tourId') },
                    { serviceBooking: bookingMatch('serviceId') },
                    { transferBooking: transferMatch },
                    { hotelBooking: { orderItem: { order: orderMatch } } },
                    { tourBooking: { orderItem: { order: orderMatch } } },
                    { serviceBooking: { orderItem: { order: orderMatch } } },
                    { transferBooking: { orderItem: { order: orderMatch } } }
                ]
            },
            select: { id: true }
        })
    ]);

    const receivableIds = receivables.map(({ id }) => id);
    const payableIds = payables.map(({ id }) => id);

    const payments = await prisma.paymentRecord.findMany({
        where: {
            OR: [
                { counterpartyPartnerId: { in: partnerIds } },
                { recordedByUserId: { in: userIds } },
                { allocations: { some: { receivableId: { in: receivableIds } } } },
                { allocations: { some: { payableInstalment: { payableId: { in: payableIds } } } } }
            ]
        },
        select: { id: true }
    });

    if (payments.length > 0) {
        await prisma.paymentRecord.deleteMany({ where: { id: { in: payments.map(({ id }) => id) } } });
    }

    await prisma.paymentAllocation.deleteMany({
        where: { OR: [{ receivableId: { in: receivableIds } }, { payableInstalment: { payableId: { in: payableIds } } }] }
    });

    if (payableIds.length > 0) {
        await prisma.supplierPayable.deleteMany({ where: { id: { in: payableIds } } });
    }

    if (receivableIds.length > 0) {
        await prisma.receivable.deleteMany({ where: { id: { in: receivableIds } } });
    }

    const financeIds = [...receivableIds, ...payableIds, ...payments.map(({ id }) => id)];

    if (financeIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { entityId: { in: financeIds } } });
    }
};

export const createTracker = () => {
    const partnerIds = new Set();
    const userIds = new Set();
    const destinationIds = new Set();
    const hotelIds = new Set();
    const amenityIds = new Set();
    const fileIds = new Set();
    const transferPointIds = new Set();
    const transferProviderIds = new Set();
    const transferVehicleIds = new Set();
    const transferRouteIds = new Set();
    const transferExtraCodes = new Set();
    const transferDriverIds = new Set();
    const transferFleetVehicleIds = new Set();
    const transferBookingIds = new Set();
    const tourIds = new Set();
    const serviceIds = new Set();
    const packageIds = new Set();

    return {
        partner(partner) {
            partnerIds.add(partner.id);
            return partner;
        },
        user(user) {
            userIds.add(user.id);
            return user;
        },
        destination(destination) {
            destinationIds.add(destination.id);
            return destination;
        },
        hotel(hotel) {
            hotelIds.add(hotel.id);
            return hotel;
        },
        amenity(amenity) {
            amenityIds.add(amenity.id);
            return amenity;
        },
        file(file) {
            fileIds.add(file.id);
            return file;
        },
        transferPoint(point) {
            transferPointIds.add(point.id);
            return point;
        },
        transferProvider(provider) {
            transferProviderIds.add(provider.id);
            return provider;
        },
        transferVehicle(vehicle) {
            transferVehicleIds.add(vehicle.id);
            return vehicle;
        },
        transferRoute(route) {
            transferRouteIds.add(route.id);
            return route;
        },
        transferExtra(extra) {
            transferExtraCodes.add(extra.code);
            return extra;
        },
        transferDriver(driver) {
            transferDriverIds.add(driver.id);
            return driver;
        },
        transferFleetVehicle(vehicle) {
            transferFleetVehicleIds.add(vehicle.id);
            return vehicle;
        },
        transferBooking(booking) {
            transferBookingIds.add(booking.id);
            return booking;
        },
        service(service) {
            serviceIds.add(service.id);
            return service;
        },
        package(pkg) {
            packageIds.add(pkg.id);
            return pkg;
        },
        tour(tour) {
            tourIds.add(tour.id);
            return tour;
        },
        async cleanup() {
            // Invitations are cleaned by id, never by an email pattern. The
            // runner gives each file its own process but they share one
            // database, so a `deleteMany` matching every `@example.test`
            // address would delete rows another file is in the middle of
            // using — and a claim whose row disappears mid-transaction looks
            // exactly like a claim that was already spent.
            if (createdInvitationIds.size > 0) {
                await prisma.invitation.deleteMany({ where: { id: { in: [...createdInvitationIds] } } });
                createdInvitationIds.clear();
            }

            const entityIds = [
                ...partnerIds,
                ...userIds,
                ...destinationIds,
                ...hotelIds,
                ...amenityIds,
                ...fileIds,
                ...transferPointIds,
                ...transferProviderIds,
                ...transferVehicleIds,
                ...transferRouteIds,
                ...transferDriverIds,
                ...transferFleetVehicleIds,
                ...transferBookingIds,
                ...tourIds,
                ...serviceIds,
                ...packageIds
            ];

            if (entityIds.length > 0) {
                await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
            }

            // Finance before anything it points at: payables and receivables
            // hold their booking, order and partner with Restrict, so a
            // booking with money attached cannot quietly disappear. One sweep
            // over everything this tracker made, by the same keys the steps
            // below use to find bookings and orders.
            await purgeFinance({
                partnerIds: [...partnerIds],
                hotelIds: [...hotelIds],
                tourIds: [...tourIds],
                serviceIds: [...serviceIds],
                packageIds: [...packageIds],
                transferBookingIds: [...transferBookingIds],
                transferVehicleIds: [...transferVehicleIds],
                transferRouteIds: [...transferRouteIds],
                userIds: [...userIds]
            });

            // Orders first: an order item holds its child booking with Restrict,
            // so no hotel, tour or service booking below can go while an item
            // still points at it. Items cascade from the order.
            if (hotelIds.size > 0 || tourIds.size > 0 || serviceIds.size > 0 || packageIds.size > 0 || partnerIds.size > 0) {
                const orders = await prisma.order.findMany({
                    where: {
                        OR: [
                            { packageId: { in: [...packageIds] } },
                            { partnerId: { in: [...partnerIds] } },
                            { items: { some: { hotelBooking: { hotelId: { in: [...hotelIds] } } } } },
                            { items: { some: { tourBooking: { tourId: { in: [...tourIds] } } } } },
                            { items: { some: { serviceBooking: { serviceId: { in: [...serviceIds] } } } } }
                        ]
                    },
                    select: { id: true }
                });

                if (orders.length > 0) {
                    const orderIds = orders.map(({ id }) => id);

                    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
                    await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } });
                }
            }

            // Packages before the hotels, tours and services their slots name.
            if (packageIds.size > 0) {
                await prisma.package.deleteMany({ where: { id: { in: [...packageIds] } } });
            }

            // Services: bookings block the delete on purpose, as for tours.
            if (serviceIds.size > 0) {
                const bookings = await prisma.serviceBooking.findMany({
                    where: { serviceId: { in: [...serviceIds] } },
                    select: { id: true }
                });

                if (bookings.length > 0) {
                    const bookingIds = bookings.map(({ id }) => id);

                    await prisma.serviceBooking.deleteMany({ where: { id: { in: bookingIds } } });
                    await prisma.auditLog.deleteMany({ where: { entityId: { in: bookingIds } } });
                }

                await prisma.service.deleteMany({ where: { id: { in: [...serviceIds] } } });
            }

            // Order matters here in a way it did not for partners and users.
            // Destination -> Hotel, FileAsset -> HotelImage and Hotel ->
            // HotelBooking are all Restrict, so cleanup runs child-first.
            if (hotelIds.size > 0) {
                // Bookings block a hotel delete on purpose: a property with
                // reservations against it must not be removable in production.
                // The suite therefore has to clear its own, and their audit
                // rows, which do not cascade by design.
                const bookings = await prisma.hotelBooking.findMany({
                    where: { hotelId: { in: [...hotelIds] } },
                    select: { id: true }
                });

                if (bookings.length > 0) {
                    const bookingIds = bookings.map(({ id }) => id);

                    await prisma.bookingHold.updateMany({
                        where: { bookingId: { in: bookingIds } },
                        data: { bookingId: null }
                    });
                    await prisma.hotelBooking.deleteMany({ where: { id: { in: bookingIds } } });
                    await prisma.auditLog.deleteMany({ where: { entityId: { in: bookingIds } } });
                }

                await prisma.hotel.deleteMany({ where: { id: { in: [...hotelIds] } } });
            }

            // Fleet and drivers. An assignment holds its driver and its car
            // with Restrict, so assignments go before either of them; ratings
            // and blocks cascade from the driver. Bookings written directly by
            // a factory (rather than through the API) are removed here too,
            // and their legs and assignments cascade with them.
            if (transferDriverIds.size > 0 || transferFleetVehicleIds.size > 0 || transferBookingIds.size > 0) {
                await prisma.transferAssignment.deleteMany({
                    where: {
                        OR: [
                            { driverId: { in: [...transferDriverIds] } },
                            { fleetVehicleId: { in: [...transferFleetVehicleIds] } },
                            { bookingId: { in: [...transferBookingIds] } }
                        ]
                    }
                });
            }

            if (transferDriverIds.size > 0) {
                await prisma.transferDriver.deleteMany({ where: { id: { in: [...transferDriverIds] } } });
            }

            if (transferFleetVehicleIds.size > 0) {
                await prisma.transferFleetVehicle.deleteMany({ where: { id: { in: [...transferFleetVehicleIds] } } });
            }

            if (transferBookingIds.size > 0) {
                await prisma.transferBooking.deleteMany({ where: { id: { in: [...transferBookingIds] } } });
            }

            // Transfers, child-first for the same reason hotels are:
            // TransferPoint -> TransferRoute and TransferVehicle ->
            // TransferBooking are both Restrict, so a point cannot go while a
            // route still names it. Bookings and their audit rows go first
            // because nothing cascades to an audit row, by design.
            if (transferVehicleIds.size > 0 || transferRouteIds.size > 0) {
                const bookings = await prisma.transferBooking.findMany({
                    where: {
                        OR: [
                            { vehicleId: { in: [...transferVehicleIds] } },
                            { routeId: { in: [...transferRouteIds] } }
                        ]
                    },
                    select: { id: true }
                });

                if (bookings.length > 0) {
                    const bookingIds = bookings.map(({ id }) => id);

                    await prisma.transferBooking.deleteMany({ where: { id: { in: bookingIds } } });
                    await prisma.auditLog.deleteMany({ where: { entityId: { in: bookingIds } } });
                }
            }

            if (transferRouteIds.size > 0) {
                await prisma.transferRoute.deleteMany({ where: { id: { in: [...transferRouteIds] } } });
            }

            if (transferVehicleIds.size > 0) {
                await prisma.transferVehicle.deleteMany({ where: { id: { in: [...transferVehicleIds] } } });
            }

            if (transferProviderIds.size > 0) {
                await prisma.transferProvider.deleteMany({ where: { id: { in: [...transferProviderIds] } } });
            }

            if (transferPointIds.size > 0) {
                await prisma.transferPoint.deleteMany({ where: { id: { in: [...transferPointIds] } } });
            }

            if (transferExtraCodes.size > 0) {
                await prisma.transferExtra.deleteMany({ where: { code: { in: [...transferExtraCodes] } } });
            }

            // Tours before destinations and partners: both hold a tour with
            // Restrict. Bookings block the tour delete on purpose, so the suite
            // clears its own, with their audit rows, exactly as for hotels.
            if (tourIds.size > 0) {
                const bookings = await prisma.tourBooking.findMany({
                    where: { tourId: { in: [...tourIds] } },
                    select: { id: true }
                });

                if (bookings.length > 0) {
                    const bookingIds = bookings.map(({ id }) => id);

                    await prisma.tourHold.updateMany({
                        where: { bookingId: { in: bookingIds } },
                        data: { bookingId: null }
                    });
                    await prisma.tourBooking.deleteMany({ where: { id: { in: bookingIds } } });
                    await prisma.auditLog.deleteMany({ where: { entityId: { in: bookingIds } } });
                }

                await prisma.tour.deleteMany({ where: { id: { in: [...tourIds] } } });
            }

            if (destinationIds.size > 0) {
                // Deepest first: a parent cannot go while a child still points
                // at it, and tests routinely build a two- or three-level tree.
                const destinations = await prisma.destination.findMany({
                    where: { id: { in: [...destinationIds] } },
                    orderBy: { path: 'desc' }
                });

                for (const destination of destinations) {
                    await prisma.destination.delete({ where: { id: destination.id } }).catch(() => {});
                }
            }

            if (fileIds.size > 0) {
                await prisma.fileAsset.deleteMany({ where: { id: { in: [...fileIds] } } });
            }

            if (amenityIds.size > 0) {
                await prisma.amenity.deleteMany({ where: { id: { in: [...amenityIds] } } });
            }

            if (partnerIds.size > 0) {
                await prisma.partner.deleteMany({ where: { id: { in: [...partnerIds] } } });
            }

            if (userIds.size > 0) {
                await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
            }

            partnerIds.clear();
            userIds.clear();
            destinationIds.clear();
            hotelIds.clear();
            amenityIds.clear();
            fileIds.clear();
            transferPointIds.clear();
            transferProviderIds.clear();
            transferVehicleIds.clear();
            transferRouteIds.clear();
            transferExtraCodes.clear();
            transferDriverIds.clear();
            transferFleetVehicleIds.clear();
            transferBookingIds.clear();
            tourIds.clear();
            serviceIds.clear();
            packageIds.clear();
        }
    };
};

export const makeAdmin = async (tracker, { role = 'ADMIN', ...overrides } = {}) =>
    tracker.user(
        await prisma.user.create({
            data: {
                email: testEmail('admin'),
                firstName: 'Ada',
                lastName: 'Admin',
                primaryRoleId: await primaryRoleIdFor(prisma, role),
                passwordHash: await testPasswordHash(),
                ...overrides
            }
        })
    );

export const makePartner = async (tracker, { status = 'APPROVED', ...overrides } = {}) =>
    tracker.partner(
        await prisma.partner.create({
            data: {
                reference: await nextPartnerReference(prisma),
                name: unique('Rooms Hotel'),
                legalName: 'Rooms Hospitality LLC',
                kind: 'HOTEL',
                status,
                registrationNumber: unique('REG').toUpperCase(),
                legalAddress: '14 Kostava Street',
                city: 'Tbilisi',
                country: 'GE',
                phone: '+995322123456',
                email: testEmail('company'),
                submittedAt: new Date(),
                // A fixture company trades as one that was onboarded before
                // the contract gate and has accepted the terms in force; the
                // contract and terms suites override both to exercise them.
                contractRequired: false,
                termsVersion: config.partners.termsVersion,
                termsAcceptedAt: new Date(),
                ...overrides
            }
        })
    );

export const makePartnerUser = async (
    tracker,
    partner,
    { role = 'PARTNER_OWNER', isPrimaryContact = true, withPassword = true, ...overrides } = {}
) =>
    tracker.user(
        await prisma.user.create({
            data: {
                email: testEmail('partner'),
                firstName: 'Nino',
                lastName: 'Beridze',
                position: 'Director',
                phone: '+995555123456',
                primaryRoleId: await primaryRoleIdFor(prisma, role),
                isPrimaryContact,
                partnerId: partner.id,
                passwordHash: withPassword ? await testPasswordHash() : null,
                ...overrides
            }
        })
    );

export const makeFinancial = (partner, overrides = {}) =>
    prisma.partnerFinancialDetail.create({
        data: {
            partnerId: partner.id,
            iban: 'GE29NB0000000101904917',
            swift: 'TBCBGE22',
            bankName: 'TBC Bank',
            accountHolder: 'Rooms Hospitality LLC',
            ...overrides
        }
    });

/** Returns the plaintext token alongside the row, as the real issuer does. */
export const makeInvitation = async ({ email, partnerId = null, invitedByUserId = null, ...overrides } = {}) => {
    const token = createToken();

    const invitation = await prisma.invitation.create({
        data: {
            tokenHash: hashToken(token),
            email: email ?? testEmail('invitee'),
            partnerId,
            invitedByUserId,
            expiresAt: expiresIn(7 * 24 * 60 * 60 * 1000),
            ...overrides
        }
    });

    createdInvitationIds.add(invitation.id);

    return { token, invitation };
};

export const makeAuthToken = async ({ userId, purpose = 'ACCOUNT_ACTIVATION', ...overrides }) => {
    const token = createToken();

    const authToken = await prisma.authToken.create({
        data: {
            tokenHash: hashToken(token),
            purpose,
            userId,
            expiresAt: expiresIn(48 * 60 * 60 * 1000),
            ...overrides
        }
    });

    return { token, authToken };
};

/** Signs in and hands back the cookie header for subsequent requests. */
/**
 * A destination. Defaults to a root COUNTRY so a test that just needs somewhere
 * to put a hotel can call it with no arguments; pass a parent to build a tree.
 */
export const makeDestination = async (tracker, { parent = null, ...overrides } = {}) => {
    const slug = overrides.slug ?? unique('dest');
    const type = overrides.type ?? (parent ? 'RESORT' : 'COUNTRY');

    return tracker.destination(
        await prisma.destination.create({
            data: {
                slug,
                name: 'Test Destination',
                type,
                parentId: parent?.id ?? null,
                path: `${parent?.path ?? ''}/${slug}`,
                countryCode: parent?.countryCode ?? 'GE',
                timezone: parent?.timezone ?? 'Asia/Tbilisi',
                latitude: 41.7497,
                longitude: 43.5322,
                ...overrides,
                slug
            }
        })
    );
};

export const makeHotel = async (tracker, { destination, ...overrides } = {}) => {
    const place = destination ?? (await makeDestination(tracker));

    return tracker.hotel(
        await prisma.hotel.create({
            data: {
                slug: unique('hotel'),
                name: 'Test Hotel',
                propertyType: 'Hotel',
                status: 'ACTIVE',
                // Production defaults to B2B-only; the factory opts into B2C
                // because most tests want a hotel an anonymous caller can see.
                // The channel rule itself is tested explicitly with overrides.
                b2cEnabled: true,
                destinationId: place.id,
                countryCode: place.countryCode,
                timezone: place.timezone,
                currency: 'GEL',
                starRating: 4,
                address: '1 Test Street',
                latitude: 41.75,
                longitude: 43.53,
                ...overrides
            }
        })
    );
};

export const makeAmenity = async (tracker, overrides = {}) =>
    tracker.amenity(
        await prisma.amenity.create({
            data: {
                code: unique('amenity'),
                name: 'Test Amenity',
                category: 'General',
                scope: 'HOTEL',
                ...overrides
            }
        })
    );

export const makeFileAsset = async (tracker, overrides = {}) =>
    tracker.file(
        await prisma.fileAsset.create({
            data: {
                objectKey: `test/${unique('object')}`,
                bucket: 'iag-public',
                originalFilename: 'photo.jpg',
                mimeType: 'image/jpeg',
                sizeBytes: 2048,
                checksumSha256: 'b'.repeat(64),
                category: 'HOTEL_IMAGE',
                visibility: 'PUBLIC',
                status: 'READY',
                ...overrides
            }
        })
    );

export const signIn = async (app, email, password = TEST_PASSWORD) => {
    const res = await request(app).post('/api/auth/login').send({ email, password });

    return { status: res.status, body: res.body, cookie: res.headers['set-cookie'] ?? [] };
};

/** A complete, valid registration body for the invitation accept endpoint. */
export const registrationPayload = (email, overrides = {}) => ({
    company: {
        name: unique('Kazbegi Lodge'),
        legalName: 'Kazbegi Lodge LLC',
        kind: 'HOTEL',
        registrationNumber: unique('REG').toUpperCase(),
        legalAddress: '2 Gergeti Street',
        city: 'Stepantsminda',
        country: 'GE',
        phone: '+995322987654',
        email: testEmail('company'),
        ...overrides.company
    },
    contact: {
        firstName: 'Giorgi',
        lastName: 'Kapanadze',
        position: 'Owner',
        phone: '+995555987654',
        email,
        ...overrides.contact
    },
    financial: {
        iban: 'GE29NB0000000101904917',
        swift: 'TBCBGE22',
        bankName: 'TBC Bank',
        accountHolder: 'Kazbegi Lodge LLC',
        ...overrides.financial
    },
    password: overrides.password ?? TEST_PASSWORD,
    terms: overrides.terms ?? { accepted: true, version: config.partners.termsVersion }
});

/** The full admin create-partner body, in whichever mode. */
export const adminCreatePayload = (mode, email, overrides = {}) => {
    const base = registrationPayload(email, overrides);

    return { mode, company: base.company, contact: base.contact, financial: base.financial, ...overrides.top };
};

/**
 * Integration suites skip rather than fail when Postgres is not running, the
 * same way db.test.js does, so `npm test` still works offline.
 */
export const databaseAvailable = () =>
    prisma
        .$queryRaw`SELECT 1`.then(() => true)
        .catch(() => false);


/* ==========================================================================
   Transfers
   ========================================================================== */

/**
 * What the place search says about Tbilisi airport — the shape the client's
 * LocationField sends, so a test that posts one is posting what the panel
 * posts. Each call gets its own place id unless told otherwise, because a
 * place id is unique across live pick-up points.
 */
export const placeRef = (overrides = {}) => ({
    placeId: unique('ChIJ'),
    name: 'Tbilisi International Airport',
    formattedAddress: 'Tbilisi International Airport, Tbilisi 0158, Georgia',
    city: 'Tbilisi',
    region: 'Tbilisi',
    countryCode: 'GE',
    types: ['airport', 'point_of_interest'],
    ...overrides
});

/**
 * A pick-up point with real-ish coordinates.
 *
 * The coordinates matter more than they look: with no curated price the fare
 * *is* the distance between two of these, so a fixture at 0,0 would quote every
 * journey as a trip to the Gulf of Guinea.
 */
export const makeTransferPoint = (overrides = {}) =>
    prisma.transferPoint.create({
        data: {
            slug: unique('point'),
            name: 'Test Point',
            kind: 'CITY',
            regionLabel: 'Test Region',
            latitude: 41.7151,
            longitude: 44.8271,
            timezone: 'Asia/Tbilisi',
            status: 'ACTIVE',
            ...overrides
        }
    });

export const makeTransferProvider = (overrides = {}) =>
    prisma.transferProvider.create({
        data: {
            slug: unique('provider'),
            name: 'Test Transfers',
            rating: 4.5,
            reviewCount: 10,
            verified: true,
            yearsActive: 3,
            ...overrides
        }
    });

/** Defaults to ACTIVE and b2cEnabled, because most tests want it sellable. */
export const makeTransferVehicle = async (overrides = {}) => {
    const providerId = overrides.providerId ?? (await makeTransferProvider()).id;

    return prisma.transferVehicle.create({
        data: {
            slug: unique('vehicle'),
            name: 'Test Sedan',
            vehicleClass: 'COMFORT',
            body: 'sedan',
            kind: 'PRIVATE',
            maxPassengers: 3,
            maxLuggage: 2,
            maxCabinBags: 2,
            features: ['airConditioning'],
            vehicleExample: 'Toyota Camry or similar',
            summary: 'A test vehicle.',
            description: ['A test vehicle.'],
            included: ['Driver'],
            excluded: ['Gratuities'],
            pickupProcedure: 'The driver calls twenty minutes ahead.',
            perKmCents: 120,
            minimumFareCents: 6750,
            airportFeeCents: 1350,
            currency: 'GEL',
            paceFactor: 1,
            recommendedRank: 1,
            b2cEnabled: true,
            status: 'ACTIVE',
            ...overrides,
            providerId
        }
    });
};

export const makeTransferRoute = async (overrides = {}) => {
    const fromPointId = overrides.fromPointId ?? (await makeTransferPoint()).id;
    const toPointId =
        overrides.toPointId ?? (await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 })).id;

    return prisma.transferRoute.create({
        data: {
            slug: unique('route'),
            tier: 'TIER_1',
            category: 'CITY',
            distanceKm: 100,
            durationMinutes: 110,
            title: 'Test Route',
            summary: 'A test route.',
            status: 'ACTIVE',
            ...overrides,
            fromPointId,
            toPointId
        }
    });
};

export const makeTransferPrice = (routeId, vehicleId, overrides = {}) =>
    prisma.transferRoutePrice.create({
        data: { routeId, vehicleId, oneWayCents: 20000, currency: 'GEL', ...overrides }
    });

/**
 * A date far enough ahead to clear the minimum-notice check, as YYYY-MM-DD.
 *
 * Relative rather than a fixed constant: a hardcoded 2027 date is a test that
 * starts failing in 2027, and the notice rule is about how far away the pick-up
 * is rather than about which year it falls in.
 */
export const futureDate = (daysAhead = 30) =>
    new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);


/* ==========================================================================
   Fleet, drivers and dispatch
   ========================================================================== */

/** A physical car, ACTIVE, sold as the given class. */
export const makeFleetVehicle = async (tracker, { providerId, vehicleClassId, ...overrides } = {}) => {
    // Short enough for a plate, unique enough for a partial unique index.
    const plate = overrides.plateNumber ?? `TT${randomBytes(4).toString('hex').toUpperCase()}`;

    return tracker.transferFleetVehicle(
        await prisma.transferFleetVehicle.create({
            data: {
                providerId,
                vehicleClassId,
                make: 'Toyota',
                model: 'Camry',
                year: 2022,
                colour: 'Black',
                body: 'sedan',
                plateNumber: plate,
                plateNormalized: plate.replace(/[^A-Z0-9]/g, ''),
                passengerCapacity: 3,
                luggageCapacity: 2,
                cabinBagCapacity: 2,
                features: ['airConditioning'],
                status: 'ACTIVE',
                ...overrides
            }
        })
    );
};

/** A driver profile, VERIFIED and active, with no login yet. */
export const makeDriver = async (tracker, { providerId, ...overrides } = {}) =>
    tracker.transferDriver(
        await prisma.transferDriver.create({
            data: {
                providerId,
                firstName: 'Levan',
                lastName: 'Gogoladze',
                phone: '+995555000111',
                languages: ['ka', 'en'],
                yearsExperience: 7,
                verificationStatus: 'VERIFIED',
                verifiedAt: new Date(),
                isActive: true,
                ...overrides
            }
        })
    );

/** A DRIVER login linked to a profile. Platform-side: no partnerId, by the CHECK. */
export const makeDriverUser = async (tracker, driver, { withPassword = true, ...overrides } = {}) => {
    const user = tracker.user(
        await prisma.user.create({
            data: {
                email: testEmail('driver'),
                firstName: driver.firstName,
                lastName: driver.lastName,
                primaryRoleId: await primaryRoleIdFor(prisma, 'DRIVER'),
                passwordHash: withPassword ? await testPasswordHash() : null,
                ...overrides
            }
        })
    );

    await prisma.transferDriver.update({ where: { id: driver.id }, data: { userId: user.id } });

    return user;
};

/**
 * A confirmed booking with one leg, written directly rather than through the
 * quote-and-confirm flow. For suites that test what happens *after* a booking
 * exists — dispatch, ratings — and do not need the fare engine in the way.
 */
export const makeTransferBooking = async (
    tracker,
    { vehicleId, from, to, pickupAt = new Date(Date.now() + 7 * 86_400_000), durationMinutes = 90, ...overrides } = {}
) =>
    tracker.transferBooking(
        await prisma.transferBooking.create({
            data: {
                reference: await nextTransferBookingReference(prisma),
                status: 'CONFIRMED',
                vehicleId,
                tripType: 'ONE_WAY',
                pickupAt,
                adults: 2,
                children: 0,
                childAges: [],
                luggage: 2,
                cabinBags: 0,
                currency: 'GEL',
                netTotalCents: 17000,
                sellTotalCents: 20000,
                markupBps: 1500,
                leadPassengerName: 'Test Passenger',
                leadPassengerEmail: testEmail('passenger'),
                leadPassengerPhone: '+995555999888',
                routeSnapshot: {
                    fromSlug: from.slug,
                    fromName: from.name,
                    fromTimezone: from.timezone,
                    toSlug: to.slug,
                    toName: to.name
                },
                vehicleSnapshot: {},
                // The shape `buildCancellationSchedule` produces for a policy
                // with no rules: one open-ended free window.
                cancellationSchedule: {
                    currency: 'GEL',
                    totalCents: 20000,
                    checkInAt: pickupAt.toISOString(),
                    windows: [{ fromAt: null, toAt: null, chargeCents: 0, basis: 'FREE', description: 'Free cancellation' }]
                },
                confirmedAt: new Date(),
                source: 'admin',
                legs: {
                    create: {
                        legIndex: 0,
                        direction: 'OUTBOUND',
                        fromPointId: from.id,
                        toPointId: to.id,
                        fromPointName: from.name,
                        toPointName: to.name,
                        pickupAt,
                        distanceKm: 100,
                        durationMinutes,
                        netCents: 17000,
                        sellCents: 20000
                    }
                },
                ...overrides
            },
            include: { legs: true }
        })
    );

/** An assignment row written directly, for exercising the database constraints. */
export const makeAssignment = (leg, { driverId, fleetVehicleId = null, windowStart, windowEnd, ...overrides }) =>
    prisma.transferAssignment.create({
        data: {
            legId: leg.id,
            bookingId: leg.bookingId,
            driverId,
            fleetVehicleId,
            status: 'OFFERED',
            windowStart,
            windowEnd,
            preBufferMinutes: 45,
            postBufferMinutes: 30,
            ...overrides
        }
    });

// --- tours -------------------------------------------------------------------

/** A published tour with nothing else: options, sheets and departures are added by the builders below. */
export const makeTour = async (tracker, { destination, ...overrides } = {}) => {
    const place = destination ?? (await makeDestination(tracker));

    return tracker.tour(
        await prisma.tour.create({
            data: {
                slug: unique('tour'),
                title: 'Test Tour',
                location: 'Kazbegi',
                status: 'ACTIVE',
                b2cEnabled: true,
                destinationId: place.id,
                timezone: place.timezone,
                currency: 'GEL',
                category: 'nature',
                summary: 'A day in the mountains.',
                description: ['Up and back.'],
                image: '/images/tours/test.jpg',
                durationDays: 1,
                durationLabel: '1 day',
                groupSize: '2-12',
                difficulty: 'Easy',
                meetingPoint: 'Hotel lobby',
                itinerary: { create: [{ day: 1, title: 'The day', description: 'What happens.', meals: [], accommodation: '' }] },
                ...overrides
            }
        })
    );
};

/**
 * An option priced by one season for the whole of 2027, with a departure on
 * `date` (when given). Percent-of-total cancellation via the tiered template.
 */
export const makeTourOption = async (
    tour,
    { date = null, totalUnits = 12, adultNetCents = 10_000, childNetCents = 5_000, groupNetCents = 40_000, ...overrides } = {}
) => {
    const policy = await prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'TIERED' } });

    const option = await prisma.tourOption.create({
        data: {
            tourId: tour.id,
            code: unique('opt').slice(0, 40),
            name: 'Shared seat',
            kind: 'SHARED',
            pricingBasis: 'PER_PERSON',
            unitKind: 'SEAT',
            scheduleKind: 'SCHEDULED',
            maxPax: 12,
            startTime: '08:00',
            cancellationPolicyId: policy.id,
            seasons: {
                create: [
                    {
                        name: 'All year',
                        validFrom: new Date('2027-01-01T00:00:00.000Z'),
                        validUntil: new Date('2027-12-31T00:00:00.000Z'),
                        currency: 'GEL',
                        tiers: { create: [{ minPax: 1, adultNetCents, childNetCents, groupNetCents }] }
                    }
                ]
            },
            ...overrides
        }
    });

    if (date) {
        await prisma.tourInventory.create({
            data: { tourOptionId: option.id, date: new Date(`${date}T00:00:00.000Z`), totalUnits }
        });
    }

    return option;
};

/**
 * A priced service, ACTIVE and B2C, on the TIERED template (percent-of-total
 * rules, which is what a service may use). Net 100.00 per unit by default.
 */
export const makeService = async (tracker, { destination = null, ...overrides } = {}) => {
    const policy = await prisma.cancellationPolicy.findFirst({ where: { hotelId: null, kind: 'TIERED' } });

    return tracker.service(
        await prisma.service.create({
            data: {
                slug: unique('service'),
                name: 'Kosher dinner delivery',
                status: 'ACTIVE',
                category: 'KOSHER_MEAL_DELIVERY',
                destinationId: destination?.id ?? null,
                basis: 'PER_PERSON',
                netCents: 10_000,
                currency: 'GEL',
                cancellationPolicyId: policy.id,
                noticeHours: 24,
                isKosher: true,
                summary: 'A hot kosher dinner brought to the hotel.',
                b2cEnabled: true,
                ...overrides
            }
        })
    );
};
