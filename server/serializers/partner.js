import { CAPABILITIES, can } from '../lib/permissions.js';
import { toContact } from './user.js';

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

        review: {
            approvedAt: partner.approvedAt ?? null,
            approvedBy: partner.approvedByUser ? toContact(partner.approvedByUser) : null,
            rejectedAt: partner.rejectedAt ?? null,
            rejectedBy: partner.rejectedByUser ? toContact(partner.rejectedByUser) : null,
            rejectionReason: partner.rejectionReason ?? null,
            suspendedAt: partner.suspendedAt ?? null,
            suspendedBy: partner.suspendedByUser ? toContact(partner.suspendedByUser) : null,
            suspensionReason: partner.suspensionReason ?? null
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
