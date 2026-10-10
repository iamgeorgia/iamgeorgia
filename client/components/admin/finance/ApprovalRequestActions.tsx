"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CalendarClock, CheckCircle2, FileX2, PenLine, Undo2 } from "lucide-react";
import { useState } from "react";

import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { AdminPanel } from "@/components/admin/AdminPage";
import { CheckboxField, FormError, NumberInput, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/admin/FormControls";
import { Modal } from "@/components/ui/Modal";
import { approvalHref } from "@/lib/admin/approvals";
import { paymentMethodLabels } from "@/lib/admin/finance";
import { requestApproval } from "@/lib/api/approvals";
import { ApiError } from "@/lib/api/client";
import { searchPartnerOptions } from "@/lib/api/finance-browser";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { RequestApprovalInput } from "@/types/approval";
import type { Payable, PaymentMethod, Receivable } from "@/types/finance";

import { currencyOptions, dueEndOf, financeErrorMessage, middayOf, receivableDebtorName, tbilisiDay } from "./PaymentFormat";

/**
 * Asking for a second person's approval, for the people who may ask but not do
 * it themselves. The same inputs as the direct actions, plus a reason that is
 * required; nothing changes until someone else approves. After a request goes
 * through, a notice links to it.
 */

const METHODS = Object.keys(paymentMethodLabels) as PaymentMethod[];

const secondary =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink";
const danger =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8";

interface Sent {
  id: string;
  reference: string;
}

/** What the page shows once a request has gone in. */
function SentNotice({ sent }: { sent: Sent }) {
  const path = useLocalePath();

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-sm border border-success/40 bg-surface px-4 py-3 text-[0.8125rem] leading-relaxed text-body"
    >
      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
      <span>
        Sent for approval as{" "}
        <Link
          href={path(approvalHref(sent.id))}
          prefetch={false}
          className="font-medium text-brand-text underline-offset-4 hover:underline"
        >
          {sent.reference}
        </Link>
        . Nothing changes until someone else approves it.
      </span>
    </p>
  );
}

/** One request dialog's submit routine: POST, then hand the new request back. */
function useRequest(onSent: (sent: Sent) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const send = async (body: RequestApprovalInput) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const approval = await requestApproval(body);
      onSent({ id: approval.id, reference: approval.reference });
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(financeErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, fieldErrors, send };
}

