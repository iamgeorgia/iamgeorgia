import { Router } from 'express';

import { authenticate, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import { ACTOR } from '../lib/transfer/machines.js';
import {
    assignSchema,
    assignmentParamSchema,
    assignmentQuerySchema,
    blockParamSchema,
    blockQuerySchema,
    createBlockSchema,
    dispatchQuerySchema,
    legParamSchema,
    legStatusSchema,
    occupancyQuerySchema,
    optionalReasonSchema,
    reasonSchema
} from '../validation/dispatch.js';
import {
    assignDriver,
    cancelLeg,
    candidatesForLeg,
    findAssignmentOr404,
    findLegOr404,
    listAssignments,
    listDispatchLegs,
    transitionLeg,
    unassignLeg
} from '../services/transfer/dispatch.service.js';
import { createBlock, deleteBlock, listBlocks, listOccupancy } from '../services/transfer/schedule.service.js';
import { listRatings, moderateRating, submitRatingForLeg } from '../services/transfer/rating.service.js';
import { moderateRatingSchema, ratingParamSchema, ratingQuerySchema, submitRatingSchema } from '../validation/rating.js';
import { toRatingAdmin } from '../serializers/rating.js';
import { toAssignmentHistory, toLegAdmin } from '../serializers/dispatch.js';
import { toDriverPublic } from '../serializers/driver.js';
import { toFleetVehiclePublic } from '../serializers/fleet.js';

/**
 * The dispatch board.
 *
 * Every write here is an operations decision and is recorded as one: who
 * was sent, what was overridden, who took them off again. Drivers have their
 * own router for their own jobs.
 */
export const adminDispatchRoutes = Router();

adminDispatchRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.DISPATCH_READ], write: [CAPABILITIES.DISPATCH_WRITE] }));

adminDispatchRoutes.get('/legs', validate({ query: dispatchQuerySchema }), async (req, res) => {
    const { legs, ...page } = await listDispatchLegs(req.valid.query);

    res.json({ data: legs.map((leg) => toLegAdmin(leg, req.user)), ...page });
});

adminDispatchRoutes.get('/legs/:legId', validate({ params: legParamSchema }), async (req, res) => {
    res.json(toLegAdmin(await findLegOr404(req.valid.params.legId), req.user));
});

adminDispatchRoutes.get('/legs/:legId/candidates', validate({ params: legParamSchema }), async (req, res) => {
    const { leg, window, candidates } = await candidatesForLeg(req.valid.params.legId);

    res.json({
        leg: toLegAdmin(leg, req.user),
        window: { windowStart: window.windowStart, windowEnd: window.windowEnd },
        data: candidates.map((candidate) => ({
            driver: toDriverPublic(candidate.driver, { revealPhone: true }),
            provider: candidate.driver.provider,
            verified: candidate.driver.verificationStatus === 'VERIFIED',
            vehicles: candidate.vehicles.map((entry) => ({
                ...toFleetVehiclePublic(entry.vehicle),
                isPrimary: entry.isPrimary,
                classMatches: entry.classMatches,
                fitsParty: entry.fitsParty,
                conflicts: entry.conflicts
            })),
            conflicts: candidate.conflicts,
            warnings: candidate.warnings,
            suggestedVehicleId: candidate.suggestedVehicleId
        }))
    });
});

adminDispatchRoutes.post(
    '/legs/:legId/assign',
    validate({ params: legParamSchema, body: assignSchema }),
    async (req, res) => {
        const leg = await assignDriver(req.valid.params.legId, req.valid.body, req.user, req);

        res.status(201).json(toLegAdmin(leg, req.user));
    }
);

adminDispatchRoutes.post(
    '/legs/:legId/unassign',
    validate({ params: legParamSchema, body: reasonSchema }),
    async (req, res) => {
        res.json(toLegAdmin(await unassignLeg(req.valid.params.legId, req.valid.body, req.user, req), req.user));
    }
);

