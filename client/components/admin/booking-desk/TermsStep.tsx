"use client";

import { stepCardClass, type StepProps } from "./wizard";
import { useCan } from "@/components/admin/AdminViewerContext";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { CheckboxField, SelectInput, TextArea, TextInput } from "@/components/admin/FormControls";
import { ReadOnlyNote } from "@/components/admin/ReadOnlyNote";
import {
  MANUAL_CHANNELS,
  adjustmentCentsFrom,
  isCartBooking,
  manualChannelLabels,
  wizardCatalogueCents,
  wizardCurrency,
  type TermsState,
} from "@/lib/admin/manualBooking";
import { listUsersClient } from "@/lib/api/users";
import { formatMoney } from "@/lib/money";

/**
 * Step 4: the desk's own terms.
 *
 * How the booking came in (it becomes the booking's `source`), who is
 * handling it, the notes the desk keeps, and the two things that need a
 * capability of their own: a change to the price (`bookings.price.override`,
 * a signed figure on top of the catalogue price, with a reason that is
 * audited) and confirming at once (`bookings.approve`, instead of the
 * approvals queue).
 */
export function TermsStep({ state, setState, errors, clearError }: StepProps) {
  const can = useCan();
  const canOverride = can("bookings.price.override");
  const canApprove = can("bookings.approve");
  const currency = wizardCurrency(state);
  const catalogue = wizardCatalogueCents(state);
  const cart = isCartBooking(state);

  const set = <K extends keyof TermsState>(key: K, value: TermsState[K]) => {
    clearError(key);
    setState((current) => ({ ...current, terms: { ...current.terms, [key]: value } }));
  };

  const searchStaff = async (term: string): Promise<PickerOption[]> => {
    const found = await listUsersClient("staff", { q: term || undefined, pageSize: 10 });
    return found.data.map((user) => ({ id: user.id, label: user.fullName, meta: user.email }));
  };

  const cents = adjustmentCentsFrom(state.terms.adjustmentAmount, currency);

  return (
    <div className="flex flex-col gap-5">
      <section className={stepCardClass}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectInput
            label="Channel"
            hint="Becomes the booking's source."
            placeholder="How did the booking come in?"
            value={state.terms.channel}
            onChange={(event) => set("channel", event.target.value as TermsState["channel"])}
            options={MANUAL_CHANNELS.map((channel) => ({ value: channel, label: manualChannelLabels[channel] }))}
            error={errors.channel}
          />
          <EntityPicker
            label="Assigned manager"
            hint="Who is handling this booking. Optional."
            value={state.terms.assignedManagerUserId}
            valueLabel={state.terms.assignedManagerLabel}
            onChange={(choice) => {
              set("assignedManagerUserId", choice?.id ?? "");
              set("assignedManagerLabel", choice?.label ?? null);
            }}
            search={searchStaff}
            placeholder="Nobody yet"
            clearLabel="Nobody"
            error={errors.assignedManagerUserId}
          />
          <TextArea
            label="Internal notes"
            hint="For the desk only. Never shown to the buyer or the supplier."
            rows={3}
            maxLength={2000}
            value={state.terms.internalNotes}
            onChange={(event) => set("internalNotes", event.target.value)}
            error={errors.internalNotes}
            className="sm:col-span-2"
          />
        </div>
      </section>

      <section className={stepCardClass}>
        <h3 className="text-[0.9375rem] font-semibold text-ink">Price</h3>
        <p className="mt-1 text-[0.8125rem] text-muted">
          The catalogue price is {catalogue !== null ? formatMoney(catalogue, currency) : "set by the search"}
          {cart ? ` across ${state.items.length} ${state.items.length === 1 ? "line" : "lines"}` : ""}. An adjustment is added on top, never a
          replacement: the supplier cost and the cancellation terms still read the catalogue.
          {cart
            ? " On an order it applies to the whole order and is spread over the standalone lines by the server; a package keeps its own discount and takes none of it."
            : ""}
        </p>
        {canOverride ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-[12rem_1fr]">
            <TextInput
              label={`Adjustment (${currency})`}
              hint="Signed: -50 is a discount, 120 a supplement."
              inputMode="decimal"
              placeholder="0"
              value={state.terms.adjustmentAmount}
              onChange={(event) => set("adjustmentAmount", event.target.value)}
              error={errors.adjustmentAmount}
              className="[&_input]:text-end [&_input]:tabular-nums"
            />
            <TextInput
              label="Reason"
              hint="Audited with the booking, and printed on nothing."
              value={state.terms.adjustmentReason}
              onChange={(event) => set("adjustmentReason", event.target.value)}
              error={errors.adjustmentReason}
              maxLength={300}
              disabled={cents === null}
            />
          </div>
        ) : (
          <ReadOnlyNote needs="bookings.price.override" what="Changing the price" className="mt-4" />
        )}
      </section>

      <section className={stepCardClass}>
        <h3 className="text-[0.9375rem] font-semibold text-ink">Confirmation</h3>
        {canApprove ? (
          <CheckboxField
            className="mt-3"
            label="Confirm now"
            hint="Otherwise the booking waits in the approvals queue."
            checked={state.terms.confirmNow}
            onChange={(next) => set("confirmNow", next)}
          />
        ) : (
          <p className="mt-2 text-[0.8125rem] text-muted">The booking will wait in the approvals queue for somebody with the right to say yes.</p>
        )}
        {errors.confirmNow && (
          <p role="alert" className="mt-2 text-[0.75rem] text-error-text">
            {errors.confirmNow}
          </p>
        )}
      </section>
    </div>
  );
}
