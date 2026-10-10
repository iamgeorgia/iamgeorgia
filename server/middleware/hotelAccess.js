import { prisma } from '../db/index.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { isStaff, ownsHotel } from './auth.js';
import { CAPABILITIES, can } from '../lib/permissions.js';

/**
 * Supplier ownership, checked once per request.
 *
 * Reads the hotel named in the route and refuses anyone who does not own it,
 * putting the record on `req.hotel` so the handler does not read it again.
 *
 * The failure is a **404, not a 403**. A supplier walking ids down a URL must
 * not be able to tell the difference between "that hotel does not exist" and
 * "that hotel is not yours" — a 403 answers the question they were asking.
 *
 * Admins pass through for any property, which is what makes this usable as a
 * single guard on routes that serve both.
 */
export const requireHotelAccess = ({ manage = false } = {}) =>
    async (req, res, next) => {
        const hotelId = req.params.hotelId ?? req.params.id;

        const hotel = await prisma.hotel.findUnique({
            where: { id: hotelId },
            select: {
                id: true,
                slug: true,
                name: true,
                status: true,
                supplierId: true,
                currency: true,
                timezone: true,
                destinationId: true
            }
        });

        if (!hotel) {
            throw new NotFoundError('Hotel not found');
        }

        if (!isStaff(req.user)) {
            if (!ownsHotel(req.user, hotel)) {
                throw new NotFoundError('Hotel not found');
            }

            // Ownership says which property; the role says what may be done to
            // it. An agent books, it does not rewrite the rate calendar.
            if (manage && !can(req.user, CAPABILITIES.PARTNER_INVENTORY_WRITE)) {
                throw new ForbiddenError('Your role cannot change this property', {
                    role: req.user.role,
                    reason: 'INSUFFICIENT_CAPABILITY',
                    required: [CAPABILITIES.PARTNER_INVENTORY_WRITE]
                });
            }
        } else if (manage && !can(req.user, CAPABILITIES.CATALOGUE_WRITE)) {
            // Staff pass the ownership check for any property, but the
            // extranet's rate and inventory writes are the same writes the
            // admin catalogue gates on `catalogue.write`; a desk that reads
            // the catalogue does not get to change prices through this door.
            throw new ForbiddenError('Your role cannot change this property', {
                role: req.user.role,
                reason: 'INSUFFICIENT_CAPABILITY',
                required: [CAPABILITIES.CATALOGUE_WRITE]
            });
        }

        req.hotel = hotel;
        next();
    };

/**
 * Narrows a hotel query to what the viewer may see.
 *
 * Applied to the `where` clause rather than to the result, so a supplier's list
 * is scoped by the database and there is no page of another supplier's hotels
 * to accidentally leak.
 */
export const hotelScopeFor = (viewer) =>
    isStaff(viewer) ? {} : { supplierId: viewer?.partnerId ?? '__none__' };
