import { prisma, disconnect } from '../db/index.js';
import { hashPassword } from '../lib/password.js';
import { nextPartnerReference } from '../lib/reference.js';
import { cancelHotelBookingInTx } from '../services/hotel/booking.service.js';
import { cancelTransferBookingInTx } from '../services/transfer/booking.service.js';
import { deleteFinanceForBookings } from './lib/finance-cleanup.js';

/**
 * Demo accounts for trying the B2B features by hand: one staff account per
 * role, an agency with a full team, a suspended agency, and two suppliers
 * that own real catalogue items with payment terms.
 *
 *   node scripts/seed-b2b-demo.js                     # create or refresh
 *   node scripts/seed-b2b-demo.js --password s3cret-pass
 *   node scripts/seed-b2b-demo.js --clear             # remove it all again
 *
 * Every login ends `@demo-b2b.iamgeorgia.test` and every company name starts
 * "Demo ", which is what `--clear` matches on. The two suppliers take over a
 * seeded hotel (`abanotubani-residence`) and a seeded transfer provider
 * ("Tbilisi Premium Transfers"); `--clear` hands both back to the platform.
 * Idempotent: re-running resets the passwords and leaves everything else.
 *
 * Bookings are not seeded: make them through the site as the agency, so the
 * finance records are written the way production writes them.
 */
const args = process.argv.slice(2);
const clear = args.includes('--clear');
const passwordIndex = args.indexOf('--password');
const PASSWORD = passwordIndex >= 0 ? args[passwordIndex + 1] : 'Demo-Georgia-2026';
const DOMAIN = 'demo-b2b.iamgeorgia.test';
const HOTEL_SLUG = 'abanotubani-residence';
const PROVIDER_NAME = 'Tbilisi Premium Transfers';

const email = (local) => `${local}@${DOMAIN}`;

const STAFF = [
    ['superadmin', 'SUPER_ADMIN', 'Salome', 'Superadmin'],
    ['admin', 'ADMIN', 'Ana', 'Admin'],
    ['management', 'MANAGEMENT', 'Mariam', 'Manager'],
    ['reservations', 'RESERVATIONS', 'Rezo', 'Reservations'],
    ['finance', 'FINANCE', 'Pikria', 'Finance'],
    ['dispatcher', 'DISPATCHER', 'Dato', 'Dispatcher']
];

const PARTNERS = [
    {
        name: 'Demo Travel Agency',
        kind: 'TOUR_OPERATOR',
        status: 'APPROVED',
        paymentDueDays: 14,
        users: [
            ['agency.owner', 'PARTNER_OWNER', 'Nino', 'Owner'],
            ['agency.admin', 'PARTNER_ADMIN', 'Giorgi', 'Admin'],
            ['agency.agent', 'PARTNER_AGENT', 'Tamar', 'Agent'],
            ['agency.finance', 'PARTNER_FINANCE', 'Levan', 'Finance']
        ]
    },
    { name: 'Demo Suspended Agency', kind: 'TOUR_OPERATOR', status: 'SUSPENDED', users: [['suspended.owner', 'PARTNER_OWNER', 'Irakli', 'Suspended']] },
    { name: 'Demo Hotel Supplier', kind: 'HOTEL', status: 'APPROVED', users: [['hotel.owner', 'PARTNER_OWNER', 'Eka', 'Hotelier']] },
    { name: 'Demo Transfer Supplier', kind: 'TRANSPORT', status: 'APPROVED', users: [['transfer.owner', 'PARTNER_OWNER', 'Zura', 'Driver']] }
];

