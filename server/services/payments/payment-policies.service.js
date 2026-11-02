import { prisma } from '../../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

/**
 * Payment policy templates for the products that are not hotels, and the
 * one rule for attaching any policy to an item (docs/plans/FLITT_INTEGRATION_PLAN.md §4.4).
 *
 * Hotels keep their own catalogue (services/hotel/policyCatalog.service.js):
 * a hotel-owned policy or a hotel template, attached to a rate plan. This
 * file covers the rest — platform templates tagged with a `productKind`
 * (TOUR, TRANSFER, PACKAGE) and tour-owned policies — and answers "may this
 * item use that policy?" for tour options, packages and transfer providers.
 */

export const TEMPLATE_PRODUCT_KINDS = Object.freeze(['TOUR', 'TRANSFER', 'PACKAGE']);

const templateWhere = (productKind) => ({ hotelId: null, tourId: null, ...(productKind ? { productKind } : { productKind: { in: TEMPLATE_PRODUCT_KINDS } }) });

export const listPaymentPolicyTemplates = ({ productKind = null, includeInactive = false } = {}) =>
    prisma.paymentPolicy.findMany({
        where: { ...templateWhere(productKind), ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ productKind: 'asc' }, { name: 'asc' }]
    });

export const findPaymentPolicyTemplateOr404 = async (id) => {
    const policy = await prisma.paymentPolicy.findFirst({ where: { id, ...templateWhere(null) } });

    if (!policy) {
        throw new NotFoundError('Payment policy not found');
    }

    return policy;
};

export const createPaymentPolicyTemplate = (input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const policy = await tx.paymentPolicy.create({ data: { ...input, hotelId: null, tourId: null } });

        await recordAudit(tx, {
            action: 'PAYMENT_POLICY_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.paymentPolicy,
            entityId: policy.id,
            summary: `Payment policy template "${policy.name}" (${policy.productKind}) created: ${policy.timing}`,
            metadata: { productKind: policy.productKind, timing: policy.timing, unpaidCancelHours: policy.unpaidCancelHours, cardOptional: policy.cardOptional },
            req
        });

        return policy;
    });

export const updatePaymentPolicyTemplate = (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const existing = await tx.paymentPolicy.findFirst({ where: { id, ...templateWhere(null) } });

        if (!existing) {
            throw new NotFoundError('Payment policy not found');
        }

        const policy = await tx.paymentPolicy.update({ where: { id }, data: input });

        await recordAudit(tx, {
            action: 'PAYMENT_POLICY_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.paymentPolicy,
            entityId: policy.id,
            summary: `Payment policy template "${policy.name}" updated`,
            metadata: { fields: Object.keys(input), timing: policy.timing, unpaidCancelHours: policy.unpaidCancelHours, cardOptional: policy.cardOptional },
            req
        });

        return policy;
    });

/**
 * The policy an item of `productKind` may attach: a platform template of
 * that kind, or — for a tour option — one the tour owns. Null clears the
 * attachment (the product default applies). Anything else is a 400 naming
 * the field, so a rate plan's hotel policy can never reach a tour option.
 */
export const resolveAssignablePolicy = async (client, policyId, { productKind, tourId = null }) => {
    if (policyId === null || policyId === undefined) {
        return null;
    }

    const policy = await client.paymentPolicy.findFirst({
        where: {
            id: policyId,
            isActive: true,
            OR: [{ hotelId: null, tourId: null, productKind }, ...(productKind === 'TOUR' && tourId ? [{ tourId }] : [])]
        }
    });

    if (!policy) {
        throw new BadRequestError(`That payment policy cannot be used for a ${productKind.toLowerCase()}`, { field: 'paymentPolicyId', productKind });
    }

    return policy;
};

/** A transfer provider's rule for all its vehicles. */
export const setTransferProviderPaymentPolicy = (providerId, paymentPolicyId, actor, req) =>
    prisma.$transaction(async (tx) => {
        const provider = await tx.transferProvider.findUnique({ where: { id: providerId }, select: { id: true, name: true } });

        if (!provider) {
            throw new NotFoundError('Transfer provider not found');
        }

        const policy = await resolveAssignablePolicy(tx, paymentPolicyId, { productKind: 'TRANSFER' });
        const updated = await tx.transferProvider.update({ where: { id: providerId }, data: { paymentPolicyId: policy?.id ?? null }, include: { paymentPolicy: true } });

        await recordAudit(tx, {
            action: 'PAYMENT_POLICY_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferProvider,
            entityId: providerId,
            summary: `${provider.name}: guests pay ${policy ? `under "${policy.name}" (${policy.timing})` : 'under the platform default'}`,
            metadata: { paymentPolicyId: policy?.id ?? null, timing: policy?.timing ?? null },
            req
        });

        return updated;
    });
