import { Router } from 'express';

import { prisma } from '../db/index.js';
import { dateOnlyToUtc } from '../lib/time.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireApprovedPartner, requireCapability, requirePartner } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { config } from '../config.js';
import { partnerSelfUpdateSchema, accountUpdateSchema, financialUpdateSchema, acceptTermsSchema } from '../validation/partner.js';
import { toPartnerDetail } from '../serializers/partner.js';
import { toUser } from '../serializers/user.js';
import { findPartnerOr404, readFinancial, updateFinancial, contractLink, acceptTerms } from '../services/partner.service.js';
import { recordAudit, AUDIT_ENTITY } from '../lib/audit.js';

export const partnerRoutes = Router();

partnerRoutes.use(authenticate, requirePartner);

const ownPartnerId = (req) => {
    if (!req.user.partnerId) {
        throw new ForbiddenError('This account is not attached to a partner company');
    }

    return req.user.partnerId;
};

/**
 * Readable in every status, including PENDING_APPROVAL, REJECTED and SUSPENDED.
 *
 * This is what the portal renders its "application under review", "declined"
 * and "suspended" pages from. Everything behind `requireApprovedPartner` is
 * not readable in those states.
 */
partnerRoutes.get('/me', async (req, res) => {
    // Bank details have their own endpoint below, with their own capability.
    const partner = await findPartnerOr404(ownPartnerId(req), req.user, { financial: false });

    res.json(toPartnerDetail(partner, req.user));
});

// --- Contract and terms -----------------------------------------------------
//
// Readable in every status and before the terms are accepted: this is what
// the "please accept the terms" page and the company's own copy of its
// contract are served from. Everything else waits behind the gate.

partnerRoutes.get('/contract', async (req, res) => {
    res.json(await contractLink(ownPartnerId(req), req.user, req));
});

partnerRoutes.get('/terms', async (req, res) => {
    const partner = await findPartnerOr404(ownPartnerId(req), req.user, { financial: false });

    res.json({
        current: config.partners.termsVersion,
        url: config.partners.termsUrl,
        acceptedVersion: partner.termsVersion ?? null,
        acceptedAt: partner.termsAcceptedAt ?? null,
        outdated: partner.termsVersion !== config.partners.termsVersion
    });
});

/** The owner accepts the current terms for the company. */
partnerRoutes.post(
    '/terms/accept',
    requireCapability(CAPABILITIES.PARTNER_TERMS_ACCEPT),
    validate({ body: acceptTermsSchema }),
    async (req, res) => {
        ownPartnerId(req);
        await acceptTerms(req.user, req.valid.body, req);

        res.json(toPartnerDetail(await findPartnerOr404(req.user.partnerId, req.user, { financial: false }), req.user));
    }
);

/**
 * A user editing their own name, position and phone.
 *
 * Allowed in every partner status and to every partner role: correcting the
 * spelling of your own name is not a privileged act, and someone whose
 * application is still under review should be able to fix a typo in it.
 */
partnerRoutes.patch('/account', validate({ body: accountUpdateSchema }), async (req, res) => {
    if (Object.keys(req.valid.body).length === 0) {
        return res.json(toUser(req.user));
    }

    const updated = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({ where: { id: req.user.id }, data: req.valid.body });

        await recordAudit(tx, {
            action: 'USER_PROFILE_UPDATED',
            actor: req.user,
            entityType: AUDIT_ENTITY.user,
            entityId: req.user.id,
            summary: `${req.user.email} updated their own details`,
            metadata: { fields: Object.keys(req.valid.body) },
            req
        });

        return user;
    });

    res.json(toUser(updated));
});

/**
 * The landing screen behind the gate.
 *
 * The counts are `count` queries rather than lengths of fetched lists: a
 * partner with four thousand bookings must not have four thousand rows read to
 * put a number in a tile. `upcoming` is what the partner actually acts on —
 * a stay still ahead of them is one they can still amend or cancel.
 */