const seed = async () => {
    const passwordHash = await hashPassword(PASSWORD);

    for (const [local, role, firstName, lastName] of STAFF) {
        await prisma.user.upsert({
            where: { email: email(local) },
            update: { passwordHash, role, isActive: true, deactivatedAt: null, deactivatedByUserId: null },
            create: { email: email(local), firstName, lastName, role, passwordHash }
        });
    }

    const partners = {};

    for (const spec of PARTNERS) {
        const existing = await prisma.partner.findFirst({ where: { name: spec.name } });
        const partner =
            existing ??
            (await prisma.partner.create({
                data: {
                    reference: await nextPartnerReference(prisma),
                    name: spec.name,
                    legalName: `${spec.name} LLC`,
                    kind: spec.kind,
                    status: spec.status,
                    registrationNumber: `DEMO${Date.now()}${Math.floor(Math.random() * 1000)}`,
                    legalAddress: '1 Rustaveli Avenue',
                    city: 'Tbilisi',
                    country: 'GE',
                    phone: '+995322000000',
                    email: email(spec.name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')),
                    submittedAt: new Date(),
                    approvedAt: spec.status === 'APPROVED' ? new Date() : null,
                    suspendedAt: spec.status === 'SUSPENDED' ? new Date() : null,
                    ...(spec.paymentDueDays ? { paymentDueDays: spec.paymentDueDays } : {})
                }
            }));

        if (existing && existing.status !== spec.status) {
            await prisma.partner.update({ where: { id: partner.id }, data: { status: spec.status } });
        }

        for (const [index, [local, role, firstName, lastName]] of spec.users.entries()) {
            await prisma.user.upsert({
                where: { email: email(local) },
                update: { passwordHash, role, isActive: true, partnerId: partner.id },
                create: {
                    email: email(local),
                    firstName,
                    lastName,
                    role,
                    partnerId: partner.id,
                    isPrimaryContact: index === 0,
                    passwordHash
                }
            });
        }

        partners[spec.name] = partner;
    }

    // The hotel supplier owns a trade-only property, with a deposit-and-balance schedule.
    const hotel = await prisma.hotel.update({ where: { slug: HOTEL_SLUG }, data: { supplierId: partners['Demo Hotel Supplier'].id } });
    const hotelTerms = {
        milestones: [
            { kind: 'DEPOSIT', basis: 'PERCENT', value: 3000, anchor: 'CONFIRMATION', offsetDays: 3 },
            { kind: 'BALANCE', anchor: 'ARRIVAL', offsetDays: -7 }
        ],
        cancellationLiability: 'PROPORTIONAL',
        cutoffTime: '10:00',
        notes: 'Demo terms: 30% three days after confirmation, the rest a week before arrival.'
    };
    await prisma.supplierPaymentTerms.upsert({ where: { hotelId: hotel.id }, update: hotelTerms, create: { hotelId: hotel.id, ...hotelTerms } });

    // The transfer supplier runs one seeded provider, paid after the ride.
    const provider = await prisma.transferProvider.findFirst({ where: { name: PROVIDER_NAME } });

    if (provider) {
        await prisma.transferProvider.update({ where: { id: provider.id }, data: { partnerId: partners['Demo Transfer Supplier'].id } });
        const providerTerms = {
            milestones: [{ kind: 'BALANCE', anchor: 'DEPARTURE', offsetDays: 5 }],
            cancellationLiability: 'NONE_UNLESS_NON_REFUNDABLE',
            notes: 'Demo terms: paid five days after the ride; nothing owed for a refundable cancellation.'
        };
        await prisma.supplierPaymentTerms.upsert({
            where: { transferProviderId: provider.id },
            update: providerTerms,
            create: { transferProviderId: provider.id, ...providerTerms }
        });
    }

    console.log(`Demo B2B accounts ready. Password for every login: ${PASSWORD}`);
    console.table([
        ...STAFF.map(([local, role]) => ({ login: email(local), role, where: '/admin/sign-in' })),
        ...PARTNERS.flatMap((spec) =>
            spec.users.map(([local, role]) => ({ login: email(local), role: `${role} (${spec.name}${spec.status === 'APPROVED' ? '' : `, ${spec.status}`})`, where: '/portal/sign-in' }))
        )
    ]);
    console.log(`Hotel "${hotel.name}" (${HOTEL_SLUG}) now belongs to Demo Hotel Supplier${provider ? `; "${PROVIDER_NAME}" to Demo Transfer Supplier` : ''}.`);
};

const clearAll = async () => {
    const partners = await prisma.partner.findMany({ where: { name: { in: PARTNERS.map((spec) => spec.name) } }, select: { id: true } });
    const partnerIds = partners.map(({ id }) => id);
    const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
    const userIds = users.map(({ id }) => id);
    const madeBy = { OR: [{ partnerId: { in: partnerIds } }, { bookedByUserId: { in: userIds } }] };

    // Give the rooms and the cars back before the rows go: a deleted booking
    // that still held inventory would leave a room unsellable.
    for (const booking of await prisma.hotelBooking.findMany({ where: { ...madeBy, status: { in: ['CONFIRMED', 'PENDING'] }, orderItem: null }, include: { rooms: true } })) {
        await prisma.$transaction((tx) => cancelHotelBookingInTx(tx, booking, { reason: 'Demo data cleared', waiveCharges: true }, null, null));
    }
    for (const booking of await prisma.transferBooking.findMany({ where: { ...madeBy, status: { in: ['CONFIRMED', 'PENDING'] }, orderItem: null }, include: { legs: true } })) {
        await prisma.$transaction((tx) => cancelTransferBookingInTx(tx, booking, { reason: 'Demo data cleared', waiveCharges: true }, null, null)).catch(() => {});
    }

    const finance = await deleteFinanceForBookings(prisma, { hotelBooking: madeBy, transferBooking: madeBy, tourBooking: madeBy, serviceBooking: madeBy, order: madeBy });
    await prisma.paymentRecord.deleteMany({ where: { counterpartyPartnerId: { in: partnerIds } } });

    const hotelBookings = await prisma.hotelBooking.findMany({ where: madeBy, select: { id: true } });
    await prisma.bookingHold.updateMany({ where: { bookingId: { in: hotelBookings.map(({ id }) => id) } }, data: { bookingId: null } });
    await prisma.hotelBooking.deleteMany({ where: { id: { in: hotelBookings.map(({ id }) => id) } } });
    await prisma.transferBooking.deleteMany({ where: madeBy });

    // Hand the catalogue items back to the platform, with their demo terms.
    const hotel = await prisma.hotel.findUnique({ where: { slug: HOTEL_SLUG } });
    if (hotel && partnerIds.includes(hotel.supplierId)) {
        await prisma.hotel.update({ where: { id: hotel.id }, data: { supplierId: null } });
        await prisma.supplierPaymentTerms.deleteMany({ where: { hotelId: hotel.id } });
    }
    const provider = await prisma.transferProvider.findFirst({ where: { name: PROVIDER_NAME } });
    if (provider && partnerIds.includes(provider.partnerId)) {
        await prisma.transferProvider.update({ where: { id: provider.id }, data: { partnerId: null } });
        await prisma.supplierPaymentTerms.deleteMany({ where: { transferProviderId: provider.id } });
    }

    await prisma.supplierPayable.deleteMany({ where: { supplierPartnerId: { in: partnerIds } } });
    await prisma.receivable.deleteMany({ where: { debtorPartnerId: { in: partnerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });

    console.log(`Cleared ${userIds.length} demo logins, ${partnerIds.length} demo companies and their bookings (${finance.payables} payables, ${finance.receivables} receivables).`);
};

(clear ? clearAll() : seed())
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(disconnect);
