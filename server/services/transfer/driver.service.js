import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { recordAudit, AUDIT_ENTITY } from '../../lib/audit.js';
import { ACTIVE_ASSIGNMENT_STATUSES, LIVE_LEG_STATUSES } from '../../lib/transfer/machines.js';
import { issueAuthToken, revokeUserSessions } from '../auth.service.js';
import { createDocumentLibrary, documentInclude } from '../media/documentLibrary.js';
import { findOrphanedAssets, removeOrphanedObjects } from '../media/orphans.js';

/**
 * Driver profiles.
 *
 * The profile and the login are two records. A profile is created by
 * operations and may be dispatched to before it has a login (the dispatcher
 * phones); a login is created later, on request, and linked. Deactivating the
 * profile deactivates the login and ends its sessions in the same transaction,
 * so a driver who has been let go is out on their next request.
 */

const imageWithVariants = { include: { variants: true } };

/** What every driver read loads. One shape, so the serializers agree. */
export const driverInclude = {
    provider: { select: { id: true, slug: true, name: true } },
    photo: imageWithVariants,
    homeBasePoint: { select: { id: true, slug: true, name: true } },
    user: true,
    verifiedByUser: true,
    vehicles: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        include: { fleetVehicle: { include: { mainImage: imageWithVariants } } }
    },
    documents: {
        orderBy: [{ docType: 'asc' }, { createdAt: 'desc' }],
        include: documentInclude
    }
};

export const driverName = (driver) => `${driver.firstName} ${driver.lastName}`;

const toDate = (dateOnly) => (dateOnly ? new Date(`${dateOnly}T00:00:00Z`) : null);

const findOr404InTx = async (tx, id) => {
    const driver = await tx.transferDriver.findUnique({ where: { id }, include: driverInclude });

    if (!driver) {
        throw new NotFoundError('That driver does not exist');
    }

    return driver;
};

export const findDriverOr404 = (id) => findOr404InTx(prisma, id);

/** The profile a DRIVER account is linked to, or null when none is. */
export const findDriverByUserId = (userId) =>
    prisma.transferDriver.findUnique({
        where: { userId },
        include: driverInclude
    });

export const listDrivers = async (query) => {
    const { page, pageSize, providerId, verificationStatus, isActive, search } = query;

    const where = {
        ...(providerId ? { providerId } : {}),
        ...(verificationStatus
            ? { verificationStatus: Array.isArray(verificationStatus) ? { in: verificationStatus } : verificationStatus }
            : {}),
        ...(isActive === undefined ? {} : { isActive }),
        ...(search
            ? {
                  OR: [
                      { firstName: { contains: search, mode: 'insensitive' } },
                      { lastName: { contains: search, mode: 'insensitive' } },
                      { phone: { contains: search } },
                      { email: { contains: search, mode: 'insensitive' } }
                  ]
              }
            : {})
    };

    const [total, drivers] = await Promise.all([
        prisma.transferDriver.count({ where }),
        prisma.transferDriver.findMany({
            where,
            include: driverInclude,
            orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize
        })
    ]);

    return { drivers, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

const assertReferences = async (tx, { providerId, photoFileAssetId, homeBasePointId }) => {
    if (providerId) {
        const provider = await tx.transferProvider.findUnique({ where: { id: providerId }, select: { id: true } });

        if (!provider) {
            throw new BadRequestError('That provider does not exist', { field: 'providerId' });
        }
    }

    if (photoFileAssetId) {
        const asset = await tx.fileAsset.findFirst({
            where: { id: photoFileAssetId, deletedAt: null },
            select: { visibility: true, mimeType: true }
        });

        if (!asset || asset.visibility !== 'PUBLIC' || !asset.mimeType.startsWith('image/')) {
            throw new BadRequestError('The photo must be a public image from the media library', {
                field: 'photoFileAssetId'
            });
        }
    }

    if (homeBasePointId) {
        const point = await tx.transferPoint.findUnique({ where: { id: homeBasePointId }, select: { id: true } });

        if (!point) {
            throw new BadRequestError('That pick-up point does not exist', { field: 'homeBasePointId' });
        }
    }
};

/** The request fields as columns; the two dates become dates. */
const profileData = (input) => {
    const data = { ...input };

    if ('licenceExpiresOn' in input) {
        data.licenceExpiresOn = toDate(input.licenceExpiresOn);
    }

    if ('dateOfBirth' in input) {
        data.dateOfBirth = toDate(input.dateOfBirth);
    }

    return data;
};

export const createDriver = (input, actor, req) =>
    prisma.$transaction(async (tx) => {
        await assertReferences(tx, input);

        const driver = await tx.transferDriver.create({
            data: profileData(input),
            include: driverInclude
        });

        await recordAudit(tx, {
            action: 'TRANSFER_DRIVER_CREATED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: driver.id,
            summary: `Created driver ${driverName(driver)}`,
            req
        });

        return driver;
    });

export const updateDriver = (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        await findOr404InTx(tx, id);
        await assertReferences(tx, input);

        const driver = await tx.transferDriver.update({
            where: { id },
            data: profileData(input),
            include: driverInclude
        });

        await recordAudit(tx, {
            action: 'TRANSFER_DRIVER_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `Updated driver ${driverName(driver)}`,
            metadata: { fields: Object.keys(input) },
            req
        });

        return driver;
    });

/** The driver's own edits: contact and copy, nothing that changes standing. */
export const updateDriverSelf = (id, input, actor, req) =>
    prisma.$transaction(async (tx) => {
        const driver = await tx.transferDriver.update({ where: { id }, data: input, include: driverInclude });

        await recordAudit(tx, {
            action: 'TRANSFER_DRIVER_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `${driverName(driver)} updated their own profile`,
            metadata: { fields: Object.keys(input), self: true },
            req
        });

        return driver;
    });

/**
 * Records the outcome of checking a driver's identity and licence.
 *
 * VERIFIED carries who and when, and the CHECK constraint insists on the
 * timestamp; every other status clears them, so a driver moved back to
 * PENDING is not still wearing a verifier's name.
 */
export const setDriverVerification = (id, { status, note }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const existing = await findOr404InTx(tx, id);
        const verified = status === 'VERIFIED';

        const driver = await tx.transferDriver.update({
            where: { id },
            data: {
                verificationStatus: status,
                verifiedAt: verified ? new Date() : null,
                verifiedByUserId: verified ? (actor?.id ?? null) : null
            },
            include: driverInclude
        });

        await recordAudit(tx, {
            action: 'TRANSFER_DRIVER_VERIFIED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `Set ${driverName(driver)} to ${status}`,
            metadata: { from: existing.verificationStatus, to: status, note: note ?? null },
            req
        });

        return driver;
    });