function DialogButtons({
  busy,
  disabled,
  onClose,
  children,
}: {
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      <SubmitButton type="submit" busy={busy} disabled={disabled}>
        {children}
      </SubmitButton>
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

const ReasonField = ({
  value,
  onChange,
  error,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
  placeholder: string;
}) => (
  <TextArea
    label="Reason"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    rows={2}
    maxLength={500}
    required
    placeholder={placeholder}
    hint="Whoever decides will read this."
    error={error}
  />
);

type Form = "override" | "waive" | "due" | "refund" | null;

/* ------------------------------------------------------------------ */
/* Payable                                                             */
/* ------------------------------------------------------------------ */

/** Asking to change what a supplier is owed: set the amount by hand, or write off what is left. */
export function PayableApprovalRequests({
  payable,
}: {
  payable: Pick<Payable, "id" | "currency" | "amountCents" | "originalAmountCents" | "outstandingCents">;
}) {
  const [form, setForm] = useState<Form>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const close = () => setForm(null);
  const done = (next: Sent) => {
    setForm(null);
    setSent(next);
  };

  return (
    <AdminPanel title="Ask for approval" description="These changes need a second person to approve them.">
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => {
            setSent(null);
            setForm("override");
          }}
          className={secondary}
        >
          <PenLine size={15} aria-hidden />
          Ask to set the amount owed
        </button>
        {payable.outstandingCents > 0 && (
          <button
            type="button"
            onClick={() => {
              setSent(null);
              setForm("waive");
            }}
            className={danger}
          >
            <Ban size={15} aria-hidden />
            Ask to write off what is left
          </button>
        )}
      </div>

      {sent && (
        <div className="mt-4">
          <SentNotice sent={sent} />
        </div>
      )}

      <Modal open={form === "override"} onClose={close} title="Ask to set the amount owed" size="md">
        {form === "override" && <PayableOverrideRequest payable={payable} onClose={close} onSent={done} />}
      </Modal>
      <Modal open={form === "waive"} onClose={close} title="Ask to write off what is left" size="md">
        {form === "waive" && <PayableWaiveRequest payable={payable} onClose={close} onSent={done} />}
      </Modal>
    </AdminPanel>
  );
}

type PayableFormProps = {
  payable: Pick<Payable, "id" | "currency" | "amountCents" | "originalAmountCents" | "outstandingCents">;
  onClose: () => void;
  onSent: (sent: Sent) => void;
};

function PayableOverrideRequest({ payable, onClose, onSent }: PayableFormProps) {
  const [amount, setAmount] = useState(toMajorUnits(payable.amountCents, payable.currency));
  const [handBack, setHandBack] = useState(false);
  const [reason, setReason] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();
  const { busy, error, fieldErrors, send } = useRequest(onSent);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAmountError(undefined);

    let cents: number | null = null;
    if (!handBack) {
      cents = toMinorUnits(amount, payable.currency);
      if (cents === null || cents < 0) {
        setAmountError("Enter an amount of zero or more.");
        return;
      }
      if (cents > payable.originalAmountCents) {
        setAmountError(`At most ${formatMoney(payable.originalAmountCents, payable.currency)}, what the booking was worth to the supplier.`);
        return;
      }
    }

    void send({
      kind: "PAYABLE_OVERRIDE",
      subjectId: payable.id,
      payload: { amountOverrideCents: cents, reason: reason.trim() },
    });
  };

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Ask for the amount owed to the supplier to be replaced with your figure, or handed back to their terms.
        It is applied only when someone else approves it.
      </p>

      <div className="mt-5 grid gap-4">
        <NumberInput
          label={`Amount owed (${payable.currency})`}
          value={amount}
          min={0}
          step="0.01"
          disabled={handBack}
          onChange={(event) => setAmount(event.target.value)}
          required={!handBack}
          hint={`At most ${formatMoney(payable.originalAmountCents, payable.currency)}.`}
          error={amountError ?? fieldErrors.amountOverrideCents}
        />
        <CheckboxField
          label="Hand it back to the supplier's terms instead"
          hint="The amount is worked out again from their rules."
          checked={handBack}
          onChange={setHandBack}
        />
        <ReasonField
          value={reason}
          onChange={setReason}
          error={fieldErrors.reason}
          placeholder="Agreed with the supplier after the cancellation"
        />
      </div>

      <FormError message={error} />
      <DialogButtons busy={busy} disabled={reason.trim().length === 0} onClose={onClose}>
        Request approval
      </DialogButtons>
    </form>
  );
}

function PayableWaiveRequest({ payable, onClose, onSent }: PayableFormProps) {
  const [reason, setReason] = useState("");
  const { busy, error, fieldErrors, send } = useRequest(onSent);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send({ kind: "PAYABLE_WAIVE", subjectId: payable.id, payload: { waive: true, reason: reason.trim() } });
      }}
      className="px-6 pt-4 pb-6"
    >
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Ask for the {formatMoney(payable.outstandingCents, payable.currency)} still owed to the supplier to be
        written off. What was already paid stays recorded. It is applied only when someone else approves it.
      </p>
      <div className="mt-5">
        <ReasonField
          value={reason}
          onChange={setReason}
          error={fieldErrors.reason}
          placeholder="The supplier agreed to waive the balance"
        />
      </div>

      <FormError message={error} />
      <DialogButtons busy={busy} disabled={reason.trim().length === 0} onClose={onClose}>
        Request approval
      </DialogButtons>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Receivable                                                          */
/* ------------------------------------------------------------------ */

/** Asking to change what a buyer owes: a new due date, a write-off, or a refund. */
export function ReceivableApprovalRequests({
  receivable,
  askForRefund,
  askForAdjustments,
}: {
  receivable: Receivable;
  /** Holds `finance.refunds.request` and cannot refund directly. */
  askForRefund: boolean;
  /** Holds `finance.adjustments.request` and cannot adjust directly. */
  askForAdjustments: boolean;
}) {
  const [form, setForm] = useState<Form>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const open = receivable.status === "OPEN" || receivable.status === "PARTIAL";
  const showRefund = askForRefund && receivable.refundDueCents > 0;
  const showDue = askForAdjustments && open;
  const showWaive = askForAdjustments && open && receivable.outstandingCents > 0;

  if (!showRefund && !showDue && !showWaive) return null;

  const close = () => setForm(null);
  const done = (next: Sent) => {
    setForm(null);
    setSent(next);
  };
  const start = (next: Form) => {
    setSent(null);
    setForm(next);
  };

  return (
    <AdminPanel title="Ask for approval" description="These changes need a second person to approve them.">
      <div className="space-y-2.5">
        {showRefund && (
          <button type="button" onClick={() => start("refund")} className={secondary}>
            <Undo2 size={15} aria-hidden />
            Ask to refund {formatMoney(receivable.refundDueCents, receivable.currency)}
          </button>
        )}
        {showDue && (
          <button type="button" onClick={() => start("due")} className={secondary}>
            <CalendarClock size={15} aria-hidden />
            Ask to change the due date
          </button>
        )}
        {showWaive && (
          <button type="button" onClick={() => start("waive")} className={danger}>
            <FileX2 size={15} aria-hidden />
            Ask to write off what is left
          </button>
        )}
      </div>

      {sent && (
        <div className="mt-4">
          <SentNotice sent={sent} />
        </div>
      )}

      <Modal open={form === "due"} onClose={close} title="Ask to change the due date" size="sm">
        {form === "due" && <ReceivableDueRequest receivable={receivable} onClose={close} onSent={done} />}
      </Modal>
      <Modal open={form === "waive"} onClose={close} title="Ask to write off what is left" size="sm">
        {form === "waive" && <ReceivableWaiveRequest receivable={receivable} onClose={close} onSent={done} />}
      </Modal>
      <Modal open={form === "refund"} onClose={close} title="Ask for a refund" size="md">
        {form === "refund" && <RefundRequestForm receivable={receivable} onClose={close} onSent={done} />}
      </Modal>
    </AdminPanel>
  );
}

