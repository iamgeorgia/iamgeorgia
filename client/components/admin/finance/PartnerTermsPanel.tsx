"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminDefinitionList, AdminPanel } from "@/components/admin/AdminPage";
import { FormError, SubmitButton, TextArea, labelClass } from "@/components/admin/FormControls";
import { ApiError, describeError } from "@/lib/api/client";
import { savePartnerTerms } from "@/lib/api/finance";
import { cn } from "@/lib/utils";
import type { PartnerTerms, ReceivableDueAnchor } from "@/types/finance";

/**
 * How long a partner has to pay us (owner decision D5): a number of days,
 * counted from confirmation or from arrival, set per partner. Each new
 * receivable takes its due date from here; Finance can still move one
 * booking's date on that receivable without touching the partner's terms.
 *
 * Rendered only when the viewer can read the terms — the page asks the API
 * and hides the panel on a refusal — and editable only with
 * `finance.terms.write`, which the PATCH checks again.
 */

const anchorLabels: Record<ReceivableDueAnchor, string> = {
  CONFIRMATION: "confirmation",
  ARRIVAL: "arrival",
};

const control =
  "h-10 rounded-sm border bg-surface px-3 text-[0.875rem] text-ink transition-colors focus:border-ink focus:outline-none disabled:opacity-60";

export function PartnerTermsPanel({ terms, canEdit }: { terms: PartnerTerms; canEdit: boolean }) {
  const router = useRouter();
  const [days, setDays] = useState(String(terms.paymentDueDays));
  const [anchor, setAnchor] = useState<ReceivableDueAnchor>(terms.paymentDueAnchor);
  const [note, setNote] = useState(terms.paymentTermsNote ?? "");
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

    const value = days.trim();
    if (!/^\d{1,3}$/.test(value) || Number(value) > 365) {
      setFieldErrors({ paymentDueDays: "A whole number of days, 0 to 365." });
      return;
    }

    setBusy(true);

    try {
      await savePartnerTerms(terms.id, {
        paymentDueDays: Number(value),
        paymentDueAnchor: anchor,
        paymentTermsNote: note.trim() || null,
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save the payment terms."));
    } finally {
      setBusy(false);
    }
  };

  const explanation = `Each booking is due this many days after ${anchorLabels[anchor]}; Finance can move one booking's date on its receivable.`;

  return (
    <AdminPanel title="Payment terms" description="How long this partner has to pay for what it books.">
      {canEdit ? (
        <form onSubmit={submit} noValidate className="space-y-4">
          <fieldset disabled={busy} className="min-w-0">
            <legend className={labelClass}>Days to pay</legend>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                step={1}
                value={days}
                onChange={(event) => {
                  setDays(event.target.value);
                  touched();
                }}
                aria-label="Days to pay"
                aria-invalid={fieldErrors.paymentDueDays ? true : undefined}
                className={cn(
                  control,
                  "w-20 text-end tabular-nums",
                  fieldErrors.paymentDueDays ? "border-error" : "border-line",
                )}
              />
              <span className="text-[0.8125rem] text-muted">from</span>
              <select
                value={anchor}
                onChange={(event) => {
                  setAnchor(event.target.value as ReceivableDueAnchor);
                  touched();
                }}
                aria-label="Counted from"
                className={cn(control, "border-line")}
              >
                <option value="CONFIRMATION">confirmation</option>
                <option value="ARRIVAL">arrival</option>
              </select>
            </div>
            {fieldErrors.paymentDueDays && (
              <p role="alert" className="mt-1.5 text-[0.75rem] text-error-text">
                {fieldErrors.paymentDueDays}
              </p>
            )}
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-subtle">{explanation}</p>
          </fieldset>

          <TextArea
            label="Note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              touched();
            }}
            disabled={busy}
            error={fieldErrors.paymentTermsNote}
            hint="Internal: what was agreed, and with whom."
            rows={2}
          />

          <FormError message={error} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.75rem] text-subtle">Applies to bookings confirmed from now on.</p>
            <SubmitButton type="submit" busy={busy} saved={saved}>
              {saved ? "Saved" : "Save terms"}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <>
          <AdminDefinitionList
            items={[
              {
                label: "Days to pay",
                value: `${terms.paymentDueDays} ${terms.paymentDueDays === 1 ? "day" : "days"} from ${anchorLabels[terms.paymentDueAnchor]}`,
              },
              { label: "Note", value: terms.paymentTermsNote ?? "—" },
            ]}
          />
          <p className="mt-4 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-subtle">
            {`Each booking is due this many days after ${anchorLabels[terms.paymentDueAnchor]}; Finance can move one booking's date on its receivable.`}
          </p>
        </>
      )}
    </AdminPanel>
  );
}
