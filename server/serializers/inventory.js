import { toDateOnly } from '../lib/time.js';
import { canViewMargin, canViewNetRates } from '../middleware/auth.js';

/**
 * Inventory, rate and quote responses.
 *
 * `availableUnits` is computed here and nowhere else. It is not a column, and
 * making it one would create a fifth number that can disagree with the four it
 * is derived from — the single failure mode this table cannot afford.
 *
 * Anything on the supplier side of the margin — net rates, markup, margin — is
 * absent rather than null for a viewer without permission, so a client cannot
 * tell the difference between "no margin" and "you may not see the margin".
 *
 * Permission means admin *or the supplier that owns this hotel*: the net rate
 * is the supplier's own contracted cost, and hiding it from them would be
 * absurd. It stays invisible to everyone else, because a guest who can see the
 * net rate can see the margin.
 */

export const toInventoryNight = (row) => ({
    date: toDateOnly(row.date),
    totalUnits: row.totalUnits,
    blockedUnits: row.blockedUnits,
    bookedUnits: row.bookedUnits,
    heldUnits: row.heldUnits,
    availableUnits: Math.max(0, row.totalUnits - row.blockedUnits - row.bookedUnits - row.heldUnits),
    stopSell: row.stopSell,
    minStay: row.minStay ?? null,
    closedToArrival: row.closedToArrival,
    closedToDeparture: row.closedToDeparture
});

export const toRateNight = (row, viewer, hotel) => {
    const night = {
        date: toDateOnly(row.date),
        currency: row.currency,
        closed: row.closed,
        extraAdultCents: row.extraAdultCents ?? null,
        extraChildCents: row.extraChildCents ?? null,
        singleOccupancyCents: row.singleOccupancyCents ?? null,
        sellCents: row.sellCents ?? null
    };

    if (canViewNetRates(viewer, hotel)) {
        night.netCents = row.netCents;
    }

    return night;
};

/**
 * The admin calendar grid: one row per night, every rate plan beside it.
 *
 * Assembled from two flat queries rather than one per plan, which is where N+1
 * would otherwise get into a screen that is refreshed constantly.
 */
export const toCalendar = ({ roomType, inventory, rates }, viewer, hotel) => {
    const byDate = new Map();

    for (const row of inventory) {
        byDate.set(toDateOnly(row.date), { ...toInventoryNight(row), rates: [] });
    }

    for (const rate of rates) {
        const date = toDateOnly(rate.date);

        if (!byDate.has(date)) {
            // A priced night with no inventory row is a real state and worth
            // showing: it is exactly the mistake that makes a hotel look
            // bookable in search and fail at checkout.
            byDate.set(date, {
                date,
                totalUnits: 0,
                blockedUnits: 0,
                bookedUnits: 0,
                heldUnits: 0,
                availableUnits: 0,
                stopSell: false,
                minStay: null,
                closedToArrival: false,
                closedToDeparture: false,
                rates: []
            });
        }

        byDate.get(date).rates.push({
            ratePlanId: rate.ratePlan.id,
            ratePlanName: rate.ratePlan.name,
            ratePlanCode: rate.ratePlan.code,
            ...toRateNight(rate, viewer, hotel)
        });
    }

    return {
        roomType: { id: roomType.id, name: roomType.name, code: roomType.code },
        nights: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
    };
};

export const toTaxFee = (taxFee) => ({
    id: taxFee.id,
    name: taxFee.name,
    basis: taxFee.basis,
    value: taxFee.value,
    currency: taxFee.currency,
    includedInRate: taxFee.includedInRate,
    appliesToChildren: taxFee.appliesToChildren,
    startDate: taxFee.startDate ? toDateOnly(taxFee.startDate) : null,
    endDate: taxFee.endDate ? toDateOnly(taxFee.endDate) : null
});

/**
 * A quote, as returned by search and by the booking preview.
 *
 * The per-night `lines` are what make a total explicable — "why is this 340 and
 * not 300" is answerable without anyone reading code.
 */
export const toQuote = (quote, viewer, hotel) => {
    const payload = {
        currency: quote.currency,
        party: quote.party,
        nights: quote.nights.map((night) => ({
            date: night.date,
            sellCents: night.sellCents,
            ...(canViewNetRates(viewer, hotel) ? { netCents: night.netCents, lines: night.lines } : {})
        })),
        taxes: {
            includedCents: quote.taxes.includedCents,
            payableAtPropertyCents: quote.taxes.payableAtPropertyCents,
            applied: quote.taxes.applied.map(({ name, basis, amountCents, includedInRate }) => ({
                name,
                basis,
                amountCents,
                includedInRate
            }))
        },
        totals: {
            nights: quote.totals.nightsCount,
            roomCents: quote.totals.sellCents,
            taxIncludedCents: quote.totals.taxIncludedCents,
            payableAtPropertyCents: quote.totals.payableAtPropertyCents,
            totalCents: quote.totals.totalCents
        }
    };

    if (canViewNetRates(viewer, hotel)) {
        payload.totals.netCents = quote.totals.netCents;
    }

    if (canViewMargin(viewer)) {
        payload.totals.markupBps = quote.totals.markupBps;
        payload.totals.marginCents = quote.totals.marginCents;
    }

    return payload;
};
