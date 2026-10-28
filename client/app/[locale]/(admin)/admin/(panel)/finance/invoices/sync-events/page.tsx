import type { Metadata } from "next";
import Link from "next/link";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader, AdminPanel } from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { formatFinanceDateTime } from "@/components/admin/finance/PaymentFormat";
import { listInvoiceSyncEvents } from "@/lib/api/invoices";
import { requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import type { InvoiceSyncEvent } from "@/types/invoice";

export const metadata: Metadata = { title: "Unmatched reports — Invoices" };

const COLUMNS: Column[] = [
  { label: "Received" },
  { label: "Source" },
  { label: "Provider id" },
  { label: "Number" },
  { label: "Status reported" },
  { label: "Reason" },
  { label: "Processed" },
];

const sourceLabels: Record<InvoiceSyncEvent["source"], string> = { WEBHOOK: "Webhook", POLL: "Poll" };

const EMPTY = "No unmatched reports. Every status change InvoiceOcean sent matched a document here.";

/** Status reports from the invoicing provider that matched no document here — worth a look when one keeps appearing. */
export default async function AdminInvoiceSyncEventsPage({
  searchParams,
}: PageProps<"/[locale]/admin/finance/invoices/sync-events">) {
  const session = await requireScreen();


  const { path } = await getI18n();
  const raw = (await searchParams).page;
  const page = Number(Array.isArray(raw) ? raw[0] : raw);
  const list = await listInvoiceSyncEvents({
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    pageSize: 25,
  });

  const pageHref = (target: number) =>
    path(`/admin/finance/invoices/sync-events${target > 1 ? `?page=${target}` : ""}`);

  const dash = <span className="text-subtle">—</span>;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Invoices", href: path("/admin/finance/invoices") },
          { label: "Unmatched reports" },
        ]}
      />

      <AdminPageHeader
        title="Unmatched reports"
        description="Status changes InvoiceOcean reported for a document this system has no record of."
      />

      <AdminPanel className="mt-8" bodyClassName="p-0">
        <div className="hidden lg:block">
          <DataTable columns={COLUMNS} caption="Unmatched reports from the invoicing provider">
            {list.data.length === 0 && <EmptyRow colSpan={COLUMNS.length} message={EMPTY} />}
            {list.data.map((event) => (
              <Row key={event.id}>
                <Cell className="whitespace-nowrap">{formatFinanceDateTime(event.createdAt)}</Cell>
                <Cell>{sourceLabels[event.source] ?? event.source}</Cell>
                <Cell className="font-mono text-[0.8125rem] break-all">{event.externalId}</Cell>
                <Cell className="font-mono text-[0.8125rem]">{event.number ?? dash}</Cell>
                <Cell>{event.status ?? dash}</Cell>
                <Cell className="max-w-xs break-words text-error-text">
                  {event.error ?? <span className="text-subtle">—</span>}
                </Cell>
                <Cell className="whitespace-nowrap">
                  {event.processedAt ? formatFinanceDateTime(event.processedAt) : "Not yet"}
                </Cell>
              </Row>
            ))}
          </DataTable>
        </div>

        <ul className="divide-y divide-line lg:hidden">
          {list.data.length === 0 && <li className="p-6 text-center text-[0.8125rem] text-muted">{EMPTY}</li>}
          {list.data.map((event) => (
            <li key={event.id} className="p-4 text-[0.8125rem]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ink">{formatFinanceDateTime(event.createdAt)}</p>
                <p className="text-muted">{sourceLabels[event.source] ?? event.source}</p>
              </div>
              <p className="mt-1 font-mono text-[0.75rem] break-all text-muted">{event.externalId}</p>
              <p className="mt-2 text-body">
                {event.number ? <span className="font-mono">{event.number}</span> : "No number"}
                {event.status ? ` · ${event.status}` : ""}
              </p>
              {event.error && <p className="mt-1 break-words text-error-text">{event.error}</p>}
              <p className="mt-1 text-muted">
                {event.processedAt ? `Processed ${formatFinanceDateTime(event.processedAt)}` : "Not processed yet"}
              </p>
            </li>
          ))}
        </ul>
      </AdminPanel>

      {list.totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
          {list.page > 1 ? (
            <Link
              href={pageHref(list.page - 1)}
              prefetch={false}
              className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40"
            >
              Previous
            </Link>
          ) : (
            <span className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body opacity-40">
              Previous
            </span>
          )}
          <p className="text-[0.8125rem] text-muted">
            Page {list.page} of {list.totalPages}
          </p>
          {list.page < list.totalPages ? (
            <Link
              href={pageHref(list.page + 1)}
              prefetch={false}
              className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40"
            >
              Next
            </Link>
          ) : (
            <span className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body opacity-40">
              Next
            </span>
          )}
        </nav>
      )}
    </AdminContainer>
  );
}
