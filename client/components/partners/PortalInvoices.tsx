import { Download, FileText } from "lucide-react";

import { InvoiceLineDescription } from "@/components/admin/finance/InvoiceLineDescription";
import { InvoiceStatusBadge } from "@/components/admin/finance/InvoiceStatusBadge";
import { LinkPager } from "@/components/partners/LinkPager";
import { PortalEmpty, PortalPanel } from "@/components/partners/PortalPage";
import { invoiceKindLabels } from "@/lib/admin/finance";
import { ownInvoicePdfUrl } from "@/lib/api/invoices";
import { dateTimeFormat } from "@/lib/intl";
import { formatMoney } from "@/lib/money";
import type { PartnerInvoice } from "@/types/invoice";
import type { Paginated } from "@/types/partner";

/**
 * A partner's own invoices: the proforma issued when a booking is confirmed
 * and the VAT invoice issued when it is paid in full. A Server Component with
 * no state; the PDF is a plain link that streams from the API.
 */

// Pinned to Tbilisi so every reader sees the same calendar day.
const formatDate = (iso: string | null) =>
  iso
    ? dateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tbilisi" }).format(
        new Date(iso),
      )
    : "—";

export function PortalInvoices({
  invoices,
  hrefFor,
}: {
  invoices: Paginated<PartnerInvoice>;
  /** The page's URL with these query changes applied. */
  hrefFor: (changes: Record<string, string | null>) => string;
}) {
  return (
    <PortalPanel
      id="invoices"
      title="Invoices"
      icon={FileText}
      description={
        invoices.total === 0
          ? undefined
          : <bdi>{`${invoices.total} ${invoices.total === 1 ? "document" : "documents"}, newest first.`}</bdi>
      }
      bodyClassName=""
    >
      {invoices.data.length === 0 ? (
        <PortalEmpty>
          No invoices yet. A proforma is issued when a booking is confirmed, and a VAT invoice when it is
          paid in full.
        </PortalEmpty>
      ) : (
        <ul className="divide-y divide-line">
          {invoices.data.map((invoice) => (
            <li key={invoice.id} className="px-4 py-4 sm:px-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <span className="font-mono text-[0.875rem] font-medium text-ink">{invoice.number ?? "—"}</span>
                    <InvoiceStatusBadge status={invoice.status} />
                  </p>
                  <p className="mt-1.5 text-[0.8125rem] text-muted">
                    {invoiceKindLabels[invoice.kind]}
                    {invoice.reference ? ` · for ${invoice.reference}` : ""}
                  </p>
                  <p className="text-[0.8125rem] text-muted">
                    Issued {formatDate(invoice.issueDate)}
                    {invoice.dueDate ? ` · due ${formatDate(invoice.dueDate)}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-[1rem] font-semibold whitespace-nowrap text-ink tabular-nums">
                    {formatMoney(invoice.totalCents, invoice.currency)}
                  </span>
                  {invoice.hasPdf && (
                    <a
                      href={ownInvoicePdfUrl(invoice.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-line px-2.5 text-[0.8125rem] font-medium text-ink transition-colors hover:border-ink"
                    >
                      <Download size={14} aria-hidden />
                      PDF
                      <span className="sr-only"> of invoice {invoice.number ?? ""} (opens in a new tab)</span>
                    </a>
                  )}
                </div>
              </div>

              {invoice.lines.length > 0 && (
                <details className="group mt-3">
                  <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-sm text-[0.8125rem] font-medium text-muted hover:text-ink">
                    {invoice.lines.length} {invoice.lines.length === 1 ? "line" : "lines"}
                  </summary>
                  <ul className="mt-1 divide-y divide-line rounded-sm border border-line">
                    {invoice.lines.map((line) => (
                      <li key={line.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-[0.8125rem]">
                        <div className="min-w-0">
                          <InvoiceLineDescription line={line} />
                          <p className="mt-0.5 text-muted">
                            {line.quantity}
                            {typeof line.unitCents === "number" ? ` × ${formatMoney(line.unitCents, invoice.currency)}` : " ×"}
                          </p>
                        </div>
                        <span className="shrink-0 font-medium text-ink tabular-nums">{formatMoney(line.totalGrossCents, invoice.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <LinkPager
        page={invoices.page}
        totalPages={invoices.totalPages}
        label="Invoices pages"
        hrefFor={(page) => `${hrefFor({ ipage: page > 1 ? String(page) : null })}#invoices`}
      />
    </PortalPanel>
  );
}
