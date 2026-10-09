"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Info } from "lucide-react";

import {
  CheckboxField,
  FormError,
  SubmitButton,
  TextArea,
  TextInput,
  hintClass,
  labelClass,
} from "@/components/admin/FormControls";
import { ApiError, describeError } from "@/lib/api/client";
import { saveSupplierTerms } from "@/lib/api/finance";
import {
  cancellationLiabilityHints,
  cancellationLiabilityLabels,
  milestoneAnchorLabels,
} from "@/lib/admin/finance";
import { dateTimeFormat } from "@/lib/intl";
import { formatMoney, percentToBps, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  CancellationLiability,
  Milestone,
  MilestoneAnchor,
  SupplierTerms,
  SupplierTermsKind,
} from "@/types/finance";

/**
 * A supplier's payment terms, as a form.
 *
 * The wire shape is an optional deposit plus exactly one balance, with
 * signed day offsets from an anchor date; the form asks for a number and a
 * "before / after" instead, because "-7" is not how anyone reads a contract.
 * The balance is always the remainder, so it has no amount field. The preview
 * sentence runs the same arithmetic as `buildInstalments` on the server
 * (percent rounded half up, a fixed deposit never more than the whole), so
 * what it says is what a booking confirmed today would get.
 */

type Direction = "before" | "after";

interface TimingDraft {
  anchor: MilestoneAnchor;
  days: string;
  direction: Direction;
}

const ANCHORS: MilestoneAnchor[] = ["CONFIRMATION", "ARRIVAL", "DEPARTURE"];
const LIABILITIES: CancellationLiability[] = ["PROPORTIONAL", "NONE_UNLESS_NON_REFUNDABLE", "MANUAL"];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const draftFrom = (milestone: { anchor: MilestoneAnchor; offsetDays: number }): TimingDraft => ({
  anchor: milestone.anchor,
  days: String(Math.abs(milestone.offsetDays)),
  direction: milestone.offsetDays < 0 ? "before" : "after",
});

/** The signed offset, or null when the number is not a whole 0–365. */
const offsetOf = (timing: TimingDraft): number | null => {
  if (!/^\d{1,3}$/.test(timing.days.trim())) return null;
  const days = Number(timing.days.trim());
  if (days > 365) return null;
  return timing.direction === "before" ? -days : days;
};

const describeTiming = (timing: TimingDraft): string => {
  const offset = offsetOf(timing);
  const anchor = milestoneAnchorLabels[timing.anchor];
  if (offset === null) return `relative to ${anchor}`;
  if (offset === 0) return `on the day of ${anchor}`;
  const days = Math.abs(offset);
  return `${days} ${days === 1 ? "day" : "days"} ${offset < 0 ? "before" : "after"} ${anchor}`;
};

const DAY = 86_400_000;

const formatDay = (date: Date) =>
  dateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tbilisi" }).format(date);

const control =
  "h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink transition-colors focus:border-ink focus:outline-none disabled:opacity-60";

