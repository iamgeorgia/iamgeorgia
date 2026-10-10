import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Undo2 } from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { Cell, DataTable, Row, type Column } from "@/components/admin/DataTable";
import { PayableApprovalRequests } from "@/components/admin/finance/ApprovalRequestActions";
import { PayableActions } from "@/components/admin/finance/PayableActions";
import { formatPayableDate } from "@/components/admin/finance/PayableFormat";
import { PayableStatusBadge } from "@/components/admin/finance/PayableStatusBadge";
import { formatPartnerDateTime } from "@/lib/admin/partners";
import {
  cancellationLiabilityLabels,
  dueInWords,
  instalmentKindLabels,
  paymentMethodLabels,
  productLabels,
  reviewReasonLabels,
  subjectHref,
} from "@/lib/admin/finance";
import { ApiError } from "@/lib/api/client";
import { getPayable } from "@/lib/api/finance";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { can } from "@/types/auth";
import type { Allocation, Instalment, Payable } from "@/types/finance";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/finance/payables/[id]">): Promise<Metadata> {
  const { id } = await params;

  try {
    const payable = await getPayable(id);
    return { title: `${payable.bookingReference} — Payables` };
  } catch {
    return { title: "Payables" };
  }
}

const INSTALMENT_COLUMNS: Column[] = [
  { label: "Instalment" },
  { label: "Due" },
  { label: "Amount", align: "end" },
  { label: "Paid", align: "end" },
  { label: "Outstanding", align: "end" },
];

/** What each review flag means and what Finance is expected to do about it. */
const reviewHelp: Record<string, string> = {
  NO_TERMS:
    "This supplier has no payment terms on file, so the whole amount was put into one balance with no due date. Add the supplier's terms, or pay it when you agree a date with them.",
  CANCELLATION_MANUAL:
    "The booking was cancelled, and this supplier's terms say a cancellation is settled by hand. Decide what they are still owed and set the amount by hand — zero if nothing.",
};

const sourceLabels: Record<string, string> = {
  CONFIRM: "Created when the booking was confirmed",
  BACKFILL: "Backfilled for a booking confirmed before the finance module existed",
  MANUAL: "Created by hand",
};

const titleCase = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");

