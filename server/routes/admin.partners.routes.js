import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { authenticate, requireCapability, requireCapabilityByMethod, requireFieldsCapability } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { NotFoundError } from '../lib/errors.js';
import { toPartnerSummary, toPartnerDetail, toAuditEntry, toInvitation } from '../serializers/partner.js';
import { prisma } from '../db/index.js';
import {
    partnerQuerySchema,
    idParamSchema,
    adminCreatePartnerSchema,
    adminUpdatePartnerSchema,
    deletePartnerSchema,
    approveSchema,
    rejectSchema,
    suspendSchema,
    financialUpdateSchema
} from '../validation/partner.js';
import {
    listPartners,
    findPartnerOr404,
    adminCreatePartner,
    updatePartner,
    deletePartner,
    transitionPartner,
    readFinancial,
    updateFinancial,
    reissueInvitation,
    listAudit,
    primaryContactOf
} from '../services/partner.service.js';
import { sendMail, sendMailQuietly, invitationUrl, activationUrl } from '../lib/mailer/index.js';

export const adminPartnerRoutes = Router();

// Every route below is an admin route. Applying the guards once to the router
// is what stops a new endpoint from being added without them.
adminPartnerRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.PARTNERS_READ], write: [CAPABILITIES.PARTNERS_WRITE] }));

// The commission rate is the one figure on a partner that is money, so it
// needs the finance capability on top of `partners.write`.
const commissionField = requireFieldsCapability(['commissionRateBps'], CAPABILITIES.FINANCE_COMMISSION_WRITE);

adminPartnerRoutes.get('/', validate({ query: partnerQuerySchema }), async (req, res) => {
    const { partners, ...page } = await listPartners(req.valid.query);

    res.json({ data: partners.map(toPartnerSummary), ...page });
});

/**
 * Creates a partner and returns the link it generated.
 *
 * The URL is in the response as well as in the email so that a mail server
 * being down does not leave an admin with a partner they cannot onboard.
 * `emailSent` tells the panel whether to show the link or just confirm.
 */
adminPartnerRoutes.post('/', commissionField, validate({ body: adminCreatePartnerSchema }), async (req, res) => {
    const result = await adminCreatePartner(req.valid.body, req.user, req);
    const { partner, contact, token, kind, expiresAt } = result;
    const url = kind === 'invitation' ? invitationUrl(token) : activationUrl(token);

    const sent = await sendMailQuietly({
        to: contact.email,
        template: kind === 'invitation' ? 'partnerInvitation' : 'accountActivation',
        data: {
            companyName: partner.name,
            contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
            invitedByName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
            url,
            expiresAt
        }
    });

    res.status(201).json({
        partner: toPartnerDetail(await findPartnerOr404(partner.id, req.user), req.user),
        link: { kind, url, expiresAt },
        emailSent: Boolean(sent)
    });
});

adminPartnerRoutes.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
    const partner = await findPartnerOr404(req.valid.params.id, req.user);

    res.json(toPartnerDetail(partner, req.user));
});

adminPartnerRoutes.patch(
    '/:id',
    commissionField,
    validate({ params: idParamSchema, body: adminUpdatePartnerSchema }),
    async (req, res) => {
        await updatePartner(req.valid.params.id, req.valid.body, req.user, req);

        res.json(toPartnerDetail(await findPartnerOr404(req.valid.params.id, req.user), req.user));
    }
);

/**
 * Removes a partner for good.
 *
 * Irreversible, so the body has to name the Partner ID being deleted. What
 * survives is the audit trail, which is why it references its subject by
 * plain strings rather than a foreign key.
 */
adminPartnerRoutes.delete(
    '/:id',
    validate({ params: idParamSchema, body: deletePartnerSchema }),
    async (req, res) => {
        const partner = await deletePartner(req.valid.params.id, req.valid.body, req.user, req);

        res.json({ deleted: true, reference: partner.reference, name: partner.name });
    }
);

// --- Review actions ---------------------------------------------------------

