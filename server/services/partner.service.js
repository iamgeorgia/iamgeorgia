import { config } from '../config.js';
import { prisma } from '../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../lib/audit.js';
import { nextPartnerReference } from '../lib/reference.js';
import { NotFoundError, ConflictError, BadRequestError, UnprocessableEntityError } from '../lib/errors.js';
import { lockKey } from '../lib/locks.js';
import { dateOnlyToUtc } from '../lib/time.js';
import { canViewFinancial } from '../serializers/partner.js';
import { companyFullSchema } from '../validation/partner.js';
import { issueAuthToken, revokePartnerSessions, revokeUserSessions } from './auth.service.js';
import { primaryRoleIdFor, primaryRoleInclude } from './rbac/access.js';
import { issueInvitation, revokeOpenInvitations } from './invitation.service.js';
import { issueSignedUrl, uploadFile } from './media/upload.service.js';

const CONTACT_ORDER = [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }];

/** The company's people, primary contact first, each with its role label. */
const USERS = { orderBy: CONTACT_ORDER, include: primaryRoleInclude };

const detailInclude = (withFinancial) => ({
    users: USERS,
    approvedByUser: true,
    rejectedByUser: true,
    suspendedByUser: true,
    blockedByUser: true,
    terminatedByUser: true,
    contractUploadedByUser: true,
    termsAcceptedByUser: true,
    contractAsset: { select: { id: true, originalFilename: true, sizeBytes: true, createdAt: true, deletedAt: true } },
    ...(withFinancial ? { financial: true } : {})
});

/** The statuses in which the relationship has been ended by the platform. */
export const CLOSED_STATUSES = ['BLOCKED', 'TERMINATED'];

/**
 * The only legal ways a partner's status may change, and from where.
 *
 * Expressed as data rather than as branches inside each handler so that
 * "approve a partner that was already rejected" cannot be reached by replaying
 * a request — the guard is the same one for every action, and adding a state
 * later means editing this table, not auditing four endpoints.
 */
const TRANSITIONS = {
    approve: {
        from: ['PENDING_APPROVAL', 'REGISTRATION_IN_PROGRESS'],
        to: 'APPROVED',
        audit: 'PARTNER_APPROVED'
    },
    reject: {
        from: ['PENDING_APPROVAL', 'REGISTRATION_IN_PROGRESS'],
        to: 'REJECTED',
        audit: 'PARTNER_REJECTED'
    },
    suspend: {
        from: ['APPROVED'],
        to: 'SUSPENDED',
        audit: 'PARTNER_SUSPENDED'
    },
    // Rejection is not meant to be final: the existing panel offers "reinstate"
    // from both suspended and rejected, and a company that fixes the paperwork
    // it was declined over should not have to start again.
    reactivate: {
        from: ['SUSPENDED', 'REJECTED'],
        to: 'APPROVED',
        audit: 'PARTNER_REACTIVATED'
    },
    // Blocking is suspension with the door shut: the company cannot even sign
    // in. Unblocking puts it back exactly where it was, approved.
    block: {
        from: ['APPROVED', 'SUSPENDED'],
        to: 'BLOCKED',
        audit: 'PARTNER_BLOCKED'
    },
    unblock: {
        from: ['BLOCKED'],
        to: 'APPROVED',
        audit: 'PARTNER_UNBLOCKED'
    },
    // The end of the relationship, from anywhere. Nothing leads out of it:
    // the company's bookings and debts stay on the books under its name,
    // which is why it is terminated rather than deleted.
    terminate: {
        from: ['INVITED', 'REGISTRATION_IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED'],
        to: 'TERMINATED',
        audit: 'PARTNER_TERMINATED'
    }
};

/**
 * Refuses to approve a company whose record is still half-empty.
 *
 * An admin-drafted partner can legitimately sit in the database without a
 * registration number or a legal address; letting one reach APPROVED would put
 * an unidentifiable company onto the live platform.
 */
