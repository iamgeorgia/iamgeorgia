import { toDateOnly } from '../lib/time.js';
import { isAdmin } from '../middleware/auth.js';
import { toLegAssignmentFor } from './dispatch.js';
import { freeCancellationUntil } from '../services/hotel/policy.service.js';

/**
 * Transfer responses.
 *
 * One rule runs through all of it: **net figures and margin are staff-only, and
 * absent rather than null** for anyone else. A `netCents: null` in a payload
 * tells a reader there is a number they are not being shown, which is both
 * useless to them and an invitation. The field simply is not there.
 *
 * "Staff" for a transfer means an admin or the partner that owns the vehicle.
 * There is no per-property ownership to check the way there is for a hotel, so
 * this is simpler than `canViewNetRates` and deliberately not routed through
 * it — passing a vehicle to a function whose parameter is named `hotel` would
 * work and would be a lie.
 */

const ownsVehicle = (viewer, vehicle) =>
    Boolean(viewer?.partnerId) && Boolean(vehicle?.partnerId) && viewer.partnerId === vehicle.partnerId;

export const canViewNetFares = (viewer, vehicle) => isAdmin(viewer) || ownsVehicle(viewer, vehicle);

export const toPoint = (point) => ({
    id: point.id,
    slug: point.slug,
    name: point.name,
    kind: point.kind,
    code: point.iataCode ?? null,
    region: point.regionLabel,
    latitude: point.latitude,
    longitude: point.longitude,
    place: point.place ?? null,
    timezone: point.timezone,
    popular: point.popular,
    image: point.image ?? null,
    // Sent to everyone rather than gated behind a viewer check, because these
    // serialisers are called as `points.map(toPoint)` and a second parameter
    // would silently receive the array index. It leaks nothing: the public
    // listing only ever returns ACTIVE rows, so off the admin endpoint this is
    // a constant. The panel needs it to tell a retired point from a live one.
    status: point.status
});

export const toProvider = (provider) => ({
    id: provider.id,
    slug: provider.slug,
    name: provider.name,
    rating: provider.rating,
    reviewCount: provider.reviewCount,
    verified: provider.verified,
    yearsActive: provider.yearsActive
});

/**
 * A vehicle class.
 *
 * The fallback fare model is staff-only. It is not secret exactly, but it is
 * the formula rather than the price, and publishing it invites a client to
 * compute its own quote and then argue with ours.
 */
export const toVehicle = (vehicle, viewer) => ({
    id: vehicle.id,
    slug: vehicle.slug,
    name: vehicle.name,
    vehicleClass: vehicle.vehicleClass,
    body: vehicle.body,
    kind: vehicle.kind,
    provider: vehicle.provider ? toProvider(vehicle.provider) : null,
    vehicleExample: vehicle.vehicleExample,
    maxPassengers: vehicle.maxPassengers,
    maxLuggage: vehicle.maxLuggage,
    maxCabinBags: vehicle.maxCabinBags,
    features: vehicle.features ?? [],
    summary: vehicle.summary,
    description: vehicle.description ?? [],
    included: vehicle.included ?? [],
    excluded: vehicle.excluded ?? [],
    pickupProcedure: vehicle.pickupProcedure,
    /**
     * The terms in words, from the shared policy the class attaches to.
     *
     * The wording rather than the tiers: a card needs one sentence a traveller
     * reads before choosing, and the exact schedule is frozen onto the booking
     * at confirmation, where it is the only thing a cancellation reads.
     */
    cancellation: vehicle.cancellationPolicy
        ? {
              kind: vehicle.cancellationPolicy.kind,
              description: vehicle.cancellationPolicy.description ?? null
          }
        : null,
    currency: vehicle.currency,
    recommendedRank: vehicle.recommendedRank,
    ...(isAdmin(viewer)
        ? {
              status: vehicle.status,
              b2cEnabled: vehicle.b2cEnabled,
              partnerId: vehicle.partnerId ?? null,
              paceFactor: vehicle.paceFactor,
              fallbackPricing: {
                  perKmCents: vehicle.perKmCents,
                  minimumFareCents: vehicle.minimumFareCents,
                  airportFeeCents: vehicle.airportFeeCents
              }
          }
        : {})
});

