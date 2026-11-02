import { toDateOnly } from '../lib/time.js';
import { freeCancellationUntil } from '../services/hotel/policy.service.js';

/**
 * Rate plan responses.
 *
 * A rate plan is what a guest actually compares, so the shape is built around
 * the three things they compare on — board, refundability and payment terms —
 * with the machinery behind each available but not in the way.
 *
 * `netCents` and anything else from the supplier side never appears here.
 * Pricing arrives in Phase 4 and will be gated explicitly; until then there is
 * nothing on a rate plan that a guest may not see.
 */

export const toCancellationRule = (rule) => ({
    hoursBeforeCheckIn: rule.hoursBeforeCheckIn,
    chargeBasis: rule.chargeBasis,
    chargeValue: rule.chargeValue
});

export const toCancellationPolicy = (policy) =>
    policy
        ? {
              id: policy.id,
              name: policy.name,
              kind: policy.kind,
              description: policy.description ?? null,
              isActive: policy.isActive,
              // A null hotelId means this is a shared platform template rather
              // than something the property wrote, and the admin panel needs to
              // know because a template cannot be edited from a hotel.
              isTemplate: policy.hotelId === null,
              rules: (policy.rules ?? []).map(toCancellationRule)
          }
        : null;

export const toPaymentPolicy = (policy) =>
    policy
        ? {
              id: policy.id,
              name: policy.name,
              timing: policy.timing,
              depositBps: policy.depositBps ?? null,
              balanceDueDaysBeforeCheckIn: policy.balanceDueDaysBeforeCheckIn ?? null,
              // Card payments (docs/plans/FLITT_INTEGRATION_PLAN.md §4.4).
              unpaidCancelHours: policy.unpaidCancelHours ?? null,
              cardOptional: Boolean(policy.cardOptional),
              productKind: policy.productKind ?? null,
              description: policy.description ?? null,
              isActive: policy.isActive,
              isTemplate: policy.hotelId === null && (policy.tourId ?? null) === null
          }
        : null;

export const toMealPlan = (mealPlan) =>
    mealPlan
        ? {
              code: mealPlan.code,
              name: mealPlan.name,
              description: mealPlan.description ?? null
          }
        : null;

/** A property's own account of what a board code means for it. */
export const toHotelMealPlan = (hotelMealPlan) => ({
    ...toMealPlan(hotelMealPlan.mealPlan),
    hotelDescription: hotelMealPlan.description ?? null,
    inclusions: hotelMealPlan.inclusions ?? [],
    serviceTimes: hotelMealPlan.serviceTimes ?? {}
});

export const toRestriction = (restriction) => ({
    id: restriction.id,
    startDate: toDateOnly(restriction.startDate),
    endDate: toDateOnly(restriction.endDate),
    minStay: restriction.minStay ?? null,
    maxStay: restriction.maxStay ?? null,
    minAdvanceDays: restriction.minAdvanceDays ?? null,
    maxAdvanceDays: restriction.maxAdvanceDays ?? null,
    closedToArrival: restriction.closedToArrival,
    closedToDeparture: restriction.closedToDeparture,
    stopSell: restriction.stopSell
});

export const toRatePlan = (ratePlan) => ({
    id: ratePlan.id,
    roomTypeId: ratePlan.roomTypeId,
    code: ratePlan.code,
    name: ratePlan.name,
    status: ratePlan.status,
    visibility: ratePlan.visibility,
    sortOrder: ratePlan.sortOrder,
    currency: ratePlan.currency,
    mealPlan: toMealPlan(ratePlan.mealPlan),
    cancellation: toCancellationPolicy(ratePlan.cancellationPolicy),
    payment: toPaymentPolicy(ratePlan.paymentPolicy),
    occupancy: {
        base: ratePlan.baseOccupancy,
        minAdults: ratePlan.minAdults ?? null,
        maxAdults: ratePlan.maxAdults ?? null,
        maxChildren: ratePlan.maxChildren ?? null
    },
    sellableFrom: ratePlan.sellableFrom ? toDateOnly(ratePlan.sellableFrom) : null,
    sellableUntil: ratePlan.sellableUntil ? toDateOnly(ratePlan.sellableUntil) : null,
    restrictions: (ratePlan.restrictions ?? []).map(toRestriction),
    createdAt: ratePlan.createdAt,
    updatedAt: ratePlan.updatedAt
});

/**
 * A rate plan as an offer for one particular stay.
 *
 * Only this form carries a cancellation *deadline*, because a deadline only
 * exists relative to a check-in date. The catalogue form above deliberately
 * does not, so nothing can accidentally show a date computed from today.
 */
export const toOfferTerms = (ratePlan, schedule) => ({
    mealPlan: toMealPlan(ratePlan.mealPlan),
    cancellation: {
        name: ratePlan.cancellationPolicy?.name ?? null,
        kind: ratePlan.cancellationPolicy?.kind ?? null,
        description: ratePlan.cancellationPolicy?.description ?? null,
        freeUntil: schedule ? freeCancellationUntil(schedule) : null,
        refundable: schedule ? freeCancellationUntil(schedule) !== null : null
    },
    payment: toPaymentPolicy(ratePlan.paymentPolicy)
});
