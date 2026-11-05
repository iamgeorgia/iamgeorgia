"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { ApiError, describeError } from "@/lib/api/client";
import { approveBooking, rejectBooking } from "@/lib/api/bookingApprovals";
import { cn } from "@/lib/utils";
import type { BookingApprovalProduct } from "@/types/booking";

/**
 * The two decisions on a booking awaiting approval, as dialogs.
 *
 * One component for the queue and for the detail panels, so the sentence an
 * operator reads before saying yes is the same on both screens. Approving is
 * a confirm step, because it is the moment the supplier is told and the
 * invoice issues; rejecting asks for a reason, because the buyer reads it.
 *
 * After either decision the caller refreshes the route: the server's answer
 * is the product's own detail JSON, and the page re-renders from the server
 * rather than patching a row by hand.
 */

export type BookingApprovalDecision = "approve" | "reject";

export interface BookingApprovalDialogsProps {
  product: BookingApprovalProduct;
  reference: string;
  /** For the credit-limit refusal, which names the partner. */
  partnerName?: string | null;
  open: BookingApprovalDecision | null;
  onClose: () => void;
  /** Called after the server said yes, with the line to show the operator. */
  onDone: (message: string) => void;
}

/**
 * The wording for a refusal. The server's codes travel in `details.reason`,
 * as the capability refusals do; anything else falls back to its message.
 */
export function describeApprovalError(error: unknown, partnerName?: string | null): string {
  if (error instanceof ApiError) {
    const details = (error.details ?? {}) as { reason?: unknown; code?: unknown; message?: unknown };
    const code = typeof details.reason === "string" ? details.reason : typeof details.code === "string" ? details.code : null;

    if (error.status === 422 && code === "CREDIT_LIMIT_EXCEEDED") {
      const who = partnerName ? partnerName : "this partner";
      const why = typeof details.message === "string" ? details.message : error.message;
      return `This would take ${who} past its credit limit. ${why}`.trim();
    }
    if (error.status === 409) {
      switch (code) {
        case "NOT_PENDING_APPROVAL":
          return "Somebody has already answered this one. The page has been refreshed.";
        case "STATUS_CHANGED":
          return "The booking changed while you were deciding. The page has been refreshed.";
        case "PART_OF_ORDER":
          return "This booking is part of an order. Approve or reject the order instead.";
        default:
          break;
      }
    }
  }
  return describeError(error, "Could not record the decision. Try again.");
}

const button =
  "inline-flex h-10 items-center justify-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
const area =
  "mt-1.5 w-full rounded-sm border border-line bg-background p-3 text-[0.8125rem] text-ink outline-none focus:border-ink";

export function BookingApprovalDialogs({
  product,
  reference,
  partnerName,
  open,
  onClose,
  onDone,
}: BookingApprovalDialogsProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const run = async (call: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);

    try {
      await call();
      setNote("");
      setReason("");
      onDone(message);
      onClose();
      router.refresh();
    } catch (caught) {
      setError(describeApprovalError(caught, partnerName));
      // A 409 means the row is stale: refresh so the operator sees why.
      if (caught instanceof ApiError && caught.status === 409) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const failure = error && (
    <p role="alert" className="mt-4 flex items-start gap-2 text-[0.8125rem] text-error-text">
      <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
      {error}
    </p>
  );

  return (
    <>
      <Modal open={open === "approve"} onClose={close} title={`Approve ${reference}?`} size="sm">
        <p className="text-[0.875rem] text-body">
          The booking is confirmed, the supplier is told and the invoice issues. This cannot be
          taken back without cancelling.
        </p>

        <label className="mt-5 block text-[0.8125rem] font-medium text-ink">
          Note (optional)
          <textarea
            value={note}
            rows={2}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            className={area}
          />
        </label>

        {failure}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => approveBooking(product, reference, note), `${reference} approved. The supplier has been told.`)
            }
            className={cn(button, "bg-brand text-white hover:bg-brand-hover")}
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className={cn(button, "border border-ink/20 text-ink hover:border-ink")}
          >
            Not yet
          </button>
        </div>
      </Modal>

      <Modal open={open === "reject"} onClose={close} title={`Reject ${reference}`} size="sm">
        <p className="text-[0.875rem] text-body">
          Whatever is held is released and the buyer is told. Nothing is charged.
        </p>

        <label className="mt-5 block text-[0.8125rem] font-medium text-ink">
          Why it cannot go ahead
          <textarea
            value={reason}
            rows={3}
            maxLength={500}
            required
            onChange={(event) => setReason(event.target.value)}
            className={area}
          />
        </label>
        <p className="mt-1 text-[0.75rem] text-muted">Required. The buyer and the agency read this word for word.</p>

        {failure}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || reason.trim().length === 0}
            onClick={() =>
              void run(() => rejectBooking(product, reference, reason), `${reference} rejected. The buyer has been told.`)
            }
            className={cn(button, "bg-error text-white hover:bg-error/90")}
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <XCircle size={15} aria-hidden />}
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className={cn(button, "border border-ink/20 text-ink hover:border-ink")}
          >
            Keep it
          </button>
        </div>
      </Modal>
    </>
  );
}
