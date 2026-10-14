import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { InvoiceActions } from "@/components/admin/finance/InvoiceActions";
import { InvoiceStatusBadge } from "@/components/admin/finance/InvoiceStatusBadge";
import { formatFinanceDate, formatFinanceDateTime } from "@/components/admin/finance/PaymentFormat";
import { invoiceKindLabels, invoiceLanguageLabel, invoiceSourceLabels, taxRateLabel } from "@/lib/admin/finance";
import { ApiError } from "@/lib/api/client";
import { getInvoice, getInvoicingSettings } from "@/lib/api/invoices";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { can } from "@/types/auth";
import type { Invoice, InvoiceChainRef } from "@/types/invoice";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/finance/invoices/[id]">): Promise<Metadata> {
  const { id } = await params;

  try {
    const invoice = await getInvoice(id);
    return { title: `${invoice.number ?? invoiceKindLabels[invoice.kind]} — Invoices` };
  } catch {
    return { title: "Invoices" };
  }
}

const LINE_COLUMNS: Column[] = [
  { label: "Description" },
  { label: "Qty", align: "end" },
  { label: "VAT", align: "end" },
  { label: "Amount", align: "end" },
];

const dash = <span className="text-subtle">—</span>;

/** One document: its lines, who it is addressed to, where it sits in its chain, and what can be done to it. */
export default async function AdminInvoicePage({ params }: PageProps<"/[locale]/admin/finance/invoices/[id]">) {
  const session = await getSession();

  if (!can(session, "invoices.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const { id } = await params;
  const { path } = await getI18n();

  let invoice: Invoice;

  try {
    invoice = await getInvoice(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Whether invoicing is on only gates the Retry button; if it cannot be read, assume it is.
  const enabled = await getInvoicingSettings().then(
    (settings) => settings.enabled,
    (error) => {
      console.error("Could not read the invoicing settings", error);
      return true;
    },
  );

  const money = (cents: number) => formatMoney(cents, invoice.currency);
  const kind = invoiceKindLabels[invoice.kind];
  const buyerName = invoice.buyer.name || invoice.receivable.debtor?.name || "Guest";
  const date = (value: string | null) => (value ? formatFinanceDate(value) : "—");

  const chainLink = (ref: InvoiceChainRef) => (
    <Link
      href={path(`/admin/finance/invoices/${ref.id}`)}
      prefetch={false}
      className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line px-4 py-3 transition-colors hover:border-ink/30"
    >
      <span className="min-w-0 text-[0.875rem]">
        <span className="font-medium text-ink">{invoiceKindLabels[ref.kind]}</span>
        <span className="ms-2 font-mono text-[0.8125rem] text-muted">{ref.number ?? "not issued yet"}</span>
      </span>
      <InvoiceStatusBadge status={ref.status} />
    </Link>
  );

  const printed = [
    { label: "Name", value: invoice.buyer.name || dash },
    { label: "Tax ID", value: invoice.buyer.taxId ? <span className="font-mono">{invoice.buyer.taxId}</span> : dash },
    { label: "Email", value: invoice.buyer.email ? <span className="break-all">{invoice.buyer.email}</span> : dash },
    { label: "Street", value: invoice.buyer.street || dash },
    { label: "City", value: invoice.buyer.city || dash },
    { label: "Country", value: invoice.buyer.country || dash },
  ];

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Invoices", href: path("/admin/finance/invoices") },
          { label: invoice.number ?? kind },
        ]}
      />

      <AdminPageHeader
        title={invoice.number ?? `${kind} (queued)`}
        description={`${kind} · addressed to ${buyerName}${
          invoice.receivable.reference ? ` · for ${invoice.receivable.reference}` : ""
        }`}
        actions={<InvoiceStatusBadge status={invoice.status} className="text-[0.8125rem]" />}
      />

      {invoice.syncError && (
        <div role="alert" className="mt-6 rounded-sm border border-error/40 bg-error/12 px-5 py-4">
          <p className="text-[0.9375rem] font-medium text-error-text">InvoiceOcean refused this document</p>
          <p className="mt-1 text-[0.875rem] leading-relaxed break-words text-error-text">{invoice.syncError}</p>
          <p className="mt-2 text-[0.8125rem] text-error-text">Fix the cause, then press Retry.</p>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <AdminPanel title="Lines" bodyClassName="p-0">
            <div className="hidden md:block">
              <DataTable columns={LINE_COLUMNS} caption="Lines on this document">
                {invoice.lines.length === 0 && <EmptyRow colSpan={LINE_COLUMNS.length} message="No lines yet." />}
                {invoice.lines.map((line) => (
                  <Row key={line.id}>
                    <Cell>
                      {line.description}
                      {line.bookingReference && (
                        <span className="block font-mono text-[0.75rem] text-muted">{line.bookingReference}</span>
                      )}
                    </Cell>
                    <Cell align="end" className="tabular-nums">
                      {line.quantity}
                    </Cell>
                    <Cell align="end" className="whitespace-nowrap tabular-nums">
                      {taxRateLabel(line.taxRateBps)}
                    </Cell>
                    <Cell align="end" className="font-medium whitespace-nowrap text-ink tabular-nums">
                      {money(line.totalGrossCents)}
                    </Cell>
                  </Row>
                ))}
                <tr className="border-t border-line">
                  <td colSpan={3} className="px-4 py-3 text-end text-[0.8125rem] font-medium text-muted">
                    Total
                  </td>
                  <td className="px-4 py-3 text-end font-medium whitespace-nowrap text-ink tabular-nums">
                    {money(invoice.totalCents)}
                  </td>
                </tr>
              </DataTable>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {invoice.lines.length === 0 && (
                <li className="p-5 text-center text-[0.8125rem] text-muted">No lines yet.</li>
              )}
              {invoice.lines.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 text-[0.8125rem]">
                    <p className="font-medium text-ink">{line.description}</p>
                    <p className="mt-0.5 text-muted">
                      {line.quantity} × · VAT {taxRateLabel(line.taxRateBps)}
                    </p>
                    {line.bookingReference && (
                      <p className="mt-0.5 font-mono text-[0.75rem] text-muted">{line.bookingReference}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-[0.875rem] font-medium text-ink tabular-nums">
                    {money(line.totalGrossCents)}
                  </p>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 p-4 text-[0.875rem] font-medium">
                <span className="text-muted">Total</span>
                <span className="text-ink tabular-nums">{money(invoice.totalCents)}</span>
              </li>
            </ul>
          </AdminPanel>

          <AdminPanel title="Buyer as printed" description="Frozen when the document was requested; later changes to the partner do not alter it.">
            <AdminDefinitionList items={printed} />
          </AdminPanel>

          <AdminPanel
            title="Chain"
            description="A VAT invoice is issued from its proforma; a correction from the VAT invoice."
          >
            <div className="space-y-2">
              {invoice.fromInvoice && (
                <>
                  <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">Issued from</p>
                  {chainLink(invoice.fromInvoice)}
                </>
              )}

              <p className="pt-1 text-[0.75rem] font-medium tracking-wide text-muted uppercase">This document</p>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-ink/40 bg-surface-soft px-4 py-3">
                <span className="min-w-0 text-[0.875rem]">
                  <span className="font-medium text-ink">{kind}</span>
                  <span className="ms-2 font-mono text-[0.8125rem] text-muted">{invoice.number ?? "not issued yet"}</span>
                </span>
                <InvoiceStatusBadge status={invoice.status} />
              </div>

              {invoice.derived.length > 0 && (
                <>
                  <p className="pt-1 text-[0.75rem] font-medium tracking-wide text-muted uppercase">Issued from this</p>
                  {invoice.derived.map((ref) => (
                    <div key={ref.id}>{chainLink(ref)}</div>
                  ))}
                </>
              )}
            </div>
            {invoice.correctionReason && (
              <p className="mt-4 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-muted">
                Reason for the correction: {invoice.correctionReason}
              </p>
            )}
          </AdminPanel>

          <AdminPanel title="Record">
            <AdminDefinitionList
              items={[
                { label: "How", value: invoiceSourceLabels[invoice.source] ?? invoice.source },
                { label: "Language", value: invoiceLanguageLabel(invoice.lang) },
                { label: "Issued", value: date(invoice.issueDate) },
                { label: "Sold on", value: date(invoice.sellDate) },
                { label: "Due", value: date(invoice.dueDate) },
                {
                  label: "Provider number",
                  value: invoice.number ? <span className="font-mono">{invoice.number}</span> : dash,
                },
                {
                  label: "Provider id",
                  value: invoice.externalId ? <span className="font-mono break-all">{invoice.externalId}</span> : dash,
                },
                {
                  label: "Last synced",
                  value: invoice.lastSyncedAt ? formatFinanceDateTime(invoice.lastSyncedAt) : "—",
                },
                { label: "Created", value: formatFinanceDateTime(invoice.createdAt) },
              ]}
            />
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-6">
          <AdminPanel title="Amounts" description={`All in ${invoice.currency}.`}>
            <AdminDefinitionList
              items={[
                { label: "Total", value: <span className="tabular-nums">{money(invoice.totalCents)}</span> },
                { label: "Paid", value: <span className="tabular-nums">{money(invoice.paidCents)}</span> },
                { label: "Currency", value: invoice.currency },
              ]}
            />
            {invoice.receivable.reference && (
              <p className="mt-4 border-t border-line pt-4 text-[0.8125rem] text-muted">
                For{" "}
                <Link
                  href={path(`/admin/finance/receivables/${invoice.receivable.id}`)}
                  prefetch={false}
                  className="font-mono text-brand-text underline-offset-4 hover:underline"
                >
                  {invoice.receivable.reference}
                </Link>
              </p>
            )}
          </AdminPanel>

          <InvoiceActions invoice={invoice} canWrite={can(session, "invoices.write")} enabled={enabled} />
        </div>
      </div>
    </AdminContainer>
  );
}
