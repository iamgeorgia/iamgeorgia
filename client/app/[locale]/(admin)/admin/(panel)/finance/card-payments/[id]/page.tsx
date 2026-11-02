import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { CardPaymentActions } from "@/components/admin/finance/CardPaymentActions";
import {
  CardModeChip,
  CardPaymentStatusBadge,
  CardRefundStatusBadge,
  bookingHref,
  cardLabel,
} from "@/components/admin/finance/CardPaymentBadges";
import { formatFinanceDateTime } from "@/components/admin/finance/PaymentFormat";
import { approvalHref } from "@/lib/admin/approvals";
import { ApiError } from "@/lib/api/client";
import { getCardPayment } from "@/lib/api/payments";
import { requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { can } from "@/types/auth";
import type { StaffPayment } from "@/types/payments";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/finance/card-payments/[id]">): Promise<Metadata> {
  const { id } = await params;

  try {
    const payment = await getCardPayment(id);
    return { title: `${payment.reference} — Card payments` };
  } catch {
    return { title: "Card payments" };
  }
}

const CALLBACK_COLUMNS: Column[] = [
  { label: "Received" },
  { label: "Signature" },
  { label: "Gateway status" },
  { label: "From", hideBelow: "md" },
  { label: "Processed", hideBelow: "md" },
  { label: "Result" },
];

const REFUND_COLUMNS: Column[] = [
  { label: "Requested" },
  { label: "Status" },
  { label: "Amount", align: "end" },
  { label: "Reason", hideBelow: "md" },
  { label: "Gateway", hideBelow: "lg" },
  { label: "Approval", align: "end" },
];

const dash = <span className="text-subtle">—</span>;
const mono = (value: string | null | undefined) =>
  value ? <span className="font-mono text-[0.8125rem] break-all">{value}</span> : dash;