export function SupplierTermsForm({
  kind,
  id,
  terms,
  currency,
  currencyKnown,
  canEdit,
}: {
  kind: SupplierTermsKind;
  id: string;
  terms: SupplierTerms;
  /** The supplier's selling currency, for a fixed deposit and the preview. */
  currency: string;
  /** False when the currency is a guess (a transfer provider has none of its own). */
  currencyKnown: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();

  const deposit = terms.milestones.find((m) => m.kind === "DEPOSIT");
  const balance = terms.milestones.find((m) => m.kind === "BALANCE");

  const [scheduled, setScheduled] = useState(terms.milestones.length > 0);
  const [depositOn, setDepositOn] = useState(Boolean(deposit));
  const [basis, setBasis] = useState<"PERCENT" | "FIXED">(deposit?.basis ?? "PERCENT");
  const [value, setValue] = useState(() => {
    if (!deposit) return "30";
    return deposit.basis === "PERCENT" ? String(deposit.value / 100) : toMajorUnits(deposit.value, currency);
  });
  const [depositTiming, setDepositTiming] = useState<TimingDraft>(
    deposit ? draftFrom(deposit) : { anchor: "CONFIRMATION", days: "3", direction: "after" },
  );
  const [balanceTiming, setBalanceTiming] = useState<TimingDraft>(
    balance ? draftFrom(balance) : { anchor: "ARRIVAL", days: "7", direction: "before" },
  );
  const [liability, setLiability] = useState<CancellationLiability>(terms.cancellationLiability);
  const [cutoff, setCutoff] = useState(terms.cutoffTime ?? "");
  const [notes, setNotes] = useState(terms.notes ?? "");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Fixed once, so the preview does not drift while the form is open.
  const [now] = useState(() => new Date());

  /** Wraps a setter so any edit clears "Saved" and the stale messages. */
  const edit =
    <T,>(setter: (next: T) => void) =>
    (next: T) => {
      setter(next);
      setSaved(false);
      setError(null);
    };

  const depositValue = useMemo((): { value: number } | { error: string } => {
    if (basis === "PERCENT") {
      const percent = Number.parseFloat(value.replace(",", "."));
      const bps = Number.isFinite(percent) ? percentToBps(percent) : NaN;
      if (!Number.isFinite(bps) || bps < 1 || bps > 9999) return { error: "A percentage between 0.01 and 99.99." };
      return { value: bps };
    }
    const cents = toMinorUnits(value, currency);
    if (cents === null || cents < 1) return { error: "An amount above zero." };
    return { value: cents };
  }, [basis, value, currency]);

  /** The body to PUT, or the per-field reasons it cannot be built yet. */
  const build = ():
    | { ok: true; milestones: Milestone[] }
    | { ok: false; errors: Record<string, string> } => {
    if (!scheduled) return { ok: true, milestones: [] };

    const errors: Record<string, string> = {};
    const milestones: Milestone[] = [];

    if (depositOn) {
      const offset = offsetOf(depositTiming);
      if (offset === null) errors.depositDays = "A whole number of days, 0 to 365.";
      if ("error" in depositValue) errors.depositValue = depositValue.error;
      if (offset !== null && "value" in depositValue) {
        milestones.push({
          kind: "DEPOSIT",
          basis,
          value: depositValue.value,
          anchor: depositTiming.anchor,
          offsetDays: offset,
        });
      }
    }

    const balanceOffset = offsetOf(balanceTiming);
    if (balanceOffset === null) errors.balanceDays = "A whole number of days, 0 to 365.";
    else milestones.push({ kind: "BALANCE", anchor: balanceTiming.anchor, offsetDays: balanceOffset });

    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, milestones };
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const built = build();
    const errors: Record<string, string> = built.ok ? {} : { ...built.errors };
    if (cutoff.trim() && !CLOCK.test(cutoff.trim())) errors.cutoffTime = "A time as HH:MM, e.g. 10:00.";

    if (!built.ok || Object.keys(errors).length) {
      setFieldErrors(errors);
      setError("Some fields need attention.");
      return;
    }

    setBusy(true);

    try {
      await saveSupplierTerms(kind, id, {
        milestones: built.milestones,
        cancellationLiability: liability,
        cutoffTime: cutoff.trim() || null,
        notes: notes.trim() || null,
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save these terms."));
    } finally {
      setBusy(false);
    }
  };

  // --- Preview -----------------------------------------------------------------------

  const preview = useMemo(() => {
    const total = toMinorUnits(1000, currency) ?? 100_000;
    const money = (cents: number) => formatMoney(cents, currency);
    const anchors: Record<MilestoneAnchor, Date> = {
      CONFIRMATION: now,
      ARRIVAL: new Date(now.getTime() + 30 * DAY),
      DEPARTURE: new Date(now.getTime() + 33 * DAY),
    };
    const lead = `For a booking of ${money(total)} confirmed today with arrival in 30 days and departure 3 days later`;

    if (!scheduled) {
      return `${lead}: the whole ${money(total)} is one balance with no due date, and the payable is flagged for Finance to review.`;
    }

    const dueOn = (timing: TimingDraft) => {
      const offset = offsetOf(timing);
      if (offset === null) return "on a date still to be set";
      const date = new Date(anchors[timing.anchor].getTime() + offset * DAY);
      const past = date.getTime() < now.getTime() - DAY / 2;
      return `on ${formatDay(date)}${past ? " (already passed, so due straight away)" : ""}`;
    };

    let depositCents = 0;
    if (depositOn && "value" in depositValue) {
      depositCents =
        basis === "PERCENT" ? Math.round((total * depositValue.value) / 10_000) : Math.min(depositValue.value, total);
    }

    const parts: string[] = [];
    if (depositCents > 0) parts.push(`deposit ${money(depositCents)} due ${dueOn(depositTiming)}`);
    if (total - depositCents > 0) parts.push(`balance ${money(total - depositCents)} due ${dueOn(balanceTiming)}`);
    else parts.push("nothing left for the balance");

    return `${lead}: ${parts.join(", ")}.`;
  }, [scheduled, depositOn, depositValue, basis, depositTiming, balanceTiming, currency, now]);

  return (
    <form onSubmit={submit} noValidate>
      {!canEdit && (
        <p className="mb-5 flex items-start gap-2 rounded-sm bg-surface-soft px-4 py-3 text-[0.8125rem] text-muted">
          <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
          You can read these terms. Changing them is for Finance staff with permission to edit
          payment terms.
        </p>
      )}

      <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-8">
        <section className="space-y-5">
          <h3 className="text-[0.875rem] font-semibold text-ink">When the supplier is paid</h3>

          <CheckboxField
            label="Pay this supplier on a schedule"
            hint="Off means no schedule: each booking's net is one undated balance, flagged for Finance to review."
            checked={scheduled}
            onChange={edit(setScheduled)}
            disabled={!canEdit || busy}
          />

          {scheduled && (
            <div className="space-y-5 border-s-2 border-line ps-4">
              <CheckboxField
                label="Take a deposit first"
                hint="Paid before the balance. The balance is always what is left."
                checked={depositOn}
                onChange={edit(setDepositOn)}
                disabled={!canEdit || busy}
              />

              {depositOn && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <span className={labelClass}>Deposit</span>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <select
                          value={basis}
                          onChange={(event) => {
                            const next = event.target.value as "PERCENT" | "FIXED";
                            edit(setBasis)(next);
                            setValue(next === "PERCENT" ? "30" : "");
                          }}
                          aria-label="Deposit basis"
                          className={control}
                        >
                          <option value="PERCENT">A percentage</option>
                          <option value="FIXED">A fixed amount</option>
                        </select>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={value}
                            onChange={(event) => edit(setValue)(event.target.value)}
                            aria-label={basis === "PERCENT" ? "Deposit percentage" : `Deposit amount in ${currency}`}
                            aria-invalid={fieldErrors.depositValue ? true : undefined}
                            className={cn(
                              control,
                              "w-28 text-end tabular-nums",
                              fieldErrors.depositValue && "border-error",
                            )}
                          />
                          <span className="text-[0.8125rem] text-muted">{basis === "PERCENT" ? "%" : currency}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {fieldErrors.depositValue && (
                    <p role="alert" className="text-[0.75rem] text-error-text">
                      {fieldErrors.depositValue}
                    </p>
                  )}
                  {basis === "FIXED" && (
                    <p className={hintClass}>
                      {currencyKnown
                        ? `In ${currency}, the supplier's currency. Never more than the booking's net.`
                        : "In the booking's currency. Never more than the booking's net."}
                    </p>
                  )}

                  <TimingPicker
                    legend="Deposit due"
                    value={depositTiming}
                    onChange={edit(setDepositTiming)}
                    error={fieldErrors.depositDays}
                  />
                </div>
              )}

              <TimingPicker
                legend={depositOn ? "Balance due" : "Payment due"}
                value={balanceTiming}
                onChange={edit(setBalanceTiming)}
                error={fieldErrors.balanceDays}
              />
            </div>
          )}

          <TextInput
            label="Cut-off time"
            type="time"
            value={cutoff}
            onChange={(event) => edit(setCutoff)(event.target.value)}
            hint="The time of day an instalment falls due, in the supplier's time zone. 10:00 if left empty."
            error={fieldErrors.cutoffTime}
            className="max-w-48"
          />

          <p className="rounded-sm bg-surface-soft px-4 py-3 text-[0.8125rem] leading-relaxed text-body" aria-live="polite">
            {preview}
          </p>
        </section>

        <fieldset className="min-w-0">
          <legend className="text-[0.875rem] font-semibold text-ink">After a cancellation</legend>
          <p className="mt-1 text-[0.8125rem] text-muted">What the supplier is owed when a booking is cancelled.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {LIABILITIES.map((option) => {
              const checked = liability === option;
              return (
                <label
                  key={option}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-sm border p-4 transition-colors has-[:disabled]:cursor-default",
                    checked ? "border-ink bg-surface-soft" : "border-line hover:border-ink/40",
                  )}
                >
                  <input
                    type="radio"
                    name="cancellationLiability"
                    value={option}
                    checked={checked}
                    onChange={() => edit(setLiability)(option)}
                    className="mt-0.5 size-4 shrink-0 accent-brand"
                  />
                  <span className="min-w-0">
                    <span className="block text-[0.875rem] font-medium text-ink">
                      {cancellationLiabilityLabels[option]}
                    </span>
                    <span className="mt-1 block text-[0.8125rem] leading-relaxed text-muted">
                      {cancellationLiabilityHints[option]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <TextArea
          label="Notes"
          value={notes}
          onChange={(event) => edit(setNotes)(event.target.value)}
          hint="For Finance: the contract reference, the bank's cut-off, anything the schedule cannot say."
          error={fieldErrors.notes}
          maxLength={2000}
        />
      </fieldset>

      <FormError message={error} />

      {canEdit && (
        <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.75rem] leading-relaxed text-subtle">
            New terms apply to bookings confirmed after you save. Bookings already confirmed keep their
            schedule; Finance adjusts a single payable by hand when it must.
          </p>
          <SubmitButton type="submit" busy={busy} saved={saved} className="shrink-0">
            {saved ? "Saved" : "Save terms"}
          </SubmitButton>
        </div>
      )}
    </form>
  );
}

/** "[7] days [before] [arrival]" — one milestone's due date. */
function TimingPicker({
  legend,
  value,
  onChange,
  error,
}: {
  legend: string;
  value: TimingDraft;
  onChange: (next: TimingDraft) => void;
  error?: string;
}) {
  const set = (changes: Partial<TimingDraft>) => {
    const next = { ...value, ...changes };
    // Nothing is due before the booking exists.
    if (next.anchor === "CONFIRMATION") next.direction = "after";
    onChange(next);
  };

  return (
    <fieldset className="min-w-0">
      <legend className={labelClass}>{legend}</legend>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          step={1}
          value={value.days}
          onChange={(event) => set({ days: event.target.value })}
          aria-label={`${legend}: number of days`}
          aria-invalid={error ? true : undefined}
          className={cn(control, "w-20 text-end tabular-nums", error && "border-error")}
        />
        <span className="text-[0.8125rem] text-muted">{value.days.trim() === "1" ? "day" : "days"}</span>
        <select
          value={value.direction}
          onChange={(event) => set({ direction: event.target.value as Direction })}
          aria-label={`${legend}: before or after`}
          className={control}
        >
          <option value="after">after</option>
          {(value.anchor !== "CONFIRMATION" || value.direction === "before") && <option value="before">before</option>}
        </select>
        <select
          value={value.anchor}
          onChange={(event) => set({ anchor: event.target.value as MilestoneAnchor })}
          aria-label={`${legend}: counted from`}
          className={control}
        >
          {ANCHORS.map((anchor) => (
            <option key={anchor} value={anchor}>
              {milestoneAnchorLabels[anchor]}
            </option>
          ))}
        </select>
      </div>
      <span className={hintClass}>Due {describeTiming(value)}.</span>
      {error && (
        <p role="alert" className="mt-1.5 text-[0.75rem] text-error-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}