const assertReadyForApproval = (partner) => {
    const result = companyFullSchema.safeParse({
        name: partner.name,
        legalName: partner.legalName ?? undefined,
        kind: partner.kind,
        registrationNumber: partner.registrationNumber ?? undefined,
        legalAddress: partner.legalAddress ?? undefined,
        city: partner.city ?? undefined,
        country: partner.country ?? undefined,
        phone: partner.phone ?? undefined,
        email: partner.email ?? undefined,
        website: partner.website ?? undefined,
        socialLinks: partner.socialLinks ?? []
    });

    if (!result.success) {
        throw new BadRequestError('Company details are incomplete', result.error.issues);
    }

    // The contract is the gate: a company trades on the platform under a
    // signed agreement or not at all, unless an admin recorded that it
    // trades without one (grandfathered, or waived on the record).
    if (partner.contractRequired && !partner.contractAssetId) {
        throw new BadRequestError('A signed contract must be on file before this partner can be approved', {
            reason: 'CONTRACT_MISSING'
        });
    }
};

/**
 * Checks a contract file an admin uploaded ahead of creating the partner: a
 * READY private CONTRACT file, not yet attached to any company.
 */
const findAttachableContract = async (client, assetId) => {
    const asset = await client.fileAsset.findFirst({
        where: { id: assetId, deletedAt: null },
        include: { contractOf: { select: { id: true } } }
    });

    if (!asset || asset.category !== 'CONTRACT' || asset.status !== 'READY') {
        throw new UnprocessableEntityError('That file is not a contract on file', { reason: 'CONTRACT_FILE_INVALID' });
    }

    if (asset.contractOf) {
        throw new UnprocessableEntityError('That contract already belongs to another partner', { reason: 'CONTRACT_FILE_TAKEN' });
    }

    return asset;
};

export const findPartnerOr404 = async (id, viewer, { financial = true } = {}) => {
    const partner = await prisma.partner.findUnique({
        where: { id },
        include: detailInclude(false)
    });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    // The financial join only happens for a viewer entitled to the result, so
    // the bank details are not merely hidden late by a serializer — for anyone
    // else they never leave Postgres. A caller that does not need them at all
    // (the session bootstrap) says so and never joins them either.
    if (!financial || !canViewFinancial(viewer, partner)) {
        return partner;
    }

    return prisma.partner.findUnique({ where: { id }, include: detailInclude(true) });
};

