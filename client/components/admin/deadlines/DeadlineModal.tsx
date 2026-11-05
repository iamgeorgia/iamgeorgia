"use client";

import Link from "next/link";
import { ChevronDown, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { AdminDefinitionList } from "@/components/admin/AdminPage";
import { useCan } from "@/components/admin/AdminViewerContext";
import { FormError, SubmitButton, TextArea, TextInput } from "@/components/admin/FormControls";
import { ReadOnlyNote } from "@/components/admin/ReadOnlyNote";
import { DeadlineKindBadge, DeadlineStatusBadge } from "@/components/admin/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { approvalProductLabels, bookingApprovalHref } from "@/lib/admin/bookingApprovals";
import { formatInstant } from "@/lib/admin/bookings";
import {
  awaitingLabels,
  deadlineDueWords,
  deadlineKindHints,
  deadlineSourceLabels,
  formatDeadlineInstant,
  instantFromZoned,
  isDeadlineMovable,
  moveCapabilitiesFor,
  zonedParts,
} from "@/lib/admin/deadlines";
import { requestApproval } from "@/lib/api/approvals";
import { ApiError, describeError } from "@/lib/api/client";
import { getDeadlineClient, moveDeadline } from "@/lib/api/deadlines";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { Deadline, DeadlineHistoryEntry } from "@/types/deadline";

/**
 * One deadline, opened from a calendar chip or a booking's deadlines panel.
 *
 * The summary, a link to the booking, the history behind a disclosure, and
 * — for whoever may move this kind — the edit form. A PAYMENT deadline is
 * Finance's: `finance.adjustments.execute` moves it outright; a holder of
 * `finance.adjustments.request` is shown the same form, and when the server
 * answers 403 `APPROVAL_REQUIRED` the change is turned into an approval
 * request on the receivable rather than reported as a failure. The other
 * two kinds need `bookings.deadlines.write`.
 */

export type MoveOutcome = { kind: "moved"; deadline: Deadline } | { kind: "sent" };

export function DeadlineModal({
  deadline,
  today,
  onClose,
  onMoved,
}: {
  deadline: Deadline | null;
  today: string;
  onClose: () => void;
  /** The row after a move, so the list can redraw without a round trip. */
  onMoved: (outcome: MoveOutcome) => void;
}) {
  return (
    <Modal open={deadline !== null} onClose={onClose} title={deadline ? `${deadline.reference} · ${deadline.kind.toLowerCase().replace("_", " ")}` : "Deadline"} size="md">
      {deadline && <DeadlineModalBody key={deadline.id} deadline={deadline} today={today} onClose={onClose} onMoved={onMoved} />}
    </Modal>
  );
}

function DeadlineModalBody({
  deadline,
  today,
  onClose,
  onMoved,
}: {
  deadline: Deadline;
  today: string;
  onClose: () => void;
  onMoved: (outcome: MoveOutcome) => void;
}) {
  const can = useCan();
  const localePath = useLocalePath();
  const needs = moveCapabilitiesFor(deadline.kind);
  const mayEdit = can(...needs) && isDeadlineMovable(deadline.status);

  // The list rows carry no history; it is read once the dialog is open.
  const [history, setHistory] = useState<DeadlineHistoryEntry[] | null>(deadline.history ?? null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    if (history !== null) return;
    let stale = false;
    getDeadlineClient(deadline.id)
      .then((full) => {
        if (!stale) setHistory(full.history ?? []);
      })
      .catch(() => {
        if (!stale) setHistory([]);
      });
    return () => {
      stale = true;
    };
  }, [deadline.id, history]);

  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState(false);

  const bookingHref = localePath(bookingApprovalHref(deadline.product, deadline.reference));
  const receivableHref =
    deadline.receivableId && can("finance.receivables.read")
      ? localePath(`/admin/finance/receivables/${deadline.receivableId}`)
      : null;

  return (
    <div className="px-6 pt-4 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <DeadlineKindBadge kind={deadline.kind} overdue={deadline.overdue} />
        <DeadlineStatusBadge status={deadline.status} />
        {deadline.overdue && <span className="text-[0.75rem] font-medium text-error-text">{deadlineDueWords(deadline, today)}</span>}
      </div>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted">{deadlineKindHints[deadline.kind]}</p>

      <div className="mt-5">
        <AdminDefinitionList
          items={[
            { label: "Due", value: formatDeadlineInstant(deadline.dueAt, deadline.timezone) },
            { label: "When", value: deadlineDueWords(deadline, today) },
            {
              label: "Booking",
              value: (
                <Link href={bookingHref} prefetch={false} className="text-ink underline-offset-4 hover:underline">
                  {deadline.reference}
                </Link>
              ),
            },
            { label: "Product", value: approvalProductLabels[deadline.product] },
            ...(deadline.title ? [{ label: "What", value: deadline.title }] : []),
            ...(deadline.leadName ? [{ label: "Lead", value: deadline.leadName }] : []),
            ...(deadline.partner
              ? [
                  {
                    label: "Partner",
                    value: (
                      <Link href={localePath(`/admin/partners/${deadline.partner.id}`)} prefetch={false} className="text-ink underline-offset-4 hover:underline">
                        {deadline.partner.name}
                      </Link>
                    ),
                  },
                ]
              : deadline.customer
                ? [
                    {
                      label: "Customer",
                      value: (
                        <Link href={localePath(`/admin/customers/${deadline.customer.id}`)} prefetch={false} className="text-ink underline-offset-4 hover:underline">
                          {deadline.customer.name}
                        </Link>
                      ),
                    },
                  ]
                : []),
            ...(deadline.assignedManager ? [{ label: "Manager", value: deadline.assignedManager.name }] : []),
            ...(deadline.kind === "CONFIRMATION" && deadline.meta.awaiting
              ? [{ label: "Waiting on", value: awaitingLabels[deadline.meta.awaiting] }]
              : []),
            { label: "Source", value: deadlineSourceLabels[deadline.source] },
            ...(deadline.completedAt ? [{ label: "Closed", value: formatInstant(deadline.completedAt) }] : []),
          ]}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href={bookingHref}
          prefetch={false}
          className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
        >
          Open booking
        </Link>
        {receivableHref && (
          <Link href={receivableHref} prefetch={false} className="text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline">
            Open receivable
          </Link>
        )}
        {mayEdit && !editing && !sent && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ms-auto inline-flex h-10 items-center rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Edit deadline
          </button>
        )}
      </div>

      {sent && (
        <p role="status" className="mt-5 flex items-start gap-2 rounded-sm border border-info/40 bg-info/8 px-4 py-3 text-[0.8125rem] leading-relaxed text-ink">
          <Send size={15} className="mt-0.5 shrink-0 text-info" aria-hidden />
          Sent for approval. The due date changes when a second person approves the request; nothing has moved yet.
        </p>
      )}

      {editing && (
        <DeadlineEditForm
          deadline={deadline}
          onCancel={() => setEditing(false)}
          onDone={(outcome) => {
            setEditing(false);
            if (outcome.kind === "sent") setSent(true);
            else {
              setHistory(outcome.deadline.history ?? null);
              onMoved(outcome);
              onClose();
            }
          }}
        />
      )}

      {!mayEdit && isDeadlineMovable(deadline.status) && (
        <ReadOnlyNote className="mt-5" needs={needs} what="Moving this deadline" />
      )}

      <div className="mt-6 border-t border-line pt-4">
        <button
          type="button"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-2 text-[0.8125rem] font-semibold text-ink"
        >
          History{history ? ` (${history.length})` : ""}
          <ChevronDown size={15} aria-hidden className={cn("text-muted transition-transform", historyOpen && "rotate-180")} />
        </button>
        {historyOpen && (
          <div className="mt-3">
            {history === null ? (
              <p className="flex items-center gap-2 text-[0.8125rem] text-muted">
                <Loader2 size={14} className="animate-spin" aria-hidden /> Loading…
              </p>
            ) : history.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">Never moved: the date is the one the system set.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {history.map((entry) => (
                  <li key={entry.id} className="text-[0.8125rem] leading-relaxed">
                    <p className="text-ink">
                      {entry.fromAt ? `${formatDeadlineInstant(entry.fromAt, deadline.timezone, false)} → ` : "Set to "}
                      <span className="font-medium">{formatDeadlineInstant(entry.toAt, deadline.timezone, false)}</span>
                    </p>
                    <p className="text-muted">
                      {deadlineSourceLabels[entry.source]}
                      {entry.changedBy ? ` by ${entry.changedBy}` : ""} · {formatInstant(entry.at)}
                      {entry.reason ? ` — ${entry.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The move itself. The new moment is typed as a wall clock in the deadline's
 * own zone — "free cancellation until 18:00, hotel time" — and turned into an
 * instant here; the server never sees a browser's zone.
 */
function DeadlineEditForm({
  deadline,
  onCancel,
  onDone,
}: {
  deadline: Deadline;
  onCancel: () => void;
  onDone: (outcome: MoveOutcome) => void;
}) {
  const current = zonedParts(deadline.dueAt, deadline.timezone);
  const [date, setDate] = useState(current.date);
  const [time, setTime] = useState(current.time);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    const local: Record<string, string> = {};
    if (!date) local.dueAt = "Choose a date.";
    if (!trimmed) local.reason = "Say why the deadline is moving: it goes in the history and the audit log.";
    setFieldErrors(local);
    if (Object.keys(local).length > 0) return;

    const dueAt = instantFromZoned(date, time || "00:00", deadline.timezone);
    setBusy(true);
    setError(null);
    try {
      const moved = await moveDeadline(deadline.id, { dueAt, reason: trimmed });
      onDone({ kind: "moved", deadline: moved });
    } catch (failure) {
      const details = failure instanceof ApiError ? (failure.details as { reason?: string; receivableId?: string } | undefined) : undefined;
      if (failure instanceof ApiError && failure.status === 403 && details?.reason === "APPROVAL_REQUIRED") {
        // Finance's second-person rule: the same change, as a request for someone else to approve.
        try {
          await requestApproval({
            kind: "RECEIVABLE_DUE_DATE",
            subjectId: details.receivableId ?? deadline.receivableId ?? undefined,
            payload: { dueAt, reason: trimmed },
          });
          onDone({ kind: "sent" });
          return;
        } catch (second) {
          if (second instanceof ApiError) setFieldErrors(second.fieldErrors());
          setError(describeError(second, "The approval request could not be raised."));
          return;
        } finally {
          setBusy(false);
        }
      }
      if (failure instanceof ApiError) setFieldErrors(failure.fieldErrors());
      setError(describeError(failure, "The deadline could not be moved."));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 rounded-sm border border-line bg-surface-soft/40 p-4">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Times are in the booking&apos;s own zone, <span className="font-medium text-ink">{deadline.timezone}</span>.
        {deadline.kind === "PAYMENT" && " A payment deadline moves the receivable's due date; without the executing capability it becomes an approval request."}
        {deadline.kind === "FREE_CANCELLATION" && " Moving the free-cancellation moment rewrites what cancelling costs from that moment on."}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextInput label="New date" type="date" value={date} onChange={(event) => setDate(event.target.value)} error={fieldErrors.dueAt} required />
        <TextInput label="Time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
      </div>
      <TextArea
        label="Reason"
        className="mt-4"
        rows={2}
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        error={fieldErrors.reason}
        hint="Kept with the deadline's history and the audit log."
        required
      />
      <FormError message={error} />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft disabled:opacity-50"
        >
          Cancel
        </button>
        <SubmitButton type="submit" busy={busy}>
          Move deadline
        </SubmitButton>
      </div>
    </form>
  );
}
