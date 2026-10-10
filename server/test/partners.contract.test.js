import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../app.js';
import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import {
    createTracker,
    databaseAvailable,
    makeAdmin,
    makeDestination,
    makeHotel,
    makeInvitation,
    makePartner,
    makePartnerUser,
    makeTour,
    makeTransferBooking,
    makeTransferPoint,
    makeTransferProvider,
    makeTransferVehicle,
    registrationPayload,
    signIn,
    testEmail
} from './support/factories.js';

const app = createApp();
const dbAvailable = await databaseAvailable();

const CURRENT = config.partners.termsVersion;

/** The smallest thing that sniffs as a PDF. */
const pdfBuffer = () =>
    Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
            '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' +
            'trailer<</Root 1 0 R>>\n%%EOF\n'
    );

/**
 * The contract gate, the terms gate, the two closed statuses and what one
 * partner may sell.
 */
describe('contract, terms, closed statuses and product access', { skip: dbAvailable ? false : 'Postgres is not reachable' }, () => {
    const tracker = createTracker();
    const cookies = {};

    before(async () => {
        for (const role of ['SUPER_ADMIN', 'MANAGEMENT']) {
            cookies[role] = (await signIn(app, (await makeAdmin(tracker, { role })).email)).cookie;
        }
    });

    after(async () => {
        await tracker.cleanup();
        await disconnect();
    });

    const trackByReference = async (reference) => tracker.partner(await prisma.partner.findUnique({ where: { reference } }));

    const uploadContract = (partnerId, cookie = cookies.SUPER_ADMIN) =>
        request(app)
            .post(`/api/admin/partners/${partnerId}/contract`)
            .set('Cookie', cookie)
            .field('signedAt', '2026-10-01')
            .field('version', 'v3')
            .attach('file', pdfBuffer(), { filename: 'contract.pdf', contentType: 'application/pdf' });

    it('registers a company only against the terms in force, and stamps them', async () => {
        const email = testEmail('invitee');
        const { token } = await makeInvitation({ email });

        const missing = await request(app).post(`/api/invitations/${token}/accept`).send({ ...registrationPayload(email), terms: undefined });
        assert.equal(missing.status, 400);

        const stale = await request(app)
            .post(`/api/invitations/${token}/accept`)
            .send(registrationPayload(email, { terms: { accepted: true, version: '1999-01' } }));
        assert.equal(stale.status, 400);
        assert.equal(stale.body.error.details.reason, 'TERMS_VERSION_STALE');
        assert.equal(stale.body.error.details.current, CURRENT);

        const accepted = await request(app).post(`/api/invitations/${token}/accept`).send(registrationPayload(email));
        assert.equal(accepted.status, 201, JSON.stringify(accepted.body));

        const partner = await trackByReference(accepted.body.reference);
        assert.equal(partner.termsVersion, CURRENT);
        assert.ok(partner.termsAcceptedAt);
        assert.equal(partner.contractRequired, true, 'a new company needs a contract before approval');
        assert.ok(await prisma.auditLog.findFirst({ where: { action: 'PARTNER_TERMS_ACCEPTED', entityId: partner.id } }));
    });

    it('approves nobody without a signed contract on file, which only the contract desk files', async () => {
        const partner = await makePartner(tracker, { status: 'PENDING_APPROVAL', contractRequired: true });
        const owner = await makePartnerUser(tracker, partner);

        const refused = await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookies.SUPER_ADMIN).send({});
        assert.equal(refused.status, 400);
        assert.equal(refused.body.error.details.reason, 'CONTRACT_MISSING');

        assert.equal((await uploadContract(partner.id, cookies.MANAGEMENT)).status, 403);
        assert.equal((await request(app).get(`/api/admin/partners/${partner.id}/contract`).set('Cookie', cookies.SUPER_ADMIN)).status, 404);

        const filed = await uploadContract(partner.id);
        assert.equal(filed.status, 201, JSON.stringify(filed.body));
        assert.equal(filed.body.contract.onFile, true);
        assert.equal(filed.body.contract.version, 'v3');
        assert.equal(filed.body.contract.filename, 'contract.pdf');

        const saved = await prisma.partner.findUnique({ where: { id: partner.id }, include: { contractAsset: true } });
        tracker.file(saved.contractAsset);
        assert.equal(saved.contractAsset.category, 'CONTRACT');
        assert.equal(saved.contractAsset.visibility, 'PRIVATE');
        assert.equal(saved.contractAsset.partnerId, partner.id, 'the file belongs to the company');

        const approved = await request(app).post(`/api/admin/partners/${partner.id}/approve`).set('Cookie', cookies.SUPER_ADMIN).send({});
        assert.equal(approved.status, 200, JSON.stringify(approved.body));

        // Read by the desk and by the company itself, through signed links.
        const adminLink = await request(app).get(`/api/admin/partners/${partner.id}/contract`).set('Cookie', cookies.SUPER_ADMIN);
        assert.equal(adminLink.status, 200);
        assert.ok(adminLink.body.url);
        assert.equal((await request(app).get(`/api/admin/partners/${partner.id}/contract`).set('Cookie', cookies.MANAGEMENT)).status, 403);

        const ownerCookie = (await signIn(app, owner.email)).cookie;
        const ownLink = await request(app).get('/api/partner/contract').set('Cookie', ownerCookie);
        assert.equal(ownLink.status, 200, JSON.stringify(ownLink.body));
        assert.ok(ownLink.body.url);
    });

    it('approves a company that was onboarded before the gate, or whose requirement was waived on the record', async () => {
        const grandfathered = await makePartner(tracker, { status: 'PENDING_APPROVAL' });
        await makePartnerUser(tracker, grandfathered);
        assert.equal((await request(app).post(`/api/admin/partners/${grandfathered.id}/approve`).set('Cookie', cookies.SUPER_ADMIN).send({})).status, 200);

        const waived = await makePartner(tracker, { status: 'PENDING_APPROVAL', contractRequired: true });
        await makePartnerUser(tracker, waived);
        const waive = await request(app)
            .put(`/api/admin/partners/${waived.id}/contract-requirement`)
            .set('Cookie', cookies.SUPER_ADMIN)
            .send({ contractRequired: false, reason: 'Framework agreement signed with the group' });
        assert.equal(waive.status, 200, JSON.stringify(waive.body));
        assert.equal(waive.body.contract.required, false);
        assert.equal((await request(app).post(`/api/admin/partners/${waived.id}/approve`).set('Cookie', cookies.SUPER_ADMIN).send({})).status, 200);
    });

    it('shuts the portal and the booking routes until the owner accepts the current terms', async () => {
        const partner = await makePartner(tracker, { termsVersion: '1999-01' });
        const owner = await makePartnerUser(tracker, partner);
        const agent = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT', isPrimaryContact: false });
        const ownerCookie = (await signIn(app, owner.email)).cookie;
        const agentCookie = (await signIn(app, agent.email)).cookie;

        const shut = await request(app).get('/api/partner/dashboard').set('Cookie', ownerCookie);
        assert.equal(shut.status, 403);
        assert.equal(shut.body.error.details.reason, 'TERMS_OUTDATED');
        assert.equal(shut.body.error.details.termsVersion, CURRENT);

        const booking = await request(app).post('/api/bookings').set('Cookie', agentCookie).send({});
        assert.equal(booking.status, 403);
        assert.equal(booking.body.error.details.reason, 'TERMS_OUTDATED');

        const me = await request(app).get('/api/partner/me').set('Cookie', agentCookie);
        assert.equal(me.status, 200, 'the explanation page still renders');
        assert.equal(me.body.terms.outdated, true);

        const terms = await request(app).get('/api/partner/terms').set('Cookie', ownerCookie);
        assert.equal(terms.status, 200);
        assert.equal(terms.body.current, CURRENT);
        assert.equal(terms.body.acceptedVersion, '1999-01');

        assert.equal((await request(app).post('/api/partner/terms/accept').set('Cookie', agentCookie).send({ version: CURRENT })).status, 403, 'only the owner accepts');
        const stale = await request(app).post('/api/partner/terms/accept').set('Cookie', ownerCookie).send({ version: '1999-01' });
        assert.equal(stale.status, 400);
        assert.equal(stale.body.error.details.reason, 'TERMS_VERSION_STALE');

        const accepted = await request(app).post('/api/partner/terms/accept').set('Cookie', ownerCookie).send({ version: CURRENT });
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
        assert.equal(accepted.body.terms.outdated, false);

        assert.equal((await request(app).get('/api/partner/dashboard').set('Cookie', ownerCookie)).status, 200);
        assert.equal((await request(app).post('/api/bookings').set('Cookie', agentCookie).send({})).status, 400, 'through to validation');
    });

    it('blocks a company out of signing in, and lets it back in exactly as it was', async () => {
        const partner = await makePartner(tracker);
        const owner = await makePartnerUser(tracker, partner);
        const before = (await signIn(app, owner.email)).cookie;

        const blocked = await request(app)
            .post(`/api/admin/partners/${partner.id}/block`)
            .set('Cookie', cookies.SUPER_ADMIN)
            .send({ reason: 'Repeated no-shows' });
        assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
        assert.equal(blocked.body.status, 'BLOCKED');
        assert.equal(blocked.body.review.blockedReason, 'Repeated no-shows');

        assert.equal((await request(app).get('/api/partner/me').set('Cookie', before)).status, 401, 'the live session ended');

        const refused = await signIn(app, owner.email);
        assert.equal(refused.status, 403);
        assert.equal(refused.body.error.details.reason, 'PARTNER_BLOCKED');

        const unblocked = await request(app).post(`/api/admin/partners/${partner.id}/unblock`).set('Cookie', cookies.SUPER_ADMIN).send({});
        assert.equal(unblocked.status, 200, JSON.stringify(unblocked.body));
        assert.equal(unblocked.body.status, 'APPROVED');
        assert.equal(unblocked.body.review.blockedAt, null);
        assert.equal((await signIn(app, owner.email)).status, 200);
    });

    it('terminates for good: accounts off, links spent, bookings kept, deletion refused', async () => {
        const supplier = await makePartner(tracker, { kind: 'TRANSPORT' });
        const partner = await makePartner(tracker, { kind: 'TOUR_OPERATOR' });
        const owner = await makePartnerUser(tracker, partner);

        const provider = tracker.transferProvider(await makeTransferProvider({ partnerId: supplier.id }));
        const vehicle = tracker.transferVehicle(await makeTransferVehicle({ providerId: provider.id }));
        const from = tracker.transferPoint(await makeTransferPoint());
        const to = tracker.transferPoint(await makeTransferPoint({ latitude: 42.4781, longitude: 44.4783 }));
        await makeTransferBooking(tracker, { vehicleId: vehicle.id, from, to, partnerId: partner.id });

        const wrong = await request(app)
            .post(`/api/admin/partners/${partner.id}/terminate`)
            .set('Cookie', cookies.SUPER_ADMIN)
            .send({ reason: 'Contract ended', confirm: 'NOPE' });
        assert.equal(wrong.status, 400);

        const ended = await request(app)
            .post(`/api/admin/partners/${partner.id}/terminate`)
            .set('Cookie', cookies.SUPER_ADMIN)
            .send({ reason: 'Contract ended', confirm: partner.reference });
        assert.equal(ended.status, 200, JSON.stringify(ended.body));
        assert.equal(ended.body.status, 'TERMINATED');

        assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).isActive, false);
        const refused = await signIn(app, owner.email);
        assert.equal(refused.status, 403);
        assert.equal(refused.body.error.details.reason, 'PARTNER_TERMINATED');

        assert.equal((await request(app).post(`/api/admin/partners/${partner.id}/unblock`).set('Cookie', cookies.SUPER_ADMIN).send({})).status, 409, 'nothing leads out');

        const deletion = await request(app)
            .delete(`/api/admin/partners/${partner.id}`)
            .set('Cookie', cookies.SUPER_ADMIN)
            .send({ confirm: partner.reference });
        assert.equal(deletion.status, 409);
        assert.equal(deletion.body.error.details.reason, 'USE_TERMINATE');
        assert.ok(await prisma.transferBooking.findFirst({ where: { partnerId: partner.id } }), 'the booking stays under its name');
    });

    it('hides a denied product from the partner, and narrows the catalogue to an allow list', async () => {
        const destination = await makeDestination(tracker);
        const [hotelA, hotelB] = [await makeHotel(tracker, { destination }), await makeHotel(tracker, { destination })];
        const tag = `ACCESS${Date.now()}`;
        const [tourA, tourB] = [await makeTour(tracker, { destination, title: `${tag} one` }), await makeTour(tracker, { destination, title: `${tag} two` })];

        const partner = await makePartner(tracker, { kind: 'TOUR_OPERATOR' });
        const agent = await makePartnerUser(tracker, partner, { role: 'PARTNER_AGENT' });
        const cookie = (await signIn(app, agent.email)).cookie;

        const hotels = async () => (await request(app).get(`/api/hotels?destinationSlug=${destination.slug}`).set('Cookie', cookie)).body.data.map((row) => row.id);
        const tours = async () => (await request(app).get(`/api/tours?search=${tag}`).set('Cookie', cookie)).body.data.map((row) => row.id);

        assert.deepEqual((await hotels()).sort(), [hotelA.id, hotelB.id].sort(), 'no rows: everything');

        const access = (entries, who = cookies.SUPER_ADMIN) =>
            request(app).put(`/api/admin/partners/${partner.id}/product-access`).set('Cookie', who).send({ entries });

        assert.equal((await access([{ productType: 'HOTEL', productId: hotelA.id, mode: 'DENY' }], cookies.MANAGEMENT)).status, 403);
        const unknown = await access([{ productType: 'HOTEL', productId: 'nope', mode: 'DENY' }]);
        assert.equal(unknown.status, 422);
        assert.equal(unknown.body.error.details.reason, 'UNKNOWN_PRODUCT');

        const denied = await access([
            { productType: 'HOTEL', productId: hotelA.id, mode: 'DENY', note: 'Exclusive to another agency' },
            { productType: 'TOUR', productId: tourB.id, mode: 'ALLOW' }
        ]);
        assert.equal(denied.status, 200, JSON.stringify(denied.body));
        assert.equal(denied.body.data.length, 2);
        assert.equal(denied.body.data.find((row) => row.productType === 'HOTEL').product.name, hotelA.name);

        // The next request sees it: the rows ride on the session's partner.
        assert.deepEqual(await hotels(), [hotelB.id], 'the denied hotel is gone');
        assert.equal((await request(app).get(`/api/hotels/${hotelA.slug}`).set('Cookie', cookie)).status, 404);
        assert.equal((await request(app).get(`/api/hotels/${hotelB.slug}`).set('Cookie', cookie)).status, 200);
        assert.deepEqual(await tours(), [tourB.id], 'one ALLOW row makes the type an allow list');
        assert.equal((await request(app).get(`/api/tours/${tourA.slug}`).set('Cookie', cookie)).status, 404);

        // Staff and the public are never on the list.
        const staffSees = (await request(app).get(`/api/hotels?destinationSlug=${destination.slug}`).set('Cookie', cookies.MANAGEMENT)).body.data.map((row) => row.id);
        assert.ok(staffSees.includes(hotelA.id));

        const trail = await prisma.auditLog.findFirst({ where: { action: 'PARTNER_PRODUCT_ACCESS_CHANGED', entityId: partner.id } });
        assert.equal(trail.metadata.added.length, 2);

        // Replacing with an empty list removes everything.
        assert.equal((await access([])).body.data.length, 0);
        assert.deepEqual((await hotels()).sort(), [hotelA.id, hotelB.id].sort());
    });
});
