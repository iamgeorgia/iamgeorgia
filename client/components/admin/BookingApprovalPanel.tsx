"use client";

import { AlertTriangle, Ban, CheckCircle2, MinusCircle, ShieldQuestion, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { AdminDefinitionList, AdminPanel } from "@/components/admin/AdminPage";
import { useCan } from "@/components/admin/AdminViewerContext";
import { BookingApprovalDialogs, type BookingApprovalDecision } from "@/components/admin/BookingApprovalDialogs";
import { ReadOnlyNote } from "@/components/admin/ReadOnlyNote";
import { approvalStateHints, approvalStateLabels } from "@/lib/admin/bookingApprovals";
import { formatInstant } from "@/lib/admin/bookings";
import { cn } from "@/lib/utils";
import type { BookingApproval, BookingApprovalProduct, BookingApprovalState } from "@/types/booking";

/**
 * The Approval panel on a booking or order detail page.
 *
 * Renders nothing for a booking that never needed the platform's yes
 * (`approval` null). Otherwise it states where the decision stands and, while
 * it is still pending, offers the two buttons to whoever holds
 * `bookings.approve` — the same dialogs the queue uses, so the wording and
 * the refusals are one and the same.
 */

type Tone = "neutral" | "positive" | "attention" | "critical";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
};

const stateTones: Record<BookingApprovalState, { tone: Tone; icon: LucideIcon }> = {
  PENDING: { tone: "attention", icon: ShieldQuestion },
  APPROVED: { tone: "positive", icon: CheckCircle2 },
  REJECTED: { tone: "critical", icon: Ban },
  WITHDRAWN: { tone: "neutral", icon: MinusCircle },
};

export function ApprovalStateBadge({ state, className }: { state: BookingApprovalState; className?: string }) {
  const { tone, icon: Icon } = stateTones[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {approvalStateLabels[state]}
    </span>
  );
}

export function BookingApprovalPanel({
  product,
  reference,
  approval,
  partnerName,
}: {
  product: BookingApprovalProduct;
  reference: string;
  approval: BookingApproval | null;
  /** Named in the credit-limit refusal; absent for a direct booking. */
  partnerName?: string | null;
}) {
  const can = useCan();
  const [dialog, setDialog] = useState<BookingApprovalDecision | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!approval) return null;

  const pending = approval.state === "PENDING";
  const canApprove = can("bookings.approve");

  const button =
    "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors";

  return (
    <AdminPanel title="Approval" description={approvalStateHints[approval.state]}>
      <AdminDefinitionList
        items={[
          { label: "Decision", value: <ApprovalStateBadge state={approval.state} /> },
          { label: "Requested", value: formatInstant(approval.requestedAt) },
          ...(pending
            ? [
                {
                  label: "Answer due",
                  value: approval.deadlineAt ? (
                    <span className={cn(approval.overdue && "inline-flex items-center gap-1 text-error-text")}>
                      {approval.overdue && <AlertTriangle size={13} aria-hidden />}
                      {approval.overdue ? "overdue · " : ""}
                      {formatInstant(approval.deadlineAt)}
                    </span>
                  ) : (
                    "No deadline"
                  ),
                },
              ]
            : []),
          ...(approval.approvedAt
            ? [
                {
                  label: "Approved",
                  value: `${formatInstant(approval.approvedAt)}${approval.approvedBy ? ` by ${approval.approvedBy}` : ""}`,
                },
              ]
            : []),
          ...(approval.rejectedAt
            ? [
                {
                  label: "Rejected",
                  value: `${formatInstant(approval.rejectedAt)}${approval.rejectedBy ? ` by ${approval.rejectedBy}` : ""}`,
                },
              ]
            : []),
          ...(approval.reason ? [{ label: approval.state === "REJECTED" ? "Reason" : "Note", value: approval.reason }] : []),
        ]}
      />

      {pending && !canApprove && (
        <ReadOnlyNote needs="bookings.approve" what="Approving or rejecting this booking" className="mt-4" />
      )}

      {pending && canApprove && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setDialog("approve")}
            className={cn(button, "bg-brand text-white hover:bg-brand-hover")}
          >
            <CheckCircle2 size={15} aria-hidden />
            Approve
          </button>
          <button
            type="button"
            onClick={() => setDialog("reject")}
            className={cn(button, "border border-error/40 text-error-text hover:bg-error/8")}
          >
            <Ban size={15} aria-hidden />
            Reject
          </button>
        </div>
      )}

      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-[0.75rem] text-muted">
        {message}
      </p>

      <BookingApprovalDialogs
        product={product}
        reference={reference}
        partnerName={partnerName}
        open={dialog}
        onClose={() => setDialog(null)}
        onDone={setMessage}
      />
    </AdminPanel>
  );
}