type ReceivableFormProps = { receivable: Receivable; onClose: () => void; onSent: (sent: Sent) => void };

function ReceivableDueRequest({ receivable, onClose, onSent }: ReceivableFormProps) {
  const [day, setDay] = useState(receivable.dueAt ? tbilisiDay(receivable.dueAt) : "");
  const [reason, setReason] = useState("");
  const { busy, error, fieldErrors, send } = useRequest(onSent);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!day) return;
        void send({
          kind: "RECEIVABLE_DUE_DATE",
          subjectId: receivable.id,
          payload: { dueAt: dueEndOf(day), reason: reason.trim() },
        });
      }}
      className="px-6 pt-4 pb-6"
    >
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Ask to give {receivableDebtorName(receivable)} more (or less) time on this one item. It is applied only
        when someone else approves it.
      </p>
      <div className="mt-5 grid gap-4">
        <TextInput
          label="New due date"
          type="date"
          value={day}
          onChange={(event) => setDay(event.target.value)}
          required
          hint="Due by the end of that day, Tbilisi time."
          error={fieldErrors.dueAt}
        />
        <ReasonField
          value={reason}
          onChange={setReason}
          error={fieldErrors.reason}
          placeholder="Agreed with the agency by phone"
        />
      </div>

      <FormError message={error} />
      <DialogButtons busy={busy} disabled={!day || reason.trim().length === 0} onClose={onClose}>
        Request approval
      </DialogButtons>
    </form>
  );
}

function ReceivableWaiveRequest({ receivable, onClose, onSent }: ReceivableFormProps) {
  const [reason, setReason] = useState("");
  const { busy, error, fieldErrors, send } = useRequest(onSent);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send({
          kind: "RECEIVABLE_WAIVE",
          subjectId: receivable.id,
          payload: { waive: true, reason: reason.trim() },
        });
      }}
      className="px-6 pt-4 pb-6"
    >
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Ask for the {formatMoney(receivable.outstandingCents, receivable.currency)} still owed by{" "}
        {receivableDebtorName(receivable)} to be written off. What was already paid stays recorded. It is applied
        only when someone else approves it.
      </p>
      <div className="mt-5">
        <ReasonField
          value={reason}
          onChange={setReason}
          error={fieldErrors.reason}
          placeholder="Goodwill gesture agreed by management"
        />
      </div>

      <FormError message={error} />
      <DialogButtons busy={busy} disabled={reason.trim().length === 0} onClose={onClose}>
        Request approval
      </DialogButtons>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Refund                                                              */
/* ------------------------------------------------------------------ */

/**
 * A compact refund request. On a receivable it is fixed to that item (money
 * out to the buyer, at most what is due back); from the Payments screen the
 * person picks the direction and who the money went to or came from, and the
 * refund is allocated to items afterwards.
 */