/** Assignments that are live and still ahead, which deactivation would orphan. */
const liveAssignmentsFor = (tx, driverId) =>
    tx.transferAssignment.findMany({
        where: { driverId, status: { in: ACTIVE_ASSIGNMENT_STATUSES }, windowEnd: { gt: new Date() } },
        include: { leg: { select: { id: true, status: true, pickupAt: true } }, booking: { select: { reference: true } } },
        orderBy: { windowStart: 'asc' }
    });

/**
 * Takes a driver off the roster.
 *
 * Refused while the driver holds upcoming assignments, unless `force` is
 * given — in which case each is revoked and its leg goes back to UNASSIGNED
 * for the dispatch board. The login is deactivated and its sessions ended in
 * the same transaction: a driver who is out is out on their next request.
 */
export const deactivateDriver = (id, { reason, force }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const existing = await findOr404InTx(tx, id);
        const live = await liveAssignmentsFor(tx, id);

        if (live.length > 0 && !force) {
            throw new ConflictError('This driver still has upcoming assignments', {
                reason: 'ACTIVE_ASSIGNMENTS',
                assignments: live.map((row) => ({
                    id: row.id,
                    bookingReference: row.booking.reference,
                    pickupAt: row.leg.pickupAt
                }))
            });
        }

        const now = new Date();

        for (const assignment of live) {
            await tx.transferAssignment.update({
                where: { id: assignment.id },
                data: { status: 'REVOKED', revokedAt: now, revokeReason: 'DRIVER_DEACTIVATED' }
            });

            if (LIVE_LEG_STATUSES.includes(assignment.leg.status)) {
                await tx.transferBookingLeg.update({
                    where: { id: assignment.leg.id },
                    data: { status: 'UNASSIGNED', statusChangedAt: now }
                });
            }

            await recordAudit(tx, {
                action: 'TRANSFER_ASSIGNMENT_REVOKED',
                actor,
                entityType: AUDIT_ENTITY.transferAssignment,
                entityId: assignment.id,
                summary: `Revoked ${assignment.booking.reference} from ${driverName(existing)}: driver deactivated`,
                metadata: { reason: 'DRIVER_DEACTIVATED', legId: assignment.leg.id },
                req
            });
        }

        const driver = await tx.transferDriver.update({
            where: { id },
            data: { isActive: false, deactivatedAt: now, deactivationReason: reason },
            include: driverInclude
        });

        if (existing.userId) {
            await tx.user.update({ where: { id: existing.userId }, data: { isActive: false } });
            await revokeUserSessions(tx, existing.userId);
            // An unused activation or reset link would set the account active
            // again when redeemed; spent, it cannot.
            await tx.authToken.updateMany({ where: { userId: existing.userId, usedAt: null }, data: { usedAt: now } });
        }

        await recordAudit(tx, {
            action: 'TRANSFER_DRIVER_DEACTIVATED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `Deactivated ${driverName(driver)}`,
            metadata: { reason, revokedAssignments: live.map((row) => row.id) },
            req
        });

        return driver;
    });