/** One card payment: the gateway's account of it, the callbacks received, the refunds sent. */
export default async function AdminCardPaymentPage({
  params,
}: PageProps<"/[locale]/admin/finance/card-payments/[id]">) {
  const session = await requireScreen();
  const { id } = await params;
  const { path } = await getI18n();

  let payment: StaffPayment;

  try {
    payment = await getCardPayment(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const money = (cents: number | null | undefined, currency = payment.currency) =>
    cents === null || cents === undefined ? "—" : formatMoney(cents, currency);

  const link = (href: string, children: React.ReactNode) => (
    <Link href={path(href)} prefetch={false} className="text-brand-text underline-offset-4 hover:underline">
      {children}
    </Link>
  );

  const callbacks = payment.callbacks ?? [];
  const refunds = payment.refunds ?? [];
  const booking = bookingHref(payment);
  const card = cardLabel(payment);
  const chargedDiffers =
    payment.actualAmountCents !== null &&
    (payment.actualAmountCents !== payment.amountCents ||
      (payment.actualCurrency ?? payment.currency) !== payment.currency);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Card payments", href: path("/admin/finance/card-payments") },
          { label: payment.reference },
        ]}
      />

      <AdminPageHeader
        title={`${payment.reference}: ${money(payment.amountCents)}`}
        description={`${payment.debtorEmail ?? "Guest"}${payment.bookingReference ? ` · ${payment.bookingReference}` : ""} · created ${formatFinanceDateTime(payment.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CardPaymentStatusBadge status={payment.status} />
            <CardModeChip mode={payment.mode} />
          </div>
        }
      />

      {payment.status === "MISMATCH" && (
        <div
          role="note"
          className="mt-6 flex items-start gap-3 rounded-sm border border-warning/50 bg-warning/10 px-4 py-3 text-[0.875rem] leading-relaxed text-ink"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
          <div>
            <p className="font-semibold">The gateway approved a different amount or currency than we asked for.</p>
            <p className="mt-1 text-body">
              Asked {money(payment.amountCents)}; the gateway reports{" "}
              {money(payment.actualAmountCents, payment.actualCurrency ?? payment.currency)}. Nothing was recorded in
              the ledger. Compare with the gateway and record the payment by hand, or refund it.
            </p>
          </div>
        </div>
      )}

      {payment.failureReason && (
        <p className="mt-6 rounded-sm border border-line bg-surface px-4 py-3 text-[0.8125rem] text-muted">
          <span className="font-medium text-ink">Failure reason:</span> {payment.failureReason}
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <AdminPanel title="Amounts">
            <AdminDefinitionList
              items={[
                { label: "Asked", value: <span className="tabular-nums">{money(payment.amountCents)}</span> },
                {
                  label: "Charged by the gateway",
                  value: (
                    <span className={chargedDiffers ? "text-warning-text tabular-nums" : "tabular-nums"}>
                      {money(payment.actualAmountCents, payment.actualCurrency ?? payment.currency)}
                    </span>
                  ),
                },
                { label: "Reversed", value: <span className="tabular-nums">{money(payment.reversedCents)}</span> },
                { label: "Still refundable", value: <span className="tabular-nums">{money(payment.refundableCents)}</span> },
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Gateway">
            <AdminDefinitionList
              items={[
                { label: "Provider", value: payment.provider },
                { label: "Order id (ours)", value: mono(payment.merchantOrderId) },
                { label: "Payment id", value: mono(payment.providerPaymentId) },
                { label: "Transaction id", value: mono(payment.providerTransactionId) },
                { label: "Order status", value: payment.providerOrderStatus ?? dash },
                { label: "Order time", value: payment.providerOrderTime ? formatFinanceDateTime(payment.providerOrderTime) : dash },
                {
                  label: "Response",
                  value:
                    payment.responseCode !== null || payment.responseDescription
                      ? `${payment.responseCode ?? ""}${payment.responseDescription ? ` ${payment.responseDescription}` : ""}`.trim()
                      : dash,
                },
                { label: "RRN", value: mono(payment.rrn) },
                { label: "Approval code", value: mono(payment.approvalCode) },
                { label: "ECI", value: mono(payment.eci) },
                { label: "Payment system", value: payment.paymentSystem ?? dash },
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Card">
            <AdminDefinitionList
              items={[
                { label: "Card", value: card ?? dash },
                { label: "Masked number", value: mono(payment.maskedCard) },
                { label: "Type", value: payment.cardType ?? dash },
                { label: "BIN", value: mono(payment.cardBin) },
              ]}
            />
          </AdminPanel>

          <AdminPanel
            title="Callbacks"
            description="Every message the gateway sent us about this payment, believed or not."
            bodyClassName="p-0"
          >
            <DataTable columns={CALLBACK_COLUMNS} caption="Gateway callbacks">
              {callbacks.length === 0 && <EmptyRow colSpan={CALLBACK_COLUMNS.length} message="No callbacks received yet." />}
              {callbacks.map((callback) => (
                <Row key={callback.id}>
                  <Cell className="whitespace-nowrap">{formatFinanceDateTime(callback.receivedAt)}</Cell>
                  <Cell>
                    {callback.signatureValid ? (
                      <span className="inline-flex items-center gap-1.5 text-success">
                        <CheckCircle2 size={14} aria-hidden />
                        Valid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-error-text">
                        <XCircle size={14} aria-hidden />
                        Invalid
                      </span>
                    )}
                  </Cell>
                  <Cell>{callback.orderStatus ?? dash}</Cell>
                  <Cell hideBelow="md">{mono(callback.sourceIp)}</Cell>
                  <Cell hideBelow="md" className="whitespace-nowrap">
                    {callback.processedAt ? formatFinanceDateTime(callback.processedAt) : dash}
                  </Cell>
                  <Cell>
                    {callback.error ? <span className="text-error-text">{callback.error}</span> : <span className="text-muted">OK</span>}
                    {callback.payload != null && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[0.75rem] text-brand-text">Payload</summary>
                        <pre className="mt-1 max-h-64 max-w-[28rem] overflow-auto rounded-sm bg-surface-soft p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-body">
                          {JSON.stringify(callback.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </Cell>
                </Row>
              ))}
            </DataTable>
          </AdminPanel>

          <AdminPanel
            title="Refunds"
            description="Refunds are requested here, approved by a second person, then sent to the gateway."
            bodyClassName="p-0"
          >
            <DataTable columns={REFUND_COLUMNS} caption="Refunds of this payment">
              {refunds.length === 0 && <EmptyRow colSpan={REFUND_COLUMNS.length} message="No refunds requested." />}
              {refunds.map((refund) => (
                <Row key={refund.id}>
                  <Cell className="whitespace-nowrap">{formatFinanceDateTime(refund.createdAt)}</Cell>
                  <Cell>
                    <CardRefundStatusBadge status={refund.status} />
                    {refund.attempts > 0 && (
                      <span className="mt-1 block text-[0.75rem] text-muted">
                        {refund.attempts === 1 ? "1 attempt" : `${refund.attempts} attempts`}
                      </span>
                    )}
                    {refund.lastError && (
                      <span className="mt-1 block text-[0.75rem] text-error-text">{refund.lastError}</span>
                    )}
                  </Cell>
                  <Cell align="end" className="font-medium whitespace-nowrap text-ink tabular-nums">
                    {money(refund.amountCents, refund.currency)}
                  </Cell>
                  <Cell hideBelow="md">{refund.reason ?? dash}</Cell>
                  <Cell hideBelow="lg">
                    {refund.reverseId && <span className="block">{mono(refund.reverseId)}</span>}
                    {(refund.responseCode !== null || refund.responseDescription) && (
                      <span className="block text-[0.75rem] text-muted">
                        {`${refund.responseCode ?? ""} ${refund.responseDescription ?? ""}`.trim()}
                      </span>
                    )}
                    {!refund.reverseId && refund.responseCode === null && !refund.responseDescription && dash}
                  </Cell>
                  <Cell align="end">
                    {refund.approvalRequestId ? link(approvalHref(refund.approvalRequestId), "Open") : dash}
                  </Cell>
                </Row>
              ))}
            </DataTable>
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-6">
          <AdminPanel title="Actions">
            <CardPaymentActions
              payment={payment}
              canCheck={can(session, "finance.payments.write")}
              canRefund={can(session, "finance.refunds.request")}
            />
            {!can(session, "finance.payments.write") && !can(session, "finance.refunds.request") && (
              <p className="text-[0.8125rem] text-muted">Your role can read card payments but not act on them.</p>
            )}
          </AdminPanel>

          <AdminPanel title="Linked records">
            <AdminDefinitionList
              items={[
                {
                  label: "Booking",
                  value: booking && payment.bookingReference ? link(booking, payment.bookingReference) : dash,
                },
                {
                  label: "Receivable",
                  value:
                    payment.receivableId && can(session, "finance.receivables.read")
                      ? link(
                          `/admin/finance/receivables/${payment.receivableId}`,
                          payment.receivable?.reference ?? "Open",
                        )
                      : (payment.receivable?.reference ?? dash),
                },
                {
                  label: "Ledger record",
                  value: payment.paymentRecordId
                    ? link(
                        `/admin/finance/payments/${payment.paymentRecordId}`,
                        payment.paymentRecord ? money(payment.paymentRecord.amountCents) : "Open",
                      )
                    : "Not recorded",
                },
                { label: "Guest", value: <span className="break-all">{payment.debtorEmail ?? "—"}</span> },
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Timeline">
            <AdminDefinitionList
              items={[
                { label: "Created", value: formatFinanceDateTime(payment.createdAt) },
                { label: "Sent to checkout", value: formatFinanceDateTime(payment.redirectReadyAt) },
                { label: "Guest returned", value: formatFinanceDateTime(payment.returnedAt) },
                { label: "Last callback", value: formatFinanceDateTime(payment.lastCallbackAt) },
                { label: "Last status check", value: formatFinanceDateTime(payment.lastStatusCheckAt) },
                { label: "Expires", value: formatFinanceDateTime(payment.expiresAt) },
                { label: "Completed", value: formatFinanceDateTime(payment.completedAt) },
                { label: "Reconciled", value: formatFinanceDateTime(payment.reconciledAt) },
              ]}
            />
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
