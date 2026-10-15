"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { useState } from "react";

import { OrderItems } from "@/components/packages/OrderItems";
import { Modal } from "@/components/ui/Modal";
import { cancelOrderItemAsAdmin, confirmOrderItem, declineOrderItem } from "@/lib/api/orders";
import { describeError } from "@/lib/api/client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Order, OrderCancellationQuote, OrderItem } from "@/types/order";

/**
 * The parts of an order with the operator's answers hung off each row.
 *
 * `OrderItems` takes its controls as a render prop, and a function cannot
 * cross the server boundary — so this client component exists to hold that
 * one function. The rows themselves are the shared component, because a part
 * looks the same to the operator as it does to the buyer and the two lists
 * drifting apart is how a reference gets read out wrongly over the phone.
 */
export function OrderParts({
  order,
  quote,
}: {
  order: Order;
  /** Per-part charges, read off the figures frozen onto each child booking. */
  quote: OrderCancellationQuote | null;
}) {
  return (
    <OrderItems
      items={order.items}
      currency={order.currency}
      action={(item) => (
        <ItemActions
          reference={order.reference}
          currency={order.currency}
          item={item}
          quote={quote}
        />
      )}
    />
  );
}

const button =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border px-3 text-[0.75rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";

function ItemActions({
  reference,
  currency,
  item,
  quote,
}: {
  reference: string;
  currency: string;
  item: OrderItem;
  quote: OrderCancellationQuote | null;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"decline" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, call: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);

    try {
      await call();
      setDialog(null);
      setReason("");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const line = quote?.items.find((row) => row.slotIndex === item.slotIndex) ?? null;

  const area =
    "mt-1.5 w-full rounded-sm border border-line bg-background p-3 text-[0.8125rem] text-ink outline-none focus:border-ink";

  if (item.status === "REQUESTED") {
    return (
      <>
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("confirm", () => confirmOrderItem(reference, item.slotIndex))}
            className={cn(button, "border-transparent bg-brand text-white hover:bg-brand-hover")}
          >
            {busy === "confirm" ? (
              <Loader2 size={13} className="animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 size={13} aria-hidden />
            )}
            Confirm
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setDialog("decline")}
            className={cn(button, "border-error/40 text-error-text hover:bg-error/8")}
          >
            <XCircle size={13} aria-hidden />
            Decline
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-1 text-end text-[0.75rem] text-error-text">
            {error}
          </p>
        )}

        <Modal
          open={dialog === "decline"}
          onClose={() => setDialog(null)}
          title={`Decline ${item.label}`}
          size="sm"
        >
          <div className="px-6 pt-4 pb-6">
            {/*
              Which of the two declines this is decides how much of the trip
              survives, so it is stated before the reason box rather than
              after it. The server applies the rule either way; the operator
              should not learn which one they chose from the result screen.
            */}
            <p className="flex items-start gap-2.5 text-[0.875rem] text-body">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
              {item.required ? (
                <span>
                  This is a <span className="font-semibold text-ink">required</span> part.
                  Declining it cancels the whole order at no charge — the failure is the
                  supplier&apos;s, not the buyer&apos;s — and every other part is released with it.
                </span>
              ) : (
                <span>
                  This is an <span className="font-semibold text-ink">optional</span> part.
                  Declining it drops this part at no charge and the order&apos;s total shrinks to
                  what survives. The rest of the trip is untouched.
                </span>
              )}
            </p>

            <label className="mt-5 block text-[0.8125rem] font-medium text-ink">
              Why it cannot run
              <textarea
                value={reason}
                rows={3}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                className={area}
                data-autofocus
              />
            </label>
            <p className="mt-1 text-[0.75rem] text-muted">
              Required. The buyer and the agency see this word for word.
            </p>

            {error && (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 text-[0.8125rem] text-error-text"
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy !== null || reason.trim().length === 0}
                onClick={() =>
                  run("decline", () => declineOrderItem(reference, item.slotIndex, reason.trim()))
                }
                className={cn(
                  button,
                  "h-10 border-transparent bg-error px-4 text-white hover:bg-error/90",
                )}
              >
                {busy === "decline" && <Loader2 size={13} className="animate-spin" aria-hidden />}
                {item.required ? "Decline and cancel the order" : "Decline this part"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setDialog(null)}
                className={cn(button, "h-10 border-ink/20 px-4 text-ink hover:border-ink")}
              >
                Keep it
              </button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  if (item.status !== "CONFIRMED") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setDialog("cancel")}
        className="mt-1 text-[0.75rem] text-muted underline-offset-4 transition-colors hover:text-error-text hover:underline"
      >
        Cancel this part
      </button>

      <Modal
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        title={`Cancel ${item.label}`}
        size="sm"
      >
        <div className="px-6 pt-4 pb-6">
          {/*
            A buyer is refused a required part (409 REQUIRED_COMPONENT) because
            keeping the discounted extras without the hotel is the arbitrage
            the package adjustment exists to prevent. Staff may override it, so
            the button is here — with the sentence that says what it is.
          */}
          {item.required && (
            <p className="mb-4 flex items-start gap-2.5 text-[0.875rem] text-body">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
              <span>
                This part is <span className="font-semibold text-ink">required</span>. A partner
                cannot drop it on its own; you can. The rest of the trip stays sold, and its share
                of the package discount is forfeited below.
              </span>
            </p>
          )}

          {line ? (
            <dl className="space-y-1.5 rounded-sm bg-surface-soft p-3 text-[0.8125rem]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Cancellation charge</dt>
                <dd className="font-medium text-ink tabular-nums">
                  {formatMoney(line.chargeCents, currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Refund to the buyer</dt>
                <dd className="font-medium text-ink tabular-nums">
                  {formatMoney(line.refundCents, currency)}
                </dd>
              </div>
              {line.clawbackCents > 0 && (
                <div className="flex justify-between gap-3 border-t border-line pt-1.5">
                  <dt className="text-muted">Discount forfeited</dt>
                  <dd className="tabular-nums text-body">
                    {formatMoney(line.clawbackCents, currency)}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-[0.8125rem] text-muted">
              Nothing is quoted for this part, so cancelling it charges nothing.
            </p>
          )}

          <label className="mt-5 block text-[0.8125rem] font-medium text-ink">
            Reason (optional)
            <textarea
              value={reason}
              rows={3}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              className={area}
            />
          </label>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 text-[0.8125rem] text-error-text"
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run("cancel", () =>
                  cancelOrderItemAsAdmin(reference, item.slotIndex, reason.trim() || undefined),
                )
              }
              className={cn(
                button,
                "h-10 border-transparent bg-error px-4 text-white hover:bg-error/90",
              )}
            >
              {busy === "cancel" && <Loader2 size={13} className="animate-spin" aria-hidden />}
              Cancel this part
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setDialog(null)}
              className={cn(button, "h-10 border-ink/20 px-4 text-ink hover:border-ink")}
            >
              Keep it
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
