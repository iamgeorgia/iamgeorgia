"use client";

import { useState } from "react";

import { describeError, ApiError } from "@/lib/api/client";
import { createPaymentPolicyTemplate, updatePaymentPolicyTemplate } from "@/lib/api/payments";
import type { PaymentPolicy, PaymentTiming } from "@/types/catalogue";
import type { PaymentPolicyInput, PaymentPolicyProductKind } from "@/types/payments";

import { CheckboxField, FormError, NumberInput, SelectInput, SubmitButton, TextArea, TextInput } from "./FormControls";

export const paymentTimingLabels: Record<PaymentTiming, string> = {
  PAY_NOW: "Pay now (card required at checkout)",
  PAY_LATER: "Pay later (card offered)",
  DEPOSIT: "Deposit, balance later",
  PAY_AT_HOTEL: "Pay on the spot (settled with the property, operator or driver)",
  CREDIT_ACCOUNT: "Credit account (partners on terms)",
};

const TIMINGS = Object.keys(paymentTimingLabels) as PaymentTiming[];

const DEFAULT_UNPAID_CANCEL_HOURS = 24;

interface PaymentPolicyEditorProps {
  productKind: PaymentPolicyProductKind;
  /** Omit to create a new template. */
  policy?: PaymentPolicy;
  onSaved: (policy: PaymentPolicy) => void;
  onCancel: () => void;
}

/**
 * Create or edit one payment policy template.
 *
 * Which fields appear follows what the checkout does with a timing (see the
 * matrix in the Flitt plan, section 4.4): only a pay-now or deposit policy
 * auto-cancels unpaid bookings, only a pay-on-the-spot policy can also offer
 * a card, and a deposit policy still charges the whole amount for now.
 */
export function PaymentPolicyEditor({ productKind, policy, onSaved, onCancel }: PaymentPolicyEditorProps) {
  const [name, setName] = useState(policy?.name ?? "");
  const [timing, setTiming] = useState<PaymentTiming>(policy?.timing ?? "PAY_LATER");
  const [depositPercent, setDepositPercent] = useState(
    policy?.depositBps != null ? String(policy.depositBps / 100) : "",
  );
  const [balanceDays, setBalanceDays] = useState(policy?.balanceDueDaysBeforeCheckIn?.toString() ?? "");
  // A blank field means "never"; a new pay-now policy starts at the default.
  const [cancelHours, setCancelHours] = useState(
    policy ? (policy.unpaidCancelHours?.toString() ?? "") : String(DEFAULT_UNPAID_CANCEL_HOURS),
  );
  const [cardOptional, setCardOptional] = useState(policy?.cardOptional ?? false);
  const [description, setDescription] = useState(policy?.description ?? "");
  const [isActive, setIsActive] = useState(policy?.isActive ?? true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const cancels = timing === "PAY_NOW" || timing === "DEPOSIT";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const body: PaymentPolicyInput = {
      productKind,
      name: name.trim(),
      timing,
      depositBps: timing === "DEPOSIT" && depositPercent !== "" ? Math.round(Number(depositPercent) * 100) : null,
      balanceDueDaysBeforeCheckIn: balanceDays !== "" ? Math.round(Number(balanceDays)) : null,
      unpaidCancelHours: cancels && cancelHours !== "" ? Math.round(Number(cancelHours)) : null,
      cardOptional: timing === "PAY_AT_HOTEL" ? cardOptional : false,
      description: description.trim() || null,
      isActive,
    };

    try {
      const saved = policy
        ? await updatePaymentPolicyTemplate(policy.id, body)
        : await createPaymentPolicyTemplate(body);
      onSaved(saved);
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 border-t border-line bg-surface-soft/40 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={fieldErrors.name}
        />
        <SelectInput
          label="When the guest pays"
          value={timing}
          onChange={(event) => setTiming(event.target.value as PaymentTiming)}
          options={TIMINGS.map((value) => ({ value, label: paymentTimingLabels[value] }))}
          error={fieldErrors.timing}
        />

        {timing === "DEPOSIT" && (
          <NumberInput
            label="Deposit (%)"
            min={1}
            max={100}
            step="0.01"
            value={depositPercent}
            onChange={(event) => setDepositPercent(event.target.value)}
            error={fieldErrors.depositBps}
          />
        )}

        {(timing === "DEPOSIT" || timing === "PAY_LATER") && (
          <NumberInput
            label="Balance due (days before check-in)"
            min={0}
            max={730}
            value={balanceDays}
            onChange={(event) => setBalanceDays(event.target.value)}
            hint="Blank = no fixed date."
            error={fieldErrors.balanceDueDaysBeforeCheckIn}
          />
        )}

        {cancels && (
          <NumberInput
            label="Cancel unpaid after (hours)"
            min={1}
            max={720}
            value={cancelHours}
            onChange={(event) => setCancelHours(event.target.value)}
            hint="Unpaid bookings are cancelled after this many hours; blank = never."
            error={fieldErrors.unpaidCancelHours}
          />
        )}
      </div>

      {timing === "DEPOSIT" && (
        <p
          role="note"
          className="rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-[0.8125rem] text-warning-text"
        >
          Deposits are not yet charged as deposits: this behaves as pay-now for the full amount.
        </p>
      )}

      {timing === "PAY_AT_HOTEL" && (
        <CheckboxField
          label="Also offer card at checkout"
          hint="Off: the guest settles on the spot and no card is offered."
          checked={cardOptional}
          onChange={setCardOptional}
        />
      )}

      <TextArea
        label="Description"
        rows={2}
        maxLength={500}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        hint="For staff; shown nowhere to guests."
        error={fieldErrors.description}
      />

      <CheckboxField
        label="Active"
        hint="An inactive template can no longer be chosen; items already using it keep it."
        checked={isActive}
        onChange={setIsActive}
      />

      <FormError message={error} />

      <div className="flex flex-wrap gap-2">
        <SubmitButton type="submit" busy={busy} disabled={name.trim().length === 0}>
          {policy ? "Save policy" : "Create policy"}
        </SubmitButton>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
