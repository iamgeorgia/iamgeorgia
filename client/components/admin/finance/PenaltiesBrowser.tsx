"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronRight, PenLine } from "lucide-react";
import { useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "../DataTable";
import { EntityPicker } from "../EntityPicker";
import { CheckboxField, FormError, NumberInput, SubmitButton, TextArea } from "../FormControls";
import { FINANCE_CURRENCIES, financeErrorMessage } from "./PaymentFormat";
import { Modal } from "@/components/ui/Modal";
import { approvalHref } from "@/lib/admin/approvals";
import { productLabels, subjectHref } from "@/lib/admin/finance";
import { requestApproval } from "@/lib/api/approvals";
import { ApiError } from "@/lib/api/client";
import { searchPartnerOptions } from "@/lib/api/finance-browser";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Penalty, PenaltyProduct } from "@/types/finance-controls";
import type { SettlementSubject } from "@/types/finance";

/**
 * The cancellation charges and the places finance changed them.
 *
 * Filters live in the URL and the server narrows the list, as on the other
 * finance registers. A charge is never edited in place: "Ask to change" sends
 * an approval request, and the new figure takes effect only once someone else
 * approves it. The page tells the asker where the request went.
 */

interface PenaltiesBrowserProps {
  penalties: Penalty[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** The partner the list is narrowed to, named for the picker. */
  partnerName?: string | null;
  /** Whether the viewer may ask for a change (`finance.adjustments.request`). */
  canRequest: boolean;
}

const PRODUCTS = Object.keys(productLabels) as PenaltyProduct[];

const field =
  "h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink sm:w-auto";
const legend = "mb-2 block text-[0.75rem] font-medium tracking-wide text-muted uppercase";

const bookingLink = (penalty: Penalty) =>
  subjectHref({
    kind: penalty.bookingType,
    id: penalty.bookingId,
    reference: penalty.reference,
    status: "",
  } satisfies SettlementSubject);

interface Sent {
  id: string;
  reference: string;
}

export function PenaltiesBrowser({
  penalties,
  total,
  page,
  pageSize,
  totalPages,
  partnerName,
  canRequest,
}: PenaltiesBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Penalty | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  const partner = params.get("partner") ?? "";
  const product = params.get("product") ?? "";
  const currency = params.get("currency") ?? "";
  const overridden = params.get("overridden") ?? "";

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }

