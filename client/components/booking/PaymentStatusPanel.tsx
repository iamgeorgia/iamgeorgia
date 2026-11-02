"use client";

import { useSearchParams } from "next/navigation";
import { Ban, Clock, CreditCard, Info } from "lucide-react";
import { Suspense, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { newIdempotencyKey } from "@/lib/booking/checkoutSession";
import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { startCardPayment } from "@/lib/payments/cardPayment";
import type { BookingPayment, BookingPaymentStatus } from "@/types/booking";

interface PaymentStatusPanelProps {
  payment: BookingPayment;
  /** The booking, order or transfer reference the payment is for. */
  reference: string;
  /** The guest's email, from the page's query. Without it the guest cannot start a payment here. */
  email: string | null;
  currency: string;
  className?: string;
}

const STATUS_TONE: Record<BookingPaymentStatus, "neutral" | "brand" | "nature"> = {
  NONE: "neutral",
  UNPAID: "brand",
  PARTIAL: "brand",
  OVERDUE: "brand",
  PAID: "nature",
  WAIVED: "neutral",
  VOID: "neutral",
};

/**
 * The payment card shown on every confirmation and manage page.
 *
 * Shared by hotel, tour, order and transfer so a guest finds the same thing
 * wherever they land: what is owed, whether it has been paid, and (when the
 * server says card is on offer right now) a button to pay. The button asks the
 * server to open a payment; it sends no amount.
 */
export function PaymentStatusPanel(props: PaymentStatusPanelProps) {
  // `useSearchParams` suspends on a statically rendered page; the fallback is
  // empty because the panel is an addition to the page, not its content.
  return (
    <Suspense fallback={null}>
      <PaymentStatusPanelInner {...props} />
    </Suspense>
  );
}

function PaymentStatusPanelInner({ payment, reference, email, currency, className }: PaymentStatusPanelProps) {
  const { t, intlLocale, locale } = useI18n();
  const copy = t.payment.panel;
  const searchParams = useSearchParams();

  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);

  const reason = payment.card.reason;
  const cancelledUnpaid = Boolean(payment.autoCancelledAt);
  // The booking was made, then card payment could not be opened from checkout.
  const checkoutFailed = searchParams.get("payment") === "failed";

  // Where card is not part of this booking's story (gateway off, a partner on
  // account terms) the panel stays out of the way unless there is history.
  const quiet = reason === "PAYMENTS_DISABLED" || reason === "PARTNER_RECEIVABLE";
  const hasHistory = payment.status === "PAID" || payment.status === "PARTIAL";
  const noBill = payment.status === "NONE" && reason !== "NO_RECEIVABLE";

  if (!cancelledUnpaid && !checkoutFailed && ((quiet && !hasHistory) || noBill || payment.status === "VOID")) {
    return null;
  }

  const owing =
    payment.status === "UNPAID" || payment.status === "PARTIAL" || payment.status === "OVERDUE";
  const deadline =
    payment.timing === "PAY_NOW" && payment.autoCancelAt && !cancelledUnpaid && owing
      ? new Intl.DateTimeFormat(intlLocale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Tbilisi",
        }).format(new Date(payment.autoCancelAt))
      : null;

  const payNow = async () => {
    if (!email || starting) return;

    setStarting(true);
    setStartFailed(false);

    // A fresh key per click: an earlier attempt may have been declined, and a
    // replayed key would hand back that attempt's dead checkout link.
    const started = await startCardPayment({
      reference,
      email,
      locale,
      idempotencyKey: newIdempotencyKey(),
    });

    if (!started) {
      setStartFailed(true);
      setStarting(false);
    }
  };

  return (
    <section className={className ?? "border border-line bg-surface p-6"} aria-labelledby="payment-panel-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="payment-panel-title" className="type-h4 flex items-center gap-2">
          <CreditCard size={18} className="text-brand-text" aria-hidden />
          {copy.title}
        </h2>
        {!cancelledUnpaid && (
          <Badge tone={STATUS_TONE[payment.status]}>{copy.status[payment.status]}</Badge>
        )}
      </div>

      {checkoutFailed && (
        <p
          role="status"
          className="type-body-sm mt-4 flex items-start gap-2.5 rounded-sm border border-warning/40 bg-warning/10 px-3.5 py-3 text-warning-text"
        >
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
          {t.payment.notice.startFailed}
        </p>
      )}

      {cancelledUnpaid && (
        <p className="type-body-sm mt-4 flex items-start gap-2.5 text-error-text">
          <Ban size={16} className="mt-0.5 shrink-0" aria-hidden />
          {copy.cancelledUnpaid}
        </p>
      )}

      {owing && !cancelledUnpaid && payment.outstandingCents !== null && (
        <p className="type-body mt-4 flex items-baseline justify-between gap-4">
          <span className="text-muted">{copy.amountDue}</span>
          <span className="font-semibold tabular-nums text-ink">
            {formatMoney(payment.outstandingCents, currency, intlLocale)}
          </span>
        </p>
      )}

      {deadline && (
        <p className="type-body-sm mt-3 flex items-start gap-2 font-medium text-warning-text">
          <Clock size={15} className="mt-0.5 shrink-0" aria-hidden />
          {fill(copy.payBefore, { date: deadline })}
        </p>
      )}

      {payment.status === "NONE" && reason === "NO_RECEIVABLE" && !cancelledUnpaid && (
        <p className="type-body-sm mt-4 text-muted">{copy.afterConfirmed}</p>
      )}

      {payment.card.available && !cancelledUnpaid && email && (
        <div className="mt-5">
          <Button fullWidth onClick={() => void payNow()} disabled={starting}>
            <CreditCard size={16} aria-hidden />
            {starting ? copy.starting : copy.payNow}
          </Button>
          {startFailed && (
            <p role="alert" className="type-body-sm mt-3 text-error-text">
              {copy.startError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
