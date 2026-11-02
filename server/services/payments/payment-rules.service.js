import { config } from '../../config.js';
import { prisma } from '../../db/index.js';
import { resolvePaymentRule, ruleFrom, ruleSummary } from '../../lib/payments/policy.js';

/**
 * The payment rule a checkout is about to book under, before the booking
 * exists — from what the checkout already holds: a hotel hold token, a tour
 * hold token, a transfer vehicle, a package. Several at once (a cart) resolve
 * to the strictest (§4.4). Nothing here is a credential: a hold token is
 * unguessable and the answer is a policy, not a price.
 */

const policySelect = { select: { name: true, timing: true, unpaidCancelHours: true, cardOptional: true } };

export const resolveCheckoutRule = async ({ hotelHolds = [], tourHolds = [], vehicleIds = [], packageSlugs = [] }, viewer = null) => {
    const [holds, tours, vehicles, packages] = await Promise.all([
        hotelHolds.length > 0
            ? prisma.bookingHold.findMany({ where: { token: { in: hotelHolds } }, select: { token: true, ratePlan: { select: { paymentPolicy: policySelect } } } })
            : [],
        tourHolds.length > 0
            ? prisma.tourHold.findMany({ where: { token: { in: tourHolds } }, select: { token: true, tourOption: { select: { paymentPolicy: policySelect } } } })
            : [],
        vehicleIds.length > 0
            ? prisma.transferVehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, provider: { select: { paymentPolicy: policySelect } } } })
            : [],
        packageSlugs.length > 0 ? prisma.package.findMany({ where: { slug: { in: packageSlugs } }, select: { slug: true, paymentPolicy: policySelect } }) : []
    ]);

    const rules = [
        ...holds.map((hold) => ruleFrom(hold.ratePlan?.paymentPolicy, 'HOTEL')),
        ...tours.map((hold) => ruleFrom(hold.tourOption?.paymentPolicy, 'TOUR')),
        ...vehicles.map((vehicle) => ruleFrom(vehicle.provider?.paymentPolicy, 'TRANSFER')),
        ...packages.map((pkg) => ruleFrom(pkg.paymentPolicy, 'PACKAGE'))
    ];

    const product = packageSlugs.length > 0 || rules.length > 1 ? 'PACKAGE' : hotelHolds.length > 0 ? 'HOTEL' : tourHolds.length > 0 ? 'TOUR' : vehicleIds.length > 0 ? 'TRANSFER' : 'PACKAGE';
    const rule = resolvePaymentRule(rules, { product });
    const summary = ruleSummary(rule, { paymentsEnabled: config.payments.flitt.enabled, partner: Boolean(viewer?.partnerId) });

    // With platform approval on (owner decision OD1 of the booking programme)
    // a booking has no bill until an operator says yes, so nothing can be
    // charged at checkout: the guest pays from the booking page, from the
    // "complete your payment" email, once the bill exists. The rule itself
    // still freezes on the receivable then.
    const approvalFirst = config.booking.approvalEnabled && summary.options.card;

    return {
        ...summary,
        options: approvalFirst ? { ...summary.options, card: false, later: true, required: false } : summary.options,
        approvalFirst,
        resolved: { hotelHolds: holds.length, tourHolds: tours.length, vehicles: vehicles.length, packages: packages.length },
        mode: config.payments.flitt.enabled ? (config.payments.flitt.mode === 'live' ? 'LIVE' : 'TEST') : null
    };
};