export const listPartners = async ({ status, kind, country, q, page, pageSize }) => {
    const where = {
        ...(status ? { status: { in: status } } : {}),
        ...(kind ? { kind } : {}),
        ...(country ? { country } : {}),
        ...(q
            ? {
                  OR: [
                      { name: { contains: q, mode: 'insensitive' } },
                      { legalName: { contains: q, mode: 'insensitive' } },
                      { reference: { contains: q, mode: 'insensitive' } },
                      { registrationNumber: { contains: q, mode: 'insensitive' } },
                      { email: { contains: q, mode: 'insensitive' } },
                      { users: { some: { email: { contains: q, mode: 'insensitive' } } } }
                  ]
              }
            : {})
    };

    const [total, partners] = await Promise.all([
        prisma.partner.count({ where }),
        prisma.partner.findMany({
            where,
            include: { users: USERS },
            orderBy: [{ createdAt: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { partners, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

const assertRegistrationNumberFree = async (registrationNumber, exceptId) => {
    if (!registrationNumber) {
        return;
    }

    const existing = await prisma.partner.findFirst({
        where: { registrationNumber, ...(exceptId ? { NOT: { id: exceptId } } : {}) }
    });

    if (existing) {
        throw new ConflictError('A partner with this registration number already exists');
    }
};

const assertEmailFree = async (email) => {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
        throw new ConflictError('An account already exists for this email address');
    }
};

/**
 * The admin-side creation flow, in its three modes.
 *
 * Every mode returns the link it generated as well as sending it. A mail server
 * that is briefly down should not leave an admin with a partner they cannot
 * onboard — they can copy the link out of the response instead, and `emailSent`
 * tells the panel whether to say so.
 */
export const adminCreatePartner = async (payload, admin, req) => {
    const { mode, company, contact, financial, commissionRateBps, notes, documents, contract, contractRequired } = payload;

    await assertEmailFree(contact.email);
    await assertRegistrationNumberFree(company.registrationNumber);

    const isDraft = mode === 'invite';

    return prisma.$transaction(async (tx) => {
        const contractAsset = contract ? await findAttachableContract(tx, contract.assetId) : null;

        const partner = await tx.partner.create({
            data: {
                ...company,
                reference: await nextPartnerReference(tx),
                status: isDraft ? 'INVITED' : mode === 'approve' ? 'APPROVED' : 'PENDING_APPROVAL',
                ...(commissionRateBps === undefined ? {} : { commissionRateBps }),
                ...(notes === undefined ? {} : { notes }),
                documents,
                contractRequired,
                ...(contractAsset
                    ? {
                          contractAssetId: contractAsset.id,
                          contractSignedAt: dateOnlyToUtc(contract.signedAt),
                          contractVersion: contract.version ?? null,
                          contractUploadedAt: new Date(),
                          contractUploadedByUserId: admin.id
                      }
                    : {}),
                ...(isDraft ? {} : { submittedAt: new Date() }),
                ...(mode === 'approve' ? { approvedAt: new Date(), approvedByUserId: admin.id } : {})
            }
        });

        if (contractAsset) {
            // The file was uploaded before the company existed; it is the
            // company's now, so the company's own users may read it.
            await tx.fileAsset.update({ where: { id: contractAsset.id }, data: { partnerId: partner.id } });

            await recordAudit(tx, {
                action: 'PARTNER_CONTRACT_UPLOADED',
                actor: admin,
                entityType: AUDIT_ENTITY.partner,
                entityId: partner.id,
                summary: `${admin.email} filed the signed contract for ${partner.name}`,
                metadata: { assetId: contractAsset.id, signedAt: contract.signedAt, version: contract.version ?? null },
                req
            });
        }

        if (isDraft) {
            // No user row yet. An account with no password, for someone who may
            // never register, would occupy their email address for nothing —
            // the contact details ride along in the invitation instead.
            const { token, invitation } = await issueInvitation(tx, {
                email: contact.email,
                partnerId: partner.id,
                invitedByUserId: admin.id,
                prefill: { contact }
            });

            await recordAudit(tx, {
                action: 'PARTNER_INVITED',
                actor: admin,
                entityType: AUDIT_ENTITY.partner,
                entityId: partner.id,
                summary: `${admin.email} invited ${contact.email} to register ${partner.name}`,
                metadata: { reference: partner.reference, email: contact.email, invitationId: invitation.id },
                req
            });

            return { partner, mode, kind: 'invitation', token, expiresAt: invitation.expiresAt, contact };
        }

        const user = await tx.user.create({
            data: {
                email: contact.email,
                primaryRoleId: await primaryRoleIdFor(tx, 'PARTNER_OWNER'),
                firstName: contact.firstName,
                lastName: contact.lastName,
                position: contact.position ?? null,
                phone: contact.phone ?? null,
                isPrimaryContact: true,
                partnerId: partner.id
            }
        });

        if (financial) {
            await tx.partnerFinancialDetail.create({ data: { partnerId: partner.id, ...financial } });
        }

        const { token, authToken } = await issueAuthToken(tx, {
            userId: user.id,
            purpose: 'ACCOUNT_ACTIVATION',
            ttlMs: config.auth.activationTtlMs
        });

        await recordAudit(tx, {
            action: 'PARTNER_CREATED',
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: partner.id,
            summary: `${admin.email} created ${partner.name} and sent an activation link to ${contact.email}`,
            // A company created to trade without a contract is on the trail
            // as such, next to who decided it.
            metadata: { reference: partner.reference, mode, contractRequired },
            req
        });

        if (mode === 'approve') {
            await recordAudit(tx, {
                action: 'PARTNER_APPROVED',
                actor: admin,
                entityType: AUDIT_ENTITY.partner,
                entityId: partner.id,
                summary: `${admin.email} approved ${partner.name} on creation`,
                metadata: { reference: partner.reference, mode },
                req
            });
        }

        return { partner, mode, kind: 'activation', token, expiresAt: authToken.expiresAt, contact };
    });
};

export const updatePartner = async (id, data, admin, req) => {
    const existing = await prisma.partner.findUnique({ where: { id } });

    if (!existing) {
        throw new NotFoundError('Partner not found');
    }

    await assertRegistrationNumberFree(data.registrationNumber, id);

    // Only what actually moved goes into the audit metadata, so the trail reads
    // as a list of changes rather than a copy of the record.
    const changes = Object.fromEntries(
        Object.entries(data)
            .filter(([key, value]) => JSON.stringify(existing[key]) !== JSON.stringify(value))
            .map(([key, value]) => [key, { from: existing[key] ?? null, to: value }])
    );

    if (Object.keys(changes).length === 0) {
        return existing;
    }

    return prisma.$transaction(async (tx) => {
        const partner = await tx.partner.update({ where: { id }, data });

        await recordAudit(tx, {
            action: 'PARTNER_UPDATED',
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: id,
            summary: `${admin.email} edited ${partner.name}`,
            metadata: { changes },
            req
        });

        return partner;
    });
};

/**
 * Moves a partner between statuses, recording who did it and why.
 *
 * The status change, the reviewer stamp, the session revocation and the audit
 * row all commit together: there is no interval in which a partner is suspended
 * but still holding a live session, or approved with nothing saying by whom.
 */
export const transitionPartner = async (id, action, input, admin, req) => {
    const rule = TRANSITIONS[action];
    const partner = await prisma.partner.findUnique({
        where: { id },
        include: { users: USERS }
    });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    if (!rule.from.includes(partner.status)) {
        throw new ConflictError(`A partner with status ${partner.status} cannot be ${action}d`, {
            status: partner.status,
            allowedFrom: rule.from
        });
    }

    if (rule.to === 'APPROVED') {
        assertReadyForApproval(partner);
    }

    const now = new Date();

    const data = { status: rule.to };
    let summary;

    if (action === 'approve' || action === 'reactivate') {
        Object.assign(data, {
            approvedAt: now,
            approvedByUserId: admin.id,
            // The record should describe where the partner is now, not carry a
            // rejection that has been overturned.
            rejectedAt: null,
            rejectedByUserId: null,
            rejectionReason: null,
            rejectionNote: null,
            suspendedAt: null,
            suspendedByUserId: null,
            suspensionReason: null
        });
        summary = `${admin.email} ${action === 'approve' ? 'approved' : 'reinstated'} ${partner.name}`;
    }

    if (action === 'reject') {
        Object.assign(data, {
            rejectedAt: now,
            rejectedByUserId: admin.id,
            rejectionReason: input.reason,
            rejectionNote: input.internalNote ?? null
        });
        summary = `${admin.email} rejected ${partner.name}`;
    }

    if (action === 'suspend') {
        Object.assign(data, {
            suspendedAt: now,
            suspendedByUserId: admin.id,
            suspensionReason: input.reason
        });
        summary = `${admin.email} suspended ${partner.name}`;
    }

    if (action === 'block') {
        Object.assign(data, {
            blockedAt: now,
            blockedByUserId: admin.id,
            blockedReason: input.reason,
            suspendedAt: null,
            suspendedByUserId: null,
            suspensionReason: null
        });
        summary = `${admin.email} blocked ${partner.name}`;
    }

    if (action === 'unblock') {
        // Back to approved as it was: the original approval stands, only the
        // block is lifted.
        Object.assign(data, { blockedAt: null, blockedByUserId: null, blockedReason: null });
        summary = `${admin.email} unblocked ${partner.name}`;
    }

    if (action === 'terminate') {
        if (input.confirm.trim().toUpperCase() !== partner.reference) {
            throw new BadRequestError('Type the Partner ID exactly to confirm termination', {
                expected: partner.reference
            });
        }

        Object.assign(data, {
            terminatedAt: now,
            terminatedByUserId: admin.id,
            terminatedReason: input.reason
        });
        summary = `${admin.email} terminated ${partner.name}`;
    }

    return prisma.$transaction(async (tx) => {
        // Serialised per partner, and the status re-read under the lock: the
        // check above ran outside the transaction, and an approve and a
        // reject arriving together must not both succeed with the last write
        // winning.
        await lockKey(tx, `partner:${id}`);

        const current = await tx.partner.findUnique({ where: { id }, select: { status: true } });

        if (current?.status !== partner.status) {
            throw new ConflictError(`A partner with status ${current?.status ?? 'unknown'} cannot be ${action}d`, {
                status: current?.status ?? null,
                allowedFrom: rule.from
            });
        }

        const updated = await tx.partner.update({ where: { id }, data });

        if (rule.to === 'TERMINATED') {
            // Nobody from the company signs in again: the accounts are
            // switched off, every open password or activation link is spent,
            // and any invitation still out there is withdrawn. The user rows
            // stay, because bookings and audit lines point at them.
            await tx.user.updateMany({ where: { partnerId: id, isActive: true }, data: { isActive: false } });
            await tx.authToken.updateMany({ where: { usedAt: null, user: { partnerId: id } }, data: { usedAt: now } });
            await revokeOpenInvitations(tx, { partnerId: id });
        }

        if (rule.to === 'REJECTED' || rule.to === 'SUSPENDED' || CLOSED_STATUSES.includes(rule.to)) {
            await revokePartnerSessions(tx, id);

            // Drivers are not members of the company — they carry no
            // partnerId — so the revocation above misses them. Their
            // affiliation runs through the transfer provider; `requireDriver`
            // refuses them from here on, and this ends the sessions they hold.
            const drivers = await tx.transferDriver.findMany({
                where: { userId: { not: null }, provider: { partnerId: id } },
                select: { userId: true }
            });

            for (const driver of drivers) {
                await revokeUserSessions(tx, driver.userId);
            }
        }

        await recordAudit(tx, {
            action: rule.audit,
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: id,
            summary,
            metadata: {
                from: partner.status,
                to: rule.to,
                reference: partner.reference,
                ...(input.reason ? { reason: input.reason } : {}),
                ...(input.internalNote ? { internalNote: input.internalNote } : {}),
                ...(input.note ? { note: input.note } : {})
            },
            req
        });

        return { partner: updated, previousStatus: partner.status, users: partner.users };
    });
};

/**
 * Removes a partner and everything that belongs only to it.
 *
 * The cascade takes its users (and with them their sessions and tokens), its
 * bank details and its invitations. The audit trail is the one thing that
 * stays: `AuditLog` references its subject by plain strings rather than a
 * foreign key precisely so that "who deleted this company, and when" survives
 * the company. The audit row is written inside the same transaction, before
 * the delete, so the two commit together or not at all.
 *
 * The Partner ID is not reused. It came from a sequence that only moves
 * forward, which is what stops a new company inheriting the identity of a
 * deleted one in someone's old email.
 *
 * `confirm` must be the partner's own reference. That is a guard against a
 * mistyped id in a script as much as against a misclick in the panel: a
 * DELETE that names the wrong record now fails instead of destroying it.
 */
export const deletePartner = async (id, { confirm }, admin, req) => {
    const partner = await prisma.partner.findUnique({
        where: { id },
        include: { users: USERS }
    });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    if (confirm.trim().toUpperCase() !== partner.reference) {
        throw new BadRequestError('Type the Partner ID exactly to confirm deletion', {
            expected: partner.reference
        });
    }

    // A company with a booking or a balance on the books is history, not
    // clutter: deleting it would orphan money. It is terminated instead, and
    // stays under its own name.
    const [bookings, debts] = await Promise.all([
        Promise.all([
            prisma.hotelBooking.count({ where: { partnerId: id } }),
            prisma.transferBooking.count({ where: { partnerId: id } }),
            prisma.tourBooking.count({ where: { partnerId: id } }),
            prisma.serviceBooking.count({ where: { partnerId: id } }),
            prisma.order.count({ where: { partnerId: id } })
        ]),
        Promise.all([
            prisma.receivable.count({ where: { debtorPartnerId: id } }),
            prisma.supplierPayable.count({ where: { supplierPartnerId: id } })
        ])
    ]);

    if (bookings.some((count) => count > 0) || debts.some((count) => count > 0)) {
        throw new ConflictError('This partner has bookings or balances on the books; terminate it instead', {
            reason: 'USE_TERMINATE',
            bookings: bookings.reduce((sum, count) => sum + count, 0),
            ledgerEntries: debts.reduce((sum, count) => sum + count, 0)
        });
    }

    return prisma.$transaction(async (tx) => {
        await recordAudit(tx, {
            action: 'PARTNER_DELETED',
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: id,
            summary: `${admin.email} deleted ${partner.name}`,
            // A snapshot of what was removed, because after this commit the
            // record it describes is gone and the row is all that is left.
            metadata: {
                reference: partner.reference,
                name: partner.name,
                legalName: partner.legalName,
                registrationNumber: partner.registrationNumber,
                status: partner.status,
                accountsRemoved: partner.users.map((user) => user.email)
            },
            req
        });

        await tx.partner.delete({ where: { id } });

        return partner;
    });
};

export const readFinancial = async (id, admin, req) => {
    const financial = await prisma.partnerFinancialDetail.findUnique({ where: { partnerId: id } });

    if (financial) {
        // Reading bank details is itself a privileged act, so it is recorded.
        // Without this the trail would show who changed an IBAN but not who
        // looked at one.
        await recordAudit(prisma, {
            action: 'PARTNER_FINANCIAL_VIEWED',
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: id,
            summary: `${admin.email} viewed bank details`,
            req
        });
    }

    return financial;
};

export const updateFinancial = async (id, data, admin, req) => {
    const partner = await prisma.partner.findUnique({ where: { id } });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    return prisma.$transaction(async (tx) => {
        const financial = await tx.partnerFinancialDetail.upsert({
            where: { partnerId: id },
            create: { partnerId: id, ...data },
            update: data
        });

        await recordAudit(tx, {
            action: 'PARTNER_FINANCIAL_UPDATED',
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: id,
            summary: `${admin.email} updated bank details for ${partner.name}`,
            // The IBAN itself is deliberately not copied into the metadata: an
            // audit table readable by more people than the financial table
            // would otherwise become the easier way to read it.
            metadata: { fields: Object.keys(data) },
            req
        });

        return financial;
    });
};

/** Issues a fresh invitation and retires whatever came before it. */
export const reissueInvitation = async (id, admin, req) => {
    const partner = await prisma.partner.findUnique({
        where: { id },
        include: { users: USERS, invitations: { orderBy: { createdAt: 'desc' }, take: 1 } }
    });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    const previous = partner.invitations[0];
    const email = previous?.email ?? partner.users[0]?.email ?? partner.email;

    if (!email) {
        throw new BadRequestError('This partner has no contact address to invite');
    }

    if (partner.status === 'APPROVED' || partner.status === 'SUSPENDED' || CLOSED_STATUSES.includes(partner.status)) {
        throw new ConflictError('This partner has already completed registration');
    }

    return prisma.$transaction(async (tx) => {
        await revokeOpenInvitations(tx, { partnerId: id });

        const { token, invitation } = await issueInvitation(tx, {
            email,
            partnerId: id,
            invitedByUserId: admin.id,
            prefill: previous?.prefill ?? {}
        });

        await tx.invitation.update({
            where: { id: invitation.id },
            data: { resentCount: (previous?.resentCount ?? 0) + 1 }
        });

        await recordAudit(tx, {
            action: 'INVITATION_RESENT',
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: id,
            summary: `${admin.email} sent a new invitation to ${email}`,
            metadata: { email, invitationId: invitation.id, replaced: previous?.id ?? null },
            req
        });

        return { partner, token, email, expiresAt: invitation.expiresAt, isReissue: Boolean(previous) };
    });
};

export const listAudit = (entityId, { take = 100 } = {}) =>
    prisma.auditLog.findMany({
        where: { entityType: AUDIT_ENTITY.partner, entityId },
        include: { actorUser: true },
        orderBy: { createdAt: 'desc' },
        take
    });

export const primaryContactOf = (partner) =>
    (partner.users ?? []).find((user) => user.isPrimaryContact) ?? partner.users?.[0] ?? null;

// --- Contract and terms ---------------------------------------------------

/**
 * Files the signed contract. A private CONTRACT file owned by the company,
 * so its own owner reads it through the same signed link an admin does. A
 * second upload replaces the first; the previous file stays on disk, named
 * on the trail.
 */
export const uploadContract = async (id, file, { signedAt, version }, admin, req) => {
    const partner = await prisma.partner.findUnique({ where: { id } });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    if (partner.status === 'TERMINATED') {
        throw new ConflictError('This partner has been terminated', { status: partner.status });
    }

    const asset = await uploadFile(
        {
            buffer: file?.buffer,
            originalFilename: file?.originalname ?? 'contract.pdf',
            declaredMimeType: file?.mimetype,
            category: 'CONTRACT',
            partnerId: id
        },
        admin,
        req
    );

    return prisma.$transaction(async (tx) => {
        const updated = await tx.partner.update({
            where: { id },
            data: {
                contractAssetId: asset.id,
                contractSignedAt: dateOnlyToUtc(signedAt),
                contractVersion: version ?? null,
                contractUploadedAt: new Date(),
                contractUploadedByUserId: admin.id
            }
        });

        await recordAudit(tx, {
            action: 'PARTNER_CONTRACT_UPLOADED',
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: id,
            summary: `${admin.email} filed the signed contract for ${partner.name}`,
            metadata: { assetId: asset.id, signedAt, version: version ?? null, replaced: partner.contractAssetId },
            req
        });

        return updated;
    });
};

/** A short-lived link to the contract, for an admin or the company itself. Audited by the media service. */
export const contractLink = async (id, viewer, req) => {
    const partner = await prisma.partner.findUnique({ where: { id }, select: { contractAssetId: true } });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    if (!partner.contractAssetId) {
        throw new NotFoundError('No contract on file');
    }

    return issueSignedUrl(partner.contractAssetId, viewer, req);
};

/** Waives or reinstates the contract requirement, with a reason on the trail. */
export const setContractRequirement = async (id, { contractRequired, reason }, admin, req) => {
    const partner = await prisma.partner.findUnique({ where: { id } });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    if (partner.contractRequired === contractRequired) {
        return partner;
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.partner.update({ where: { id }, data: { contractRequired } });

        await recordAudit(tx, {
            action: 'PARTNER_UPDATED',
            actor: admin,
            entityType: AUDIT_ENTITY.partner,
            entityId: id,
            summary: `${admin.email} ${contractRequired ? 'required a contract from' : 'waived the contract for'} ${partner.name}`,
            metadata: { changes: { contractRequired: { from: partner.contractRequired, to: contractRequired } }, reason },
            req
        });

        return updated;
    });
};

/** Whether the company has accepted the terms now in force. */
export const termsCurrent = (partner) => partner?.termsVersion === config.partners.termsVersion;

/**
 * The owner accepts the current terms for the company. Any other version is
 * refused: the client shows the text it was given, and that text must be
 * the one being agreed to.
 */
export const acceptTerms = async (user, { version }, req) => {
    if (version !== config.partners.termsVersion) {
        throw new BadRequestError('Those are not the current terms', {
            reason: 'TERMS_VERSION_STALE',
            current: config.partners.termsVersion
        });
    }

    const partner = await prisma.partner.findUnique({ where: { id: user.partnerId } });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    if (termsCurrent(partner)) {
        return partner;
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.partner.update({
            where: { id: partner.id },
            data: { termsVersion: version, termsAcceptedAt: new Date(), termsAcceptedByUserId: user.id }
        });

        await recordAudit(tx, {
            action: 'PARTNER_TERMS_ACCEPTED',
            actor: user,
            entityType: AUDIT_ENTITY.partner,
            entityId: partner.id,
            summary: `${user.email} accepted the platform terms (${version}) for ${partner.name}`,
            metadata: { version, previous: partner.termsVersion },
            req
        });

        return updated;
    });
};

// --- Product access -------------------------------------------------------

const PRODUCT_TABLE = {
    HOTEL: (client, ids) => client.hotel.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }),
    TRANSFER: (client, ids) => client.transferVehicle.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }),
    TOUR: (client, ids) => client.tour.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, slug: true } }),
    SERVICE: (client, ids) => client.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }),
    PACKAGE: (client, ids) => client.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } })
};

