"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cancelBooking } from "@/lib/api/bookings";
import { bookingErrorKey } from "@/lib/booking/errors";
import { formatInstant } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { useI18n } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { CancellationQuote, HotelBookingStatus } from "@/types/booking";
import { BookingErrorText } from "@/components/booking/BookingErrorText";

interface CancelBookingProps {
  reference: string;
  /**
   * A guest's proof the booking is theirs. Omitted in the partner portal and
   * the admin panel, where the session already proves it and the server stops
   * looking at the email at all.
   */
  email?: string;
  status: HotelBookingStatus;
  /** Priced by the server off the schedule frozen onto the booking. */
  quote: CancellationQuote | null;
  /** The moment free cancellation ends, if it has not already. */
  freeUntil: string | null;
}

/**
 * Cancelling, with the price of doing so stated before the button.
 *
 * The figure comes from the server, which reads it off the cancellation
 * schedule frozen onto the booking at confirmation — not off the hotel's
 * current policy. What the guest is owed was settled when they booked, and a
 * property that has since tightened its terms cannot reach backwards.
 *
 * The confirmation dialog is not ceremony: releasing the rooms is immediate and
 * irreversible, and on a non-refundable rate it costs the whole stay.
 */
export function CancelBooking({
  reference,
  email,
  status,
  quote,
  freeUntil,
}: CancelBookingProps) {
  const router = useRouter();
  const { t, intlLocale } = useI18n();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.booking.errors | null>(null);

  if (done || status === "CANCELLED") {
    return (
      <div className="border border-line bg-surface p-6">
        <p className="type-body-sm flex items-start gap-2.5 text-body">
          <CircleCheck size={17} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <span>
            <span className="font-medium text-ink">
              {done ? t.booking.cancel.doneTitle : t.booking.cancel.alreadyCancelled}
            </span>
            {done && <span className="mt-1 block text-muted">{t.booking.cancel.doneBody}</span>}
          </span>
        </p>
      </div>
    );
  }

  // COMPLETED and NO_SHOW are past the point where a guest may act alone.
  if (status !== "CONFIRMED" && status !== "PENDING") {
    return (
      <div className="border border-line bg-surface p-6">
        <p className="type-body-sm text-muted">{t.booking.cancel.notCancellable}</p>
      </div>
    );
  }

  const free = quote !== null && quote.chargeCents === 0;

  const confirm = async () => {
    setSubmitting(true);
    setErrorKey(null);

    try {
      await cancelBooking(reference, { reason: reason.trim() || undefined, email });

      setDone(true);
      setOpen(false);
      // The booking record itself is server-rendered; re-fetch so the status,
      // the charge and the released rooms all update together.
      router.refresh();
    } catch (error) {
      setErrorKey(bookingErrorKey(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="border border-line bg-surface p-6">
        <h2 className="type-h4">{t.booking.cancel.title}</h2>

        {quote && (
          <dl className="mt-4 space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="type-body-sm text-muted">
                {free
                  ? t.booking.cancel.free
                  : fill(t.booking.cancel.charge, {
                      amount: formatMoney(quote.chargeCents, quote.currency, intlLocale),
                    })}
              </dt>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="type-body-sm text-muted">
                {quote.refundCents > 0
                  ? fill(t.booking.cancel.refund, {
                      amount: formatMoney(quote.refundCents, quote.currency, intlLocale),
                    })
                  : t.booking.cancel.noRefund}
              </dt>
            </div>
          </dl>
        )}

        {freeUntil && free && (
          <p className="type-caption mt-3 text-muted">
            {fill(t.booking.cancel.deadline, { date: formatInstant(freeUntil, intlLocale) })}
          </p>
        )}

        {errorKey && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-sm border border-error/30 bg-error/5 px-4 py-3 text-sm text-error-text"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <BookingErrorText errorKey={errorKey} />
          </p>
        )}

        <Button variant="outline" fullWidth className="mt-5" onClick={() => setOpen(true)}>
          {t.booking.cancel.confirm}
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t.booking.cancel.title} size="sm">
        <div className="px-6 pt-4 pb-6">
          <p className="type-body-sm flex items-start gap-2.5 text-body">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-warning-text" aria-hidden />
            {t.booking.cancel.irreversible}
          </p>

          {quote && !free && (
            <p className="type-body-sm mt-4 font-medium text-ink">
              {fill(t.booking.cancel.charge, {
                amount: formatMoney(quote.chargeCents, quote.currency, intlLocale),
              })}
            </p>
          )}

          <label className="mt-5 block">
            <span className="type-caption mb-1.5 block text-muted">{t.booking.cancel.reason}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-sm border border-line bg-background px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
            />
            <span className="type-caption mt-1 block text-subtle">
              {t.booking.cancel.reasonHint}
            </span>
          </label>

          {/* Side by side while both labels fit, stacked when a translation is
              too long for one row — decided by the text, not a breakpoint. */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="outline" className="grow" onClick={() => setOpen(false)} disabled={submitting}>
              {t.booking.cancel.keep}
            </Button>
            <Button className="grow" onClick={() => void confirm()} disabled={submitting}>
              {submitting ? t.booking.cancel.cancelling : t.booking.cancel.confirm}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