/** One supplier payable: what is owed, how it is split, and what has been paid against it. */
export default async function AdminPayablePage({ params }: PageProps<"/[locale]/admin/finance/payables/[id]">) {
  const session = await getSession();

  if (!can(session, "finance.payables.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const { id } = await params;
  const { path } = await getI18n();

  let payable: Payable;

  try {
    payable = await getPayable(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const canWrite = can(session, "finance.payments.write") && payable.status !== "WAIVED";
  const canAdjustWithoutApproval = can(session, "finance.adjustments.execute");
  const canAskForApproval =
    !canAdjustWithoutApproval && can(session, "finance.adjustments.request") && payable.status !== "WAIVED";
  const money = (cents: number) => formatMoney(cents, payable.currency);
  const bookingHref = subjectHref(payable.booking);
  const date = (value: string | null) => formatPayableDate(value, payable.timezone);

  const supplier = payable.supplier ? (
    <Link href={path(`/admin/partners/${payable.supplier.id}`)} className="underline-offset-4 hover:underline">
      {payable.supplier.name}
    </Link>
  ) : (
    "Platform (our own inventory)"
  );

  const payments = (instalment: Instalment) =>
    (instalment.allocations ?? []).filter((allocation): allocation is Allocation & { payment: NonNullable<Allocation["payment"]> } =>
      Boolean(allocation.payment),
    );

  const paymentLine = (allocation: Allocation & { payment: NonNullable<Allocation["payment"]> }) => (
    <li
      key={allocation.id}
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[0.8125rem]"
    >
      <span className="min-w-0 text-body">
        {date(allocation.payment.paidAt)} · {paymentMethodLabels[allocation.payment.method]}
        {allocation.payment.kind === "REFUND" && " · refund"}
        {allocation.payment.reference && (
          <span className="break-all text-muted"> · {allocation.payment.reference}</span>
        )}
      </span>
      <span className={cn("tabular-nums", allocation.amountCents < 0 ? "text-warning-text" : "text-ink")}>
        {money(allocation.amountCents)}
      </span>
    </li>
  );

  const dueCell = (instalment: Instalment) =>
    instalment.dueAt ? (
      <>
        <span className={cn("block", instalment.overdue ? "text-error-text" : "text-body")}>
          {date(instalment.dueAt)}
        </span>
        {(instalment.status === "OPEN" || instalment.status === "PARTIAL") && (
          <span
            className={cn("block text-[0.75rem]", instalment.overdue ? "font-medium text-error-text" : "text-muted")}
          >
            {dueInWords(instalment.dueAt)}
          </span>
        )}
      </>
    ) : (
      <span className="text-subtle">No date</span>
    );

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Payables", href: path("/admin/finance/payables") },
          { label: payable.bookingReference },
        ]}
      />

      <AdminPageHeader
        title={payable.bookingReference}
        description={`${productLabels[payable.product]} · ${payable.supplier ? `owed to ${payable.supplier.name}` : "platform inventory, no outside supplier"}`}
        actions={<PayableStatusBadge status={payable.status} className="text-[0.8125rem]" />}
      />

      {payable.needsReview && (
        <div
          role="status"
          className="mt-6 flex items-start gap-3 rounded-sm border border-warning/40 bg-warning/5 p-4"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
          <div className="min-w-0">
            <p className="text-[0.875rem] font-semibold text-warning-text">
              Needs review
              {payable.reviewReason && reviewReasonLabels[payable.reviewReason]
                ? `: ${reviewReasonLabels[payable.reviewReason]}`
                : ""}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
              {(payable.reviewReason && reviewHelp[payable.reviewReason]) ??
                "Something about this payable needs a person to look at it before it is paid."}
            </p>
          </div>
        </div>
      )}

      {payable.refundDueCents > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-sm border border-info/40 bg-info/5 p-4">
          <Undo2 size={18} className="mt-0.5 shrink-0 text-info rtl:-scale-x-100" aria-hidden />
          <div className="min-w-0">
            <p className="text-[0.875rem] font-semibold text-ink">
              {money(payable.refundDueCents)} to come back from the supplier
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-body">
              We have paid {money(payable.paidCents)}, but only {money(payable.amountCents)} is owed now — usually
              because the booking was cancelled after we paid. Ask the supplier for the difference and record it as
              a refund on the Payments screen.
            </p>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <AdminPanel
            title="What is owed"
            description="The supplier's net price for this booking, in its own currency."
          >
            <AdminDefinitionList
              items={[
                { label: "Net at confirmation", value: money(payable.originalAmountCents) },
                { label: "Owed now", value: money(payable.amountCents) },
                { label: "Paid", value: money(payable.paidCents) },
                {
                  label: "Outstanding",
                  value: <span className="text-[0.9375rem] font-semibold">{money(payable.outstandingCents)}</span>,
                },
                ...(payable.refundDueCents > 0
                  ? [{ label: "Refund due to us", value: money(payable.refundDueCents) }]
                  : []),
                ...(payable.amountOverrideCents !== null
                  ? [
                      { label: "Set by hand", value: money(payable.amountOverrideCents) },
                      { label: "Because", value: payable.overrideReason ?? "—" },
                    ]
                  : []),
                ...(payable.cancellationLiability
                  ? [
                      {
                        label: "Cancellation treated as",
                        value: cancellationLiabilityLabels[payable.cancellationLiability],
                      },
                    ]
                  : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel
            title="Instalments"
            description="How the supplier's payment terms split the amount, and what has been paid against each part."
            bodyClassName="p-0 2xl:p-5"
          >
            {payable.instalments.length === 0 ? (
              <p className="p-5 text-[0.8125rem] text-muted 2xl:p-0">No instalments — nothing is scheduled to be paid.</p>
            ) : (
              <>
                {/* The table only where the panel is wide enough for it: the shared
                    table keeps a 44rem floor, and in the two-column layout the
                    panel is narrower than that until very wide screens. */}
                <div className="hidden rounded-sm border border-line 2xl:block">
                  <DataTable columns={INSTALMENT_COLUMNS} caption="Instalments and their payments">
                    {payable.instalments.map((instalment) => {
                      const lines = payments(instalment);

                      return [
                        <Row key={instalment.id}>
                          <Cell>
                            <span className="font-medium text-ink">{instalmentKindLabels[instalment.kind]}</span>
                            <span className="block text-[0.75rem] text-muted">Part {instalment.sequence}</span>
                            {/* Under the name rather than in a column of its own: six
                                columns did not fit the panel at laptop width. */}
                            <span className="mt-1.5 block">
                              <PayableStatusBadge status={instalment.status} />
                            </span>
                          </Cell>
                          <Cell>{dueCell(instalment)}</Cell>
                          <Cell align="end" className="tabular-nums">
                            {money(instalment.amountCents)}
                            {instalment.amountCents !== instalment.originalAmountCents && (
                              <span className="block text-[0.75rem] text-muted">
                                was {money(instalment.originalAmountCents)}
                              </span>
                            )}
                          </Cell>
                          <Cell align="end" className="tabular-nums">
                            {money(instalment.paidCents)}
                          </Cell>
                          <Cell align="end" className="font-medium tabular-nums text-ink">
                            {money(instalment.outstandingCents)}
                          </Cell>
                        </Row>,
                        lines.length > 0 && (
                          <tr key={`${instalment.id}-payments`}>
                            <td colSpan={INSTALMENT_COLUMNS.length} className="bg-surface-soft/50 px-4 py-3">
                              <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">
                                Payments
                              </p>
                              <ul className="space-y-1">{lines.map(paymentLine)}</ul>
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                  </DataTable>
                </div>

                <ul className="divide-y divide-line 2xl:hidden">
                  {payable.instalments.map((instalment) => {
                    const lines = payments(instalment);

                    return (
                      <li key={instalment.id} className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-ink">{instalmentKindLabels[instalment.kind]}</p>
                            <p className="mt-0.5 text-[0.8125rem]">{dueCell(instalment)}</p>
                          </div>
                          <PayableStatusBadge status={instalment.status} />
                        </div>

                        <dl className="mt-3 grid grid-cols-2 gap-3 text-[0.8125rem] sm:grid-cols-3">
                          <div className="min-w-0">
                            <dt className="text-[0.75rem] text-muted">Amount</dt>
                            <dd className="tabular-nums text-body">{money(instalment.amountCents)}</dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-[0.75rem] text-muted">Paid</dt>
                            <dd className="tabular-nums text-body">{money(instalment.paidCents)}</dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-[0.75rem] text-muted">Left</dt>
                            <dd className="font-medium tabular-nums text-ink">{money(instalment.outstandingCents)}</dd>
                          </div>
                        </dl>

                        {lines.length > 0 && (
                          <div className="mt-3 rounded-sm bg-surface-soft/60 p-3">
                            <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">
                              Payments
                            </p>
                            <ul className="space-y-1.5">{lines.map(paymentLine)}</ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-6">
          {canWrite && <PayableActions payable={payable} adjustWithoutApproval={canAdjustWithoutApproval} />}
          {canAskForApproval && <PayableApprovalRequests payable={payable} />}

          <AdminPanel title="Booking">
            <AdminDefinitionList
              items={[
                { label: "Supplier", value: supplier },
                { label: "Product", value: productLabels[payable.product] },
                {
                  label: "Booking",
                  value: bookingHref ? (
                    <Link href={path(bookingHref)} className="font-mono underline-offset-4 hover:underline">
                      {payable.bookingReference}
                    </Link>
                  ) : (
                    <span className="font-mono">{payable.bookingReference}</span>
                  ),
                },
                ...(payable.booking ? [{ label: "Booking status", value: titleCase(payable.booking.status) }] : []),
                { label: "Currency", value: payable.currency },
                { label: "Created", value: formatPartnerDateTime(payable.createdAt) },
                { label: "Origin", value: sourceLabels[payable.source] ?? titleCase(payable.source) },
                ...(payable.voidedAt ? [{ label: "Nothing owed since", value: formatPartnerDateTime(payable.voidedAt) }] : []),
                ...(payable.waivedAt ? [{ label: "Written off", value: formatPartnerDateTime(payable.waivedAt) }] : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Notes">
            {payable.notes ? (
              <p className="text-[0.875rem] leading-relaxed whitespace-pre-line text-body">{payable.notes}</p>
            ) : (
              <p className="text-[0.8125rem] text-muted">No notes.</p>
            )}
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
