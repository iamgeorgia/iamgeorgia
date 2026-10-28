import { zonedTimeToInstant } from '../../lib/time.js';

/**
 * Cancellation: turning policy into money.
 *
 * Pure by design — plain data in, plain data out, no Prisma and no `req`. That
 * is what lets every boundary case be tested exhaustively, and these are
 * boundaries that decide refunds.
 *
 * The important idea is that a booking never re-reads its hotel's policy. At
 * confirmation the rules are resolved into a **schedule of absolute instants**
 * and frozen onto the booking. Cancelling is then a lookup in that schedule,
 * so a hotel that tightens its terms in March cannot retroactively change what
 * a guest who booked in January is owed.
 */

/** Basis points of an amount, rounded half-up, in minor units. */
const applyBps = (amountCents, bps) => Math.round((amountCents * bps) / 10_000);

/**
 * What one rule charges, given the stay it applies to.
 *
 * `NIGHTS` sums the *actual* first N nights rather than N times an average:
 * cancelling a stay that starts on New Year's Eve should forfeit New Year's
 * Eve, not the mean of a week that includes it.
 *
 * `totalCents` is what the guest paid — the nights plus any tax included in
 * the price — and is what a percentage-of-total and a fixed cap are read
 * against. It defaults to the sum of the nights for callers with no tax.
 */
export const chargeForRule = (rule, { nightlyCents, totalCents }) => {
    const total = totalCents ?? nightlyCents.reduce((sum, cents) => sum + cents, 0);

    switch (rule.chargeBasis) {
        case 'PERCENT_OF_TOTAL':
            return applyBps(total, rule.chargeValue);
        case 'PERCENT_OF_FIRST_NIGHT':
            return applyBps(nightlyCents[0] ?? 0, rule.chargeValue);
        case 'FIXED_AMOUNT':
            return Math.min(rule.chargeValue, total);
        case 'NIGHTS':
            return nightlyCents.slice(0, rule.chargeValue).reduce((sum, cents) => sum + cents, 0);
        default:
            return 0;
    }
};

/**
 * Resolves a policy into absolute windows for one particular stay.
 *
 * Each rule says "from this many hours before check-in and inward, this
 * applies", so the hours are the *start* of a tier and not its end. Tiers are
 * laid out widest-first and each one runs until the next opens.
 *
 * Anything earlier than the first deadline is free — that is what "free
 * cancellation until 30 days before" means — with one exception, which is how a
 * non-refundable rate is expressed: a deadline so wide it has already passed at
 * the moment of booking. There the free window is dropped rather than dated in
 * the past.
 *
 * `fromAt` is inclusive, `toAt` exclusive, and the last window is open-ended so
 * that cancelling after check-in still lands somewhere.
 *
 * `includedTaxCents` is the tax the guest paid inside the price for this room.
 * It belongs in the schedule's total because the refund is read off that
 * total: a schedule built from the nights alone refunded the room and kept the
 * VAT on a free cancellation.
 */
export const buildCancellationSchedule = ({
    rules,
    checkInDate,
    checkInTime = '14:00',
    timezone,
    nightlyCents,
    includedTaxCents = 0,
    currency,
    bookedAt = new Date()
}) => {
    const checkInAt = zonedTimeToInstant(checkInDate, checkInTime, timezone);
    const total = nightlyCents.reduce((sum, cents) => sum + cents, 0) + includedTaxCents;

    // Widest deadline first: 720 hours before check-in comes before 168.
    const ordered = [...rules].sort((a, b) => b.hoursBeforeCheckIn - a.hoursBeforeCheckIn);

    const windows = ordered.map((rule) => ({
        fromAt: new Date(checkInAt.getTime() - rule.hoursBeforeCheckIn * 3_600_000).toISOString(),
        toAt: null,
        chargeCents: chargeForRule(rule, { nightlyCents, totalCents: total }),
        basis: rule.chargeBasis,
        hoursBeforeCheckIn: rule.hoursBeforeCheckIn
    }));

    // Anything earlier than the first deadline is free — that is what "free
    // cancellation until 30 days before" means.
    //
    // Unless the first deadline is already in the past at the moment of
    // booking, which is exactly how a non-refundable rate is expressed: a
    // deadline so wide that it has already elapsed. Emitting a free window
    // there would advertise free cancellation until a date in 2016, so the
    // window is dropped and the charge simply applies from the start.
    const firstDeadline = windows.length > 0 ? Date.parse(windows[0].fromAt) : null;

    if (firstDeadline !== null && firstDeadline > bookedAt.getTime()) {
        windows.unshift({
            fromAt: null,
            toAt: windows[0].fromAt,
            chargeCents: 0,
            basis: 'FREE',
            description: 'Free cancellation'
        });
    } else if (windows.length > 0) {
        windows[0].fromAt = null;
    }

    // Close each window at the start of the next, leaving the last open-ended.
    for (let index = 1; index < windows.length; index += 1) {
        windows[index - 1].toAt = windows[index].fromAt;
    }

    // A policy with no rules at all is fully refundable, and says so rather
    // than producing an empty schedule nothing can be looked up in.
    if (windows.length === 0) {
        windows.push({
            fromAt: null,
            toAt: null,
            chargeCents: 0,
            basis: 'FREE',
            description: 'Free cancellation'
        });
    }

    return {
        currency,
        totalCents: total,
        checkInAt: checkInAt.toISOString(),
        windows
    };
};

