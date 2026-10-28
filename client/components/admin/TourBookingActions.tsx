"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { TourBookingStatusBadge } from "./StatusBadge";
import { cancelTourBookingAsAdmin, confirmTourRequest, declineTourRequest } from "@/lib/api/tours";
import { describeError } from "@/lib/api/client";
import { formatInstant } from "@/lib/admin/bookings";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { TourBooking, TourCancellationQuote } from "@/types/tour";

/**
 * The operator's three answers to a tour booking.
 *
 * A PENDING booking is a request with its seats already claimed: confirming
 * makes it a booking and sends the voucher, declining releases the seats at
 * no charge and tells the agency why. Cancelling a confirmed booking charges
 * whatever the terms frozen at confirmation say, and the figure is shown
 * before the button. A booking still waiting for the platform's approval
 * can only be withdrawn here, at no charge — approving is the queue's job.
 */
export function TourBookingActions({
  booking,
  quote,
}: {
  booking: TourBooking;
  quote: TourCancellationQuote | null;
}) {
  const router = useRouter();
  const can = useCan();
  const [mode, setMode] = useState<"idle" | "decline" | "cancel">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pending = booking.status === "PENDING";
  const awaitingApproval = booking.status === "PENDING_APPROVAL";
  const cancellable = awaitingApproval || booking.status === "PENDING" || booking.status === "CONFIRMED";
  // Answering a request changes the booking; cancelling is its own right.
  const canAnswer = can("bookings.write");
  const canCancel = can("bookings.cancel");

  const run = async (key: string, call: () => Promise<unknown>, note: string) => {
    setBusy(key);
    setError(null);
    setMessage(null);

    try {
      await call();
      setMessage(note);
      setMode("idle");
      setReason("");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const base =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
  const area =
    "mt-2 w-full rounded-sm border border-line bg-surface px-3 py-2 text-[0.8125rem] text-ink outline-none focus:border-ink";

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.8125rem] text-muted">Current status</span>
        <TourBookingStatusBadge status={booking.status} />
      </div>

      {pending && booking.requestDeadlineAt && (
        <p className="mt-3 text-[0.8125rem] text-warning-text">
          Answer due by {formatInstant(booking.requestDeadlineAt)}. The seats are already claimed.
        </p>
      )}

      {pending && !canAnswer && (
        <ReadOnlyNote needs="bookings.write" what="Answering this request" className="mt-4" />
      )}

      {pending && canAnswer && (
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              run("confirm", () => confirmTourRequest(booking.reference), "Confirmed. The voucher is on its way.")
            }
            className={cn(base, "bg-brand text-white hover:bg-brand-hover")}
          >
            {busy === "confirm" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
            Confirm request
          </button>

          {mode === "decline" ? (
            <div className="rounded-sm border border-line p-3">
              <label className="block text-[0.8125rem] font-medium text-ink">
                Why it cannot run
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className={area} />
              </label>
              <p className="mt-1 text-[0.75rem] text-muted">Required. The agency sees this word for word.</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null || reason.trim().length === 0}
                  onClick={() =>
                    run("decline", () => declineTourRequest(booking.reference, reason.trim()), "Declined. The seats are released and nothing is charged.")
                  }
                  className={cn(base, "border border-error/40 text-error-text hover:bg-error/8")}
                >
                  {busy === "decline" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <XCircle size={15} aria-hidden />}
                  Decline
                </button>
                <button type="button" onClick={() => setMode("idle")} className={cn(base, "border border-ink/20 text-ink hover:border-ink")}>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setMode("decline")}
              className={cn(base, "border border-error/40 text-error-text hover:bg-error/8")}
            >
              <XCircle size={15} aria-hidden />
              Decline request
            </button>
          )}
        </div>
      )}

      {awaitingApproval && (
        <p className="mt-4 rounded-sm bg-surface-soft p-3 text-[0.8125rem] text-muted">
          Nothing is charged for withdrawing a request before it is approved; the held seats are released.
        </p>
      )}

      {cancellable && !pending && quote && (
        <dl className="mt-4 space-y-1.5 rounded-sm bg-surface-soft p-3 text-[0.8125rem]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Cancelling now costs</dt>
            <dd className="font-medium text-ink tabular-nums">{formatMoney(quote.chargeCents, quote.currency)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Refund to traveller</dt>
            <dd className="font-medium text-ink tabular-nums">{formatMoney(quote.refundCents, quote.currency)}</dd>
          </div>
        </dl>
      )}

      {cancellable && !pending && !canCancel && (
        <ReadOnlyNote needs="bookings.cancel" what="Cancelling this booking" className="mt-4" />
      )}

      {cancellable && !pending && canCancel && (
        <div className="mt-4">
          {mode === "cancel" ? (
            <div className="rounded-sm border border-line p-3">
              <label className="block text-[0.8125rem] font-medium text-ink">
                Reason (optional)
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className={area} />
              </label>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      "cancel",
                      () => cancelTourBookingAsAdmin(booking.reference, reason.trim() || undefined),
                      awaitingApproval ? "Request withdrawn. The seats are released and nothing is charged." : "Cancelled. The seats are released.",
                    )
                  }
                  className={cn(base, "bg-error text-white hover:bg-error/90")}
                >
                  {busy === "cancel" && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  {awaitingApproval ? "Withdraw request" : "Cancel booking"}
                </button>
                <button type="button" onClick={() => setMode("idle")} className={cn(base, "border border-ink/20 text-ink hover:border-ink")}>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setMode("cancel")}
              className={cn(base, "border border-error/40 text-error-text hover:bg-error/8")}
            >
              {awaitingApproval ? "Withdraw request" : "Cancel booking"}
            </button>
          )}
        </div>
      )}

      {!cancellable && (
        <p className="mt-4 text-[0.8125rem] text-muted">Nothing further can be done to this booking.</p>
      )}

      <p aria-live="polite" className="mt-3 min-h-5 text-[0.75rem]">
        {error ? <span className="text-error-text">{error}</span> : message && <span className="text-muted">{message}</span>}
      </p>
    </div>
  );
}