/** The products behind a set of access rows, by type, for display and for checking they exist. */
const resolveProducts = async (client, entries) => {
    const byType = new Map();

    for (const entry of entries) {
        if (!byType.has(entry.productType)) {
            byType.set(entry.productType, new Set());
        }

        byType.get(entry.productType).add(entry.productId);
    }

    const found = new Map();

    for (const [type, ids] of byType) {
        for (const product of await PRODUCT_TABLE[type](client, [...ids])) {
            found.set(`${type}:${product.id}`, { id: product.id, name: product.name ?? product.title, slug: product.slug });
        }
    }

    return found;
};

export const listProductAccess = async (id) => {
    const partner = await prisma.partner.findUnique({ where: { id }, select: { id: true } });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    const entries = await prisma.partnerProductAccess.findMany({
        where: { partnerId: id },
        include: { createdByUser: true },
        orderBy: [{ productType: 'asc' }, { createdAt: 'asc' }]
    });
    const products = await resolveProducts(prisma, entries);

    return entries.map((entry) => ({ ...entry, product: products.get(`${entry.productType}:${entry.productId}`) ?? null }));
};

/**
 * Replaces the company's access list as a whole. What the admin sends is the
 * list; what was there and is absent now is removed. Every product named
 * must exist, so a typo cannot quietly become a rule that matches nothing.
 */