export const reactivateDriver = (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const existing = await findOr404InTx(tx, id);

        const driver = await tx.transferDriver.update({
            where: { id },
            data: { isActive: true, deactivatedAt: null, deactivationReason: null },
            include: driverInclude
        });

        if (existing.userId) {
            await tx.user.update({ where: { id: existing.userId }, data: { isActive: true } });
        }

        await recordAudit(tx, {
            action: 'TRANSFER_DRIVER_REACTIVATED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `Reactivated ${driverName(driver)}`,
            req
        });

        return driver;
    });

/**
 * Creates the login for a profile and issues its activation link.
 *
 * The same shape as an admin creating a partner: a user row with no password,
 * an ACCOUNT_ACTIVATION token, and the email sent by the route once this has
 * committed. Returns the plaintext token; it is never stored.
 */
export const createDriverAccount = (id, { email }, actor, req) =>
    prisma.$transaction(async (tx) => {
        const driver = await findOr404InTx(tx, id);

        if (driver.userId) {
            throw new ConflictError('This driver already has an account', { userId: driver.userId });
        }

        const taken = await tx.user.findUnique({ where: { email }, select: { id: true } });

        if (taken) {
            throw new ConflictError('An account with that email already exists', { field: 'email' });
        }

        const user = await tx.user.create({
            data: {
                email,
                role: 'DRIVER',
                firstName: driver.firstName,
                lastName: driver.lastName,
                phone: driver.phone,
                isActive: true
            }
        });

        await tx.transferDriver.update({ where: { id }, data: { userId: user.id } });

        const { token, authToken } = await issueAuthToken(tx, {
            userId: user.id,
            purpose: 'ACCOUNT_ACTIVATION',
            ttlMs: config.auth.activationTtlMs
        });

        await recordAudit(tx, {
            action: 'DRIVER_ACCOUNT_CREATED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `Created a login for ${driverName(driver)} and sent an activation link to ${email}`,
            metadata: { userId: user.id, email },
            req
        });

        const refreshed = await findOr404InTx(tx, id);

        return { driver: refreshed, user, token, expiresAt: authToken.expiresAt };
    });

/** A fresh activation link, for a login that has never set a password. */
export const reissueDriverActivation = (id, actor, req) =>
    prisma.$transaction(async (tx) => {
        const driver = await findOr404InTx(tx, id);

        if (!driver.user) {
            throw new ConflictError('This driver has no account yet', { reason: 'NO_ACCOUNT' });
        }

        if (driver.user.passwordHash) {
            throw new ConflictError('This account is already activated', { reason: 'ALREADY_ACTIVE' });
        }

        const { token, authToken } = await issueAuthToken(tx, {
            userId: driver.user.id,
            purpose: 'ACCOUNT_ACTIVATION',
            ttlMs: config.auth.activationTtlMs
        });

        await recordAudit(tx, {
            action: 'DRIVER_ACCOUNT_CREATED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `Re-sent the activation link for ${driverName(driver)}`,
            metadata: { userId: driver.user.id, email: driver.user.email, reissued: true },
            req
        });

        return { driver, user: driver.user, token, expiresAt: authToken.expiresAt };
    });

/**
 * Replaces the driver's car links as a whole.
 *
 * The dispatcher pre-fills the primary car and lists the others; the actual
 * car for a job is on the assignment, so nothing here touches a schedule.
 */
export const setDriverVehicles = (id, { vehicles }, actor, req) =>
    prisma.$transaction(async (tx) => {
        await findOr404InTx(tx, id);

        const ids = vehicles.map((link) => link.fleetVehicleId);
        const known = await tx.transferFleetVehicle.findMany({
            where: { id: { in: ids }, status: { not: 'ARCHIVED' } },
            select: { id: true }
        });
        const unknown = ids.filter((vehicleId) => !known.some((row) => row.id === vehicleId));

        if (unknown.length > 0) {
            throw new BadRequestError('Some of those cars do not exist or are archived', {
                field: 'vehicles',
                unknown
            });
        }

        await tx.transferDriverVehicle.deleteMany({ where: { driverId: id } });

        if (vehicles.length > 0) {
            await tx.transferDriverVehicle.createMany({
                data: vehicles.map((link) => ({
                    driverId: id,
                    fleetVehicleId: link.fleetVehicleId,
                    isPrimary: link.isPrimary
                }))
            });
        }

        const driver = await findOr404InTx(tx, id);

        await recordAudit(tx, {
            action: 'TRANSFER_DRIVER_UPDATED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `Set the cars for ${driverName(driver)}`,
            metadata: { vehicles },
            req
        });

        return driver;
    });

