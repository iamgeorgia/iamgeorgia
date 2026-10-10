"use client";

import { useRouter } from "next/navigation";
import { Ban, Banknote, NotebookPen, PenLine, RotateCcw } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "../AdminPage";
import { FormError, NumberInput, SelectInput, SubmitButton, TextArea, TextInput } from "../FormControls";
import { formatPayableDate, paidOnToInstant, todayInTbilisi, UNSETTLED } from "./PayableFormat";
import { Modal } from "@/components/ui/Modal";
import { instalmentKindLabels, paymentMethodLabels } from "@/lib/admin/finance";
import { describeError } from "@/lib/api/client";
import { adjustPayable, newIdempotencyKey, payInstalment } from "@/lib/api/finance";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Instalment, Payable, PaymentMethod } from "@/types/finance";

type Dialog = { kind: "pay"; sequence: number } | { kind: "override" } | { kind: "waive" } | { kind: "notes" } | null;

const METHODS: PaymentMethod[] = ["BANK_TRANSFER", "CASH", "CARD", "OTHER"];

const secondary =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60";
const danger =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8 disabled:opacity-60";
const cancelButton =
  "inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60";

/** What paying an instalment needs to know about its payable — the detail page passes the whole record, the overview a slice. */
export type PayablePayFields = Pick<Payable, "id" | "currency" | "bookingReference" | "timezone" | "supplier">;

const supplierOf = (payable: Pick<Payable, "supplier">) => payable.supplier?.name ?? "the supplier";

/**
 * What Finance can do to one payable: pay an instalment, set the amount owed
 * by hand (or hand it back to the supplier's terms), write off what is left,
 * and keep notes.
 *
 * Rendered only for a viewer with `finance.payments.write`, and never for a
 * written-off payable — the server refuses both anyway, and its message is
 * what lands in the dialog when it refuses something else. After every
 * success the page is refreshed rather than patched, so the figures on screen
 * are always the server's.
 */
/** `adjustWithoutApproval` is false for someone who must ask for approval instead of overriding or writing off. */
export function PayableActions({
  payable,
  adjustWithoutApproval = true,
}: {
  payable: Payable;
  adjustWithoutApproval?: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (payable.status === "WAIVED") return null;

  const close = () => setDialog(null);

  const done = (text: string) => {
    setDialog(null);
    setMessage(text);
    router.refresh();
  };

  const openInstalments = payable.instalments.filter(
    (instalment) => UNSETTLED.includes(instalment.status) && instalment.outstandingCents > 0,
  );
  const paying = dialog?.kind === "pay" ? payable.instalments.find((entry) => entry.sequence === dialog.sequence) : undefined;

  return (
    <AdminPanel title="Actions">
      <div className="space-y-2.5">
        {openInstalments.map((instalment) => (
          <button
            key={instalment.id}
            type="button"
            onClick={() => {
              setMessage(null);
              setDialog({ kind: "pay", sequence: instalment.sequence });
            }}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <Banknote size={15} className="shrink-0" aria-hidden />
            <span>
              Pay the {instalmentKindLabels[instalment.kind].toLowerCase()} ·{" "}
              <span className="tabular-nums">{formatMoney(instalment.outstandingCents, payable.currency)}</span>
            </span>
          </button>
        ))}

        {openInstalments.length === 0 && (
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            {payable.status === "PAID"
              ? "Every instalment is paid."
              : payable.status === "VOID"
                ? "Nothing is owed to the supplier for this booking."
                : "No instalment is open for payment."}
          </p>
        )}

        <div className="space-y-2.5 border-t border-line pt-4">
          {adjustWithoutApproval && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setDialog({ kind: "override" });
            }}
            className={secondary}
          >
            <PenLine size={15} aria-hidden />
            Set the amount owed by hand
          </button>
          )}

          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setDialog({ kind: "notes" });
            }}
            className={secondary}
          >
            <NotebookPen size={15} aria-hidden />
            {payable.notes ? "Edit notes" : "Add a note"}
          </button>

          {adjustWithoutApproval && payable.outstandingCents > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setDialog({ kind: "waive" });
              }}
              className={danger}
            >
              <Ban size={15} aria-hidden />
              Write off what is left
            </button>
          )}
        </div>
      </div>

      <p aria-live="polite" className="mt-4 text-[0.8125rem] leading-relaxed text-muted empty:hidden">
        {message}
      </p>

      <Modal open={Boolean(paying)} onClose={close} title="Record payment to supplier" size="md">
        {paying && <PayForm payable={payable} instalment={paying} onClose={close} onDone={done} />}
      </Modal>

      <Modal open={dialog?.kind === "override"} onClose={close} title="Set the amount owed by hand" size="md">
        {dialog?.kind === "override" && <OverrideForm payable={payable} onClose={close} onDone={done} />}
      </Modal>

      <Modal open={dialog?.kind === "waive"} onClose={close} title="Write off what is left" size="md">
        {dialog?.kind === "waive" && <WaiveForm payable={payable} onClose={close} onDone={done} />}
      </Modal>

      <Modal open={dialog?.kind === "notes"} onClose={close} title="Notes" size="md">
        {dialog?.kind === "notes" && <NotesForm payable={payable} onClose={close} onDone={done} />}
      </Modal>
    </AdminPanel>
  );
}

