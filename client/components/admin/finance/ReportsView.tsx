"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { useTransition } from "react";

import { cn } from "@/lib/utils";
import type { AgeingReport, MarginReport } from "@/types/finance";

export type ReportKind = "summary" | "margin" | "ageing" | "commission";

const REPORTS: { value: ReportKind; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "margin", label: "Margin" },
  { value: "ageing", label: "Ageing" },
  { value: "commission", label: "Commission" },
];

const GROUPS: { value: MarginReport["groupBy"]; label: string }[] = [
  { value: "product", label: "Product" },
  { value: "supplier", label: "Supplier" },
  { value: "partner", label: "Partner (buyer)" },
];

const SIDES: { value: AgeingReport["side"]; label: string }[] = [
  { value: "receivables", label: "Owed to us (buyers)" },
  { value: "payables", label: "We owe (suppliers)" },
];

const field =
  "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";

const legendClass = "text-[0.75rem] font-medium tracking-wide text-muted uppercase";

interface ReportsViewProps {
  report: ReportKind;
  /** The period as the address names it; empty when it names none. */
  from: string;
  to: string;
  /** The period the server applied, shown when the address names none. */
  periodFrom: string;
  periodTo: string;
  groupBy: MarginReport["groupBy"];
  side: AgeingReport["side"];
  /** Empty for every currency. */
  currency: string;
  currencies: string[];
  /** Null when the viewer may not export. */
  csvHref: string | null;
  /** Whether the viewer may read the commission report; its tab is left out otherwise. */
  canReadCommission?: boolean;
}

/**
 * The report picker and its filters.
 *
 * The same URL-state pattern as the other registers: every control writes to
 * the address and the Server Component above reads the report again, so a
 * report — "margin by supplier, September, in lari" — is a link that can be
 * sent to whoever asked. Controls that do not apply to the chosen report are
 * hidden rather than disabled: the ageing report has no period, it is "now".
 */
export function ReportsView({
  report,
  from,
  to,
  periodFrom,
  periodTo,
  groupBy,
  side,
  currency,
  currencies,
  csvHref,
  canReadCommission = false,
}: ReportsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }

    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }));
  };

  // A changed end keeps the other end explicit, so the range on screen is the
  // range in the address and not half of it plus a moving default.
  const setFrom = (value: string) => apply({ from: value || null, to: value ? to || periodTo : to || null });
  const setTo = (value: string) => apply({ to: value || null, from: value ? from || periodFrom : from || null });

  const hasPeriod = report !== "ageing";

  return (
    <section className="mt-8 rounded-sm border border-line bg-surface p-4 sm:p-5" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Report">
        {REPORTS.filter((option) => option.value !== "commission" || canReadCommission).map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={report === option.value}
            onClick={() => apply({ report: option.value === "summary" ? null : option.value })}
            className={cn(
              "h-9 rounded-sm border px-3 text-[0.8125rem] font-medium transition-colors",
              report === option.value
                ? "border-ink bg-ink text-on-dark"
                : "border-line bg-surface text-body hover:border-ink/40",
            )}
          >
            {option.label}
          </button>
        ))}

        <span className="ms-auto flex items-center gap-3">
          {pending && <Loader2 size={16} className="animate-spin text-muted" aria-label="Loading report" />}
          {csvHref && (
            <a
              href={csvHref}
              download
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:border-ink/40"
            >
              <Download size={15} aria-hidden />
              Download CSV
            </a>
          )}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[auto_repeat(2,minmax(0,16rem))]">
        {hasPeriod && (
          <fieldset className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 xl:col-span-1">
            <legend className={cn(legendClass, "mb-1.5")}>
              Period <span className="normal-case tracking-normal">(Tbilisi days)</span>
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={from || periodFrom}
                max={to || periodTo || undefined}
                onChange={(event) => setFrom(event.target.value)}
                aria-label="From"
                className={cn(field, "min-w-0 flex-1 sm:flex-none")}
              />
              <span aria-hidden className="text-muted">
                –
              </span>
              <input
                type="date"
                value={to || periodTo}
                min={from || periodFrom || undefined}
                onChange={(event) => setTo(event.target.value)}
                aria-label="To"
                className={cn(field, "min-w-0 flex-1 sm:flex-none")}
              />
              {(from || to) && (
                <button
                  type="button"
                  onClick={() => apply({ from: null, to: null })}
                  className="text-[0.75rem] text-brand-text underline-offset-4 hover:underline"
                >
                  Last 30 days
                </button>
              )}
            </div>
          </fieldset>
        )}

        {(report === "margin" || report === "commission") && (
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={legendClass}>Group by</span>
            <select
              value={groupBy}
              onChange={(event) => apply({ groupBy: event.target.value === "product" ? null : event.target.value })}
              className={cn(field, "w-full min-w-0")}
            >
              {GROUPS.filter((option) => report === "margin" || option.value !== "supplier").map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {report === "ageing" && (
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={legendClass}>Side</span>
            <select
              value={side}
              onChange={(event) => apply({ side: event.target.value === "receivables" ? null : event.target.value })}
              className={cn(field, "w-full min-w-0")}
            >
              {SIDES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={legendClass}>Currency</span>
          <select
            value={currency}
            onChange={(event) => apply({ currency: event.target.value || null })}
            className={cn(field, "w-full min-w-0")}
          >
            <option value="">All currencies</option>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
