"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { FormError, SubmitButton } from "@/components/admin/FormControls";
import { dueInWords } from "@/lib/admin/finance";
import { allocatePayment } from "@/lib/api/finance";
import { listReceivablesClient } from "@/lib/api/finance-browser";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Payment, Receivable } from "@/types/finance";

import { financeErrorMessage, formatFinanceDate, receivableDebtorName, receivableSubjectLine } from "./PaymentFormat";

/**
 * "Allocate the rest": spreads what a payment has not yet settled over
 * receivables, after the fact — money that arrived before anyone knew what
 * it was for, or more than the item it was recorded against.
 *
 * Money in is spread over open receivables; a refund to a buyer over items
 * something was paid on. Supplier-side money (paid out, or refunded by a
 * supplier) settles instalments, which live on the Payables screens.
 */
export function PaymentAllocator({ payment }: { payment: Payment }) {
  const path = useLocalePath();
  const settlesReceivables =
    (payment.direction === "IN" && payment.kind === "PAYMENT") ||
    (payment.direction === "OUT" && payment.kind === "REFUND");

  return (
    <AdminPanel
      title="Allocate the rest"
      description={`${formatMoney(payment.unallocatedCents, payment.currency)} of this payment has not been matched to anything yet.`}
    >
      {settlesReceivables ? (
        <ReceivableAllocator payment={payment} />
      ) : (
        <p className="text-[0.875rem] leading-relaxed text-body">
          {payment.direction === "OUT"
            ? "Money paid to a supplier settles their instalments."
            : "A supplier's refund is matched to their instalments."}{" "}
          Open the supplier&apos;s payable on the{" "}
          <Link
            href={path("/admin/finance/payables")}
            prefetch={false}
            className="text-brand-text underline-offset-4 hover:underline"
          >
            Payables
          </Link>{" "}
          screen to see what is due, and ask an administrator to match this payment to it.
        </p>
      )}
    </AdminPanel>
  );
}

const SEARCH_DEBOUNCE_MS = 300;

/** Earliest due first, undated last, then oldest — the server's own oldest-first order. */
const byDue = (a: Receivable, b: Receivable) => {
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  if (a.dueAt && !b.dueAt) return -1;
  if (!a.dueAt && b.dueAt) return 1;
  return a.createdAt < b.createdAt ? -1 : 1;
};

