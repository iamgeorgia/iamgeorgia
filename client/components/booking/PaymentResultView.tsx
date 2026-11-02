"use client";

import {
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { getPayment, retryPayment } from "@/lib/api/payments";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { confirmationPath, recallGuestEmail, rememberGuestEmail } from "@/lib/payments/cardPayment";
import { declineReasonKey } from "@/lib/payments/declineReason";
import { OPEN_PAYMENT_STATUSES, type GuestPayment } from "@/types/payments";

/** Quick polling while the bank is likely still answering. */
const FAST_POLL_MS = 3_000;
const FAST_WINDOW_MS = 2 * 60_000;
/** Then a gentler cadence until the total window closes. */
const SLOW_POLL_MS = 15_000;
const TOTAL_WINDOW_MS = 10 * 60_000;
/** Consecutive failed reads after which the view stops pretending it is still checking. */
const MAX_READ_FAILURES = 3;

interface PaymentResultViewProps {
  paymentId: string;
  token: string | null;
}

type Tone = "info" | "success" | "error" | "warning";

const TONE: Record<Tone, string> = {
  info: "bg-brand/10 text-brand-text",
  success: "bg-success/10 text-success",
  error: "bg-error/10 text-error-text",
  warning: "bg-warning/10 text-warning-text",
};

/**
 * What happened to a card payment, kept current while it is still open.
 *
 * Read-only by construction: the only calls are `GET` (polling) and, on an
 * explicit click, `retry` for a fresh attempt. The booking is never touched
 * from here, so a refresh, a second tab or the back button cannot change its
 * state.
 */
export function PaymentResultView({ paymentId, token }: PaymentResultViewProps) {
  const { t, intlLocale, locale } = useI18n();
  const path = useLocalePath();
  const copy = t.payment.result;

  const [payment, setPayment] = useState<GuestPayment | null>(null);
  /** The read failed and nothing is known about the payment yet (or any more). */
  const [unreachable, setUnreachable] = useState(false);
  /** Polling ran out of time with the payment still open. */
  const [stalled, setStalled] = useState(false);
  /** Bumped by "Check again" to start a fresh polling run. */
  const [run, setRun] = useState(0);

  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);

  useEffect(() => {
    if (!token) return;

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let known = false;
    const startedAt = Date.now();

    const tick = async () => {
      try {
        const next = await getPayment(paymentId, token);

        if (!live) return;

        failures = 0;
        known = true;
        setUnreachable(false);
        setPayment(next);

        if (!OPEN_PAYMENT_STATUSES.includes(next.status)) return;
      } catch {
        if (!live) return;

        failures += 1;

        // A blip in the middle of polling is retried; a first read that fails,
        // or three in a row, is reported.
        if (!known || failures >= MAX_READ_FAILURES) {
          setUnreachable(true);
          return;
        }
      }

      const elapsed = Date.now() - startedAt;

      if (elapsed >= TOTAL_WINDOW_MS) {
        setStalled(true);
        return;
      }

      timer = setTimeout(() => void tick(), elapsed < FAST_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS);
    };

    void tick();

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [paymentId, token, run]);

  const checkAgain = () => {
    setUnreachable(false);
    setStalled(false);
    setRun((current) => current + 1);
  };

  const shell = (
    tone: Tone,
    icon: React.ReactNode,
    title: string,
    body?: React.ReactNode,
    extra?: React.ReactNode,
    actions?: React.ReactNode,
  ) => (
    <section
      className="border border-line bg-surface p-6 shadow-card sm:p-8"
      role="status"
      aria-live="polite"
    >
      <span className={`flex size-14 items-center justify-center rounded-full ${TONE[tone]}`}>{icon}</span>
      <h1 className="type-h2 mt-5">{title}</h1>
      {body && <div className="type-body mt-3 text-body">{body}</div>}
      {extra}
      {actions && <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">{actions}</div>}
    </section>
  );

  // --- no token ------------------------------------------------------------

  if (!token) {
    return shell(
      "warning",
      <ShieldAlert size={26} aria-hidden />,
      copy.missingTitle,
      copy.missingBody,
      undefined,
      <Button href={path("/booking/manage")}>{copy.findBooking}</Button>,
    );
  }

  // --- nothing known yet ---------------------------------------------------

  if (!payment) {
    if (unreachable) {
      return shell(
        "warning",
        <Clock size={26} aria-hidden />,
        copy.unknownTitle,
        fill(copy.unknownBody, { reference: paymentId }),
        undefined,
        <Button onClick={checkAgain}>{copy.checkAgain}</Button>,
      );
    }

    return shell(
      "info",
      <LoaderCircle size={26} className="animate-spin" aria-hidden />,
      copy.processingTitle,
      copy.processingBody,
    );
  }

  // --- derived facts -------------------------------------------------------

  const amount = formatMoney(payment.amountCents, payment.currency, intlLocale);
  // Parked in this tab's sessionStorage just before the redirect to the bank.
  // Without it the confirmation page cannot prove who is asking, so the guest
  // is sent to the lookup form instead.
  const email = recallGuestEmail(payment.bookingReference);
  const bookingHref = email
    ? path(`${confirmationPath(payment.bookingReference)}?email=${encodeURIComponent(email)}`)
    : path("/booking/manage");
  const autoCancelAt = payment.receivable?.autoCancelAt ?? null;

  const payBefore = autoCancelAt ? (
    <p className="type-body-sm mt-4 flex items-center gap-2 font-medium text-warning-text">
      <Clock size={15} aria-hidden />
      {fill(copy.payBefore, {
        date: new Intl.DateTimeFormat(intlLocale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Tbilisi",
        }).format(new Date(autoCancelAt)),
      })}
    </p>
  ) : null;

  const tryAgain = async () => {
    if (retrying) return;

    setRetrying(true);
    setRetryFailed(false);

    try {
      const next = await retryPayment(paymentId, token, locale);

      if (!next.checkoutUrl) throw new Error("No checkout URL");

      if (email) rememberGuestEmail(payment.bookingReference, email);
      window.location.assign(next.checkoutUrl);
    } catch {
      setRetryFailed(true);
      setRetrying(false);
    }
  };

  const retryButtons = (withLater: boolean) => (
    <>
      <Button onClick={() => void tryAgain()} disabled={retrying}>
        <RotateCcw size={16} aria-hidden />
        {retrying ? t.payment.panel.starting : copy.tryAgain}
      </Button>
      {withLater && (
        <Button variant="outline" href={bookingHref}>
          {copy.payLater}
        </Button>
      )}
    </>
  );

  const retryError = retryFailed ? (
    <p role="alert" className="type-body-sm mt-5 text-error-text">
      {copy.retryFailed}
    </p>
  ) : null;

  const details = (
    <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 border-t border-line pt-5 text-sm">
      <dt className="text-muted">{copy.amount}</dt>
      <dd className="font-medium tabular-nums text-ink">{amount}</dd>
      {payment.maskedCard && (
        <>
          <dt className="text-muted">{copy.card}</dt>
          <dd className="font-medium tabular-nums text-ink" dir="ltr">
            {[payment.paymentSystem ?? payment.cardType, payment.maskedCard].filter(Boolean).join(" ")}
          </dd>
        </>
      )}
      <dt className="text-muted">{copy.paymentReference}</dt>
      <dd className="font-medium tabular-nums text-ink" dir="ltr">
        {payment.reference}
      </dd>
      <dt className="text-muted">{copy.bookingReference}</dt>
      <dd className="font-medium tabular-nums text-ink" dir="ltr">
        {payment.bookingReference}
      </dd>
    </dl>
  );

  // --- the states ----------------------------------------------------------

  switch (payment.status) {
    case "APPROVED":
      return shell(
        "success",
        <CircleCheck size={26} aria-hidden />,
        copy.approvedTitle,
        <>
          <p>{copy.approvedBody}</p>
          <p className="type-body-sm mt-2 text-muted">{copy.receiptSent}</p>
        </>,
        details,
        <Button href={bookingHref}>{email ? copy.viewBooking : copy.findBooking}</Button>,
      );

    case "DECLINED": {
      const reason = t.payment.declineReasons[declineReasonKey(payment.responseCode)];

      return shell(
        "error",
        <CircleX size={26} aria-hidden />,
        copy.declinedTitle,
        <>
          <p>{reason}</p>
          <p className="mt-2 font-medium text-ink">{copy.noMoneyTaken}</p>
        </>,
        <>
          {payBefore}
          {retryError}
        </>,
        retryButtons(true),
      );
    }

    case "EXPIRED":
    case "CANCELLED":
      return shell(
        "warning",
        <TriangleAlert size={26} aria-hidden />,
        copy.notCompletedTitle,
        <p className="font-medium text-ink">{copy.noMoneyTaken}</p>,
        <>
          {payBefore}
          {retryError}
        </>,
        retryButtons(true),
      );

    case "FAILED":
      return shell(
        "warning",
        <TriangleAlert size={26} aria-hidden />,
        copy.failedTitle,
        copy.failedBody,
        <>
          {payBefore}
          {retryError}
        </>,
        retryButtons(false),
      );

    case "MISMATCH":
      return shell(
        "info",
        <Clock size={26} aria-hidden />,
        copy.mismatchTitle,
        copy.mismatchBody,
        details,
      );

    case "REVERSED":
      return shell(
        "info",
        <Undo2 size={26} aria-hidden />,
        copy.reversedTitle,
        copy.reversedBody,
        details,
        <Button href={bookingHref}>{email ? copy.viewBooking : copy.findBooking}</Button>,
      );

    default:
      // CREATED, REDIRECT_READY, PROCESSING: still open.
      if (stalled || unreachable) {
        return shell(
          "warning",
          <Clock size={26} aria-hidden />,
          stalled ? copy.pendingTitle : copy.unknownTitle,
          fill(stalled ? copy.pendingBody : copy.unknownBody, { reference: payment.reference }),
          undefined,
          <Button onClick={checkAgain}>{copy.checkAgain}</Button>,
        );
      }

      return shell(
        "info",
        <LoaderCircle size={26} className="animate-spin" aria-hidden />,
        copy.processingTitle,
        copy.processingBody,
        payBefore,
      );
  }
}