adminDispatchRoutes.post(
    '/legs/:legId/status',
    validate({ params: legParamSchema, body: legStatusSchema }),
    async (req, res) => {
        const leg = await transitionLeg(req.valid.params.legId, req.valid.body, { actorKind: ACTOR.OPS }, req.user, req);

        res.json(toLegAdmin(leg, req.user));
    }
);

adminDispatchRoutes.post(
    '/legs/:legId/cancel',
    validate({ params: legParamSchema, body: optionalReasonSchema }),
    async (req, res) => {
        res.json(toLegAdmin(await cancelLeg(req.valid.params.legId, req.valid.body, req.user, req), req.user));
    }
);

adminDispatchRoutes.get('/assignments', validate({ query: assignmentQuerySchema }), async (req, res) => {
    const { assignments, ...page } = await listAssignments(req.valid.query);

    res.json({ data: assignments.map(toAssignmentHistory), ...page });
});

adminDispatchRoutes.get('/assignments/:id', validate({ params: assignmentParamSchema }), async (req, res) => {
    res.json(toAssignmentHistory(await findAssignmentOr404(req.valid.params.id)));
});

// --- Schedule ------------------------------------------------------------------

adminDispatchRoutes.get('/schedule', validate({ query: occupancyQuerySchema }), async (req, res) => {
    res.json({ data: await listOccupancy(req.valid.query) });
});

const toBlock = (block) => ({
    id: block.id,
    driver: block.driver ? { id: block.driver.id, firstName: block.driver.firstName, lastName: block.driver.lastName } : null,
    vehicle: block.fleetVehicle
        ? { id: block.fleetVehicle.id, make: block.fleetVehicle.make, model: block.fleetVehicle.model, plateNumber: block.fleetVehicle.plateNumber }
        : null,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    reason: block.reason,
    note: block.note ?? null,
    createdBy: block.createdByUser
        ? { id: block.createdByUser.id, email: block.createdByUser.email }
        : null,
    createdAt: block.createdAt
});

adminDispatchRoutes.get('/blocks', validate({ query: blockQuerySchema }), async (req, res) => {
    res.json({ data: (await listBlocks(req.valid.query)).map(toBlock) });
});

adminDispatchRoutes.post('/blocks', validate({ body: createBlockSchema }), async (req, res) => {
    res.status(201).json(toBlock(await createBlock(req.valid.body, req.user, req)));
});

adminDispatchRoutes.delete('/blocks/:id', validate({ params: blockParamSchema }), async (req, res) => {
    await deleteBlock(req.valid.params.id, req.user, req);

    res.status(204).end();
});

// --- Ratings -------------------------------------------------------------------

adminDispatchRoutes.get('/ratings', validate({ query: ratingQuerySchema }), async (req, res) => {
    const { ratings, ...page } = await listRatings(req.valid.query);

    res.json({ data: ratings.map(toRatingAdmin), ...page });
});

/** Feedback taken over the phone, recorded by operations on the passenger's behalf. */
adminDispatchRoutes.post(
    '/legs/:legId/rating',
    validate({ params: legParamSchema, body: submitRatingSchema }),
    async (req, res) => {
        const rating = await submitRatingForLeg(
            req.valid.params.legId,
            req.valid.body,
            { source: 'ADMIN', submittedByUserId: req.user.id },
            req.user,
            req
        );

        res.status(201).json(toRatingAdmin(rating));
    }
);

adminDispatchRoutes.post(
    '/ratings/:id/publish',
    validate({ params: ratingParamSchema, body: moderateRatingSchema }),
    async (req, res) => {
        res.json(toRatingAdmin(await moderateRating(req.valid.params.id, 'PUBLISHED', req.valid.body, req.user, req)));
    }
);

adminDispatchRoutes.post(
    '/ratings/:id/reject',
    validate({ params: ratingParamSchema, body: moderateRatingSchema }),
    async (req, res) => {
        res.json(toRatingAdmin(await moderateRating(req.valid.params.id, 'REJECTED', req.valid.body, req.user, req)));
    }
);
