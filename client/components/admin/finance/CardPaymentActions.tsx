"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";

import { FormError, NumberInput, SubmitButton, TextArea } from "@/components/admin/FormControls";
import { Modal } from "@/components/ui/Modal";
import { approvalHref } from "@/lib/admin/approvals";
import { ApiError, describeError } from "@/lib/api/client";
import { checkCardPaymentStatus, requestCardRefund } from "@/lib/api/payments";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import type { StaffPayment } from "@/types/payments";

const secondary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:pointer-events-none disabled:opacity-50";

interface CardPaymentActionsProps {
  payment: Pick<StaffPayment, "id" | "status" | "currency" | "refundableCents">;
  canCheck: boolean;
  canRefund: boolean;
}

/**
 * What staff can do to one card payment: ask the gateway what it thinks now,
 * and ask for a refund. A refund is only ever a request here — it opens an
 * approval, and the money moves after a second person approves it.
 */
export function CardPaymentActions({ payment, canCheck, canRefund }: CardPaymentActionsProps) {
  const router = useRouter();
  const path = useLocalePath();

  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(() => toMajorUnits(payment.refundableCents, payment.currency));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<{ id: string; reference: string } | null>(null);

  const refundable = payment.status === "APPROVED" && payment.refundableCents > 0;
  if (!canCheck && !(canRefund && refundable) && !sent) return null;

  const check = async () => {
    setChecking(true);
    setNotice(null);
    setCheckError(null);
    try {
      const result = await checkCardPaymentStatus(payment.id);
      setNotice(
        result.stale
          ? "The gateway did not answer in time; showing what we last knew."
          : result.changed
            ? `Status updated to ${result.status.toLowerCase().replace("_", " ")}.`
            : "No change: the gateway agrees with our record.",
      );
      router.refresh();
    } catch (caught) {
      setCheckError(describeError(caught));
    } finally {
      setChecking(false);
    }
  };

  const minor = toMinorUnits(amount || "0", payment.currency);
  const amountError =
    minor === null || minor <= 0
      ? "Enter an amount above zero."
      : minor > payment.refundableCents
        ? `At most ${formatMoney(payment.refundableCents, payment.currency)} can still be refunded.`
        : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (amountError || minor === null) return;

    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const approval = await requestCardRefund(payment.id, { amountCents: minor, reason: reason.trim() });
      setSent({ id: approval.id, reference: approval.reference });
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors());
        // The API's error code is not kept on ApiError; the shape of `details`
        // (the amount still refundable) identifies the 422 well enough.
        const left = (caught.details as { refundableCents?: number } | null | undefined)?.refundableCents;
        if (caught.status === 422 && typeof left === "number") {
          setError(`That is more than can be refunded. At most ${formatMoney(left, payment.currency)} is left.`);
          return;
        }
        if (caught.status === 409) {
          setError("This payment can no longer be refunded. Reload the page to see why.");
          return;
        }
      }
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canCheck && (
          <button type="button" onClick={check} disabled={checking} className={secondary}>
            <RefreshCw size={14} className={checking ? "animate-spin" : undefined} aria-hidden />
            Check status now
          </button>
        )}
        {canRefund && refundable && (
          <button
            type="button"
            onClick={() => {
              setAmount(toMajorUnits(payment.refundableCents, payment.currency));
              setError(null);
              setOpen(true);
            }}
            className={secondary}
          >
            <Undo2 size={14} aria-hidden />
            Request refund
          </button>
        )}
      </div>

      {notice && (
        <p role="status" className="text-[0.8125rem] text-muted">
          {notice}
        </p>
      )}
      <FormError message={checkError} />

      {sent && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-sm border border-success/40 bg-surface px-4 py-3 text-[0.8125rem] leading-relaxed text-body"
        >
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <span>
            Refund sent for approval as{" "}
            <Link
              href={path(approvalHref(sent.id))}
              prefetch={false}
              className="font-medium text-brand-text underline-offset-4 hover:underline"
            >
              {sent.reference}
            </Link>
            . The card is refunded only after someone else approves it.
          </span>
        </p>
      )}

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Request a card refund" size="sm">
        <form onSubmit={submit} noValidate>
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            The money goes back to the guest&apos;s card, but only after a second person approves this request.
            Up to {formatMoney(payment.refundableCents, payment.currency)} can still be refunded.
          </p>
          <div className="mt-4 space-y-4">
            <NumberInput
              label={`Amount (${payment.currency})`}
              step="0.01"
              min="0"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              error={fieldErrors.amountCents ?? (amount ? amountError : undefined)}
              data-autofocus
            />
            <TextArea
              label="Reason"
              rows={3}
              maxLength={500}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              hint="Whoever approves it will read this, and it is kept in the audit log."
              error={fieldErrors.reason}
            />
          </div>
          <FormError message={error} />
          <div className="mt-6 flex flex-wrap gap-2">
            <SubmitButton type="submit" busy={busy} disabled={Boolean(amountError) || reason.trim().length < 3}>
              Send for approval
            </SubmitButton>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className={secondary}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
