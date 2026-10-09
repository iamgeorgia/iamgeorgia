import { Router } from 'express';

import { authRoutes } from './auth.routes.js';
import { invitationRoutes } from './invitations.routes.js';
import { adminPartnerRoutes } from './admin.partners.routes.js';
import { adminBadgeRoutes } from './admin.badges.routes.js';
import { adminUserRoutes } from './admin.users.routes.js';
import { adminAuditRoutes } from './admin.audit.routes.js';
import { partnerTeamRoutes } from './partner.team.routes.js';
import { adminFinanceRoutes } from './admin.finance.routes.js';
import { partnerFinanceRoutes } from './partner.finance.routes.js';
import { partnerRoutes } from './partner.routes.js';
import { destinationRoutes } from './destinations.routes.js';
import { adminDestinationRoutes } from './admin.destinations.routes.js';
import { hotelRoutes } from './hotels.routes.js';
import { hotelSearchRoutes } from './hotels.search.routes.js';
import {
    adminBookingRoutes,
    bookingRoutes,
    partnerBookingRoutes
} from './hotels.bookings.routes.js';
import { adminHotelRoutes } from './admin.hotels.routes.js';
import { amenityRoutes, adminAmenityRoutes } from './amenities.routes.js';
import { adminMediaRoutes } from './admin.media.routes.js';
import { adminPricingRuleRoutes } from './admin.pricingRules.routes.js';
import { partnerHotelRoutes } from './partner.hotels.routes.js';
import { transferRoutes } from './transfers.routes.js';
import {
    adminTransferBookingRoutes,
    partnerTransferBookingRoutes,
    transferBookingRoutes
} from './transfers.bookings.routes.js';
import { adminTransferRoutes } from './admin.transfers.routes.js';
import { adminFleetRoutes } from './admin.fleet.routes.js';
import { adminDriverRoutes } from './admin.drivers.routes.js';
import { adminDispatchRoutes } from './admin.dispatch.routes.js';
import { driverRoutes } from './driver.routes.js';
import { partnerDriverRoutes } from './partner.drivers.routes.js';
import { tourRoutes, tourSearchRoutes } from './tours.routes.js';
import {
    adminTourBookingRoutes,
    partnerTourBookingRoutes,
    tourBookingRoutes
} from './tours.bookings.routes.js';
import { adminTourRoutes } from './admin.tours.routes.js';
import { serviceRoutes } from './services.routes.js';
import { packageRoutes } from './packages.routes.js';
import { recommendationRoutes } from './recommendations.routes.js';
import { adminPackageRoutes } from './admin.packages.routes.js';
import { adminOrderRoutes, orderRoutes, partnerOrderRoutes } from './orders.routes.js';
import { adminServiceBookingRoutes, adminServiceRoutes, serviceBookingRoutes } from './admin.services.routes.js';

/**
 * Everything under /api. Mounted as one router so app.js keeps saying what the
 * middleware order is rather than accumulating a list of route registrations.
 *
 * The groups differ by who may reach them, and that is enforced on the
 * router itself rather than route by route:
 *   /auth        — public, rate limited
 *   /invitations — public, the token is the credential
 *   /destinations, /hotels, /amenities, /transfers — public catalogue, no credential
 *   /admin/*     — authenticate + requireAdmin, applied to the whole router
 *   /partner/*   — authenticate, with status and role guards per route
 */
export const routes = Router();

routes.use('/auth', authRoutes);
routes.use('/invitations', invitationRoutes);
routes.use('/destinations', destinationRoutes);
// Dated search sits above the catalogue router: /api/search answers "what can
// I book", /api/hotels answers "what properties exist".
// Tours keep their own dated search and their own bookings prefix, for the
// same reason transfers do: a TUR reference is not a BKG one. Mounted above
// the catalogue routers so `/tours/bookings` is never read as a slug.
routes.use('/search/tours', tourSearchRoutes);
routes.use('/search', hotelSearchRoutes);
routes.use('/tours/bookings', tourBookingRoutes);
routes.use('/tours', tourRoutes);
routes.use('/services', serviceRoutes);
routes.use('/packages', packageRoutes);
routes.use('/recommendations', recommendationRoutes);
routes.use('/orders', orderRoutes);
routes.use('/service-bookings', serviceBookingRoutes);
routes.use('/hotels', hotelRoutes);
routes.use('/bookings', bookingRoutes);
// Transfers keep their bookings under their own prefix rather than joining
// /bookings. The two products share no identifier space — a TRF reference is
// not a BKG one — and one endpoint that had to work out which kind of thing it
// was looking at would be a worse endpoint than two that each know.
routes.use('/transfers/bookings', transferBookingRoutes);
routes.use('/transfers', transferRoutes);
routes.use('/amenities', amenityRoutes);
routes.use('/admin/badges', adminBadgeRoutes);
routes.use('/admin/users', adminUserRoutes);
routes.use('/admin/audit', adminAuditRoutes);
routes.use('/admin/finance', adminFinanceRoutes);
routes.use('/admin/partners', adminPartnerRoutes);
routes.use('/admin/destinations', adminDestinationRoutes);
routes.use('/admin/hotels', adminHotelRoutes);
routes.use('/admin/amenities', adminAmenityRoutes);
routes.use('/admin/media', adminMediaRoutes);
routes.use('/admin/bookings', adminBookingRoutes);
routes.use('/admin/pricing-rules', adminPricingRuleRoutes);
routes.use('/admin/transfers/bookings', adminTransferBookingRoutes);
// Operations staff (dispatchers included) run the fleet and the drivers;
// the catalogue router below them stays admin-only. Mounted first so the
// broader guard on /admin/transfers cannot shadow them.
routes.use('/admin/transfers/fleet', adminFleetRoutes);
routes.use('/admin/transfers/drivers', adminDriverRoutes);
routes.use('/admin/transfers/dispatch', adminDispatchRoutes);
routes.use('/admin/transfers', adminTransferRoutes);
routes.use('/admin/tours/bookings', adminTourBookingRoutes);
routes.use('/admin/tours', adminTourRoutes);
routes.use('/admin/services/bookings', adminServiceBookingRoutes);
routes.use('/admin/services', adminServiceRoutes);
routes.use('/admin/packages', adminPackageRoutes);
routes.use('/admin/orders', adminOrderRoutes);
routes.use('/partner/tours/bookings', partnerTourBookingRoutes);
routes.use('/partner/orders', partnerOrderRoutes);
routes.use('/partner/hotels', partnerHotelRoutes);
routes.use('/partner/bookings', partnerBookingRoutes);
routes.use('/partner/transfers/bookings', partnerTransferBookingRoutes);
routes.use('/partner/drivers', partnerDriverRoutes);
routes.use('/partner/team', partnerTeamRoutes);
routes.use('/partner/finance', partnerFinanceRoutes);
routes.use('/partner', partnerRoutes);
// The driver panel. Scoped on the session's driver profile, never on input.
routes.use('/driver', driverRoutes);

export default routes;