function ReceivableAllocator({ payment }: { payment: Payment }) {
  const router = useRouter();
  const isRefund = payment.kind === "REFUND";
  const partnerId = payment.counterparty.partner?.id ?? null;

  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Receivable[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a successful allocation, so the list shows what is left.
  const [reloadKey, setReloadKey] = useState(0);

  // How much one row can take: what is outstanding for money in, what was
  // paid for a refund — the same ceiling the server applies.
  const room = (row: Receivable) => (isRefund ? row.paidCents : row.outstandingCents);

  useEffect(() => {
    let cancelled = false;
    const search = term.trim();

    const timer = setTimeout(
      () => {
        listReceivablesClient({
          currency: payment.currency,
          status: isRefund ? ["PARTIAL", "PAID", "VOID", "WAIVED"] : ["OPEN", "PARTIAL"],
          ...(partnerId ? { debtorPartnerId: partnerId } : {}),
          ...(search ? { q: search } : {}),
          pageSize: 100,
        })
          .then(({ data }) => {
            if (cancelled) return;
            setLoadError(null);
            setRows(
              data
                .filter((row) => (isRefund ? row.paidCents > 0 : row.outstandingCents > 0))
                .sort(byDue),
            );
          })
          .catch((caught: unknown) => {
            if (!cancelled) setLoadError(financeErrorMessage(caught));
          });
      },
      // The first load goes at once; typing waits for a pause.
      search ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, payment.currency, partnerId, isRefund, reloadKey]);

  const cents = (id: string) => {
    const value = amounts[id];
    if (!value?.trim()) return 0;
    return toMinorUnits(value, payment.currency) ?? Number.NaN;
  };

  const visible = rows ?? [];
  const chosen = Object.keys(amounts)
    .map((id) => ({ id, amountCents: cents(id) }))
    .filter((row) => row.amountCents !== 0);
  const chosenCents = chosen.reduce((sum, row) => sum + (Number.isFinite(row.amountCents) ? row.amountCents : 0), 0);
  const leftCents = payment.unallocatedCents - chosenCents;

  const invalid = chosen.some((row) => {
    const target = visible.find((candidate) => candidate.id === row.id);
    return !Number.isFinite(row.amountCents) || row.amountCents < 0 || (target && row.amountCents > room(target));
  });
  const ready = chosen.length > 0 && !invalid && leftCents >= 0;

  /** Fills the visible rows earliest due first, until the money runs out. */
  const fillOldestFirst = () => {
    let left = payment.unallocatedCents;
    const next: Record<string, string> = {};

    for (const row of visible) {
      if (left <= 0) break;
      const take = Math.min(room(row), left);
      if (take > 0) {
        next[row.id] = toMajorUnits(take, payment.currency);
        left -= take;
      }
    }

    setAmounts(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError(null);

    try {
      await allocatePayment(
        payment.id,
        chosen.map((row) => ({ receivableId: row.id, amountCents: row.amountCents })),
      );
      setAmounts({});
      setReloadKey((key) => key + 1);
      router.refresh();
    } catch (caught) {
      setError(financeErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        {partnerId
          ? `${isRefund ? "Items" : "Open items"} for ${payment.counterparty.partner?.name}, in ${payment.currency}.`
          : `No partner on this payment — search for the ${isRefund ? "item" : "open item"} by reference, name or email.`}
      </p>

      <div className="relative mt-3">
        <Search
          size={15}
          className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Reference, name or email"
          aria-label="Search receivables"
          className="h-10 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-[0.875rem] text-ink transition-colors focus:border-ink focus:outline-none"
        />
      </div>

      {loadError && <FormError message={loadError} />}

      {rows === null && !loadError ? (
        <p className="mt-4 flex items-center gap-2 text-[0.8125rem] text-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Loading…
        </p>
      ) : (
        rows !== null && (
          <ul className="mt-4 divide-y divide-line rounded-sm border border-line">
            {rows.length === 0 && (
              <li className="p-4 text-center text-[0.8125rem] text-muted">
                {isRefund ? "Nothing paid in this currency to refund against." : "Nothing open in this currency."}
              </li>
            )}
            {rows.map((row) => {
              const value = amounts[row.id] ?? "";
              const rowCents = cents(row.id);
              const tooMuch = Number.isFinite(rowCents) && rowCents > room(row);

              return (
                <li key={row.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-[0.8125rem]">
                    <p className="font-mono font-medium text-ink">{row.reference}</p>
                    <p className="truncate text-muted">
                      {receivableDebtorName(row)}
                      {receivableSubjectLine(row) ? ` · ${receivableSubjectLine(row)}` : ""}
                    </p>
                    <p className={cn("text-muted", row.overdue && "text-error-text")}>
                      {isRefund ? "Paid " : "Outstanding "}
                      <span className="tabular-nums">{formatMoney(room(row), row.currency)}</span>
                      {row.dueAt && !isRefund ? ` · due ${formatFinanceDate(row.dueAt)} (${dueInWords(row.dueAt)})` : ""}
                    </p>
                  </div>
                  <label className="shrink-0">
                    <span className="sr-only">Amount for {row.reference}</span>
                    <input
                      value={value}
                      onChange={(event) => setAmounts((current) => ({ ...current, [row.id]: event.target.value }))}
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-invalid={tooMuch || undefined}
                      className={cn(
                        "h-10 w-full rounded-sm border bg-surface px-3 text-end text-[0.875rem] text-ink tabular-nums focus:outline-none sm:w-32",
                        tooMuch ? "border-error focus:border-error" : "border-line focus:border-ink",
                      )}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        )
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className={cn("text-[0.8125rem] tabular-nums", leftCents < 0 ? "text-error-text" : "text-muted")}>
          {leftCents < 0
            ? `${formatMoney(-leftCents, payment.currency)} more than is left`
            : `${formatMoney(leftCents, payment.currency)} left after this`}
        </p>
        <button
          type="button"
          onClick={fillOldestFirst}
          disabled={!rows || rows.length === 0}
          className="text-[0.8125rem] text-brand-text underline-offset-4 hover:underline disabled:opacity-40"
        >
          Fill oldest first
        </button>
      </div>

      <FormError message={error} />

      <div className="mt-4">
        <SubmitButton type="submit" busy={busy} disabled={!ready}>
          Allocate {chosenCents > 0 ? formatMoney(chosenCents, payment.currency) : ""}
        </SubmitButton>
      </div>
    </form>
  );
}