    // A narrower filter makes the old page number meaningless.
    if (!("page" in changes)) next.delete("page");

    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  };

  const filtered = partner !== "" || product !== "" || currency !== "" || overridden !== "";
  const emptyMessage = filtered ? "No cancellation charges match your filters." : "No cancellation charge has been made yet.";

  const COLUMNS: Column[] = [
    { label: "Booking" },
    { label: "Partner", hideBelow: "lg" },
    { label: "Charged by policy", align: "end" },
    { label: "Agreed instead", align: "end", hideBelow: "xl" },
    { label: "Charged", align: "end" },
    { label: "Why changed", hideBelow: "xl" },
    { label: "", align: "end" },
  ];

  const actions = (penalty: Penalty) => (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {penalty.approvalId && (
        <Link
          href={path(approvalHref(penalty.approvalId))}
          prefetch={false}
          className="inline-flex items-center gap-1 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
        >
          Request
          <ChevronRight size={14} className="rtl:-scale-x-100" aria-hidden />
        </Link>
      )}
      {canRequest && (
        <button
          type="button"
          onClick={() => {
            setSent(null);
            setEditing(penalty);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
        >
          <PenLine size={14} aria-hidden />
          Ask to change
        </button>
      )}
    </div>
  );

  const reference = (penalty: Penalty) => {
    const href = bookingLink(penalty);

    return href ? (
      <Link
        href={path(href)}
        prefetch={false}
        className="font-mono text-[0.8125rem] font-medium text-ink underline-offset-4 hover:underline"
      >
        {penalty.reference}
      </Link>
    ) : (
      <span className="font-mono text-[0.8125rem] font-medium text-ink">{penalty.reference}</span>
    );
  };

  return (
    <section className="mt-8">
      <div className="rounded-sm border border-line bg-surface p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <EntityPicker
            label="Partner"
            value={partner}
            valueLabel={partnerName}
            search={searchPartnerOptions}
            onChange={(choice) => apply({ partner: choice?.id ?? null })}
            clearLabel="Any partner"
            placeholder="Any partner"
          />

          <div>
            <label htmlFor="penalty-product" className={legend}>
              Product
            </label>
            <select
              id="penalty-product"
              value={product}
              onChange={(event) => apply({ product: event.target.value })}
              className={field}
            >
              <option value="">All products</option>
              {PRODUCTS.map((value) => (
                <option key={value} value={value}>
                  {productLabels[value]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="penalty-currency" className={legend}>
              Currency
            </label>
            <select
              id="penalty-currency"
              value={currency}
              onChange={(event) => apply({ currency: event.target.value })}
              className={field}
            >
              <option value="">All currencies</option>
              {FINANCE_CURRENCIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="penalty-overridden" className={legend}>
              Changed by finance
            </label>
            <select
              id="penalty-overridden"
              value={overridden}
              onChange={(event) => apply({ overridden: event.target.value })}
              className={field}
            >
              <option value="">Changed or not</option>
              <option value="true">Only changed</option>
              <option value="false">Only the policy&apos;s figure</option>
            </select>
          </div>
        </div>

        <p
          aria-live="polite"
          className={cn("mt-4 border-t border-line pt-4 text-[0.8125rem] text-muted", pending && "opacity-50")}
        >
          {total === 1 ? "1 charge" : `${total} charges`}
        </p>
      </div>

      {sent && (
        <p
          role="status"
          className="mt-5 flex items-start gap-2 rounded-sm border border-success/40 bg-surface px-4 py-3 text-[0.8125rem] leading-relaxed text-body"
        >
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <span>
            Sent for approval as{" "}
            <Link
              href={path(approvalHref(sent.id))}
              prefetch={false}
              className="font-medium text-brand-text underline-offset-4 hover:underline"
            >
              {sent.reference}
            </Link>
            . The charge stays as it is until someone else approves it.
          </span>
        </p>
      )}

      <div className={cn("mt-5 transition-opacity", pending && "opacity-60")}>
        <div className="hidden lg:block">
          <DataTable columns={COLUMNS} caption="Cancellation charges">
            {penalties.length === 0 && <EmptyRow colSpan={COLUMNS.length} message={emptyMessage} />}

            {penalties.map((penalty) => (
              <Row key={penalty.id}>
                <Cell>
                  {reference(penalty)}
                  <span className="block text-[0.75rem] text-muted">{productLabels[penalty.bookingType]}</span>
                </Cell>
                <Cell hideBelow="lg">{penalty.partner?.name ?? <span className="text-subtle">Guest</span>}</Cell>
                <Cell align="end" className="tabular-nums">
                  {formatMoney(penalty.chargeCents, penalty.currency)}
                </Cell>
                <Cell align="end" hideBelow="xl" className="tabular-nums">
                  {penalty.overrideCents === null ? "—" : formatMoney(penalty.overrideCents, penalty.currency)}
                </Cell>
                <Cell align="end" className="font-medium text-ink tabular-nums">
                  {formatMoney(penalty.effectiveCents, penalty.currency)}
                </Cell>
                <Cell hideBelow="xl" className="max-w-64 text-[0.8125rem]">
                  {penalty.overrideReason ?? <span className="text-subtle">—</span>}
                </Cell>
                <Cell align="end">{actions(penalty)}</Cell>
              </Row>
            ))}
          </DataTable>
        </div>

        <ul className="space-y-3 lg:hidden">
          {penalties.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              {emptyMessage}
            </li>
          )}

          {penalties.map((penalty) => (
            <li key={penalty.id} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p>{reference(penalty)}</p>
                  <p className="text-[0.75rem] text-muted">
                    {productLabels[penalty.bookingType]} · {penalty.partner?.name ?? "Guest"}
                  </p>
                </div>
                <p className="font-medium text-ink tabular-nums">{formatMoney(penalty.effectiveCents, penalty.currency)}</p>
              </div>
              {penalty.overrideCents !== null && (
                <p className="mt-2 text-[0.75rem] text-muted">
                  The policy charged {formatMoney(penalty.chargeCents, penalty.currency)}.
                  {penalty.overrideReason && ` ${penalty.overrideReason}`}
                </p>
              )}
              <div className="mt-3 border-t border-line pt-3">{actions(penalty)}</div>
            </li>
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
            className="h-10 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-[0.8125rem] text-muted">
            Page {page} of {totalPages}
            <span className="sr-only">, {pageSize} per page</span>
          </p>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => apply({ page: String(page + 1) })}
            className="h-10 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Ask to change a cancellation charge" size="md">
        {editing && (
          <PenaltyChangeRequest
            key={editing.id}
            penalty={editing}
            onClose={() => setEditing(null)}
            onSent={(next) => {
              setSent(next);
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
    </section>
  );
}

function PenaltyChangeRequest({
  penalty,
  onClose,
  onSent,
}: {
  penalty: Penalty;
  onClose: () => void;
  onSent: (sent: Sent) => void;
}) {
  const [amount, setAmount] = useState(toMajorUnits(penalty.effectiveCents, penalty.currency));
  const [handBack, setHandBack] = useState(false);
  const [reason, setReason] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAmountError(undefined);
    setError(null);
    setFieldErrors({});

    let cents: number | null = null;
    if (!handBack) {
      cents = toMinorUnits(amount, penalty.currency);
      if (cents === null || cents < 0) {
        setAmountError("Enter an amount of zero or more.");
        return;
      }
      if (cents > penalty.chargeCents) {
        setAmountError(`At most ${formatMoney(penalty.chargeCents, penalty.currency)}, what the policy charged.`);
        return;
      }
    }

    setBusy(true);

    try {
      const approval = await requestApproval({
        kind: "PENALTY_OVERRIDE",
        subjectId: penalty.id,
        payload: { overrideCents: cents, reason: reason.trim() },
      });
      onSent({ id: approval.id, reference: approval.reference });
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(financeErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        {penalty.reference} was charged {formatMoney(penalty.chargeCents, penalty.currency)} by the cancellation policy.
        Ask for a lower charge, or for the policy&apos;s figure to apply again. Nothing changes until someone else approves it.
      </p>

      <div className="mt-5 grid gap-4">
        <NumberInput
          label={`New charge (${penalty.currency})`}
          value={amount}
          min={0}
          step="0.01"
          disabled={handBack || busy}
          onChange={(event) => setAmount(event.target.value)}
          required={!handBack}
          hint={`At most ${formatMoney(penalty.chargeCents, penalty.currency)}.`}
          error={amountError ?? fieldErrors.overrideCents}
        />
        <CheckboxField
          label="Go back to the policy's figure instead"
          hint="Removes any change made earlier."
          checked={handBack}
          onChange={setHandBack}
          disabled={busy}
        />
        <TextArea
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          required
          disabled={busy}
          placeholder="The guest was ill and sent a doctor's note"
          hint="Whoever decides will read this."
          error={fieldErrors.reason}
        />
      </div>

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton type="submit" busy={busy} disabled={reason.trim().length === 0}>
          Request approval
        </SubmitButton>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
