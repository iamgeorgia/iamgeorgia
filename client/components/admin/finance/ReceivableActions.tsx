"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, FileX2, Loader2, NotebookPen, Undo2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { FormError, SubmitButton, TextArea, TextInput } from "@/components/admin/FormControls";
import { Modal } from "@/components/ui/Modal";
import { ApiError } from "@/lib/api/client";
import { adjustReceivable } from "@/lib/api/finance";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AdjustReceivableInput, Receivable } from "@/types/finance";

import { dueEndOf, financeErrorMessage, receivableDebtorName, tbilisiDay } from "./PaymentFormat";
import { RecordPaymentButton } from "./RecordPaymentModal";

type Dialog = "due" | "waive" | "notes" | null;

const secondary =
  "inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink";

/**
 * What Finance can do to one receivable: take a payment against it, refund
 * what is due back after a cancellation, give the buyer more time on this one
 * booking (owner decision D5 — the partner's own payment days stay as they
 * are), write off what is left, or keep a note. Every change but a payment
 * asks for a reason, which the server keeps in the audit log.
 */
export function ReceivableActions({ receivable }: { receivable: Receivable }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const open = receivable.status === "OPEN" || receivable.status === "PARTIAL";
  const label = `${receivable.reference} · ${receivableDebtorName(receivable)}`;
  const counterparty = {
    partnerId: receivable.debtor.partner?.id ?? null,
    partnerName: receivable.debtor.partner?.name ?? null,
    name: receivable.debtor.name,
    email: receivable.debtor.email,
  };

  return (
    <AdminPanel title="Actions">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:flex-col">
        {open && receivable.outstandingCents > 0 && (
          <RecordPaymentButton
            preset={{
              direction: "IN",
              kind: "PAYMENT",
              currency: receivable.currency,
              amountCents: receivable.outstandingCents,
              allocations: [{ receivableId: receivable.id, amountCents: receivable.outstandingCents, label }],
              counterparty,
            }}
          />
        )}

        {receivable.refundDueCents > 0 && (
          <RecordPaymentButton
            variant="secondary"
            label={`Refund ${formatMoney(receivable.refundDueCents, receivable.currency)}`}
            title="Record a refund to the buyer"
            preset={{
              direction: "OUT",
              kind: "REFUND",
              currency: receivable.currency,
              amountCents: receivable.refundDueCents,
              allocations: [{ receivableId: receivable.id, amountCents: receivable.refundDueCents, label }],
              counterparty,
            }}
          />
        )}

        {open && (
          <button type="button" onClick={() => setDialog("due")} className={secondary}>
            <CalendarClock size={15} aria-hidden />
            Change due date
          </button>
        )}

        <button type="button" onClick={() => setDialog("notes")} className={secondary}>
          <NotebookPen size={15} aria-hidden />
          {receivable.notes ? "Edit note" : "Add a note"}
        </button>

        {open && receivable.outstandingCents > 0 && (
          <button
            type="button"
            onClick={() => setDialog("waive")}
            className={cn(secondary, "text-error-text hover:border-error/60 hover:text-error-text")}
          >
            <FileX2 size={15} aria-hidden />
            Write off
          </button>
        )}
      </div>

      {!open && receivable.refundDueCents === 0 && (
        <p className="mt-4 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-muted">
          <Undo2 size={14} className="mt-0.5 shrink-0" aria-hidden />
          Nothing is left to collect on this receivable.
        </p>
      )}

      <Modal open={dialog === "due"} onClose={() => setDialog(null)} title="Change the due date" size="sm">
        {dialog === "due" && <DueDateForm receivable={receivable} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === "waive"} onClose={() => setDialog(null)} title="Write off what is left" size="sm">
        {dialog === "waive" && <WriteOffForm receivable={receivable} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal
        open={dialog === "notes"}
        onClose={() => setDialog(null)}
        title={receivable.notes ? "Edit the note" : "Add a note"}
        size="sm"
      >
        {dialog === "notes" && <NotesForm receivable={receivable} onClose={() => setDialog(null)} />}
      </Modal>
    </AdminPanel>
  );
}

/** The shared submit routine: PATCH, refresh, close — or show what was refused. */
function useAdjust(receivable: Receivable, onClose: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const run = async (body: AdjustReceivableInput) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await adjustReceivable(receivable.id, body);
      router.refresh();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(financeErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, fieldErrors, run };
}

function DialogButtons({
  busy,
  disabled,
  onClose,
  children,
  danger,
}: {
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {danger ? (
        // Not `SubmitButton`: `cn` does not merge classes, so its brand
        // background cannot be overridden from outside.
        <button
          type="submit"
          disabled={busy || disabled}
          className="inline-flex h-10 items-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {children}
        </button>
      ) : (
        <SubmitButton type="submit" busy={busy} disabled={disabled}>
          {children}
        </SubmitButton>
      )}
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
      >
        Cancel
      </button>
    </div>
  );
}

function DueDateForm({ receivable, onClose }: { receivable: Receivable; onClose: () => void }) {
  const [day, setDay] = useState(receivable.dueAt ? tbilisiDay(receivable.dueAt) : "");
  const [reason, setReason] = useState("");
  const { busy, error, fieldErrors, run } = useAdjust(receivable, onClose);

  const ready = Boolean(day) && reason.trim().length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void run({ dueAt: dueEndOf(day), reason: reason.trim() });
      }}
      className="px-6 pt-4 pb-6"
    >
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Gives {receivableDebtorName(receivable)} more (or less) time on this one item. Their usual
        payment days, set on the partner&apos;s page, do not change.
      </p>

      <div className="mt-5 grid gap-4">
        <TextInput
          label="New due date"
          type="date"
          value={day}
          onChange={(event) => setDay(event.target.value)}
          required
          hint="Due by the end of that day, Tbilisi time."
          error={fieldErrors.dueAt || undefined}
        />
        <TextArea
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          required
          placeholder="Agreed with the agency by phone on 9 October"
          error={fieldErrors.reason || undefined}
        />
      </div>

      <FormError message={error} />
      <DialogButtons busy={busy} disabled={!ready} onClose={onClose}>
        Save due date
      </DialogButtons>
    </form>
  );
}

