"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Ban, CheckCircle2, Search } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { BookingApprovalDialogs, type BookingApprovalDecision } from "./BookingApprovalDialogs";
import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import {
  BOOKING_APPROVAL_PRODUCTS,
  approvalProductFilterLabels,
  approvalProductLabels,
  bookingApprovalHref,
  timeAgo,
} from "@/lib/admin/bookingApprovals";
import { formatInstant, formatStayDate } from "@/lib/admin/bookings";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { BookingApprovalProduct, BookingApprovalRow } from "@/types/booking";

/**
 * The approval queue: every booking and order waiting for the platform's
 * yes, earliest deadline first, across all four registers.
 *
 * Filters live in the URL, as on every other register, so a view is
 * shareable and the server does the narrowing. The decisions are taken here,
 * on the row, because the queue is worked by the dozen and a round trip to a
 * detail page per booking is the cost the queue exists to remove.
 */

const columns: Column[] = [
  { label: "Reference" },
  { label: "Booking" },
  { label: "Buyer", hideBelow: "xl" },
  { label: "Total", align: "end" },
  { label: "Requested", hideBelow: "xl" },
  { label: "Deadline" },
  { label: "Actions", align: "end" },
];

/** "12 – 14 Jun 2027", or the single date when the two are the same. */
const formatWhen = (when: BookingApprovalRow["when"]): string =>
  when.from === when.to ? formatStayDate(when.from) : `${formatStayDate(when.from)} – ${formatStayDate(when.to)}`;