export const toRouteStop = (stop) => ({
    id: stop.id,
    position: stop.position,
    dwellMinutes: stop.dwellMinutes,
    point: toPoint(stop.point)
});

export const toRoute = (route, viewer) => ({
    id: route.id,
    slug: route.slug,
    from: toPoint(route.fromPoint),
    to: toPoint(route.toPoint),
    tier: route.tier,
    category: route.category,
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMinutes,
    title: route.title ?? null,
    summary: route.summary ?? null,
    description: route.description ?? [],
    heroImage: route.heroImage ?? null,
    featured: route.featured,
    // Public so the client's sitemap can carry a real `lastModified` per URL.
    updatedAt: route.updatedAt,
    stops: (route.stops ?? []).map(toRouteStop),
    // The cheapest curated fare, for a "from" price on a card. Absent when the
    // route has no prices at all, because the distance engine's answer depends
    // on the party and cannot be stated without one.
    startingFromCents:
        (route.prices ?? []).length > 0
            ? Math.min(...route.prices.map((price) => price.oneWayCents))
            : null,
    ...(isAdmin(viewer)
        ? {
              status: route.status,
              prices: (route.prices ?? []).map((price) => ({
                  vehicleId: price.vehicleId,
                  oneWayCents: price.oneWayCents,
                  returnCents: price.returnCents,
                  netCents: price.netCents,
                  currency: price.currency,
                  isActive: price.isActive
              }))
          }
        : {})
});

export const toExtra = (extra) => ({
    code: extra.code,
    name: extra.name,
    description: extra.description ?? null,
    basis: extra.basis,
    // For a PERCENT extra this column holds basis points, and calling it
    // `priceCents` there would be a quiet lie. Two fields, one of which is
    // always null, says what it is.
    priceCents: extra.basis === 'PERCENT' ? null : extra.priceCents,
    percentBps: extra.basis === 'PERCENT' ? extra.priceCents : null,
    currency: extra.currency,
    appliesToClasses: extra.appliesToClasses ?? [],
    position: extra.position,
    // Same reasoning as `toPoint`: the public list is filtered to active rows,
    // so this only ever says anything off the admin endpoint, where the panel
    // has to show a retired extra as retired rather than as a live add-on.
    isActive: extra.isActive
});

const toQuoteLeg = (leg, viewer, vehicle) => ({
    direction: leg.direction,
    from: leg.fromPointName,
    to: leg.toPointName,
    pickupAt: leg.pickupAt instanceof Date ? leg.pickupAt.toISOString() : leg.pickupAt,
    distanceKm: leg.distanceKm,
    durationMinutes: leg.durationMinutes,
    isNight: leg.isNight,
    baseFareCents: leg.baseFareCents,
    nightSurchargeCents: leg.nightSurchargeCents,
    extras: leg.extras ?? [],
    sellCents: leg.sellCents,
    ...(canViewNetFares(viewer, vehicle) ? { netCents: leg.netCents, source: leg.source } : {})
});

/** One priced offer, as a result card renders it. */
export const toOffer = (offer, viewer) => ({
    token: offer.token,
    vehicle: toVehicle(offer.vehicle, viewer),
    quote: {
        currency: offer.quote.currency,
        perSeat: offer.quote.perSeat,
        legs: offer.quote.legs.map((leg) => toQuoteLeg(leg, viewer, offer.vehicle)),
        totals: {
            sellCents: offer.quote.totals.sellCents,
            totalCents: offer.quote.totals.totalCents,
            ...(canViewNetFares(viewer, offer.vehicle)
                ? {
                      netCents: offer.quote.totals.netCents,
                      markupBps: offer.quote.totals.markupBps,
                      marginCents: offer.quote.totals.marginCents
                  }
                : {})
        }
    }
});

export const toQuoteResult = (result, viewer) => ({
    from: toPoint(result.from),
    to: toPoint(result.to),
    route: result.route ? toRoute(result.route, viewer) : null,
    closed: result.closed ?? false,
    offers: result.offers.map((offer) => toOffer(offer, viewer))
});