function RefundRequestForm({
  receivable,
  onClose,
  onSent,
}: {
  receivable?: Receivable;
  onClose: () => void;
  onSent: (sent: Sent) => void;
}) {
  const settling = Boolean(receivable);
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [currency, setCurrency] = useState(receivable?.currency ?? "GEL");
  const [amount, setAmount] = useState(receivable ? toMajorUnits(receivable.refundDueCents, receivable.currency) : "");
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [paidOn, setPaidOn] = useState(() => tbilisiDay());
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const initialPartner: PickerOption | null = receivable?.debtor.partner
    ? { id: receivable.debtor.partner.id, label: receivable.debtor.partner.name }
    : null;
  const [partner, setPartner] = useState<PickerOption | null>(initialPartner);
  const [name, setName] = useState(receivable?.debtor.name ?? "");
  const [amountError, setAmountError] = useState<string | undefined>();
  const { busy, error, fieldErrors, send } = useRequest(onSent);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAmountError(undefined);

    const cents = toMinorUnits(amount, currency);
    if (cents === null || cents <= 0) {
      setAmountError("Enter an amount above zero.");
      return;
    }
    if (receivable && cents > receivable.refundDueCents) {
      setAmountError(`No more than ${formatMoney(receivable.refundDueCents, receivable.currency)} is due back.`);
      return;
    }

    const counterparty = partner
      ? { counterpartyPartnerId: partner.id }
      : {
          ...(name.trim() ? { counterpartyName: name.trim() } : {}),
          ...(receivable?.debtor.email ? { counterpartyEmail: receivable.debtor.email } : {}),
        };

    void send({
      kind: "REFUND",
      subjectId: receivable?.id,
      payload: {
        direction,
        kind: "REFUND",
        method,
        currency,
        amountCents: cents,
        paidAt: middayOf(paidOn),
        reason: reason.trim(),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...counterparty,
        allocations: receivable ? [{ receivableId: receivable.id, amountCents: cents }] : [],
      },
    });
  };

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        {receivable
          ? `Ask to pay back money to ${receivableDebtorName(receivable)} for ${receivable.reference}. `
          : "Ask to record a refund. "}
        Nothing is recorded until someone else approves it.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {!settling && (
          <SelectInput
            label="Which way the money goes"
            value={direction}
            onChange={(event) => setDirection(event.target.value as "IN" | "OUT")}
            options={[
              { value: "OUT", label: "Paid back to a buyer" },
              { value: "IN", label: "Received back from a supplier" },
            ]}
            className="sm:col-span-2"
          />
        )}
        <TextInput
          label={`Amount (${currency})`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          required
          error={amountError ?? fieldErrors.amountCents}
        />
        <SelectInput
          label="Currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          options={currencyOptions(receivable?.currency)}
          disabled={settling}
        />
        <SelectInput
          label="Method"
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          options={METHODS.map((value) => ({ value, label: paymentMethodLabels[value] }))}
        />
        <TextInput
          label="Paid on"
          type="date"
          value={paidOn}
          max={tbilisiDay()}
          onChange={(event) => setPaidOn(event.target.value)}
          required
          error={fieldErrors.paidAt}
        />
        <TextInput
          label="Reference (optional)"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Bank transfer number, receipt…"
          autoComplete="off"
          maxLength={120}
          className="sm:col-span-2"
        />

        {!settling && (
          <div className="sm:col-span-2">
            <EntityPicker
              label={direction === "OUT" ? "Refunded to (partner)" : "Refunded by (supplier)"}
              value={partner?.id ?? ""}
              valueLabel={partner?.label}
              onChange={setPartner}
              search={searchPartnerOptions}
              placeholder="Search partners"
              clearLabel="No partner account"
              error={fieldErrors.counterpartyPartnerId}
            />
            {!partner && (
              <TextInput
                className="mt-4"
                label="Or a name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="A guest without an account"
                autoComplete="off"
                maxLength={200}
                error={fieldErrors.counterpartyName}
              />
            )}
          </div>
        )}

        <div className="sm:col-span-2">
          <ReasonField
            value={reason}
            onChange={setReason}
            error={fieldErrors.reason}
            placeholder="The booking was cancelled within the free window"
          />
        </div>
      </div>

      <FormError message={error} />
      <DialogButtons busy={busy} disabled={reason.trim().length === 0 || !amount.trim()} onClose={onClose}>
        Request approval
      </DialogButtons>
    </form>
  );
}

/** The Payments screen's header button: ask for a refund that is not tied to one receivable. */
export function RefundApprovalRequestButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  return (
    <div className={cn("flex flex-col items-end gap-3", className)}>
      <button
        type="button"
        onClick={() => {
          setSent(null);
          setOpen(true);
        }}
        className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
      >
        <Undo2 size={15} aria-hidden />
        Ask to refund
      </button>

      {sent && <SentNotice sent={sent} />}

      <Modal open={open} onClose={() => setOpen(false)} title="Ask for a refund" size="md">
        {open && (
          <RefundRequestForm
            onClose={() => setOpen(false)}
            onSent={(next) => {
              setOpen(false);
              setSent(next);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