/**
 * What cancelling at a given moment costs, read off a frozen schedule.
 *
 * Takes the schedule, not the policy: by the time this runs the terms are
 * whatever was agreed at booking, and the hotel's current policy is irrelevant.
 */
export const calculateRefund = (schedule, at = new Date()) => {
    const instant = at instanceof Date ? at : new Date(at);
    const time = instant.getTime();

    const window =
        schedule.windows.find((candidate) => {
            const from = candidate.fromAt === null ? -Infinity : Date.parse(candidate.fromAt);
            const to = candidate.toAt === null ? Infinity : Date.parse(candidate.toAt);

            return time >= from && time < to;
        }) ?? schedule.windows.at(-1);

    const chargeCents = Math.min(window.chargeCents, schedule.totalCents);

    return {
        chargeCents,
        refundCents: schedule.totalCents - chargeCents,
        currency: schedule.currency,
        refundable: chargeCents < schedule.totalCents,
        window
    };
};

/**
 * The deadline a guest is shown: the last moment cancellation is still free.
 *
 * Null when the rate was never free — a non-refundable rate has no deadline to
 * display, and showing one dated at booking time would be worse than showing
 * none.
 */
export const freeCancellationUntil = (schedule) => {
    const free = schedule.windows.filter((window) => window.chargeCents === 0);

    if (free.length === 0) {
        return null;
    }

    const last = free.at(-1);

    return last.toAt ?? null;
};

/**
 * Moves the end of free cancellation on a frozen schedule, by hand.
 *
 * The windows stay what they were; only the boundary between "free" and the
 * first charge moves to `instant`. A schedule that was never free (a
 * non-refundable rate) gains a free window up to that moment. What
 * cancelling costs is read off the schedule, so the deadline a desk shows
 * and the charge it applies can never disagree.
 */
export const moveFreeCancellationUntil = (schedule, instant) => {
    const at = (instant instanceof Date ? instant : new Date(instant)).toISOString();
    const windows = schedule.windows.map((window) => ({ ...window }));
    const free = windows.filter((window) => window.chargeCents === 0);

    if (free.length === 0) {
        windows.unshift({ fromAt: null, toAt: at, chargeCents: 0, basis: 'FREE', description: 'Free cancellation' });
        windows[1].fromAt = at;
    } else {
        const last = free.at(-1);
        const index = windows.indexOf(last);

        last.toAt = windows[index + 1] ? at : null;
        if (windows[index + 1]) windows[index + 1].fromAt = at;
    }

    // A charged window that now ends before it starts is swallowed.
    const kept = windows.filter((window, index) => index === 0 || window.toAt === null || Date.parse(window.toAt) > Date.parse(window.fromAt));

    return { ...schedule, windows: kept };
};

/**
 * The three policies every new property starts from, so the wizard's policy
 * step is a choice rather than a blank form.
 *
 * Expressed in hours because a deadline is a wall-clock instant at the
 * property; storing days would leave the time of day to be guessed later.
 */
export const POLICY_TEMPLATES = [
    {
        name: 'Flexible',
        kind: 'FLEXIBLE',
        description: 'Free cancellation until 7 days before arrival. After that, the first night is charged.',
        rules: [
            { hoursBeforeCheckIn: 168, chargeBasis: 'PERCENT_OF_FIRST_NIGHT', chargeValue: 10_000 },
            { hoursBeforeCheckIn: 0, chargeBasis: 'PERCENT_OF_TOTAL', chargeValue: 10_000 }
        ]
    },
    {
        name: 'Non-refundable',
        kind: 'NON_REFUNDABLE',
        description: 'Charged in full when the booking is confirmed. No refund after confirmation.',
        // One rule with a very wide window: non-refundable from the moment of
        // booking, whenever that was.
        rules: [{ hoursBeforeCheckIn: 87_600, chargeBasis: 'PERCENT_OF_TOTAL', chargeValue: 10_000 }]
    },
    {
        name: 'Tiered',
        kind: 'TIERED',
        description:
            'Free more than 30 days before arrival, then 30% from 30 days, 50% from 15 days, ' +
            'and the full amount within 7 days.',
        // Each rule opens a tier that runs until the next one opens, so the
        // hours are the *start* of a band and not its end. 30+ days out is
        // covered by no rule at all, which is what makes it free.
        rules: [
            { hoursBeforeCheckIn: 720, chargeBasis: 'PERCENT_OF_TOTAL', chargeValue: 3_000 },
            { hoursBeforeCheckIn: 360, chargeBasis: 'PERCENT_OF_TOTAL', chargeValue: 5_000 },
            { hoursBeforeCheckIn: 168, chargeBasis: 'PERCENT_OF_TOTAL', chargeValue: 10_000 }
        ]
    }
];

export const PAYMENT_TEMPLATES = [
    { name: 'Pay now', timing: 'PAY_NOW', description: 'Charged in full at the time of booking.' },
    {
        name: 'Pay at the hotel',
        timing: 'PAY_AT_HOTEL',
        description: 'Nothing is taken now; the property collects on arrival.'
    },
    {
        name: 'Deposit',
        timing: 'DEPOSIT',
        depositBps: 3_000,
        balanceDueDaysBeforeCheckIn: 14,
        description: '30% deposit at booking, the balance due 14 days before arrival.'
    },
    {
        name: 'Credit account',
        timing: 'CREDIT_ACCOUNT',
        description: 'Invoiced to the partner account on the agreed settlement terms.'
    }
];