const toBookingLeg = (leg, viewer, vehicle, { guest = false } = {}) => ({
    id: leg.id,
    legIndex: leg.legIndex,
    direction: leg.direction,
    from: leg.fromPointName,
    to: leg.toPointName,
    pickupAt: leg.pickupAt.toISOString(),
    distanceKm: leg.distanceKm,
    durationMinutes: leg.durationMinutes,
    sellCents: leg.sellCents,
    ...(canViewNetFares(viewer, vehicle) ? { netCents: leg.netCents } : {}),
    // Operational state, and who is coming — shaped for whoever is asking:
    // everything for operations, the accepted driver for a partner, and the
    // same with a surname initial for the passenger.
    status: leg.status ?? 'UNASSIGNED',
    assignment: leg.assignments ? toLegAssignmentFor(leg, viewer, { guest }) : null,
    /** The score already left on this leg, if any — so a form knows not to ask twice. */
    rating: leg.rating ? { score: leg.rating.score, status: leg.rating.status } : null
});

export const toTransferBookingSummary = (booking, viewer) => ({
    reference: booking.reference,
    status: booking.status,
    tripType: booking.tripType,
    pickupAt: booking.pickupAt.toISOString(),
    returnPickupAt: booking.returnPickupAt?.toISOString() ?? null,
    // From the snapshot, not the live route: a voucher has to keep describing
    // the journey that was sold.
    from: booking.routeSnapshot?.fromName ?? null,
    to: booking.routeSnapshot?.toName ?? null,
    vehicleName: booking.vehicleSnapshot?.name ?? null,
    passengers: booking.adults + booking.children,
    leadPassengerName: booking.leadPassengerName,
    leadPassengerEmail: booking.leadPassengerEmail,
    currency: booking.currency,
    totalCents: booking.sellTotalCents,
    createdAt: booking.createdAt.toISOString(),
    legStatuses: (booking.legs ?? []).map((leg) => leg.status ?? 'UNASSIGNED'),
    ...(isAdmin(viewer)
        ? {
              netTotalCents: booking.netTotalCents,
              markupBps: booking.markupBps,
              marginCents: booking.sellTotalCents - booking.netTotalCents,
              partner: booking.partner
                  ? { id: booking.partner.id, reference: booking.partner.reference, name: booking.partner.name }
                  : null
          }
        : {})
});

export const toTransferBooking = (booking, viewer) => ({
    ...toTransferBookingSummary(booking, viewer),
    route: booking.routeSnapshot,
    vehicle: booking.vehicleSnapshot,
    adults: booking.adults,
    children: booking.children,
    childAges: booking.childAges ?? [],
    luggage: booking.luggage,
    cabinBags: booking.cabinBags,
    leadPassengerPhone: booking.leadPassengerPhone ?? null,
    flightNumber: booking.flightNumber ?? null,
    pickupAddress: booking.pickupAddress ?? null,
    dropoffAddress: booking.dropoffAddress ?? null,
    pickupPlace: booking.pickupPlace ?? null,
    dropoffPlace: booking.dropoffPlace ?? null,
    specialRequests: booking.specialRequests ?? null,
    cancellation: {
        freeUntil: freeCancellationUntil(booking.cancellationSchedule),
        windows: (booking.cancellationSchedule?.windows ?? []).map((window) => ({
            fromAt: window.fromAt,
            toAt: window.toAt,
            chargeCents: window.chargeCents
        })),
        cancelledAt: booking.cancelledAt?.toISOString() ?? null,
        chargeCents: booking.cancellationChargeCents ?? null,
        reason: booking.cancellationReason ?? null
    },
    legs: (booking.legs ?? []).map((leg) =>
        toBookingLeg(leg, viewer, booking.vehicle, { guest: !viewer })
    ),
    extras: (booking.extras ?? []).map((extra) => ({
        code: extra.code,
        name: extra.name,
        quantity: extra.quantity,
        unitCents: extra.unitCents,
        totalCents: extra.totalCents
    })),
    confirmedAt: booking.confirmedAt?.toISOString() ?? null
});

export const toCancellationQuote = (quote) => ({
    refundableCents: quote.refundableCents,
    chargeCents: quote.chargeCents,
    currency: quote.currency,
    freeUntil: quote.freeUntil,
    asAt: quote.asAt
});

export const toBlackout = (blackout) => ({
    id: blackout.id,
    routeId: blackout.routeId,
    vehicleId: blackout.vehicleId,
    from: toDateOnly(blackout.from),
    to: toDateOnly(blackout.to),
    reason: blackout.reason ?? null
});