/**
 * Removes a driver for good.
 *
 * Open only while no assignment, past or upcoming, names them: the
 * assignment is the record of who drove whom and holds its driver with
 * Restrict, so a driver who has ever been on a job is deactivated instead.
 * The refusal carries the count so the panel can say why.
 *
 * The login goes with the profile. An orphaned DRIVER account could still
 * sign in to an empty panel, and it would hold the email a replacement
 * profile needs; deleting it ends its sessions and tokens by cascade.
 * Documents and links cascade; the assets nothing else references go too.
 */
export const deleteDriver = async (id, actor, req) => {
    const { driver, orphaned } = await prisma.$transaction(async (tx) => {
        const existing = await findOr404InTx(tx, id);

        const assignments = await tx.transferAssignment.count({ where: { driverId: id } });

        if (assignments > 0) {
            throw new ConflictError('This driver has been on jobs — deactivate them instead of deleting', {
                reason: 'HAS_ASSIGNMENTS',
                assignments
            });
        }

        const assetIds = [
            ...new Set(
                [...existing.documents.map((document) => document.fileAssetId), existing.photoFileAssetId].filter(Boolean)
            )
        ];

        await tx.transferDriver.delete({ where: { id } });

        if (existing.userId) {
            await tx.user.delete({ where: { id: existing.userId } });
        }

        const gone = await findOrphanedAssets(tx, assetIds);

        if (gone.length > 0) {
            await tx.fileAsset.deleteMany({ where: { id: { in: gone.map((asset) => asset.id) } } });
        }

        await recordAudit(tx, {
            action: 'TRANSFER_DRIVER_DELETED',
            actor,
            entityType: AUDIT_ENTITY.transferDriver,
            entityId: id,
            summary: `Deleted driver ${driverName(existing)}`,
            metadata: {
                firstName: existing.firstName,
                lastName: existing.lastName,
                phone: existing.phone,
                providerId: existing.providerId,
                verificationStatus: existing.verificationStatus,
                isActive: existing.isActive,
                accountRemoved: existing.user?.email ?? null,
                assetsRemoved: gone.length
            },
            req
        });

        return { driver: existing, orphaned: gone };
    });

    await removeOrphanedObjects(orphaned, { driverId: id });

    return driver;
};

/** Licence, ID, medical, background check. Private, like every other document. */
export const driverDocuments = createDocumentLibrary({
    documentDelegate: 'transferDriverDocument',
    ownerDelegate: 'transferDriver',
    ownerField: 'driverId',
    ownerLabel: 'Driver',
    ownerNoun: 'driver',
    ownerName: driverName,
    ownerSelect: { id: true, firstName: true, lastName: true },
    auditEntity: AUDIT_ENTITY.transferDriver,
    auditActions: {
        attached: 'TRANSFER_DRIVER_DOCUMENT_UPLOADED',
        detached: 'TRANSFER_DRIVER_DOCUMENT_DELETED'
    }
});

/**
 * A driver, as one of the partner's own transfers has shown them.
 *
 * Scoped in SQL: the driver must hold, or have held, an assignment on a
 * booking belonging to the viewer's company — accepted, finished, or still
 * the open offer the partner made at checkout. Anyone else is a 404 --
 * driver ids are not for browsing.
 */
export const findDriverForPartner = async (id, viewer) => {
    if (!viewer?.partnerId) {
        throw new NotFoundError('That driver does not exist');
    }

    const driver = await prisma.transferDriver.findFirst({
        where: {
            id,
            assignments: {
                some: {
                    status: { in: ['OFFERED', 'ACCEPTED', 'COMPLETED', 'NO_SHOW'] },
                    booking: { partnerId: viewer.partnerId }
                }
            }
        },
        include: {
            photo: { include: { variants: true } },
            vehicles: {
                where: { fleetVehicle: { status: 'ACTIVE' } },
                orderBy: [{ isPrimary: 'desc' }],
                include: {
                    fleetVehicle: {
                        include: {
                            mainImage: { include: { variants: true } },
                            images: {
                                orderBy: [{ sortOrder: 'asc' }],
                                include: { fileAsset: { include: { variants: true } } }
                            }
                        }
                    }
                }
            },
            ratings: {
                where: { status: 'PUBLISHED' },
                orderBy: { createdAt: 'desc' },
                take: 20
            }
        }
    });

    if (!driver) {
        throw new NotFoundError('That driver does not exist');
    }

    return driver;
};
