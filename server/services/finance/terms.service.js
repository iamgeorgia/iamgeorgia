import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { NotFoundError } from '../../lib/errors.js';

/**
 * Payment terms: when a supplier is paid and what it is owed after a
 * cancellation (per hotel, transfer provider, tour or service), and how long
 * a partner has to pay us (per partner, D5).
 *
 * Terms apply to bookings confirmed after they are saved. A booking already
 * confirmed keeps the schedule it was given — the supplier agreed to that
 * schedule for that booking — and Finance adjusts a single payable by hand
 * when it must.
 */

/** The four kinds of supplier product terms can hang off, by route segment. */
export const TERMS_SUBJECTS = {
    hotel: { column: 'hotelId', model: 'hotel', label: (row) => row.name },
    transferProvider: { column: 'transferProviderId', model: 'transferProvider', label: (row) => row.name },
    tour: { column: 'tourId', model: 'tour', label: (row) => row.slug },
    service: { column: 'serviceId', model: 'service', label: (row) => row.name }
};

const subjectOr404 = async (client, kind, id) => {
    const spec = TERMS_SUBJECTS[kind];
    const row = await client[spec.model].findUnique({ where: { id } });

    if (!row) {
        throw new NotFoundError('Not found');
    }

    return { spec, row };
};

/** The terms for a product, or the defaults that apply when it has none. */
export const getSupplierTerms = async (kind, id) => {
    const { spec } = await subjectOr404(prisma, kind, id);
    const terms = await prisma.supplierPaymentTerms.findUnique({ where: { [spec.column]: id } });

    return terms ?? { [spec.column]: id, milestones: [], cancellationLiability: 'PROPORTIONAL', cutoffTime: null, notes: null, isDefault: true };
};

export const putSupplierTerms = (kind, id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const { spec, row } = await subjectOr404(tx, kind, id);
        const data = {
            milestones: input.milestones,
            cancellationLiability: input.cancellationLiability,
            cutoffTime: input.cutoffTime ?? null,
            notes: input.notes ?? null
        };

        const terms = await tx.supplierPaymentTerms.upsert({
            where: { [spec.column]: id },
            update: data,
            create: { [spec.column]: id, ...data }
        });

        await recordAudit(tx, {
            action: 'SUPPLIER_TERMS_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.supplierPaymentTerms,
            entityId: terms.id,
            summary: `Updated the payment terms of ${spec.label(row)}`,
            metadata: { [spec.column]: id, ...data },
            req
        });

        return terms;
    });

/** A partner's payment terms (D5): days to pay, and from when they count. */
export const updatePartnerTerms = (partnerId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const partner = await tx.partner.findUnique({ where: { id: partnerId } });

        if (!partner) {
            throw new NotFoundError('Partner not found');
        }

        const updated = await tx.partner.update({
            where: { id: partnerId },
            data: {
                ...(input.paymentDueDays !== undefined ? { paymentDueDays: input.paymentDueDays } : {}),
                ...(input.paymentDueAnchor !== undefined ? { paymentDueAnchor: input.paymentDueAnchor } : {}),
                ...(input.paymentTermsNote !== undefined ? { paymentTermsNote: input.paymentTermsNote } : {}),
                ...(input.bookingApproval !== undefined ? { bookingApproval: input.bookingApproval } : {})
            },
            select: { id: true, paymentDueDays: true, paymentDueAnchor: true, paymentTermsNote: true, bookingApproval: true }
        });

        const termsChanged =
            input.paymentDueDays !== undefined || input.paymentDueAnchor !== undefined || input.paymentTermsNote !== undefined;

        if (termsChanged) {
            await recordAudit(tx, {
                action: 'PARTNER_TERMS_UPDATED',
                actor,
                entityType: AUDIT_ENTITY.partner,
                entityId: partnerId,
                summary: `Payment terms for ${partner.name}: ${updated.paymentDueDays} days from ${updated.paymentDueAnchor.toLowerCase()}`,
                metadata: {
                    from: { paymentDueDays: partner.paymentDueDays, paymentDueAnchor: partner.paymentDueAnchor },
                    to: { paymentDueDays: updated.paymentDueDays, paymentDueAnchor: updated.paymentDueAnchor }
                },
                req
            });
        }

        // Its own row: whether a company's bookings wait for the platform's
        // yes (OD1) is an operations decision, read separately from the money.
        if (input.bookingApproval !== undefined && input.bookingApproval !== partner.bookingApproval) {
            await recordAudit(tx, {
                action: 'PARTNER_BOOKING_APPROVAL_CHANGED',
                actor,
                entityType: AUDIT_ENTITY.partner,
                entityId: partnerId,
                summary: `Bookings by ${partner.name} are now ${updated.bookingApproval === 'AUTO' ? 'confirmed at once' : 'approved first'}`,
                metadata: { from: partner.bookingApproval, to: updated.bookingApproval },
                req
            });
        }

        return updated;
    });