export const setProductAccess = async (id, entries, admin, req) => {
    const partner = await prisma.partner.findUnique({ where: { id }, select: { id: true, name: true } });

    if (!partner) {
        throw new NotFoundError('Partner not found');
    }

    const products = await resolveProducts(prisma, entries);
    const unknown = entries.filter((entry) => !products.has(`${entry.productType}:${entry.productId}`));

    if (unknown.length > 0) {
        throw new UnprocessableEntityError('Some products do not exist', {
            reason: 'UNKNOWN_PRODUCT',
            products: unknown.map((entry) => ({ productType: entry.productType, productId: entry.productId }))
        });
    }

    await prisma.$transaction(async (tx) => {
        const existing = await tx.partnerProductAccess.findMany({ where: { partnerId: id } });
        const keyOf = (row) => `${row.productType}:${row.productId}`;
        const wanted = new Map(entries.map((entry) => [keyOf(entry), entry]));
        const current = new Map(existing.map((row) => [keyOf(row), row]));

        const removed = existing.filter((row) => !wanted.has(keyOf(row)));
        const added = entries.filter((entry) => !current.has(keyOf(entry)));
        const changed = entries.filter((entry) => {
            const row = current.get(keyOf(entry));

            return row && (row.mode !== entry.mode || (row.note ?? null) !== (entry.note ?? null));
        });

        if (removed.length > 0) {
            await tx.partnerProductAccess.deleteMany({ where: { id: { in: removed.map((row) => row.id) } } });
        }

        for (const entry of changed) {
            await tx.partnerProductAccess.update({
                where: { id: current.get(keyOf(entry)).id },
                data: { mode: entry.mode, note: entry.note ?? null }
            });
        }

        if (added.length > 0) {
            await tx.partnerProductAccess.createMany({
                data: added.map((entry) => ({
                    partnerId: id,
                    productType: entry.productType,
                    productId: entry.productId,
                    mode: entry.mode,
                    note: entry.note ?? null,
                    createdByUserId: admin.id
                }))
            });
        }

        if (removed.length + added.length + changed.length > 0) {
            const describe = (row) => ({ productType: row.productType, productId: row.productId, mode: row.mode });

            await recordAudit(tx, {
                action: 'PARTNER_PRODUCT_ACCESS_CHANGED',
                actor: admin,
                entityType: AUDIT_ENTITY.partner,
                entityId: id,
                summary: `${admin.email} changed what ${partner.name} may sell`,
                metadata: { added: added.map(describe), removed: removed.map(describe), changed: changed.map(describe) },
                req
            });
        }
    });

    // Read back after the commit, not inside it: the list is served by the
    // default client, which would not see the transaction's own writes.
    return listProductAccess(id);
};