const notifyDecision = async (action, { partner, users }) => {
    const contact = primaryContactOf({ users });

    if (!contact) {
        return;
    }

    const data = {
        companyName: partner.name,
        reference: partner.reference,
        contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        reason: partner.rejectionReason
    };

    if (action === 'approve' || action === 'reactivate') {
        await sendMailQuietly({ to: contact.email, template: 'partnerApproved', data });
    }

    if (action === 'reject') {
        await sendMailQuietly({ to: contact.email, template: 'partnerRejected', data });
    }
};

const reviewAction = (action, schema) => [
    validate({ params: idParamSchema, body: schema }),
    async (req, res) => {
        const result = await transitionPartner(req.valid.params.id, action, req.valid.body, req.user, req);

        await notifyDecision(action, result);

        res.json(toPartnerDetail(await findPartnerOr404(req.valid.params.id, req.user), req.user));
    }
];

adminPartnerRoutes.post('/:id/approve', ...reviewAction('approve', approveSchema));
adminPartnerRoutes.post('/:id/reject', ...reviewAction('reject', rejectSchema));
adminPartnerRoutes.post('/:id/suspend', ...reviewAction('suspend', suspendSchema));
adminPartnerRoutes.post('/:id/reactivate', ...reviewAction('reactivate', approveSchema));

// --- Financial --------------------------------------------------------------

// Bank details are their own capability, not part of reading a partner: the
// reservations and management desks read every partner and never an IBAN.
const financialGuard = requireCapability(CAPABILITIES.PARTNERS_FINANCIAL_READ);

adminPartnerRoutes.get('/:id/financial', financialGuard, validate({ params: idParamSchema }), async (req, res) => {
    const financial = await readFinancial(req.valid.params.id, req.user, req);

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
});

adminPartnerRoutes.put(
    '/:id/financial',
    financialGuard,
    validate({ params: idParamSchema, body: financialUpdateSchema }),
    async (req, res) => {
        const financial = await updateFinancial(req.valid.params.id, req.valid.body, req.user, req);

        res.json({
            iban: financial.iban,
            swift: financial.swift,
            bankName: financial.bankName,
            accountHolder: financial.accountHolder,
            updatedAt: financial.updatedAt
        });
    }
);

// --- Invitations and history ------------------------------------------------

adminPartnerRoutes.get('/:id/invitations', validate({ params: idParamSchema }), async (req, res) => {
    const invitations = await prisma.invitation.findMany({
        where: { partnerId: req.valid.params.id },
        include: { invitedByUser: true },
        orderBy: { createdAt: 'desc' }
    });

    res.json({ data: invitations.map(toInvitation) });
});

adminPartnerRoutes.post('/:id/invitations', validate({ params: idParamSchema }), async (req, res) => {
    const { partner, token, email, expiresAt, isReissue } = await reissueInvitation(
        req.valid.params.id,
        req.user,
        req
    );

    const url = invitationUrl(token);

    // This one is not sent quietly. The admin pressed a button whose entire
    // purpose is "send them a link"; reporting success when nothing was sent
    // would be a lie they act on.
    let emailSent = true;

    try {
        await sendMail({
            to: email,
            template: isReissue ? 'invitationReissued' : 'partnerInvitation',
            data: {
                companyName: partner.name,
                invitedByName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
                url,
                expiresAt
            }
        });
    } catch (err) {
        req.log?.error({ err }, 'Invitation email failed');
        emailSent = false;
    }

    res.status(201).json({ link: { kind: 'invitation', url, expiresAt }, email, emailSent });
});

// A partner's history carries commission changes and internal review notes,
// so it is read with the audit log's capability rather than the partner's.
adminPartnerRoutes.get('/:id/audit', requireCapability(CAPABILITIES.AUDIT_READ), validate({ params: idParamSchema }), async (req, res) => {
    const entries = await listAudit(req.valid.params.id);

    res.json({ data: entries.map(toAuditEntry) });
});

export default adminPartnerRoutes;
