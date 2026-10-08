import { Router } from 'express';

import { authenticate, requireAdmin, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import {
    attachFleetImageSchema,
    attachVehicleDocumentSchema,
    createFleetVehicleSchema,
    documentParamSchema,
    fleetQuerySchema,
    idParamSchema,
    imageOrderSchema,
    imageParamSchema,
    updateFleetImageSchema,
    updateFleetVehicleSchema
} from '../validation/fleet.js';
import {
    activateFleetVehicle,
    archiveFleetVehicle,
    createFleetVehicle,
    deleteFleetVehicle,
    findFleetVehicleOr404,
    fleetDocuments,
    fleetGallery,
    listFleetVehicles,
    updateFleetVehicle
} from '../services/transfer/fleet.service.js';
import { issueSignedUrl } from '../services/media/upload.service.js';
import { toAttachedDocument, toFleetImage, toFleetVehicleAdmin } from '../serializers/fleet.js';

/**
 * The fleet: physical cars.
 *
 * Operations staff, not only admins: a dispatcher adds the new minivan and
 * photographs it. Guarded on the router so no endpoint here can forget.
 *
 * Note what a document response never carries: a URL. The bytes are reached
 * through the signed-link endpoint below, which authorises and audits.
 */
export const adminFleetRoutes = Router();

adminFleetRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.DISPATCH_READ], write: [CAPABILITIES.DISPATCH_WRITE] }));

adminFleetRoutes.get('/', validate({ query: fleetQuerySchema }), async (req, res) => {
    const { vehicles, ...page } = await listFleetVehicles(req.valid.query);

    res.json({ data: vehicles.map(toFleetVehicleAdmin), ...page });
});

adminFleetRoutes.post('/', validate({ body: createFleetVehicleSchema }), async (req, res) => {
    const vehicle = await createFleetVehicle(req.valid.body, req.user, req);

    res.status(201).json(toFleetVehicleAdmin(vehicle));
});

adminFleetRoutes.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
    res.json(toFleetVehicleAdmin(await findFleetVehicleOr404(req.valid.params.id)));
});

adminFleetRoutes.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateFleetVehicleSchema }),
    async (req, res) => {
        const vehicle = await updateFleetVehicle(req.valid.params.id, req.valid.body, req.user, req);

        res.json(toFleetVehicleAdmin(vehicle));
    }
);

adminFleetRoutes.post('/:id/archive', validate({ params: idParamSchema }), async (req, res) => {
    res.json(toFleetVehicleAdmin(await archiveFleetVehicle(req.valid.params.id, req.user, req)));
});

adminFleetRoutes.post('/:id/activate', validate({ params: idParamSchema }), async (req, res) => {
    res.json(toFleetVehicleAdmin(await activateFleetVehicle(req.valid.params.id, req.user, req)));
});

/**
 * A real delete, and admin-only where everything else here is open to a
 * dispatcher. Refused with 409 `HAS_ASSIGNMENTS` once the car has been on a
 * job — archiving is the answer then. Removes its photographs and documents
 * where nothing else references them.
 */
adminFleetRoutes.delete('/:id', requireAdmin, validate({ params: idParamSchema }), async (req, res) => {
    await deleteFleetVehicle(req.valid.params.id, req.user, req);

    res.status(204).end();
});

// --- Gallery -----------------------------------------------------------------

adminFleetRoutes.get('/:id/images', validate({ params: idParamSchema }), async (req, res) => {
    const vehicle = await findFleetVehicleOr404(req.valid.params.id);

    res.json({ data: vehicle.images.map(toFleetImage) });
});

adminFleetRoutes.post(
    '/:id/images',
    validate({ params: idParamSchema, body: attachFleetImageSchema }),
    async (req, res) => {
        const image = await fleetGallery.attach(req.valid.params.id, req.valid.body, req.user, req);

        res.status(201).json(toFleetImage(image));
    }
);

adminFleetRoutes.put(
    '/:id/images/order',
    validate({ params: idParamSchema, body: imageOrderSchema }),
    async (req, res) => {
        const count = await fleetGallery.reorder(req.valid.params.id, req.valid.body.order, req.user, req);

        res.json({ count });
    }
);

adminFleetRoutes.patch(
    '/:id/images/:imageId',
    validate({ params: imageParamSchema, body: updateFleetImageSchema }),
    async (req, res) => {
        const { id, imageId } = req.valid.params;
        const image = await fleetGallery.update(id, imageId, req.valid.body, req.user, req);

        res.json(toFleetImage(image));
    }
);

adminFleetRoutes.delete('/:id/images/:imageId', validate({ params: imageParamSchema }), async (req, res) => {
    const { id, imageId } = req.valid.params;
    await fleetGallery.detach(id, imageId, req.user, req);

    res.status(204).end();
});

// --- Documents ---------------------------------------------------------------

adminFleetRoutes.get('/:id/documents', validate({ params: idParamSchema }), async (req, res) => {
    await findFleetVehicleOr404(req.valid.params.id);
    const documents = await fleetDocuments.list(req.valid.params.id);

    res.json({ data: documents.map(toAttachedDocument) });
});

adminFleetRoutes.post(
    '/:id/documents',
    validate({ params: idParamSchema, body: attachVehicleDocumentSchema }),
    async (req, res) => {
        const document = await fleetDocuments.attach(req.valid.params.id, req.valid.body, req.user, req);

        res.status(201).json(toAttachedDocument(document));
    }
);

/** The only way to the bytes: a short-lived link, issued after an audit row. */
adminFleetRoutes.get(
    '/:id/documents/:documentId/url',
    validate({ params: documentParamSchema }),
    async (req, res) => {
        const { id, documentId } = req.valid.params;
        const document = await fleetDocuments.findOr404(id, documentId);

        res.json(await issueSignedUrl(document.fileAssetId, req.user, req));
    }
);

adminFleetRoutes.delete(
    '/:id/documents/:documentId',
    validate({ params: documentParamSchema }),
    async (req, res) => {
        const { id, documentId } = req.valid.params;
        await fleetDocuments.detach(id, documentId, req.user, req);

        res.status(204).end();
    }
);
