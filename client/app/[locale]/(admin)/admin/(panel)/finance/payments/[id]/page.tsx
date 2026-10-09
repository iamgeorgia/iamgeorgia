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
import { PaymentAllocator } from "@/components/admin/finance/PaymentAllocator";
import {
  counterpartyName,
  formatFinanceDate,
  formatFinanceDateTime,
} from "@/components/admin/finance/PaymentFormat";
import { instalmentKindLabels, paymentKindLabel, paymentMethodLabels, productLabels } from "@/lib/admin/finance";
import { ApiError } from "@/lib/api/client";
import { getPayment } from "@/lib/api/finance";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { can } from "@/types/auth";
import type { Allocation, Payment } from "@/types/finance";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/finance/payments/[id]">): Promise<Metadata> {
  const { id } = await params;

  try {
    const payment = await getPayment(id);
    return { title: `${paymentKindLabel(payment.direction, payment.kind)} ${formatFinanceDate(payment.paidAt)} — Payments` };
  } catch {
    return { title: "Payments" };
  }
}

const COLUMNS: Column[] = [
  { label: "Settled" },
  { label: "For", hideBelow: "md" },
  { label: "Amount", align: "end" },
];

/** One payment: every field, who recorded it, and what it settled. */
export default async function AdminPaymentPage({ params }: PageProps<"/[locale]/admin/finance/payments/[id]">) {
  const session = await getSession();

  if (!can(session, "finance.payments.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const { id } = await params;
  const { path } = await getI18n();

  let payment: Payment;

  try {
    payment = await getPayment(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const canWrite = can(session, "finance.payments.write");
  const canReadReceivables = can(session, "finance.receivables.read");
  const canReadPayables = can(session, "finance.payables.read");
  const money = (cents: number) => formatMoney(cents, payment.currency);
  const kindLabel = paymentKindLabel(payment.direction, payment.kind);

  const link = (href: string | null, children: React.ReactNode) =>
    href ? (
      <Link href={path(href)} prefetch={false} className="text-brand-text underline-offset-4 hover:underline">
        {children}
      </Link>
    ) : (
      children
    );

  const settled = (allocation: Allocation) => {
    if (allocation.receivable) {
      return link(
        canReadReceivables ? `/admin/finance/receivables/${allocation.receivable.id}` : null,
        <span className="font-mono text-[0.8125rem]">{allocation.receivable.reference}</span>,
      );
    }
    if (allocation.instalment) {
      const { instalment } = allocation;
      return link(
        canReadPayables && instalment.payableId ? `/admin/finance/payables/${instalment.payableId}` : null,
        `${instalmentKindLabels[instalment.kind]} (instalment ${instalment.sequence})`,
      );
    }
    return "—";
  };

  const settledFor = (allocation: Allocation) => {
    if (allocation.receivable) return allocation.receivable.debtorName;
    if (allocation.instalment) {
      const { instalment } = allocation;
      return [instalment.product ? productLabels[instalment.product] : null, instalment.bookingReference]
        .filter(Boolean)
        .join(" · ") || "—";
    }
    return "—";
  };

  const counterparty = payment.counterparty.partner
    ? link(`/admin/partners/${payment.counterparty.partner.id}`, payment.counterparty.partner.name)
    : counterpartyName(payment);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Payments", href: path("/admin/finance/payments") },
          { label: `${kindLabel} · ${formatFinanceDate(payment.paidAt)}` },
        ]}
      />

      <AdminPageHeader
        title={`${kindLabel}: ${money(payment.amountCents)}`}
        description={`${payment.direction === "IN" ? "From" : "To"} ${counterpartyName(payment)} · paid on ${formatFinanceDate(payment.paidAt)}`}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <AdminPanel title="Details">
            <AdminDefinitionList
              items={[
                { label: "What", value: kindLabel },
                { label: "Amount", value: <span className="tabular-nums">{money(payment.amountCents)}</span> },
                { label: "Allocated", value: <span className="tabular-nums">{money(payment.allocatedCents)}</span> },
                {
                  label: "Unallocated",
                  value: (
                    <span className={cn("tabular-nums", payment.unallocatedCents > 0 && "text-warning-text")}>
                      {money(payment.unallocatedCents)}
                    </span>
                  ),
                },
                { label: "Method", value: paymentMethodLabels[payment.method] },
                { label: "Paid on", value: formatFinanceDate(payment.paidAt) },
                { label: "Reference", value: payment.reference ? <span className="break-all">{payment.reference}</span> : "—" },
                { label: payment.direction === "IN" ? "From" : "To", value: counterparty },
                ...(payment.counterparty.email
                  ? [{ label: "Email", value: <span className="break-all">{payment.counterparty.email}</span> }]
                  : []),
                ...(payment.attachment ? [{ label: "Attachment", value: payment.attachment.name }] : []),
              ]}
            />
          </AdminPanel>

          {(payment.reason || payment.note) && (
            <AdminPanel title={payment.reason ? "Reason and note" : "Note"}>
              {payment.reason && (
                <>
                  <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">Reason</p>
                  <p className="mt-1 text-[0.875rem] leading-relaxed whitespace-pre-line text-body">{payment.reason}</p>
                </>
              )}
              {payment.note && (
                <>
                  <p className={cn("text-[0.75rem] font-medium tracking-wide text-muted uppercase", payment.reason && "mt-4")}>
                    Note
                  </p>
                  <p className="mt-1 text-[0.875rem] leading-relaxed whitespace-pre-line text-body">{payment.note}</p>
                </>
              )}
            </AdminPanel>
          )}

          <AdminPanel
            title="What it settled"
            description={payment.kind === "REFUND" ? "Refunds are recorded against what was paid, shown negative." : undefined}
            bodyClassName="p-0"
          >
            <DataTable columns={COLUMNS} caption="What this payment settled">
              {payment.allocations.length === 0 && (
                <EmptyRow colSpan={COLUMNS.length} message="Nothing yet — the whole amount is unallocated." />
              )}
              {payment.allocations.map((allocation) => (
                <Row key={allocation.id}>
                  <Cell>
                    {settled(allocation)}
                    <span className="block text-[0.75rem] text-muted md:hidden">{settledFor(allocation)}</span>
                  </Cell>
                  <Cell hideBelow="md">{settledFor(allocation)}</Cell>
                  <Cell align="end" className="font-medium tabular-nums whitespace-nowrap text-ink">
                    {money(allocation.amountCents)}
                  </Cell>
                </Row>
              ))}
            </DataTable>
          </AdminPanel>

          {canWrite && payment.unallocatedCents > 0 && <PaymentAllocator payment={payment} />}
        </div>

        <div className="min-w-0 space-y-6">
          <AdminPanel title="Recorded">
            <AdminDefinitionList
              items={[
                {
                  label: "By",
                  value: payment.recordedBy ? (
                    <>
                      {payment.recordedBy.fullName || payment.recordedBy.email}
                      <span className="block text-[0.75rem] font-normal break-all text-muted">
                        {payment.recordedBy.email}
                      </span>
                    </>
                  ) : (
                    "The system"
                  ),
                },
                { label: "At", value: formatFinanceDateTime(payment.createdAt) },
              ]}
            />
            <p className="mt-4 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-subtle">
              A recorded payment cannot be edited or deleted from the panel; only its
              unallocated rest can still be matched to items.
            </p>
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
