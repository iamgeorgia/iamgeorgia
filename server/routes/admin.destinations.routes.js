import { Router } from 'express';

import { authenticate, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import {
    createDestinationSchema,
    destinationQuerySchema,
    destinationTranslationSchema,
    idParamSchema,
    localeParamSchema,
    updateDestinationSchema
} from '../validation/destination.js';
import {
    createDestination,
    deleteDestination,
    findDestinationOr404,
    getDestinationTree,
    listDestinations,
    updateDestination,
    upsertDestinationTranslation
} from '../services/hotel/destination.service.js';
import {
    toDestinationDetail,
    toDestinationNode,
    toDestinationSummary,
    toDestinationTranslation
} from '../serializers/destination.js';

/**
 * Destination administration.
 *
 * Every route below is an admin route. Applying the guards to the router rather
 * than to each handler is what stops a new endpoint being added without them.
 */
export const adminDestinationRoutes = Router();

adminDestinationRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.CATALOGUE_READ], write: [CAPABILITIES.CATALOGUE_WRITE] }));

adminDestinationRoutes.get('/', validate({ query: destinationQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const { destinations, ...page } = await listDestinations(req.valid.query);

    res.json({ data: destinations.map((destination) => toDestinationSummary(destination, locale)), ...page });
});

// The picker in the hotel wizard needs the shape of the tree, not a page of it.
adminDestinationRoutes.get('/tree', validate({ query: destinationQuerySchema }), async (req, res) => {
    const { locale, countryCode, featured } = req.valid.query;
    const roots = await getDestinationTree({ locale, countryCode, featured });

    res.json({ data: roots.map((root) => toDestinationNode(root, locale)) });
});

adminDestinationRoutes.get(
    '/:id',
    validate({ params: idParamSchema, query: destinationQuerySchema }),
    async (req, res) => {
        const destination = await findDestinationOr404(req.valid.params.id, { locale: req.valid.query.locale });

        res.json(toDestinationDetail(destination, req.valid.query.locale));
    }
);

adminDestinationRoutes.post('/', validate({ body: createDestinationSchema }), async (req, res) => {
    const created = await createDestination(req.valid.body, req.user, req);

    res.status(201).json(toDestinationDetail(await findDestinationOr404(created.id)));
});

adminDestinationRoutes.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateDestinationSchema }),
    async (req, res) => {
        await updateDestination(req.valid.params.id, req.valid.body, req.user, req);

        res.json(toDestinationDetail(await findDestinationOr404(req.valid.params.id)));
    }
);

adminDestinationRoutes.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
    await deleteDestination(req.valid.params.id, req.user, req);

    res.status(204).end();
});

adminDestinationRoutes.put(
    '/:id/translations/:locale',
    validate({ params: localeParamSchema, body: destinationTranslationSchema }),
    async (req, res) => {
        const { id, locale } = req.valid.params;
        const translation = await upsertDestinationTranslation(id, locale, req.valid.body, req.user, req);

        res.json(toDestinationTranslation(translation));
    }
);
