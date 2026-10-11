"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Banknote } from "lucide-react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { PayForm } from "@/components/admin/finance/PayableActions";
import { Modal } from "@/components/ui/Modal";
import { dueInWords, instalmentKindLabels, productLabels } from "@/lib/admin/finance";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DueInstalment, DueTotals } from "@/types/finance";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The supplier instalments late or due this week — the same rows the
 * payment reminders are sent about, so what the desk is nudged about and
 * what it sees here never disagree. **Mark paid** opens the same dialog as
 * the payable's own page; recording the payment is what stops the reminders.
 */
export function PaymentsDuePanel({
  instalments,
  totals,
  days,
  now,
  canPay,
}: {
  instalments: DueInstalment[];
  totals: DueTotals;
  days: number;
  /** The render moment, as ISO text: a client component cannot take a Date. */
  now: string;
  canPay: boolean;
}) {
  const router = useRouter();
  const path = useLocalePath();
  const [paying, setPaying] = useState<DueInstalment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const at = new Date(now);

  const byCurrency = Object.entries(totals.outstandingByCurrency)
    .map(([currency, cents]) => formatMoney(cents, currency))
    .join(" · ");

  const description =
    instalments.length === 0
      ? `Nothing late, nothing due in the next ${days} days.`
      : `${plural(totals.overdue, "payment", "payments")} late, ${totals.due} due in the next ${days} days${byCurrency ? ` — ${byCurrency} outstanding` : ""}.`;

  return (
    <AdminPanel
      title="Supplier payments due"
      description={description}
      action={
        <Link
          href={path("/admin/finance/payables")}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-text transition-colors hover:text-brand-hover"
        >
          View all
          <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden />
        </Link>
      }
      bodyClassName="p-0"
    >
      {message && (
        <p role="status" className="border-b border-line bg-success/8 px-5 py-3 text-[0.8125rem] text-success">
          {message}
        </p>
      )}

      {instalments.length === 0 ? (
        <p className="px-5 py-10 text-center text-[0.875rem] text-muted">Nothing late, nothing due this week.</p>
      ) : (
        <ul className="divide-y divide-line">
          {instalments.map((instalment) => {
            const late = Boolean(instalment.dueAt) && new Date(instalment.dueAt!).getTime() < at.getTime();

            return (
              <li key={instalment.id} className="flex items-center gap-3 px-5 py-3">
                <Link
                  href={path(`/admin/finance/payables/${instalment.payable.id}`)}
                  prefetch={false}
                  className="min-w-0 flex-1 rounded-sm transition-colors hover:text-brand-text"
                >
                  <span className="block text-[0.875rem] font-medium text-ink">
                    {instalment.payable.bookingReference}
                    <span className="ms-2 text-[0.75rem] font-normal text-muted">{instalmentKindLabels[instalment.kind]}</span>
                  </span>
                  <span className="block truncate text-[0.75rem] text-muted">
                    {instalment.payable.supplier?.name ?? "Our own inventory"} · {productLabels[instalment.payable.product]}
                  </span>
                </Link>

                <span className="shrink-0 text-end">
                  <span className="block text-[0.875rem] font-medium text-ink tabular-nums">
                    {formatMoney(instalment.outstandingCents, instalment.currency)}
                  </span>
                  <span className={cn("block text-[0.75rem]", late ? "font-medium text-error-text" : "text-muted")}>
                    {dueInWords(instalment.dueAt, at)}
                  </span>
                </span>

                {canPay && instalment.outstandingCents > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(null);
                      setPaying(instalment);
                    }}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-[0.75rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
                  >
                    <Banknote size={14} aria-hidden />
                    Mark paid
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={paying !== null} onClose={() => setPaying(null)} title="Record payment to supplier" size="md">
        {paying && (
          <PayForm
            payable={paying.payable}
            instalment={paying}
            onClose={() => setPaying(null)}
            onDone={(text) => {
              setPaying(null);
              setMessage(text);
              router.refresh();
            }}
          />
        )}
      </Modal>
    </AdminPanel>
  );
}