export function BookingApprovalsBrowser({
  data,
  total,
  page,
  totalPages,
  now,
}: {
  data: BookingApprovalRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** The server's clock at render, so "2 hours ago" agrees across hydration. */
  now: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const localePath = useLocalePath();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [dialog, setDialog] = useState<{ row: BookingApprovalRow; decision: BookingApprovalDecision } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }

    // A narrower filter makes the old page number meaningless.
    if (!("page" in changes)) next.delete("page");

    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  // Debounced, so typing a reference does not fire a request per keystroke.
  useEffect(() => {
    const current = params.get("search") ?? "";
    if (search === current) return;

    const timer = setTimeout(() => apply({ search: search || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const product = params.get("product") ?? "";
  const overdueOnly = params.get("overdue") === "true";
  const at = new Date(now);

  const field =
    "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";
  const chip =
    "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-[0.8125rem] font-medium whitespace-nowrap transition-colors";
  const chipOn = "border-brand bg-brand-soft text-brand-text";
  const chipOff = "border-line text-body hover:border-subtle hover:text-ink";
  const action =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border px-3 text-[0.75rem] font-semibold transition-colors";

  const reference = (row: BookingApprovalRow) => (
    <Link
      href={localePath(bookingApprovalHref(row.product, row.reference))}
      prefetch={false}
      className="underline-offset-4 hover:underline"
    >
      <span className="font-medium text-ink">{row.reference}</span>
    </Link>
  );

  const productPill = (value: BookingApprovalProduct) => (
    <span className="ms-2 rounded-full bg-surface-soft px-2 py-0.5 text-[0.6875rem] font-medium tracking-wide text-muted uppercase">
      {approvalProductLabels[value]}
    </span>
  );

  const deadline = (row: BookingApprovalRow) =>
    row.deadlineAt ? (
      <span className={cn("inline-flex items-center gap-1 tabular-nums", row.overdue && "font-medium text-error-text")}>
        {row.overdue && <AlertTriangle size={12} aria-hidden />}
        {formatInstant(row.deadlineAt)}
      </span>
    ) : (
      <span className="text-subtle">—</span>
    );

  const actions = (row: BookingApprovalRow) => (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={() => setDialog({ row, decision: "approve" })}
        className={cn(action, "border-transparent bg-brand text-white hover:bg-brand-hover")}
      >
        <CheckCircle2 size={13} aria-hidden />
        Approve
      </button>
      <button
        type="button"
        onClick={() => setDialog({ row, decision: "reject" })}
        className={cn(action, "border-error/40 text-error-text hover:bg-error/8")}
      >
        <Ban size={13} aria-hidden />
        Reject
      </button>
    </div>
  );

  return (
    <div>
      <FilterDisclosure
        count={(product !== "" ? 1 : 0) + (overdueOnly ? 1 : 0)}
        lead={
          <div className="relative min-w-[16rem] flex-1">
            <Search size={15} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Reference, buyer name or email"
              aria-label="Search the approval queue"
              className={cn(field, "w-full ps-9")}
            />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => apply({ product: null })}
            aria-pressed={product === ""}
            className={cn(chip, product === "" ? chipOn : chipOff)}
          >
            All
          </button>
          {BOOKING_APPROVAL_PRODUCTS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => apply({ product: product === value ? null : value })}
              aria-pressed={product === value}
              className={cn(chip, product === value ? chipOn : chipOff)}
            >
              {approvalProductFilterLabels[value]}
            </button>
          ))}

          <span className="mx-1 h-6 w-px bg-line" aria-hidden />

          <button
            type="button"
            onClick={() => apply({ overdue: overdueOnly ? null : "true" })}
            aria-pressed={overdueOnly}
            className={cn(
              chip,
              overdueOnly ? "border-error bg-error/10 text-error-text" : "border-error/40 text-error-text hover:bg-error/5",
            )}
          >
            <AlertTriangle size={14} aria-hidden />
            Overdue only
          </button>
        </div>
      </FilterDisclosure>

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0
          ? "Nothing is waiting for approval."
          : `${total} ${total === 1 ? "booking" : "bookings"} waiting, earliest deadline first`}
      </p>

      <p role="status" aria-live="polite" className="mt-1 min-h-5 text-[0.8125rem] text-success">
        {message}
      </p>

      <div className={cn("mt-4 transition-opacity", pending && "opacity-60")}>
        {/* Desktop: a real table. Below lg the same rows render as cards. */}
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Bookings awaiting approval">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing is waiting for approval." />
            ) : (
              data.map((row) => (
                <Row key={`${row.product}-${row.id}`} className={cn(row.overdue && "bg-error/5")}>
                  <Cell>
                    {reference(row)}
                    {productPill(row.product)}
                  </Cell>
                  <Cell>
                    {row.title}
                    <span className="block text-[0.75rem] text-muted">{formatWhen(row.when)}</span>
                  </Cell>
                  <Cell hideBelow="xl">
                    {row.leadName}
                    {row.partner && <span className="block text-[0.75rem] text-muted">{row.partner.name}</span>}
                  </Cell>
                  <Cell align="end" className="tabular-nums">
                    {formatMoney(row.totalCents, row.currency)}
                  </Cell>
                  <Cell hideBelow="xl" className="whitespace-nowrap text-muted">
                    {timeAgo(row.requestedAt, at)}
                  </Cell>
                  <Cell className="whitespace-nowrap">{deadline(row)}</Cell>
                  <Cell align="end">{actions(row)}</Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>

        <ul className="flex flex-col gap-3 lg:hidden">
          {data.length === 0 && (
            <li className="py-12 text-center text-[0.875rem] text-muted">Nothing is waiting for approval.</li>
          )}
          {data.map((row) => (
            <li
              key={`${row.product}-${row.id}`}
              className={cn("rounded-sm border border-line bg-surface p-4", row.overdue && "border-error/40 bg-error/5")}
            >
              <div className="flex items-start justify-between gap-3">
                <span>
                  {reference(row)}
                  {productPill(row.product)}
                </span>
                <span className="font-medium text-ink tabular-nums">{formatMoney(row.totalCents, row.currency)}</span>
              </div>
              <p className="mt-2 text-[0.875rem] text-body">{row.title}</p>
              <p className="text-[0.8125rem] text-muted">{formatWhen(row.when)}</p>
              <p className="mt-1 text-[0.8125rem] text-muted">
                {row.leadName}
                {row.partner && ` · ${row.partner.name}`}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[0.75rem] text-muted">
                <span>Requested {timeAgo(row.requestedAt, at)}</span>
                {row.deadlineAt && (
                  <span>
                    {row.overdue ? "Overdue · " : "Due "}
                    {deadline(row)}
                  </span>
                )}
              </p>
              <div className="mt-3">{actions(row)}</div>
            </li>
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
            className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[0.8125rem] text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => apply({ page: String(page + 1) })}
            className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}

      {dialog && (
        <BookingApprovalDialogs
          product={dialog.row.product}
          reference={dialog.row.reference}
          partnerName={dialog.row.partner?.name ?? null}
          open={dialog.decision}
          onClose={() => setDialog(null)}
          onDone={setMessage}
        />
      )}
    </div>
  );
}