function WriteOffForm({ receivable, onClose }: { receivable: Receivable; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, fieldErrors, run } = useAdjust(receivable, onClose);

  const ready = reason.trim().length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void run({ waive: true, reason: reason.trim() });
      }}
      className="px-6 pt-4 pb-6"
    >
      <p className="flex items-start gap-2 rounded-sm border border-error/40 bg-surface px-4 py-3 text-[0.8125rem] leading-relaxed text-error-text">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          {formatMoney(receivable.outstandingCents, receivable.currency)} will no longer be owed by{" "}
          {receivableDebtorName(receivable)}. What was already paid stays recorded. This cannot be
          undone from here.
        </span>
      </p>

      <TextArea
        className="mt-5"
        label="Reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        maxLength={500}
        required
        placeholder="Goodwill gesture agreed by management"
        error={fieldErrors.reason || undefined}
      />

      <FormError message={error} />
      <DialogButtons busy={busy} disabled={!ready} onClose={onClose} danger>
        Write off {formatMoney(receivable.outstandingCents, receivable.currency)}
      </DialogButtons>
    </form>
  );
}

function NotesForm({ receivable, onClose }: { receivable: Receivable; onClose: () => void }) {
  const [notes, setNotes] = useState(receivable.notes ?? "");
  const [reason, setReason] = useState("");
  const { busy, error, fieldErrors, run } = useAdjust(receivable, onClose);

  const changed = notes.trim() !== (receivable.notes ?? "");
  const ready = changed && reason.trim().length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void run({ notes: notes.trim() || null, reason: reason.trim() });
      }}
      className="px-6 pt-4 pb-6"
    >
      <div className="grid gap-4">
        <TextArea
          label="Note"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          maxLength={2000}
          hint="For Finance only — the buyer never sees it. Leave empty to remove it."
          error={fieldErrors.notes || undefined}
        />
        <TextInput
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          required
          placeholder="Why the note changed"
          error={fieldErrors.reason || undefined}
        />
      </div>

      <FormError message={error} />
      <DialogButtons busy={busy} disabled={!ready} onClose={onClose}>
        Save note
      </DialogButtons>
    </form>
  );
}
