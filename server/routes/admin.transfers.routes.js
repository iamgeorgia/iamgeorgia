import { Router } from 'express';

import { authenticate, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import {
    blackoutQuerySchema,
    bulkPriceSchema,
    createBlackoutSchema,
    createExtraSchema,
    createPointSchema,
    createRouteSchema,
    createVehicleSchema,
    idParamSchema,
    localeParamSchema,
    pointQuerySchema,
    pointTranslationSchema,
    routePricesSchema,
    routeQuerySchema,
    routeStopsSchema,
    routeTranslationSchema,
    updateExtraSchema,
    updatePointSchema,
    updateRouteSchema,
    updateVehicleSchema,
    vehicleQuerySchema,
    vehicleTranslationSchema
} from '../validation/transfer.js';
import {
    createPoint,
    deactivatePoint,
    findPointOr404,
    listPoints,
    updatePoint,
    upsertPointTranslation
} from '../services/transfer/point.service.js';
import {
    archiveVehicle,
    createVehicle,
    findVehicleOr404,
    listProviders,
    listVehicles,
    updateVehicle,
    upsertVehicleTranslation
} from '../services/transfer/vehicle.service.js';
import {
    archiveRoute,
    bulkPriceRoutes,
    createRoute,
    findRouteOr404,
    listRoutes,
    publishRoute,
    routeChecklist,
    setRoutePrices,
    setRouteStops,
    unpublishRoute,
    updateRoute,
    upsertRouteTranslation
} from '../services/transfer/route.service.js';
import {
    createBlackout,
    deactivateExtra,
    deleteBlackout,
    listBlackouts,
    listExtras,
    updateExtra,
    upsertExtra
} from '../services/transfer/extra.service.js';
import { toBlackout, toExtra, toPoint, toProvider, toRoute, toVehicle } from '../serializers/transfer.js';

/**
 * The transfer panel.
 *
 * Guarded on the router rather than route by route, so there is no way to add
 * an endpoint here and forget the check. Reads include drafts and retired rows,
 * which is the difference between this and the public catalogue: an admin needs
 * to see the thing they have not published yet.
 */
export const adminTransferRoutes = Router();

adminTransferRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.CATALOGUE_READ], write: [CAPABILITIES.CATALOGUE_WRITE] }));

/* --- Points ------------------------------------------------------------- */

adminTransferRoutes.get('/points', validate({ query: pointQuerySchema }), async (req, res) => {
    const points = await listPoints({ ...req.valid.query, includeInactive: true });

    res.json({ data: points.map(toPoint) });
});

adminTransferRoutes.post('/points', validate({ body: createPointSchema }), async (req, res) => {
    const point = await createPoint(req.valid.body, req.user, req);

    res.status(201).json(toPoint(point));
});

adminTransferRoutes.get('/points/:id', validate({ params: idParamSchema }), async (req, res) => {
    const point = await findPointOr404(req.valid.params.id, { includeInactive: true });

    res.json(toPoint(point));
});

adminTransferRoutes.patch(
    '/points/:id',
    validate({ params: idParamSchema, body: updatePointSchema }),
    async (req, res) => {
        const point = await updatePoint(req.valid.params.id, req.valid.body, req.user, req);

        res.json(toPoint(point));
    }
);

/**
 * Retires a point rather than deleting it.
 *
 * DELETE is the verb an admin reaches for and the one the panel sends, but what
 * happens is a status change: routes reference this row with `Restrict` and
 * bookings reference it for reporting, so a hard delete would either fail or
 * take history with it.
 */
adminTransferRoutes.delete('/points/:id', validate({ params: idParamSchema }), async (req, res) => {
    const point = await deactivatePoint(req.valid.params.id, req.user, req);

    res.json(toPoint(point));
});

adminTransferRoutes.put(
    '/points/:id/translations/:locale',
    validate({ params: localeParamSchema, body: pointTranslationSchema }),
    async (req, res) => {
        const point = await upsertPointTranslation(
            req.valid.params.id,
            req.valid.params.locale,
            req.valid.body
        );

        res.json(toPoint(point));
    }
);

/* --- Suppliers ----------------------------------------------------------- */

/**
 * The suppliers, for the vehicle form's provider field.
 *
 * A read-only list and nothing more. Suppliers are onboarded as partners, so
 * there is no create here on purpose — this endpoint exists so that adding a
 * vehicle class does not require knowing a provider id by heart.
 */
adminTransferRoutes.get('/providers', async (_req, res) => {
    const providers = await listProviders();

    res.json({ data: providers.map(toProvider) });
});

/* --- Vehicle classes ----------------------------------------------------- */

adminTransferRoutes.get('/vehicles', validate({ query: vehicleQuerySchema }), async (req, res) => {
    const vehicles = await listVehicles({ ...req.valid.query, viewer: req.user });

    res.json({ data: vehicles.map((vehicle) => toVehicle(vehicle, req.user)) });
});

adminTransferRoutes.post('/vehicles', validate({ body: createVehicleSchema }), async (req, res) => {
    const vehicle = await createVehicle(req.valid.body, req.user, req);

    res.status(201).json(toVehicle(vehicle, req.user));
});

adminTransferRoutes.get('/vehicles/:id', validate({ params: idParamSchema }), async (req, res) => {
    const vehicle = await findVehicleOr404(req.valid.params.id, { viewer: req.user });

    res.json(toVehicle(vehicle, req.user));
});

adminTransferRoutes.patch(
    '/vehicles/:id',
    validate({ params: idParamSchema, body: updateVehicleSchema }),
    async (req, res) => {
        const vehicle = await updateVehicle(req.valid.params.id, req.valid.body, req.user, req);

        res.json(toVehicle(vehicle, req.user));
    }
);

