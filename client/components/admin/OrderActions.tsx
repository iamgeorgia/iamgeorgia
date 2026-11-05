"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Loader2 } from "lucide-react";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { OrderStatusBadge } from "./StatusBadge";
import { cancelOrderAsAdmin } from "@/lib/api/orders";
import { describeError } from "@/lib/api/client";
import { formatInstant } from "@/lib/admin/bookings";
import { isRequestOverdue } from "@/lib/admin/orders";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Order, OrderCancellationQuote } from "@/types/order";

/**
 * Cancelling the whole order.
 *
 * The parts have their own answers on the rows above; this is the one button
 * that ends the trip, so it carries the total charge and refund before it
 * rather than after. The figures are the server's quote, priced off the terms
 * frozen onto each child booking — never recomputed here, because a template
 * edited since must not be able to reach back into a sold trip.
 */
export function OrderActions({
  order,
  quote,
}: {
  order: Order;
  quote: OrderCancellationQuote | null;
}) {
  const router = useRouter();
  const can = useCan();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // An order still waiting for the platform's yes can be cancelled too: the
  // buyer may have changed their mind before anyone answered.
  const cancellable =
    order.status === "PENDING_APPROVAL" ||
    order.status === "PENDING_CONFIRMATION" ||
    order.status === "CONFIRMED" ||
    order.status === "PARTIALLY_CANCELLED";
  const canCancel = can("bookings.cancel");
  const overdue = isRequestOverdue(order.requestDeadlineAt);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await cancelOrderAsAdmin(order.reference, reason.trim() || undefined);
      setMessage("Cancelled. Every part still live has been released.");
      setConfirming(false);
      setReason("");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
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
        <OrderStatusBadge status={order.status} />
      </div>

      {order.pendingCount > 0 && (
        <p
          className={cn(
            "mt-3 flex items-start gap-2 text-[0.8125rem]",
            overdue ? "font-medium text-error-text" : "text-warning-text",
          )}
        >
          {overdue ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          ) : (
            <Clock size={14} className="mt-0.5 shrink-0" aria-hidden />
          )}
          <span>
            {order.pendingCount} {order.pendingCount === 1 ? "part is" : "parts are"} waiting on a
            supplier
            {order.requestDeadlineAt &&
              ` — ${overdue ? "answer was due" : "answer due by"} ${formatInstant(order.requestDeadlineAt)}`}
            . Their rooms and seats are already claimed. Answer each one on its row.
          </span>
        </p>
      )}

      {cancellable && quote && (
        <dl className="mt-4 space-y-1.5 rounded-sm bg-surface-soft p-3 text-[0.8125rem]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Cancelling now costs</dt>
            <dd className="font-medium text-ink tabular-nums">
              {formatMoney(quote.chargeCents, quote.currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Refund to the buyer</dt>
            <dd className="font-medium text-ink tabular-nums">
              {formatMoney(quote.refundCents, quote.currency)}
            </dd>
          </div>
        </dl>
      )}

      {/* No quote is not a failure: an order with nothing live left has
          nothing to price, and saying so beats an empty panel. */}
      {cancellable && !quote && (
        <p className="mt-4 text-[0.8125rem] text-muted">
          Nothing here is priced for cancellation, so ending the order charges nothing.
        </p>
      )}

      {cancellable && !canCancel && (
        <ReadOnlyNote needs="bookings.cancel" what="Cancelling this order" className="mt-4" />
      )}

      {cancellable && canCancel && (
        <div className="mt-4">
          {confirming ? (
            <div className="rounded-sm border border-line p-3">
              <p className="text-[0.8125rem] text-body">
                This ends the whole trip. Every part still live is released, and the charge above
                stands.
              </p>
              <label className="mt-3 block text-[0.8125rem] font-medium text-ink">
                Reason (optional)
                <textarea
                  value={reason}
                  rows={3}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  className={area}
                />
              </label>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cancel()}
                  className={cn(base, "bg-error text-white hover:bg-error/90")}
                >
                  {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  Cancel order
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  className={cn(base, "border border-ink/20 text-ink hover:border-ink")}
                >
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={cn(base, "border border-error/40 text-error-text hover:bg-error/8")}
            >
              Cancel order
            </button>
          )}
        </div>
      )}

      {!cancellable && (
        <p className="mt-4 text-[0.8125rem] text-muted">
          Nothing further can be done to this order.
        </p>
      )}

      <p aria-live="polite" className="mt-3 min-h-5 text-[0.75rem]">
        {error ? (
          <span className="text-error-text">{error}</span>
        ) : (
          message && <span className="text-muted">{message}</span>
        )}
      </p>
    </div>
  );
}
