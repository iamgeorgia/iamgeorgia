import { prisma } from '../../db/index.js';
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../errors.js';
import { CAPABILITIES, assertCan, can } from '../permissions.js';

/**
 * The actor a member of staff becomes when booking for somebody else.
 *
 * Everything that prices and scopes a booking reads the actor — the trade
 * flag, the partner's product access, its markup rules and commission rate,
 * the credit limit, and the `partnerId` written on the row — so a manual
 * booking is made as the buyer rather than by threading a second identity
 * through every `prepare` and `confirm`. The staff id stays as `bookedBy`,
 * the audit row carries the staff email, and `onBehalf` says what happened.
 *
 * For a customer with no partner account the actor is the member of staff
 * with no partner: trade prices and the default markup, which is the desk's
 * prerogative and is audited with the booking.
 */
/**
 * The desk searching and quoting as a partner.
 *
 * An offer token is priced for the viewer it was issued to, so a booking
 * made for a partner has to be searched as that partner. A member of staff
 * who may create bookings sends `X-Act-As-Partner: <partnerId>` on the
 * search and quote routes, and is that partner for the request — the same
 * actor the manual booking will be made as. Anyone else sending the header
 * is refused; a partner's own session never carries one.
 */
export const actAsPartner = async (req, res, next) => {
    const partnerId = req.get('x-act-as-partner')?.trim();

    if (!partnerId) {
        return next();
    }

    if (!req.user || req.user.partnerId || !can(req.user, CAPABILITIES.BOOKINGS_WRITE)) {
        throw new ForbiddenError('Only the booking desk may search as a partner', { reason: 'ACT_AS_FORBIDDEN' });
    }

    req.user = await actorOnBehalfOf(req.user, { kind: 'PARTNER', partnerId });

    return next();
};

export const actorOnBehalfOf = async (staff, buyer) => {
    assertCan(staff, CAPABILITIES.BOOKINGS_WRITE);

    if (buyer.kind === 'PARTNER') {
        const partner = await prisma.partner.findUnique({ where: { id: buyer.partnerId }, include: { productAccess: true } });

        if (!partner) {
            throw new NotFoundError('Partner not found');
        }

        if (partner.status !== 'APPROVED') {
            throw new UnprocessableEntityError('That partner cannot be booked for', { reason: 'PARTNER_INACTIVE', status: partner.status });
        }

        return { ...staff, partnerId: partner.id, partner, onBehalf: { kind: 'PARTNER', partnerId: partner.id, byUserId: staff.id } };
    }

    return { ...staff, partnerId: null, partner: null, onBehalf: { kind: 'CUSTOMER', customerId: buyer.customerId ?? null, byUserId: staff.id } };
};
