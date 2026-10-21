"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { BookingStatusBadge } from "./StatusBadge";
import { cancelBookingAsAdmin } from "@/lib/api/bookings";
import { describeError } from "@/lib/api/client";
import { bookingStatusHints } from "@/lib/admin/bookings";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Booking, CancellationQuote } from "@/types/booking";

/**
 * What an operator can do to a booking.
 *
 * Only one thing, and deliberately: cancel. There is no "confirm" button
 * because a booking is confirmed the moment it is made — the rooms are already
 * committed — and no "mark completed" because that is a function of the date
 * rather than of anyone's opinion. Approving is the queue's job, not this
 * panel's; a booking still waiting for approval can only be withdrawn here.
 *
 * Cancelling shows what it will cost *before* it happens. The figure comes from
 * the schedule frozen onto the booking at confirmation, so it is what the guest
 * was actually promised and not what the hotel's policy says today. A booking
 * withdrawn before approval costs nothing: no supplier has been asked yet.
 */
export function BookingActions({
  booking,
  quote,
}: {
  booking: Booking;
  /** Pre-fetched by the page, so the cost is visible without a click. */
  quote: CancellationQuote | null;
}) {
  const router = useRouter();
  const can = useCan();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const awaitingApproval = booking.status === "PENDING_APPROVAL";
  const cancellable = awaitingApproval || booking.status === "PENDING" || booking.status === "CONFIRMED";
  // The server refuses the cancel without this; the button is simply not offered.
  const canCancel = can("bookings.cancel");

  const run = async () => {
    setBusy(true);
    setError(null);

    try {
      const result = await cancelBookingAsAdmin(booking.reference, reason || undefined);

      setMessage(
        result.cancellation.chargeCents > 0
          ? `Cancelled. ${formatMoney(result.cancellation.chargeCents, result.cancellation.currency)} is chargeable under the terms agreed at booking.`
          : "Cancelled in full. Nothing is chargeable.",
      );
      setConfirming(false);
      // The page is a Server Component; refreshing re-reads the record rather
      // than patching a local copy that could drift from the server's.
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const base =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.8125rem] text-muted">Current status</span>
        <BookingStatusBadge status={booking.status} />
      </div>

      {awaitingApproval && (
        <p className="mt-4 rounded-sm bg-surface-soft p-3 text-[0.8125rem] text-muted">
          Nothing is charged for withdrawing a request before it is approved.
        </p>
      )}

      {cancellable && !awaitingApproval && quote && (
        <dl className="mt-4 space-y-1.5 rounded-sm bg-surface-soft p-3 text-[0.8125rem]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Cancelling now costs</dt>
            <dd className="font-medium text-ink tabular-nums">
              {formatMoney(quote.chargeCents, quote.currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Refund to guest</dt>
            <dd className="font-medium text-ink tabular-nums">
              {formatMoney(quote.refundCents, quote.currency)}
            </dd>
          </div>
        </dl>
      )}

      {cancellable && !canCancel && (
        <ReadOnlyNote needs="bookings.cancel" what="Cancelling this booking" className="mt-4" />
      )}

      {cancellable && canCancel && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={cn(base, "mt-4 border border-error/40 text-error-text hover:bg-error/8")}
        >
          <Ban size={15} aria-hidden />
          {awaitingApproval ? "Withdraw request" : "Cancel booking"}
        </button>
      )}

      {canCancel && confirming && (
        <div className="mt-4 rounded-sm border border-error/40 p-3">
          <p className="flex items-start gap-2 text-[0.8125rem] text-error-text">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {awaitingApproval
                ? `This withdraws the request before anyone has approved it, releases the ${booking.rooms} held ${booking.rooms === 1 ? "room" : "rooms"} at no charge, and cannot be undone.`
                : `This releases ${booking.rooms} ${booking.rooms === 1 ? "room" : "rooms"} back on sale and cannot be undone.`}
            </span>
          </p>

          <label className="mt-3 block text-[0.75rem] font-medium text-muted" htmlFor="cancel-reason">
            Reason (optional, kept internally)
          </label>
          <input
            id="cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink"
          />

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={run}
              className={cn(base, "bg-error text-white hover:opacity-90")}
            >
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
              {awaitingApproval ? "Withdraw request" : "Confirm cancellation"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className={cn(base, "border border-ink/20 text-ink hover:border-ink hover:bg-surface-soft")}
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      <p aria-live="polite" className="mt-4 min-h-8 text-[0.75rem]">
        {error ? (
          <span className="text-error-text">{error}</span>
        ) : (
          <span className="text-muted">{message ?? bookingStatusHints[booking.status]}</span>
        )}
      </p>
    </div>
  );
}
