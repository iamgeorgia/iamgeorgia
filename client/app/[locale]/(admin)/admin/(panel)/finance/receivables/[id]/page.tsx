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
import {
  formatFinanceDate,
  formatFinanceDateTime,
  receivableDebtorName,
  receivableSubjectLine,
} from "@/components/admin/finance/PaymentFormat";
import { ReceivableApprovalRequests } from "@/components/admin/finance/ApprovalRequestActions";
import { ReceivableActions } from "@/components/admin/finance/ReceivableActions";
import { ReceivableInvoicesPanel } from "@/components/admin/finance/ReceivableInvoicesPanel";
import { SettlementStatusBadge } from "@/components/admin/finance/SettlementStatusBadge";
import { dueInWords, paymentKindLabel, paymentMethodLabels, subjectHref } from "@/lib/admin/finance";
import { ApiError } from "@/lib/api/client";
import { getReceivable } from "@/lib/api/finance";
import { getInvoicingSettings } from "@/lib/api/invoices";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { can } from "@/types/auth";
import type { Allocation, Receivable } from "@/types/finance";
import type { InvoicingSettings } from "@/types/invoice";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/finance/receivables/[id]">): Promise<Metadata> {
  const { id } = await params;

  try {
    const receivable = await getReceivable(id);
    return { title: `${receivable.reference} — Receivables` };
  } catch {
    return { title: "Receivables" };
  }
}

const sourceLabels: Record<string, string> = {
  CONFIRM: "Created when the booking was confirmed",
  BACKFILL: "Created from an earlier booking",
  MANUAL: "Created by hand",
};

const ALLOCATION_COLUMNS: Column[] = [
  { label: "Paid on" },
  { label: "What" },
  { label: "Method", hideBelow: "md" },
  { label: "Reference", hideBelow: "md" },
  { label: "Amount", align: "end" },
];

/**
 * One receivable: what is owed for which booking, by whom, by when, and every
 * payment and refund recorded against it.
 */
