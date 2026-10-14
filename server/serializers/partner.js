import { config } from '../config.js';
import { CAPABILITIES, can } from '../lib/permissions.js';
import { toContact } from './user.js';

/** One line of a partner's allow or deny list, with the product it names. */
export const toProductAccess = (entry) => ({
    id: entry.id,
    productType: entry.productType,
    productId: entry.productId,
    mode: entry.mode,
    note: entry.note ?? null,
    product: entry.product ?? null,
    createdAt: entry.createdAt,
    createdBy: entry.createdByUser ? toContact(entry.createdByUser) : null
});

const primaryContactOf = (partner) => {
    const users = partner.users ?? [];

    return users.find((user) => user.isPrimaryContact) ?? users[0] ?? null;
};

/**
 * Whether a viewer may see this partner's bank details.
 *
 * Admins can, for any partner. A partner's own owner or finance user can, for
 * their own company and no other — the partnerId comparison is what stops one
 * approved partner from reading another's IBAN by changing the id in a URL.
 */
export const canViewFinancial = (viewer, partner) =>
    can(viewer, CAPABILITIES.PARTNERS_FINANCIAL_READ) ||
    (can(viewer, CAPABILITIES.PARTNER_FINANCIAL_READ) && viewer.partnerId === partner.id);

const toFinancial = (financial) =>
    financial
        ? {
              iban: financial.iban,
              swift: financial.swift,
              bankName: financial.bankName ?? null,
              accountHolder: financial.accountHolder ?? null,
              updatedAt: financial.updatedAt
          }
        : null;

/** The row shape for the partners table and the applications queue. */
export const toPartnerSummary = (partner) => ({
    id: partner.id,
    reference: partner.reference,
    name: partner.name,
    legalName: partner.legalName ?? null,
    kind: partner.kind,
    status: partner.status,
    registrationNumber: partner.registrationNumber ?? null,
    // For the invoices issued to this partner (Phase 4): its VAT/tax number and
    // the language its documents are printed in (null = the server default).
    taxId: partner.taxId ?? null,
    invoiceLang: partner.invoiceLang ?? null,
    city: partner.city ?? null,
    country: partner.country ?? null,
    email: partner.email ?? null,
    phone: partner.phone ?? null,
    submittedAt: partner.submittedAt ?? null,
    createdAt: partner.createdAt,
    contact: toContact(primaryContactOf(partner))
});

/**
 * The full record behind an application.
 *
 * `financial` is attached only when the viewer is entitled to it and is absent
 * — not null — otherwise, so a UI cannot mistake "you may not see this" for
 * "this partner has not supplied bank details". Review notes and the internal
 * rejection note are admin-only for the same reason they exist: they are
 * written about the partner, not for them.
 */
export const toPartnerDetail = (partner, viewer) => {
    const detail = {
        ...toPartnerSummary(partner),
        legalAddress: partner.legalAddress ?? null,
        website: partner.website ?? null,
        socialLinks: partner.socialLinks ?? [],
        documents: partner.documents ?? [],
        commissionRateBps: partner.commissionRateBps,
        creditLimitCents: partner.creditLimitCents ?? null,
        creditLimitCurrency: partner.creditLimitCurrency ?? null,
        creditLimitMode: partner.creditLimitMode ?? 'BLOCK',
        users: (partner.users ?? []).map(toContact),
        updatedAt: partner.updatedAt,

        // The signed agreement on file. The file itself is reached through
        // the contract endpoint, by signed link; here only the facts.
        contract: {
            required: partner.contractRequired ?? true,
            onFile: Boolean(partner.contractAssetId && !partner.contractAsset?.deletedAt),
            signedAt: partner.contractSignedAt ?? null,
            version: partner.contractVersion ?? null,
            uploadedAt: partner.contractUploadedAt ?? null,
            uploadedBy: partner.contractUploadedByUser ? toContact(partner.contractUploadedByUser) : null,
            filename: partner.contractAsset?.originalFilename ?? null
        },
        terms: {
            current: config.partners.termsVersion,
            url: config.partners.termsUrl,
            acceptedVersion: partner.termsVersion ?? null,
            acceptedAt: partner.termsAcceptedAt ?? null,
            acceptedBy: partner.termsAcceptedByUser ? toContact(partner.termsAcceptedByUser) : null,
            outdated: partner.termsVersion !== config.partners.termsVersion
        },

        review: {
            approvedAt: partner.approvedAt ?? null,
            approvedBy: partner.approvedByUser ? toContact(partner.approvedByUser) : null,
            rejectedAt: partner.rejectedAt ?? null,
            rejectedBy: partner.rejectedByUser ? toContact(partner.rejectedByUser) : null,
            rejectionReason: partner.rejectionReason ?? null,
            suspendedAt: partner.suspendedAt ?? null,
            suspendedBy: partner.suspendedByUser ? toContact(partner.suspendedByUser) : null,
            suspensionReason: partner.suspensionReason ?? null,
            blockedAt: partner.blockedAt ?? null,
            blockedBy: partner.blockedByUser ? toContact(partner.blockedByUser) : null,
            blockedReason: partner.blockedReason ?? null,
            terminatedAt: partner.terminatedAt ?? null,
            terminatedBy: partner.terminatedByUser ? toContact(partner.terminatedByUser) : null,
            terminatedReason: partner.terminatedReason ?? null
        }
    };

    // Present only when the bank details were joined for an entitled viewer:
    // `null` then means "none on file", and an absent key means "not shown".
    if (partner.financial !== undefined && canViewFinancial(viewer, partner)) {
        detail.financial = toFinancial(partner.financial);
    }

    if (can(viewer, CAPABILITIES.PARTNERS_READ)) {
        detail.notes = partner.notes ?? null;
        detail.review.rejectionNote = partner.rejectionNote ?? null;
    }

    return detail;
};

export const toInvitation = (invitation) => ({
    id: invitation.id,
    email: invitation.email,
    partnerId: invitation.partnerId ?? null,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt ?? null,
    revokedAt: invitation.revokedAt ?? null,
    resentCount: invitation.resentCount,
    createdAt: invitation.createdAt,
    invitedBy: invitation.invitedByUser ? toContact(invitation.invitedByUser) : null,
    status: invitation.acceptedAt
        ? 'ACCEPTED'
        : invitation.revokedAt
          ? 'REVOKED'
          : invitation.expiresAt <= new Date()
            ? 'EXPIRED'
            : 'PENDING'
});

export const toAuditEntry = (entry) => ({
    id: entry.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    metadata: entry.metadata ?? {},
    actor: entry.actorUser ? toContact(entry.actorUser) : null,
    actorEmail: entry.actorEmail,
    createdAt: entry.createdAt
});
