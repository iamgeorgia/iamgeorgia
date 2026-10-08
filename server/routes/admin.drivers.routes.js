import { Router } from 'express';

import { authenticate, requireAdmin, requireCapabilityByMethod } from '../middleware/auth.js';
import { CAPABILITIES } from '../lib/permissions.js';
import { validate } from '../middleware/validate.js';
import { documentParamSchema, idParamSchema } from '../validation/fleet.js';
import {
    attachDriverDocumentSchema,
    createDriverAccountSchema,
    createDriverSchema,
    deactivateDriverSchema,
    driverQuerySchema,
    driverVehiclesSchema,
    updateDriverSchema,
    verifyDriverSchema
} from '../validation/driver.js';
import {
    createDriver,
    createDriverAccount,
    deactivateDriver,
    deleteDriver,
    driverDocuments,
    driverName,
    findDriverOr404,
    listDrivers,
    reactivateDriver,
    reissueDriverActivation,
    setDriverVehicles,
    setDriverVerification,
    updateDriver
} from '../services/transfer/driver.service.js';
import { issueSignedUrl } from '../services/media/upload.service.js';
import { activationUrl, sendMailQuietly } from '../lib/mailer/index.js';
import { toDriverAdmin } from '../serializers/driver.js';
import { toAttachedDocument } from '../serializers/fleet.js';

/**
 * Driver profiles, for operations staff.
 *
 * Everything here answers with the operations view of a driver — the one that
 * includes the licence number and the documents on file. Nothing under
 * /partner or /driver ever calls these serializers.
 */
export const adminDriverRoutes = Router();

adminDriverRoutes.use(authenticate, requireCapabilityByMethod({ read: [CAPABILITIES.DISPATCH_READ], write: [CAPABILITIES.DISPATCH_WRITE] }));

adminDriverRoutes.get('/', validate({ query: driverQuerySchema }), async (req, res) => {
    const { drivers, ...page } = await listDrivers(req.valid.query);

    res.json({ data: drivers.map(toDriverAdmin), ...page });
});

adminDriverRoutes.post('/', validate({ body: createDriverSchema }), async (req, res) => {
    const driver = await createDriver(req.valid.body, req.user, req);

    res.status(201).json(toDriverAdmin(driver));
});

adminDriverRoutes.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
    res.json(toDriverAdmin(await findDriverOr404(req.valid.params.id)));
});

adminDriverRoutes.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateDriverSchema }),
    async (req, res) => {
        res.json(toDriverAdmin(await updateDriver(req.valid.params.id, req.valid.body, req.user, req)));
    }
);

adminDriverRoutes.post(
    '/:id/verify',
    validate({ params: idParamSchema, body: verifyDriverSchema }),
    async (req, res) => {
        res.json(toDriverAdmin(await setDriverVerification(req.valid.params.id, req.valid.body, req.user, req)));
    }
);

adminDriverRoutes.post(
    '/:id/deactivate',
    validate({ params: idParamSchema, body: deactivateDriverSchema }),
    async (req, res) => {
        res.json(toDriverAdmin(await deactivateDriver(req.valid.params.id, req.valid.body, req.user, req)));
    }
);

adminDriverRoutes.post('/:id/activate', validate({ params: idParamSchema }), async (req, res) => {
    res.json(toDriverAdmin(await reactivateDriver(req.valid.params.id, req.user, req)));
});

/**
 * A real delete, admin-only. Refused with 409 `HAS_ASSIGNMENTS` once the
 * driver has been on a job — deactivating is the answer then. Takes the
 * login with it, so the email is free for whoever replaces them.
 */
adminDriverRoutes.delete('/:id', requireAdmin, validate({ params: idParamSchema }), async (req, res) => {
    await deleteDriver(req.valid.params.id, req.user, req);

    res.status(204).end();
});

/**
 * Emails the activation link and reports whether that worked.
 *
 * The link is returned as well as sent, as the partner invitation endpoint
 * does: the admin who pressed the button can copy it and pass it on
 * themselves, and `emailSent` tells the panel whether it needs to say so.
 * The account exists either way — the mail goes after the commit, quietly.
 */
const sendActivation = async ({ driver, user, token, expiresAt }) => {
    const url = activationUrl(token);
    const sent = await sendMailQuietly({
        to: user.email,
        template: 'driverAccountActivation',
        data: { driverName: driverName(driver), url, expiresAt }
    });

    return {
        driver: toDriverAdmin(driver),
        link: { kind: 'activation', url, expiresAt },
        email: user.email,
        emailSent: sent !== null
    };
};

adminDriverRoutes.post(
    '/:id/account',
    validate({ params: idParamSchema, body: createDriverAccountSchema }),
    async (req, res) => {
        const issued = await createDriverAccount(req.valid.params.id, req.valid.body, req.user, req);

        res.status(201).json(await sendActivation(issued));
    }
);

adminDriverRoutes.post('/:id/account/resend', validate({ params: idParamSchema }), async (req, res) => {
    const issued = await reissueDriverActivation(req.valid.params.id, req.user, req);

    res.json(await sendActivation(issued));
});

adminDriverRoutes.put(
    '/:id/vehicles',
    validate({ params: idParamSchema, body: driverVehiclesSchema }),
    async (req, res) => {
        res.json(toDriverAdmin(await setDriverVehicles(req.valid.params.id, req.valid.body, req.user, req)));
    }
);

// --- Documents ---------------------------------------------------------------

adminDriverRoutes.get('/:id/documents', validate({ params: idParamSchema }), async (req, res) => {
    await findDriverOr404(req.valid.params.id);
    const documents = await driverDocuments.list(req.valid.params.id);

    res.json({ data: documents.map(toAttachedDocument) });
});

adminDriverRoutes.post(
    '/:id/documents',
    validate({ params: idParamSchema, body: attachDriverDocumentSchema }),
    async (req, res) => {
        const document = await driverDocuments.attach(req.valid.params.id, req.valid.body, req.user, req);

        res.status(201).json(toAttachedDocument(document));
    }
);

/** The only way to the bytes: a short-lived link, issued after an audit row. */
adminDriverRoutes.get(
    '/:id/documents/:documentId/url',
    validate({ params: documentParamSchema }),
    async (req, res) => {
        const { id, documentId } = req.valid.params;
        const document = await driverDocuments.findOr404(id, documentId);

        res.json(await issueSignedUrl(document.fileAssetId, req.user, req));
    }
);

adminDriverRoutes.delete(
    '/:id/documents/:documentId',
    validate({ params: documentParamSchema }),
    async (req, res) => {
        const { id, documentId } = req.valid.params;
        await driverDocuments.detach(id, documentId, req.user, req);

        res.status(204).end();
    }
);
