import { toDateOnly } from '../lib/time.js';
import { canViewBuyer, canViewMargin } from '../middleware/auth.js';
import { toBookingSummary } from './booking.js';
import { toTransferBookingSummary } from './transfer.js';
import { toTourBookingSummary } from './tourBooking.js';
import { toServiceBookingSummary } from './service.js';
import { childOf } from '../services/order/order.service.js';

/**
 * Order responses.
 *
 * Each item carries its child booking through that product's own summary
 * serializer, so the per-product net gating is exactly what the standalone
 * registers apply. The order-level net and margin are admin-only.
 */

const toChild = (item, viewer) => {
    const child = childOf(item);

    if (!child) return null;

    switch (item.componentType) {
        case 'HOTEL_STAY':
            return toBookingSummary(child, viewer);
        case 'TRANSFER':
            return toTransferBookingSummary(child, viewer);
        case 'TOUR':
            return toTourBookingSummary(child, viewer);
        case 'SERVICE':
        default:
            return toServiceBookingSummary(child, viewer);
    }
};

export const toOrderItem = (item, viewer) => ({
    slotIndex: item.slotIndex,
    componentType: item.componentType,
    label: item.label,
    required: item.required,
    status: item.status,
    fulfilment: item.fulfilment,
    sellCents: item.sellCents,
    adjustmentCents: item.adjustmentCents,
    lineTotalCents: item.lineTotalCents,
    cancellationChargeCents: item.cancellationChargeCents ?? null,
    cancelledAt: item.cancelledAt ?? null,
    ...(canViewMargin(viewer) ? { netCents: item.netCents } : {}),
    booking: toChild(item, viewer)
});

export const toOrderSummary = (order, viewer) => {
    const snapshot = order.packageSnapshot ?? {};

    const summary = {
        reference: order.reference,
        status: order.status,
        kind: order.kind,
        package: { id: snapshot.id ?? order.packageId, slug: snapshot.slug ?? order.package?.slug ?? null, name: snapshot.name ?? order.package?.name ?? null },
        startDate: toDateOnly(order.startDate),
        endDate: toDateOnly(order.endDate),
        adults: order.adults,
        childAges: order.childAges ?? [],
        rooms: order.rooms,
        leadName: order.leadName,
        currency: order.currency,
        totalCents: order.sellTotalCents,
        adjustmentCents: order.adjustmentCents,
        itemCount: (order.items ?? []).length,
        pendingCount: (order.items ?? []).filter((item) => item.status === 'REQUESTED').length,
        requestDeadlineAt: order.requestDeadlineAt ?? null,
        createdAt: order.createdAt,
        confirmedAt: order.confirmedAt ?? null,
        cancelledAt: order.cancelledAt ?? null,
        completedAt: order.completedAt ?? null
    };

    if (canViewMargin(viewer)) {
        summary.componentsNetCents = order.componentsNetCents;
        summary.componentsSellCents = order.componentsSellCents;
        summary.marginCents = order.sellTotalCents - order.componentsNetCents;
    }

    if (canViewBuyer(viewer)) {
        summary.partner = order.partner ?? null;
    }

    return summary;
};

export const toOrderDetail = (order, viewer) => ({
    ...toOrderSummary(order, viewer),
    leadEmail: order.leadEmail,
    leadPhone: order.leadPhone ?? null,
    specialRequests: order.specialRequests ?? null,
    packageSnapshot: order.packageSnapshot,
    cancellationChargeCents: order.cancellationChargeCents ?? null,
    cancellationReason: order.cancellationReason ?? null,
    source: order.source,
    items: (order.items ?? []).map((item) => toOrderItem(item, viewer))
});

export const toOrderCancellationQuote = (quote) => ({
    chargeCents: quote.chargeCents,
    refundCents: quote.refundCents,
    currency: quote.currency,
    refundable: quote.refundCents > 0,
    items: (quote.items ?? []).map((item) => ({
        slotIndex: item.slotIndex,
        label: item.label,
        chargeCents: item.chargeCents,
        refundCents: item.refundCents,
        clawbackCents: item.clawbackCents
    }))
});
