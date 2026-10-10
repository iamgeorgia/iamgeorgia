"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "../DataTable";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge";
import { formatFinanceDateTime } from "./PaymentFormat";
import {
  approvalHref,
  approvalKindLabels,
  approvalKinds,
  approvalStatusLabels,
  approvalStatuses,
} from "@/lib/admin/approvals";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Approval } from "@/types/approval";

interface ApprovalsBrowserProps {
  approvals: Approval[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const COLUMNS: Column[] = [
  { label: "Request" },
  { label: "What" },
  { label: "Amount", align: "end" },
  { label: "Asked by", hideBelow: "xl" },
  { label: "Asked" },
  { label: "Status" },
  { label: "", align: "end" },
];

/**
 * The approval requests and their filters. As on the other finance lists the
 * filters live in the URL and the server does the narrowing. With no status in
 * the address the list shows what is waiting; `all` is spelt out.
 */
export function ApprovalsBrowser({ approvals, total, page, pageSize, totalPages }: ApprovalsBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();

  const status = params.get("status") ?? "PENDING";
  const kind = params.get("kind") ?? "all";

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      const isDefault = (key === "kind" && value === "all") || (key === "status" && value === "PENDING");
      if (value === null || value === "" || isDefault) next.delete(key);
      else next.set(key, value);
    }

    // A narrower filter makes the old page number meaningless.
    if (!("page" in changes)) next.delete("page");

    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  };

  const chip = (selected: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
      selected
        ? "border-ink bg-ink text-on-dark"
        : "border-line bg-surface text-body hover:border-ink/40 hover:text-ink",
    );

  const field =
    "h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink sm:w-auto";

  const href = (approval: Approval) => path(approvalHref(approval.id));
  const amount = (approval: Approval) =>
    approval.amountCents !== null && approval.currency ? formatMoney(approval.amountCents, approval.currency) : "—";
  const emptyMessage = status === "PENDING" ? "Nothing is waiting for a decision." : "No requests match your filters.";

  return (
    <section className="mt-8">
      <div className="rounded-sm border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <fieldset>
            <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">Status</legend>
            <div className="flex flex-wrap gap-2">
              {([...approvalStatuses, "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => apply({ status: value })}
                  aria-pressed={status === value}
                  className={chip(status === value)}
                >
                  {value === "all" ? "All" : approvalStatusLabels[value]}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="approval-kind"
              className="mb-2 block text-[0.75rem] font-medium tracking-wide text-muted uppercase"
            >
              Kind
            </label>
            <select
              id="approval-kind"
              value={kind}
              onChange={(event) => apply({ kind: event.target.value })}
              className={field}
            >
              <option value="all">All kinds</option>
              {approvalKinds.map((value) => (
                <option key={value} value={value}>
                  {approvalKindLabels[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p
          aria-live="polite"
          className={cn("mt-4 border-t border-line pt-4 text-[0.8125rem] text-muted", pending && "opacity-50")}
        >
          {total === 1 ? "1 request" : `${total} requests`}
        </p>
      </div>

      <div className={cn("mt-5 transition-opacity", pending && "opacity-60")}>
        <div className="hidden lg:block">
          <DataTable columns={COLUMNS} caption="Approval requests">
            {approvals.length === 0 && <EmptyRow colSpan={COLUMNS.length} message={emptyMessage} />}

            {/* No prefetch: a prefetch per row would spend the panel's shared rate limit. */}
            {approvals.map((approval) => (
              <Row key={approval.id}>
                <Cell>
                  <Link
                    href={href(approval)}
                    prefetch={false}
                    className="font-mono text-[0.8125rem] font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {approval.reference}
                  </Link>
                  <span className="block text-[0.75rem] text-muted">{approvalKindLabels[approval.kind]}</span>
                </Cell>
                <Cell>{approval.summary}</Cell>
                <Cell align="end" className="tabular-nums">
                  {amount(approval)}
                </Cell>
                <Cell hideBelow="xl">{approval.requestedBy?.fullName ?? <span className="text-subtle">—</span>}</Cell>
                <Cell className="whitespace-nowrap">{formatFinanceDateTime(approval.createdAt)}</Cell>
                <Cell>
                  <ApprovalStatusBadge status={approval.status} />
                  {approval.lastError && (
                    <span className="mt-1 block text-[0.75rem] font-medium text-error-text">Could not be applied</span>
                  )}
                </Cell>
                <Cell align="end">
                  <Link
                    href={href(approval)}
                    prefetch={false}
                    className="inline-flex items-center gap-1 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
                  >
                    Open
                    <ChevronRight size={14} className="rtl:-scale-x-100" aria-hidden />
                  </Link>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </div>

        <ul className="space-y-3 lg:hidden">
          {approvals.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              {emptyMessage}
            </li>
          )}

          {approvals.map((approval) => (
            <li key={approval.id}>
              <Link
                href={href(approval)}
                prefetch={false}
                className="block rounded-sm border border-line bg-surface p-4 transition-colors hover:border-ink/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[0.8125rem] font-medium text-ink">{approval.reference}</p>
                    <p className="text-[0.75rem] text-muted">{approvalKindLabels[approval.kind]}</p>
                  </div>
                  <ApprovalStatusBadge status={approval.status} />
                </div>
                <p className="mt-2 text-[0.8125rem] text-body">{approval.summary}</p>
                <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-[0.75rem] text-muted">
                  <span>
                    {approval.requestedBy?.fullName ?? "—"} · {formatFinanceDateTime(approval.createdAt)}
                  </span>
                  <span className="font-medium text-ink tabular-nums">{amount(approval)}</span>
                </p>
                {approval.lastError && (
                  <p className="mt-2 text-[0.75rem] font-medium text-error-text">Could not be applied</p>
                )}
              </Link>
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
    </section>
  );
}
