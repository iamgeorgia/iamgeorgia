"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminDefinitionList, AdminPanel } from "@/components/admin/AdminPage";
import { CheckboxField, FormError, NumberInput, SelectInput, SubmitButton, labelClass } from "@/components/admin/FormControls";
import { ApiError, describeError } from "@/lib/api/client";
import { setPartnerCredit } from "@/lib/api/finance-controls";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CreditMode, CreditPosition } from "@/types/finance-controls";

import { currencyOptions } from "./PaymentFormat";

/**
 * How much a partner may have open with us at once, and what happens when a
 * booking would go past it. The position is read from the API; the form shows
 * only with `partners.credit.write`, which the PATCH checks again.
 */

const MODE_LABELS: Record<CreditMode, string> = {
  BLOCK: "Block",
  WARN: "Warn",
};

const MODE_HINTS: Record<CreditMode, string> = {
  BLOCK: "Block refuses the booking until open invoices are settled.",
  WARN: "Warn lets the booking through and tells finance.",
};

const MODES = Object.keys(MODE_LABELS) as CreditMode[];

/** The position in words, shared by the read-only view and the top of the form. */
function CreditFigures({ credit }: { credit: CreditPosition }) {
  if (credit.limitCents === null || !credit.currency) {
    return <p className="text-[0.875rem] text-body">No limit is set. This partner can book without a ceiling on what it owes.</p>;
  }

  const money = (cents: number | null) => (cents === null ? "—" : formatMoney(cents, credit.currency as string));
  const overLimit = credit.availableCents !== null && credit.availableCents < 0;

  return (
    <AdminDefinitionList
      items={[
        { label: "Limit", value: `${money(credit.limitCents)} (${credit.currency})` },
        { label: "When reached", value: MODE_LABELS[credit.mode] },
        { label: "Owed now", value: money(credit.outstandingCents) },
        {
          label: "Still available",
          value: <span className={cn("tabular-nums", overLimit && "font-medium text-error-text")}>{money(credit.availableCents)}</span>,
        },
      ]}
    />
  );
}

export function PartnerCreditPanel({
  partnerId,
  credit,
  canEdit,
}: {
  partnerId: string;
  credit: CreditPosition;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [currency, setCurrency] = useState(credit.currency ?? "GEL");
  const [amount, setAmount] = useState(credit.limitCents === null ? "" : toMajorUnits(credit.limitCents, credit.currency ?? "GEL"));
  const [noLimit, setNoLimit] = useState(credit.limitCents === null);
  const [mode, setMode] = useState<CreditMode>(credit.mode);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const touched = () => {
    setSaved(false);
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    let cents: number | null = null;
    if (!noLimit) {
      cents = toMinorUnits(amount, currency);
      if (cents === null || cents < 0) {
        setFieldErrors({ creditLimitCents: "Enter a limit of zero or more." });
        return;
      }
    }

    setBusy(true);

    try {
      await setPartnerCredit(
        partnerId,
        noLimit
          ? { creditLimitCents: null, creditLimitMode: mode }
          : { creditLimitCents: cents, creditLimitCurrency: currency, creditLimitMode: mode },
      );
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save the credit limit."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPanel title="Credit limit" description="How much this partner may owe us at once.">
      <CreditFigures credit={credit} />

      {canEdit && (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4 border-t border-line pt-4">
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <NumberInput
                label="Limit"
                value={amount}
                min={0}
                step="0.01"
                disabled={noLimit}
                onChange={(event) => {
                  setAmount(event.target.value);
                  touched();
                }}
                error={fieldErrors.creditLimitCents}
              />
              <SelectInput
                label="Currency"
                value={currency}
                disabled={noLimit}
                options={currencyOptions(credit.currency)}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  touched();
                }}
                error={fieldErrors.creditLimitCurrency}
              />
            </div>

            <CheckboxField
              label="No limit"
              hint="Clears the limit; the partner can book whatever it owes."
              checked={noLimit}
              onChange={(next) => {
                setNoLimit(next);
                touched();
              }}
            />

            <fieldset className="min-w-0">
              <legend className={labelClass}>When a booking would go past the limit</legend>
              <div className="mt-2 space-y-2">
                {MODES.map((value) => (
                  <label key={value} className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="credit-mode"
                      value={value}
                      checked={mode === value}
                      onChange={() => {
                        setMode(value);
                        touched();
                      }}
                      className="mt-0.5 size-4 shrink-0 accent-brand"
                    />
                    <span className="text-[0.8125rem] leading-snug text-body">
                      <span className="font-medium text-ink">{MODE_LABELS[value]}</span>
                      <span className="mt-0.5 block text-[0.75rem] text-subtle">{MODE_HINTS[value]}</span>
                    </span>
                  </label>
                ))}
              </div>
              {fieldErrors.creditLimitMode && (
                <p role="alert" className="mt-1.5 text-[0.75rem] text-error-text">
                  {fieldErrors.creditLimitMode}
                </p>
              )}
            </fieldset>
          </fieldset>

          <FormError message={error} />

          <div className="flex justify-end">
            <SubmitButton type="submit" busy={busy} saved={saved}>
              {saved ? "Saved" : "Save credit limit"}
            </SubmitButton>
          </div>
        </form>
      )}
    </AdminPanel>
  );
}
