import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { invoiceKindLabels, invoiceStatusLabels, invoiceStatusTone } from "@/lib/admin/finance";
import { ownInvoicePdfUrl } from "@/lib/api/invoices";
import { dateTimeFormat } from "@/lib/intl";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { InvoiceStatus, PartnerInvoice } from "@/types/invoice";
import type { Paginated } from "@/types/partner";

/**
 * A partner's own invoices: the proforma issued when a booking is confirmed
 * and the VAT invoice issued when it is paid in full. A Server Component with
 * no state; the PDF is a plain link that streams from the API.
 */

const TONES = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
} as const;

// Pinned to Tbilisi so every reader sees the same calendar day.
const formatDate = (iso: string | null) =>
  iso
    ? dateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tbilisi" }).format(
        new Date(iso),
      )
    : "—";

function InvoicePill({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        TONES[invoiceStatusTone[status]],
      )}
    >
      {invoiceStatusLabels[status]}
    </span>
  );
}

export function PortalInvoices({
  invoices,
  hrefFor,
}: {
  invoices: Paginated<PartnerInvoice>;
  /** The page's URL with these query changes applied. */
  hrefFor: (changes: Record<string, string | null>) => string;
}) {
  return (
    <section className="rounded-sm border border-line bg-surface">
      <div className="p-5 sm:p-6">
        <h2 className="font-display text-[1.25rem] text-ink">Invoices</h2>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
          {invoices.total === 0
            ? "No invoices yet. A proforma is issued when a booking is confirmed, and a VAT invoice when it is paid in full."
            : `${invoices.total} ${invoices.total === 1 ? "document" : "documents"}, newest first.`}
        </p>
      </div>

      {invoices.data.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {invoices.data.map((invoice) => (
            <li key={invoice.id} className="p-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[0.875rem] font-medium text-ink">{invoice.number ?? "—"}</span>
                    <span className="text-[0.8125rem] text-muted">{invoiceKindLabels[invoice.kind]}</span>
                    <InvoicePill status={invoice.status} />
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-muted">
                    {invoice.reference ? `For ${invoice.reference} · ` : ""}
                    Issued {formatDate(invoice.issueDate)}
                    {invoice.dueDate ? ` · due ${formatDate(invoice.dueDate)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-end">
                  <span className="text-[1rem] font-semibold text-ink tabular-nums">
                    {formatMoney(invoice.totalCents, invoice.currency)}
                  </span>
                  {invoice.hasPdf && (
                    <a
                      href={ownInvoicePdfUrl(invoice.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
                    >
                      PDF
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={invoices.page}
        totalPages={invoices.totalPages}
        hrefFor={(page) => hrefFor({ ipage: page > 1 ? String(page) : null })}
      />
    </section>
  );
}

function Pager({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const button =
    "inline-flex h-10 items-center gap-1 rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft";
  const disabled = "pointer-events-none opacity-40";

  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line p-5 sm:px-6" aria-label="Invoices pagination">
      <Link
        href={hrefFor(Math.max(1, page - 1))}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={cn(button, page <= 1 && disabled)}
      >
        <ChevronLeft size={15} aria-hidden className="rtl:-scale-x-100" />
        Previous
      </Link>
      <span className="text-[0.8125rem] text-muted">
        Page {page} of {totalPages}
      </span>
      <Link
        href={hrefFor(Math.min(totalPages, page + 1))}
        aria-disabled={page >= totalPages}
        tabIndex={page >= totalPages ? -1 : undefined}
        className={cn(button, page >= totalPages && disabled)}
      >
        Next
        <ChevronRight size={15} aria-hidden className="rtl:-scale-x-100" />
      </Link>
    </nav>
  );
}