adminTransferRoutes.post('/vehicles/:id/archive', validate({ params: idParamSchema }), async (req, res) => {
    const vehicle = await archiveVehicle(req.valid.params.id, req.user, req);

    res.json(toVehicle(vehicle, req.user));
});

adminTransferRoutes.put(
    '/vehicles/:id/translations/:locale',
    validate({ params: localeParamSchema, body: vehicleTranslationSchema }),
    async (req, res) => {
        const vehicle = await upsertVehicleTranslation(
            req.valid.params.id,
            req.valid.params.locale,
            req.valid.body
        );

        res.json(toVehicle(vehicle, req.user));
    }
);

/* --- Routes -------------------------------------------------------------- */

/**
 * The bulk price editor.
 *
 * Registered before `/routes/:id` on purpose: Express matches in order, and
 * `/routes/prices` would otherwise be read as a route whose id is "prices".
 */
adminTransferRoutes.put('/routes/prices', validate({ body: bulkPriceSchema }), async (req, res) => {
    const result = await bulkPriceRoutes(req.valid.body, req.user, req);

    res.json(result);
});

adminTransferRoutes.get('/routes', validate({ query: routeQuerySchema }), async (req, res) => {
    const { routes, ...page } = await listRoutes({ ...req.valid.query, includeDrafts: true });

    res.json({ data: routes.map((route) => toRoute(route, req.user)), ...page });
});

adminTransferRoutes.post('/routes', validate({ body: createRouteSchema }), async (req, res) => {
    const route = await createRoute(req.valid.body, req.user, req);

    res.status(201).json({ ...toRoute(route, req.user), publishChecklist: routeChecklist(route) });
});

adminTransferRoutes.get('/routes/:id', validate({ params: idParamSchema }), async (req, res) => {
    const route = await findRouteOr404(req.valid.params.id, { includeDrafts: true });

    res.json({ ...toRoute(route, req.user), publishChecklist: routeChecklist(route) });
});

adminTransferRoutes.patch(
    '/routes/:id',
    validate({ params: idParamSchema, body: updateRouteSchema }),
    async (req, res) => {
        const route = await updateRoute(req.valid.params.id, req.valid.body, req.user, req);

        res.json({ ...toRoute(route, req.user), publishChecklist: routeChecklist(route) });
    }
);

adminTransferRoutes.put(
    '/routes/:id/prices',
    validate({ params: idParamSchema, body: routePricesSchema }),
    async (req, res) => {
        const route = await setRoutePrices(req.valid.params.id, req.valid.body.prices, req.user, req);

        res.json({ ...toRoute(route, req.user), publishChecklist: routeChecklist(route) });
    }
);

adminTransferRoutes.put(
    '/routes/:id/stops',
    validate({ params: idParamSchema, body: routeStopsSchema }),
    async (req, res) => {
        const route = await setRouteStops(req.valid.params.id, req.valid.body.stops, req.user, req);

        res.json(toRoute(route, req.user));
    }
);

adminTransferRoutes.post('/routes/:id/publish', validate({ params: idParamSchema }), async (req, res) => {
    const route = await publishRoute(req.valid.params.id, req.user, req);

    res.json({ ...toRoute(route, req.user), publishChecklist: routeChecklist(route) });
});

adminTransferRoutes.post('/routes/:id/unpublish', validate({ params: idParamSchema }), async (req, res) => {
    const route = await unpublishRoute(req.valid.params.id, req.user, req);

    res.json(toRoute(route, req.user));
});

adminTransferRoutes.post('/routes/:id/archive', validate({ params: idParamSchema }), async (req, res) => {
    const route = await archiveRoute(req.valid.params.id, req.user, req);

    res.json(toRoute(route, req.user));
});

adminTransferRoutes.put(
    '/routes/:id/translations/:locale',
    validate({ params: localeParamSchema, body: routeTranslationSchema }),
    async (req, res) => {
        const route = await upsertRouteTranslation(
            req.valid.params.id,
            req.valid.params.locale,
            req.valid.body
        );

        res.json(toRoute(route, req.user));
    }
);

/* --- Extras and blackouts ------------------------------------------------ */

adminTransferRoutes.get('/extras', async (_req, res) => {
    const extras = await listExtras({ includeInactive: true });

    res.json({ data: extras.map(toExtra) });
});

adminTransferRoutes.post('/extras', validate({ body: createExtraSchema }), async (req, res) => {
    const extra = await upsertExtra(req.valid.body, req.user, req);

    res.status(201).json(toExtra(extra));
});

adminTransferRoutes.put(
    '/extras/:id',
    validate({ params: idParamSchema, body: updateExtraSchema }),
    async (req, res) => {
        const extra = await updateExtra(req.valid.params.id, req.valid.body, req.user, req);

        res.json(toExtra(extra));
    }
);

adminTransferRoutes.delete('/extras/:id', validate({ params: idParamSchema }), async (req, res) => {
    const extra = await deactivateExtra(req.valid.params.id, req.user, req);

    res.json(toExtra(extra));
});

adminTransferRoutes.get('/blackouts', validate({ query: blackoutQuerySchema }), async (req, res) => {
    const blackouts = await listBlackouts(req.valid.query);

    res.json({ data: blackouts.map(toBlackout) });
});

adminTransferRoutes.post('/blackouts', validate({ body: createBlackoutSchema }), async (req, res) => {
    const blackout = await createBlackout(req.valid.body, req.user, req);

    res.status(201).json(toBlackout(blackout));
});

adminTransferRoutes.delete('/blackouts/:id', validate({ params: idParamSchema }), async (req, res) => {
    await deleteBlackout(req.valid.params.id, req.user, req);

    res.status(204).end();
});

export default adminTransferRoutes;
