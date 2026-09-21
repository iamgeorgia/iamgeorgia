"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ApiError } from "@/lib/api/client";
import { cancelOrder, cancelOrderItem } from "@/lib/api/orders";
import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { OrderCancellationQuote, OrderStatus } from "@/types/order";

interface CancelOrderProps {
  reference: string;
  /** A guest's proof. Omitted for a signed-in partner, where the session proves it. */
  email?: string;
  status: OrderStatus;
  currency: string;
  /** Priced by the server off the figures frozen onto the order. */
  quote: OrderCancellationQuote | null;
  /** When set, this cancels one part rather than the whole trip. */
  item?: { slotIndex: number; label: string; required: boolean };
}

/**
 * Cancelling a trip, or one part of it, with the price of doing so first.
 *
 * The clawback gets its own line and its own sentence. A buyer who cancels
 * the optional dinner from a discounted package will be refunded less than
 * the dinner's ticket price, and the reason — the discount was for booking
 * the trip whole — belongs on the screen where they decide, not in an email
 * afterwards.
 *
 * A required part cannot be dropped on its own by a buyer. That is a server
 * rule (409 `REQUIRED_COMPONENT`); rendering the explanation instead of a
 * button that will fail is the honest version of the same rule.
 */
export function CancelOrder({
  reference,
  email,
  status,
  currency,
  quote,
  item,
}: CancelOrderProps) {
  const router = useRouter();
  const { t, intlLocale } = useI18n();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.orders.errors | null>(null);

  const money = (cents: number) => formatMoney(cents, currency, intlLocale);

  if (done) {
    return (
      <div className="border border-line bg-surface p-6">
        <p className="type-body-sm flex items-start gap-2.5 text-body">
          <CircleCheck size={17} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <span>
            <span className="font-medium text-ink">
              {item ? t.orders.cancel.itemDoneTitle : t.orders.cancel.doneTitle}
            </span>
            <span className="mt-1 block text-muted">
              {item ? t.orders.cancel.itemDoneBody : t.orders.cancel.doneBody}
            </span>
          </span>
        </p>
      </div>
    );
  }

  if (status === "CANCELLED") {
    return (
      <div className="border border-line bg-surface p-6">
        <p className="type-body-sm text-muted">{t.orders.cancel.alreadyCancelled}</p>
      </div>
    );
  }

  if (status === "COMPLETED") {
    return (
      <div className="border border-line bg-surface p-6">
        <p className="type-body-sm text-muted">{t.booking.cancel.notCancellable}</p>
      </div>
    );
  }

  // A buyer cannot drop a required part on its own; say why rather than
  // offering a button the server will refuse.
  if (item?.required) {
    return (
      <div className="border border-line bg-surface p-4">
        <p className="type-body-sm font-medium text-ink">{t.orders.cancel.requiredPart}</p>
        <p className="type-caption mt-1 text-muted">{t.orders.cancel.requiredPartHint}</p>
      </div>
    );
  }

  const line = item
    ? (quote?.items.find((row) => row.slotIndex === item.slotIndex) ?? null)
    : null;
  const chargeCents = item ? (line?.chargeCents ?? 0) : (quote?.chargeCents ?? 0);
  const refundCents = item ? (line?.refundCents ?? 0) : (quote?.refundCents ?? 0);
  const clawbackCents = item
    ? (line?.clawbackCents ?? 0)
    : (quote?.items.reduce((sum, row) => sum + row.clawbackCents, 0) ?? 0);
  const free = chargeCents === 0;

  const confirm = async () => {
    setSubmitting(true);
    setErrorKey(null);

    try {
      if (item) {
        await cancelOrderItem(reference, item.slotIndex, {
          reason: reason.trim() || undefined,
          email,
        });
      } else {
        await cancelOrder(reference, { reason: reason.trim() || undefined, email });
      }

      setDone(true);
      setOpen(false);
      router.refresh();
    } catch (error) {
      const details = error instanceof ApiError ? (error.details as { reason?: string }) : undefined;

      setErrorKey(
        details?.reason === "REQUIRED_COMPONENT"
          ? "partOfOrder"
          : error instanceof ApiError
            ? "generic"
            : "generic",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="border border-line bg-surface p-6">
        <h2 className="type-h4">{item ? fill(t.orders.cancel.itemTitle, { label: item.label }) : t.orders.cancel.title}</h2>

        {quote ? (
          <dl className="mt-4 flex flex-col gap-2">
            <div className="type-body-sm flex items-baseline justify-between gap-4">
              <dt className="text-muted">{t.orders.cancel.charge}</dt>
              <dd className="tabular-nums text-ink">{money(chargeCents)}</dd>
            </div>
            <div className="type-body-sm flex items-baseline justify-between gap-4">
              <dt className="text-muted">{t.orders.cancel.refund}</dt>
              <dd className="tabular-nums text-ink">{money(refundCents)}</dd>
            </div>
            {clawbackCents > 0 && (
              <div className="type-caption mt-1 border-t border-line pt-2">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted">{t.orders.cancel.clawback}</dt>
                  <dd className="tabular-nums text-body">{money(clawbackCents)}</dd>
                </div>
                <p className="mt-1 text-muted">{t.orders.cancel.clawbackHint}</p>
              </div>
            )}
          </dl>
        ) : (
          <p className="type-body-sm mt-3 text-muted">{t.orders.cancel.pendingFree}</p>
        )}

        {free && quote && (
          <p className="type-body-sm mt-3 text-success">{t.orders.cancel.free}</p>
        )}

        <Button variant="outline" fullWidth className="mt-5" onClick={() => setOpen(true)}>
          {item ? t.orders.cancel.confirmItem : t.orders.cancel.confirm}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={item ? fill(t.orders.cancel.itemTitle, { label: item.label }) : t.orders.cancel.title}
      >
        <p className="type-body-sm flex items-start gap-2.5 text-body">
          <TriangleAlert size={17} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
          {t.orders.cancel.irreversible}
        </p>

        {quote && chargeCents > 0 && (
          <p className="type-body-sm mt-4 rounded-sm bg-surface-soft p-3 text-body">
            {t.orders.cancel.charge}:{" "}
            <span className="font-semibold tabular-nums text-ink">{money(chargeCents)}</span>
          </p>
        )}

        <label className="mt-5 block">
          <span className="type-caption mb-1.5 block text-muted">{t.orders.cancel.reason}</span>
          <textarea
            value={reason}
            rows={3}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-sm border border-line bg-background p-3 text-sm text-ink focus:border-ink focus:outline-none"
          />
        </label>

        {errorKey && (
          <p role="alert" className="type-body-sm mt-4 flex items-start gap-2 text-error-text">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
            {t.orders.errors[errorKey]}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => void confirm()} disabled={submitting}>
            {submitting
              ? t.orders.cancel.cancelling
              : item
                ? t.orders.cancel.confirmItem
                : t.orders.cancel.confirm}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            {t.orders.cancel.keep}
          </Button>
        </div>
      </Modal>
    </>
  );
}