interface FormProps {
  payable: Payable;
  onClose: () => void;
  onDone: (message: string) => void;
}

function CancelButton({ onClose, busy }: { onClose: () => void; busy: boolean }) {
  return (
    <button type="button" onClick={onClose} disabled={busy} className={cancelButton}>
      Cancel
    </button>
  );
}

/**
 * Paying one instalment.
 *
 * Mounted only while the dialog is open, and the idempotency key is chosen
 * once on mount: a retry after a dropped connection sends the same key, so a
 * payment the server did record answers with that record instead of paying
 * the supplier twice. Closing and reopening the dialog is a new payment.
 */
export function PayForm({
  payable,
  instalment,
  onClose,
  onDone,
}: Omit<FormProps, "payable"> & { payable: PayablePayFields; instalment: Instalment }) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const today = todayInTbilisi();

  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState(toMajorUnits(instalment.outstandingCents, payable.currency));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setAmountError(undefined);
    setDateError(undefined);

    const cents = toMinorUnits(amount, payable.currency);
    if (cents === null || cents <= 0) {
      setAmountError("Enter an amount above zero.");
      return;
    }
    if (cents > instalment.outstandingCents) {
      setAmountError(`At most ${formatMoney(instalment.outstandingCents, payable.currency)} is left on this instalment.`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
      setDateError("Choose the day the money went out.");
      return;
    }
    if (paidOn > today) {
      setDateError("A payment cannot be dated in the future.");
      return;
    }

    setBusy(true);

    try {
      const { replayed } = await payInstalment(
        payable.id,
        instalment.sequence,
        {
          method,
          paidAt: paidOnToInstant(paidOn),
          amountCents: cents,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        },
        idempotencyKey,
      );
      onDone(
        replayed
          ? "That payment had already been recorded. Nothing was paid twice."
          : `Recorded ${formatMoney(cents, payable.currency)} paid to ${supplierOf(payable)}.`,
      );
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      <div className="rounded-sm border border-line bg-surface-soft px-4 py-3 text-[0.8125rem]">
        <p className="font-medium text-ink">
          {instalmentKindLabels[instalment.kind]} for {payable.bookingReference}
        </p>
        <p className="mt-1 text-muted">
          <span className="tabular-nums">{formatMoney(instalment.outstandingCents, payable.currency)}</span> left of{" "}
          <span className="tabular-nums">{formatMoney(instalment.amountCents, payable.currency)}</span>
          {instalment.dueAt ? ` · due ${formatPayableDate(instalment.dueAt, payable.timezone)}` : " · no due date"}
        </p>
      </div>

      <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
        Record money that has already gone out to {supplierOf(payable)}. This does not send anything — it
        writes down a payment made by bank, cash or card.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SelectInput
          label="Paid by"
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          options={METHODS.map((value) => ({ value, label: paymentMethodLabels[value] }))}
        />
        <TextInput
          label="Paid on"
          type="date"
          value={paidOn}
          max={today}
          onChange={(event) => setPaidOn(event.target.value)}
          required
          error={dateError}
        />
        <NumberInput
          label={`Amount (${payable.currency})`}
          value={amount}
          min={0}
          step="0.01"
          onChange={(event) => setAmount(event.target.value)}
          required
          hint="Less than what is left records a part payment; the rest stays open."
          error={amountError}
          className="sm:col-span-2"
        />
        <TextInput
          label="Reference (optional)"
          value={reference}
          maxLength={120}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Bank transfer number"
          className="sm:col-span-2"
        />
        <TextArea
          label="Note (optional)"
          value={note}
          maxLength={1000}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
          className="sm:col-span-2"
        />
      </div>

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton type="submit" busy={busy}>
          Record payment
        </SubmitButton>
        <CancelButton onClose={onClose} busy={busy} />
      </div>
    </form>
  );
}

/**
 * Finance's own figure for what the supplier is owed. It survives every later
 * recalculation until it is handed back, which puts the supplier's rules in
 * charge again. Both need a reason; it goes to the audit log.
 */
