"use client";

import Link from "next/link";

import { AdminDefinitionList, AdminPanel } from "@/components/admin/AdminPage";
import { useCan } from "@/components/admin/AdminViewerContext";
import { PaymentStatusBadge } from "@/components/admin/PaymentStatusBadge";
import { formatInstant } from "@/lib/admin/bookings";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { BookingPayment } from "@/types/booking";

/**
 * The small Payment panel on every booking and order detail page.
 *
 * Anyone who reads bookings sees where the bill stands — unpaid, overdue,
 * paid — because a desk answering the phone needs that word. The link into
 * the receivable itself is finance's: it renders only for a viewer who holds
 * `finance.receivables.read`, which is also what the receivable page asks.
 */
export function BookingPaymentPanel({ payment, currency }: { payment: BookingPayment; currency: string }) {
  const can = useCan();
  const localePath = useLocalePath();

  const money = (cents: number | null) => (cents === null ? "—" : formatMoney(cents, currency));
  const receivableHref =
    payment.receivableId && can("finance.receivables.read")
      ? localePath(`/admin/finance/receivables/${payment.receivableId}`)
      : null;

  return (
    <AdminPanel
      title="Payment"
      description={
        payment.status === "NONE"
          ? "No bill has been raised. One issues when the booking is approved."
          : payment.via === "ORDER"
            ? "Billed on the order this booking belongs to."
            : undefined
      }
      action={
        receivableHref ? (
          <Link
            href={receivableHref}
            prefetch={false}
            className="text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
          >
            Open receivable
          </Link>
        ) : undefined
      }
    >
      <AdminDefinitionList
        items={[
          { label: "Status", value: <PaymentStatusBadge status={payment.status} /> },
          { label: "Due", value: payment.dueAt ? formatInstant(payment.dueAt) : "—" },
          ...(payment.status !== "NONE"
            ? [
                { label: "Billed", value: money(payment.amountCents) },
                { label: "Paid", value: money(payment.paidCents) },
                { label: "Outstanding", value: money(payment.outstandingCents) },
              ]
            : []),
        ]}
      />
    </AdminPanel>
  );
}