export default async function AdminReceivablePage({
  params,
}: PageProps<"/[locale]/admin/finance/receivables/[id]">) {
  const session = await getSession();

  if (!can(session, "finance.receivables.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const { id } = await params;
  const { path } = await getI18n();

  const canReadInvoices = can(session, "invoices.read");
  // The invoicing defaults are read alongside the receivable; a failure only disables the issue button.
  const settingsRequest: Promise<InvoicingSettings | null> = canReadInvoices
    ? getInvoicingSettings().catch(() => null)
    : Promise.resolve(null);

  let receivable: Receivable;

  try {
    receivable = await getReceivable(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const invoicingSettings = await settingsRequest;
  const canWrite = can(session, "finance.payments.write");
  const canReadPayments = can(session, "finance.payments.read");
  const canRefundWithoutApproval = can(session, "finance.refunds.execute");
  const canAdjustWithoutApproval = can(session, "finance.adjustments.execute");
  const money = (cents: number) => formatMoney(cents, receivable.currency);
  const isOpen = receivable.status === "OPEN" || receivable.status === "PARTIAL";
  const late = receivable.overdue && isOpen;
  const subjectLink = subjectHref(receivable.subject);
  const allocations = receivable.allocations ?? [];

  const subject = receivable.subject ? (
    subjectLink ? (
      <Link href={path(subjectLink)} prefetch={false} className="text-brand-text underline-offset-4 hover:underline">
        {receivableSubjectLine(receivable)}
      </Link>
    ) : (
      receivableSubjectLine(receivable)
    )
  ) : (
    "—"
  );

  const debtor = receivable.debtor.partner ? (
    <Link
      href={path(`/admin/partners/${receivable.debtor.partner.id}`)}
      prefetch={false}
      className="text-brand-text underline-offset-4 hover:underline"
    >
      {receivable.debtor.partner.name}
    </Link>
  ) : (
    receivable.debtor.name || "Guest"
  );

  const paymentLink = (allocation: Allocation, children: React.ReactNode) =>
    allocation.payment && canReadPayments ? (
      <Link
        href={path(`/admin/finance/payments/${allocation.payment.id}`)}
        prefetch={false}
        className="text-brand-text underline-offset-4 hover:underline"
      >
        {children}
      </Link>
    ) : (
      children
    );

  const what = (allocation: Allocation) =>
    allocation.payment ? paymentKindLabel(allocation.payment.direction, allocation.payment.kind) : "Payment";

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Receivables", href: path("/admin/finance/receivables") },
          { label: receivable.reference },
        ]}
      />

      <AdminPageHeader
        title={receivable.reference}
        description={`Owed by ${receivableDebtorName(receivable)}${
          receivable.subject ? ` · ${receivableSubjectLine(receivable)}` : ""
        }`}
        actions={
          <SettlementStatusBadge
            status={receivable.status}
            overdue={receivable.overdue}
            className="text-[0.8125rem]"
          />
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <AdminPanel title="Amounts" description={`All in ${receivable.currency}.`}>
            <AdminDefinitionList
              items={[
                ...(receivable.originalAmountCents !== receivable.amountCents
                  ? [{ label: "Originally owed", value: <span className="tabular-nums">{money(receivable.originalAmountCents)}</span> }]
                  : []),
                { label: "Owed", value: <span className="tabular-nums">{money(receivable.amountCents)}</span> },
                { label: "Paid", value: <span className="tabular-nums">{money(receivable.paidCents)}</span> },
                {
                  label: "Outstanding",
                  value: (
                    <span className={cn("tabular-nums", late && "text-error-text")}>
                      {money(receivable.outstandingCents)}
                    </span>
                  ),
                },
                ...(receivable.refundDueCents > 0
                  ? [
                      {
                        label: "To refund",
                        value: (
                          <span className="text-warning-text tabular-nums">{money(receivable.refundDueCents)}</span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            {receivable.refundDueCents > 0 && (
              <p className="mt-4 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-muted">
                More has been paid than is now owed — usually after a cancellation or a price
                change. The difference is due back to the buyer.
              </p>
            )}
          </AdminPanel>

          <AdminPanel title="What it is for">
            <AdminDefinitionList
              items={[
                { label: "Booking", value: subject },
                ...(receivable.subject
                  ? [{ label: "Booking status", value: receivable.subject.status.toLowerCase().replaceAll("_", " ") }]
                  : []),
                { label: "Owed by", value: debtor },
                ...(receivable.debtor.email
                  ? [{ label: "Email", value: <span className="break-all">{receivable.debtor.email}</span> }]
                  : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel
            title="Payments against it"
            description="Money received for this item, and refunds paid back (shown negative)."
            bodyClassName="p-0"
          >
            <div className="hidden md:block">
              <DataTable columns={ALLOCATION_COLUMNS} caption="Payments against this receivable">
                {allocations.length === 0 && (
                  <EmptyRow colSpan={ALLOCATION_COLUMNS.length} message="Nothing has been paid against this yet." />
                )}
                {allocations.map((allocation) => (
                  <Row key={allocation.id}>
                    <Cell className="whitespace-nowrap">
                      {paymentLink(allocation, formatFinanceDate(allocation.payment?.paidAt ?? allocation.createdAt))}
                    </Cell>
                    <Cell>{what(allocation)}</Cell>
                    <Cell hideBelow="md">
                      {allocation.payment ? paymentMethodLabels[allocation.payment.method] : "—"}
                    </Cell>
                    <Cell hideBelow="md">
                      {allocation.payment?.reference ?? <span className="text-subtle">—</span>}
                    </Cell>
                    <Cell
                      align="end"
                      className={cn(
                        "font-medium tabular-nums whitespace-nowrap",
                        allocation.amountCents < 0 ? "text-warning-text" : "text-ink",
                      )}
                    >
                      {money(allocation.amountCents)}
                    </Cell>
                  </Row>
                ))}
              </DataTable>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {allocations.length === 0 && (
                <li className="p-5 text-center text-[0.8125rem] text-muted">Nothing has been paid against this yet.</li>
              )}
              {allocations.map((allocation) => (
                <li key={allocation.id} className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 text-[0.8125rem]">
                    <p className="font-medium text-ink">
                      {paymentLink(allocation, formatFinanceDate(allocation.payment?.paidAt ?? allocation.createdAt))}
                    </p>
                    <p className="mt-0.5 text-muted">
                      {what(allocation)}
                      {allocation.payment ? ` · ${paymentMethodLabels[allocation.payment.method]}` : ""}
                    </p>
                    {allocation.payment?.reference && (
                      <p className="mt-0.5 truncate text-muted">{allocation.payment.reference}</p>
                    )}
                  </div>
                  <p
                    className={cn(
                      "shrink-0 text-[0.875rem] font-medium tabular-nums",
                      allocation.amountCents < 0 ? "text-warning-text" : "text-ink",
                    )}
                  >
                    {money(allocation.amountCents)}
                  </p>
                </li>
              ))}
            </ul>
          </AdminPanel>

          <ReceivableInvoicesPanel
            receivable={receivable}
            canRead={canReadInvoices}
            canWrite={can(session, "invoices.write")}
            settings={invoicingSettings}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <AdminPanel title="Due">
            {receivable.dueAt ? (
              <>
                <p className={cn("text-[1.125rem] font-medium", late ? "text-error-text" : "text-ink")}>
                  {formatFinanceDate(receivable.dueAt)}
                </p>
                {isOpen && (
                  <p className={cn("mt-1 text-[0.8125rem]", late ? "text-error-text" : "text-muted")}>
                    {dueInWords(receivable.dueAt)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[0.875rem] text-muted">No due date set.</p>
            )}
            <p className="mt-3 text-[0.75rem] leading-relaxed text-subtle">
              Set from the buyer&apos;s payment days when the item was created. Moving it here changes
              this item only.
            </p>
          </AdminPanel>

          {canWrite && (
            <ReceivableActions
              receivable={receivable}
              refundWithoutApproval={canRefundWithoutApproval}
              adjustWithoutApproval={canAdjustWithoutApproval}
            />
          )}
          <ReceivableApprovalRequests
            receivable={receivable}
            askForRefund={!canRefundWithoutApproval && can(session, "finance.refunds.request")}
            askForAdjustments={!canAdjustWithoutApproval && can(session, "finance.adjustments.request")}
          />

          <AdminPanel title="Note">
            {receivable.notes ? (
              <p className="text-[0.875rem] leading-relaxed whitespace-pre-line text-body">{receivable.notes}</p>
            ) : (
              <p className="text-[0.875rem] text-muted">No note.</p>
            )}
          </AdminPanel>

          <AdminPanel title="Record">
            <AdminDefinitionList
              items={[
                { label: "Created", value: formatFinanceDateTime(receivable.createdAt) },
                { label: "How", value: sourceLabels[receivable.source] ?? receivable.source },
                ...(receivable.waivedAt ? [{ label: "Written off", value: formatFinanceDateTime(receivable.waivedAt) }] : []),
                ...(receivable.voidedAt
                  ? [{ label: "Nothing owed since", value: formatFinanceDateTime(receivable.voidedAt) }]
                  : []),
              ]}
            />
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
