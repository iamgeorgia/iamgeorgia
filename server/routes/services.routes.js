import { Router } from 'express';

import { validate } from '../middleware/validate.js';
import { isTrade, optionalAuthenticate } from '../middleware/auth.js';
import { accessWhere } from '../services/partner/access.service.js';
import { publicServiceQuerySchema, serviceSlugParamSchema } from '../validation/service.js';
import { findServiceOr404, listServices } from '../services/service/service.service.js';
import { resolveMarkup } from '../services/hotel/pricingRule.service.js';
import { toServiceDetail, toServiceSummary } from '../serializers/service.js';

/**
 * The public service catalogue: read only.
 *
 * Services are sold through packages; this exists so a package page can
 * describe what a slot is, and so a partner can browse what may be added.
 * Anonymous callers see only what is switched on for B2C, as everywhere.
 */
export const serviceRoutes = Router();

serviceRoutes.use(optionalAuthenticate);

const markupFor = async (viewer) => {
    const { markupBps } = await resolveMarkup({
        partner: viewer?.partner ?? (viewer?.partnerId ? { id: viewer.partnerId } : null),
        productType: 'SERVICE'
    });

    return markupBps;
};

serviceRoutes.get('/', validate({ query: publicServiceQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const [{ services, ...page }, markupBps] = await Promise.all([
        listServices({ ...req.valid.query, status: ['ACTIVE'], b2cOnly: !isTrade(req.user), access: accessWhere(req.user, 'SERVICE') }),
        markupFor(req.user)
    ]);

    res.json({ data: services.map((service) => toServiceSummary(service, locale, null, { markupBps })), ...page });
});

serviceRoutes.get('/:slug', validate({ params: serviceSlugParamSchema, query: publicServiceQuerySchema }), async (req, res) => {
    const { locale } = req.valid.query;
    const [service, markupBps] = await Promise.all([
        findServiceOr404(req.valid.params.slug, { locale, statuses: ['ACTIVE'], b2cOnly: !isTrade(req.user), access: accessWhere(req.user, 'SERVICE') }),
        markupFor(req.user)
    ]);

    res.json(toServiceDetail(service, locale, null, { markupBps }));
});