partnerRoutes.get('/dashboard', requireApprovedPartner, async (req, res) => {
    const partnerId = ownPartnerId(req);

    // Today at the platform's own boundary. A stay is a calendar date at the
    // property, so this compares dates and never instants.
    const today = dateOnlyToUtc(new Date().toISOString().slice(0, 10));

    const [partner, listings, bookings, upcoming, cancelled] = await Promise.all([
        findPartnerOr404(partnerId, req.user),
        prisma.hotel.count({ where: { supplierId: partnerId, status: 'ACTIVE' } }),
        prisma.hotelBooking.count({ where: { partnerId } }),
        prisma.hotelBooking.count({
            where: { partnerId, status: 'CONFIRMED', checkIn: { gte: today } }
        }),
        prisma.hotelBooking.count({ where: { partnerId, status: 'CANCELLED' } })
    ]);

    res.json({
        partner: toPartnerDetail(partner, req.user),
        stats: { listings, bookings, upcoming, cancelled }
    });
});

/**
 * A partner editing its own profile.
 *
 * The schema is an allow-list, so `status`, `reference`, `commissionRateBps`
 * and the reviewer stamps are not merely ignored here — they never reach the
 * update at all. A partner cannot approve itself, rename its Partner ID, or
 * award itself a better commission.
 */
partnerRoutes.patch(
    '/profile',
    requireApprovedPartner,
    requireCapability(CAPABILITIES.PARTNER_PROFILE_WRITE),
    validate({ body: partnerSelfUpdateSchema }),
    async (req, res) => {
        const id = ownPartnerId(req);

        await prisma.$transaction(async (tx) => {
            await tx.partner.update({ where: { id }, data: req.valid.body });

            await recordAudit(tx, {
                action: 'PARTNER_UPDATED',
                actor: req.user,
                entityType: AUDIT_ENTITY.partner,
                entityId: id,
                summary: `${req.user.email} updated their company profile`,
                metadata: { fields: Object.keys(req.valid.body), self: true },
                req
            });
        });

        res.json(toPartnerDetail(await findPartnerOr404(id, req.user), req.user));
    }
);

// --- Financial --------------------------------------------------------------
//
// Restricted to the two roles that have a reason to see bank details. A
// PARTNER_AGENT working for the same company does not, which is the point of
// having roles at all rather than one "partner user".

partnerRoutes.get(
    '/financial',
    // Gated on status as well as role, matching the PUT below. Bank details are
    // not one of the things a suspended or rejected partner still gets to read
    // — and a guard that is applied to the write but not the read is how the
    // next one gets forgotten.
    requireApprovedPartner,
    requireCapability(CAPABILITIES.PARTNER_FINANCIAL_READ),
    async (req, res) => {
        // Through `readFinancial` so a partner's own look at its bank details
        // is audited like an admin's: the trail answers "who saw the IBAN"
        // whichever side of the platform they were on.
        const financial = await readFinancial(ownPartnerId(req), req.user, req);

        if (!financial) {
            throw new NotFoundError('No bank details on file');
        }

        res.json({
            iban: financial.iban,
            swift: financial.swift,
            bankName: financial.bankName,
            accountHolder: financial.accountHolder,
            updatedAt: financial.updatedAt
        });
    }
);

partnerRoutes.put(
    '/financial',
    requireApprovedPartner,
    requireCapability(CAPABILITIES.PARTNER_FINANCIAL_WRITE),
    validate({ body: financialUpdateSchema }),
    async (req, res) => {
        const financial = await updateFinancial(ownPartnerId(req), req.valid.body, req.user, req);

        res.json({
            iban: financial.iban,
            swift: financial.swift,
            bankName: financial.bankName,
            accountHolder: financial.accountHolder,
            updatedAt: financial.updatedAt
        });
    }
);

export default partnerRoutes;