function OverrideForm({ payable, onClose, onDone }: FormProps) {
  const overridden = payable.amountOverrideCents !== null;
  const [amount, setAmount] = useState(toMajorUnits(payable.amountCents, payable.currency));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"set" | "release" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | undefined>();
  const [reasonError, setReasonError] = useState<string | undefined>();

  const original = formatMoney(payable.originalAmountCents, payable.currency);

  const checkReason = () => {
    if (reason.trim()) return true;
    setReasonError("Say why. The reason is kept with the change.");
    return false;
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setAmountError(undefined);
    setReasonError(undefined);

    const cents = toMinorUnits(amount, payable.currency);
    if (cents === null || cents < 0) {
      setAmountError("Enter an amount of zero or more.");
      return;
    }
    if (cents > payable.originalAmountCents) {
      setAmountError(`At most ${original}, what the booking was worth to the supplier.`);
      return;
    }
    if (!checkReason()) return;

    setBusy("set");
    try {
      await adjustPayable(payable.id, { amountOverrideCents: cents, reason: reason.trim() });
      onDone(`The supplier is now owed ${formatMoney(cents, payable.currency)}, set by hand.`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const release = async () => {
    setError(null);
    setReasonError(undefined);
    if (!checkReason()) return;

    setBusy("release");
    try {
      await adjustPayable(payable.id, { amountOverrideCents: null, reason: reason.trim() });
      onDone("Handed back to the supplier's terms. The amount has been worked out again from their rules.");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={save} className="px-6 pt-4 pb-6">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Replace what the supplier&apos;s terms say with your own figure — after a cancellation decided by hand, or
        a deal agreed with the supplier. It stays as you set it when the booking changes later, until you hand it
        back. The instalments are worked out again to match.
      </p>

      {overridden && (
        <p className="mt-3 rounded-sm bg-surface-soft p-3 text-[0.8125rem] leading-relaxed text-body">
          Set by hand at {formatMoney(payable.amountOverrideCents!, payable.currency)}
          {payable.overrideReason ? ` — “${payable.overrideReason}”` : ""}.
        </p>
      )}

      <div className="mt-5 grid gap-4">
        <NumberInput
          label={`Amount owed (${payable.currency})`}
          value={amount}
          min={0}
          step="0.01"
          onChange={(event) => setAmount(event.target.value)}
          required
          hint={`At most ${original}. Below what has already been paid, the difference shows as a refund due from the supplier.`}
          error={amountError}
        />
        <TextArea
          label="Reason"
          value={reason}
          maxLength={500}
          rows={2}
          onChange={(event) => setReason(event.target.value)}
          required
          hint="Kept in the audit log with the change."
          error={reasonError}
        />
      </div>

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton type="submit" busy={busy === "set"} disabled={busy !== null}>
          Set the amount
        </SubmitButton>
        {overridden && (
          <button
            type="button"
            onClick={release}
            disabled={busy !== null}
            className={cn(cancelButton, "gap-2")}
          >
            <RotateCcw size={15} className="rtl:-scale-x-100" aria-hidden />
            Hand back to the supplier&apos;s terms
          </button>
        )}
        <CancelButton onClose={onClose} busy={busy !== null} />
      </div>
    </form>
  );
}

/** Writing off what is left. One-way: the payable and its open instalments become WAIVED. */
function WaiveForm({ payable, onClose, onDone }: FormProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();

  const left = formatMoney(payable.outstandingCents, payable.currency);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setReasonError(undefined);
    if (!reason.trim()) {
      setReasonError("Say why. The reason is kept with the write-off.");
      return;
    }

    setBusy(true);
    try {
      await adjustPayable(payable.id, { waive: true, reason: reason.trim() });
      onDone(`Wrote off ${left}. Nothing more is owed to ${supplierOf(payable)} for this booking.`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      <p className="rounded-sm border border-error/40 bg-error/5 p-3 text-[0.8125rem] leading-relaxed text-error-text">
        This marks the {left} still outstanding as not to be paid, and closes every open instalment. It cannot be
        undone: a written-off payable cannot be paid, adjusted or reopened from this screen. Payments already made
        stay on record.
      </p>

      <TextArea
        label="Reason"
        value={reason}
        maxLength={500}
        rows={2}
        onChange={(event) => setReason(event.target.value)}
        required
        hint="Kept in the audit log with the write-off."
        error={reasonError}
        className="mt-5"
      />

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Ban size={15} aria-hidden />
          Write off {left}
        </button>
        <CancelButton onClose={onClose} busy={busy} />
      </div>
    </form>
  );
}

/** Free-text notes on the payable. A change still carries a reason, as every edit here does. */
function NotesForm({ payable, onClose, onDone }: FormProps) {
  const [notes, setNotes] = useState(payable.notes ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setReasonError(undefined);
    if (!reason.trim()) {
      setReasonError("Say why, in a few words.");
      return;
    }

    setBusy(true);
    try {
      await adjustPayable(payable.id, { notes: notes.trim() || null, reason: reason.trim() });
      onDone(notes.trim() ? "Notes saved." : "Notes cleared.");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      <div className="grid gap-4">
        <TextArea
          label="Notes"
          value={notes}
          maxLength={2000}
          rows={5}
          onChange={(event) => setNotes(event.target.value)}
        />
        <TextInput
          label="Reason for the change"
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          required
          error={reasonError}
        />
      </div>

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton type="submit" busy={busy}>
          Save notes
        </SubmitButton>
        <CancelButton onClose={onClose} busy={busy} />
      </div>
    </form>
  );
}
