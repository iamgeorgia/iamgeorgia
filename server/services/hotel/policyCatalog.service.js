import { prisma } from '../../db/index.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { PAYMENT_TEMPLATES, POLICY_TEMPLATES } from './policy.service.js';

/**
 * Managing cancellation and payment policies.
 *
 * Distinct from `policy.service.js`, which is the pure calculation: this file
 * owns the rows, that one owns the arithmetic. Keeping them apart is what lets
 * every refund boundary be tested without a database.
 *
 * Cancellation and payment live together here because they are siblings — both
 * hotel-scoped templates attached to a rate plan — but they are deliberately
 * separate *entities*, because in B2B they vary independently: a non-refundable
 * rate can still settle on a credit account thirty days after checkout.
 */

const assertHotel = async (client, hotelId) => {
    const hotel = await client.hotel.findUnique({ where: { id: hotelId } });

    if (!hotel) {
        throw new NotFoundError('Hotel not found');
    }

    return hotel;
};

/**
 * A hotel's policies, plus the platform templates it can also use.
 *
 * Templates carry a null `hotelId` and are shared, so a new property is offered
 * a choice rather than a blank form. They are returned alongside rather than
 * copied, so improving a template improves it everywhere it has not been
 * overridden.
 */
// A hotel's template is one with no owner and no product kind: payment
// templates for tours, transfers and packages carry a `productKind` and are
// not offered to a rate plan.
const templateWhere = (delegate) => (delegate === 'paymentPolicy' ? { hotelId: null, tourId: null, productKind: null } : { hotelId: null });

const listPolicies = (delegate) => async (hotelId, { includeInactive, includeTemplates } = {}) => {
    await assertHotel(prisma, hotelId);

    return prisma[delegate].findMany({
        where: {
            ...(includeInactive ? {} : { isActive: true }),
            ...(includeTemplates ? { OR: [{ hotelId }, templateWhere(delegate)] } : { hotelId })
        },
        ...(delegate === 'cancellationPolicy'
            ? { include: { rules: { orderBy: { hoursBeforeCheckIn: 'desc' } } } }
            : {}),
        orderBy: [{ hotelId: 'asc' }, { name: 'asc' }]
    });
};

export const listCancellationPolicies = listPolicies('cancellationPolicy');
export const listPaymentPolicies = listPolicies('paymentPolicy');

/**
 * Reads a policy a hotel is entitled to use: its own, or a shared template.
 *
 * The `hotelId IN (this, null)` filter is the authorization check — without it
 * a rate plan could reference another property's negotiated terms by id.
 */
export const findUsablePolicy = async (client, delegate, hotelId, policyId) => {
    const policy = await client[delegate].findFirst({
        where: { id: policyId, OR: [{ hotelId }, templateWhere(delegate)] }
    });

    if (!policy) {
        throw new NotFoundError('Policy not found');
    }

    return policy;
};

export const findCancellationPolicyOr404 = async (hotelId, policyId) => {
    const policy = await prisma.cancellationPolicy.findFirst({
        where: { id: policyId, OR: [{ hotelId }, { hotelId: null }] },
        include: { rules: { orderBy: { hoursBeforeCheckIn: 'desc' } } }
    });

    if (!policy) {
        throw new NotFoundError('Cancellation policy not found');
    }

    return policy;
};

export const upsertCancellationPolicy = async (hotelId, policyId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const hotel = await assertHotel(tx, hotelId);
        const { rules, ...fields } = input;

        if (policyId) {
            const current = await tx.cancellationPolicy.findFirst({ where: { id: policyId } });

            if (!current) {
                throw new NotFoundError('Cancellation policy not found');
            }

            // A shared template belongs to the platform, not to one property.
            // Letting a hotel edit one would change terms for every other
            // property using it.
            if (current.hotelId !== hotelId) {
                throw new ConflictError('A shared policy template cannot be edited by a hotel', {
                    hint: 'Create a hotel-specific policy instead'
                });
            }
        }

        const policy = policyId
            ? await tx.cancellationPolicy.update({ where: { id: policyId }, data: fields })
            : await tx.cancellationPolicy.create({ data: { ...fields, hotelId } });

        // Rules are replaced whole: the set is the unit of meaning.
        await tx.cancellationRule.deleteMany({ where: { policyId: policy.id } });

        if (rules.length > 0) {
            await tx.cancellationRule.createMany({
                data: rules.map((rule) => ({ ...rule, policyId: policy.id }))
            });
        }

        await recordAudit(tx, {
            action: policyId ? 'CANCELLATION_POLICY_UPDATED' : 'CANCELLATION_POLICY_CREATED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: hotelId,
            summary: `${policyId ? 'Updated' : 'Created'} cancellation policy "${policy.name}" on ${hotel.name}`,
            metadata: { policyId: policy.id, kind: policy.kind, rules: rules.length },
            req
        });

        return tx.cancellationPolicy.findUnique({
            where: { id: policy.id },
            include: { rules: { orderBy: { hoursBeforeCheckIn: 'desc' } } }
        });
    });

export const upsertPaymentPolicy = async (hotelId, policyId, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const hotel = await assertHotel(tx, hotelId);

        if (policyId) {
            const current = await tx.paymentPolicy.findFirst({ where: { id: policyId } });

            if (!current) {
                throw new NotFoundError('Payment policy not found');
            }

            if (current.hotelId !== hotelId) {
                throw new ConflictError('A shared policy template cannot be edited by a hotel', {
                    hint: 'Create a hotel-specific policy instead'
                });
            }
        }

        const policy = policyId
            ? await tx.paymentPolicy.update({ where: { id: policyId }, data: input })
            : await tx.paymentPolicy.create({ data: { ...input, hotelId } });

        await recordAudit(tx, {
            action: policyId ? 'PAYMENT_POLICY_UPDATED' : 'PAYMENT_POLICY_CREATED',
            actor,
            entityType: AUDIT_ENTITY.hotel,
            entityId: hotelId,
            summary: `${policyId ? 'Updated' : 'Created'} payment policy "${policy.name}" on ${hotel.name}`,
            metadata: { policyId: policy.id, timing: policy.timing },
            req
        });

        return policy;
    });

/**
 * Creates the platform-wide templates if they are not already there.
 *
 * Run from `scripts/seed-reference.js`. Idempotent on name, and it never
 * touches a hotel's own policies.
 */
export const seedPolicyTemplates = async (client = prisma) => {
    let created = 0;

    for (const template of POLICY_TEMPLATES) {
        const existing = await client.cancellationPolicy.findFirst({
            where: { hotelId: null, name: template.name }
        });

        if (existing) {
            continue;
        }

        const { rules, ...fields } = template;

        await client.cancellationPolicy.create({
            data: { ...fields, hotelId: null, rules: { create: rules } }
        });
        created += 1;
    }

    for (const template of PAYMENT_TEMPLATES) {
        const productKind = template.productKind ?? null;
        const existing = await client.paymentPolicy.findFirst({
            where: { hotelId: null, tourId: null, productKind, name: template.name }
        });

        if (!existing) {
            await client.paymentPolicy.create({ data: { ...template, productKind, hotelId: null } });
            created += 1;
        }
    }

    return created;
};
