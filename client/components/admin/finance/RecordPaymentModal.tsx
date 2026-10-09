"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Banknote, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { useId, useState } from "react";

import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import {
  CheckboxField,
  FormError,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
  hintClass,
  labelClass,
} from "@/components/admin/FormControls";
import { Modal } from "@/components/ui/Modal";
import { paymentKindLabel, paymentMethodLabels } from "@/lib/admin/finance";
import { ApiError } from "@/lib/api/client";
import { newIdempotencyKey, recordPayment } from "@/lib/api/finance";
import { searchPartnerOptions } from "@/lib/api/finance-browser";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  AllocationInput,
  Payment,
  PaymentDirection,
  PaymentKind,
  PaymentMethod,
  RecordPaymentInput,
} from "@/types/finance";

import { currencyOptions, financeErrorMessage, middayOf, tbilisiDay } from "./PaymentFormat";

/**
 * "Record a payment" — the one dialog every money movement goes through.
 *
 * Two modes, decided by the preset:
 *
 * - **Settling something named.** A receivable's "Record a payment" or
 *   "Refund" passes `allocations`: the direction, kind and currency are fixed
 *   by what is being settled, and only the amount, date and method are asked.
 * - **General.** The Payments screen's header button: which way the money
 *   went, who it was, and whether to settle that partner's oldest open items
 *   first or leave it unallocated to spread later.
 *
 * One Idempotency-Key per opened dialog, kept in state: a double click or a
 * retry after a dropped connection answers with the payment already recorded
 * instead of recording it twice. Closing and reopening starts a new one.
 */

export interface PresetAllocation extends AllocationInput {
  /** What the line settles, as shown in the dialog: "RCV-000123 · Nino Beridze". */
  label?: string;
}

export interface RecordPaymentPreset {
  direction?: PaymentDirection;
  kind?: PaymentKind;
  currency?: string;
  /** Prefilled amount, in minor units. */
  amountCents?: number;
  /**
   * What the payment settles, each with the most it may take (what is
   * outstanding for a payment, what is due back for a refund). Filled in the
   * order given until the amount runs out. Fixes direction, kind and currency.
   */
  allocations?: PresetAllocation[];
  counterparty?: {
    partnerId?: string | null;
    partnerName?: string | null;
    name?: string | null;
    email?: string | null;
  };
}

export interface RecordPaymentModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  preset?: RecordPaymentPreset;
}

const METHODS = Object.keys(paymentMethodLabels) as PaymentMethod[];

export function RecordPaymentModal({ open, onClose, title, preset }: RecordPaymentModalProps) {
  const isRefund = preset?.kind === "REFUND";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? (isRefund ? "Record a refund" : "Record a payment")}
      size="md"
    >
      {open && <RecordPaymentForm preset={preset} onClose={onClose} />}
    </Modal>
  );
}

/** The dialog with its own trigger, for a page header or an actions panel. */
export function RecordPaymentButton({
  preset,
  label = "Record a payment",
  title,
  variant = "primary",
  className,
}: {
  preset?: RecordPaymentPreset;
  label?: string;
  title?: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[0.8125rem] transition-colors",
          variant === "primary"
            ? "bg-brand font-semibold text-white hover:bg-brand-hover"
            : "border border-line bg-surface font-medium text-body hover:border-ink/40 hover:text-ink",
          className,
        )}
      >
        <Banknote size={15} aria-hidden />
        {label}
      </button>

      <RecordPaymentModal open={open} onClose={() => setOpen(false)} title={title} preset={preset} />
    </>
  );
}

type Settle = "OLDEST" | "NONE";

/** Spreads `amount` over the preset lines in order, each up to its own ceiling. */
const plan = (targets: PresetAllocation[], amountCents: number): AllocationInput[] => {
  let left = amountCents;
  const rows: AllocationInput[] = [];

  for (const target of targets) {
    if (left <= 0) break;
    const cents = Math.min(target.amountCents, left);
    if (cents > 0) {
      rows.push({
        ...(target.receivableId ? { receivableId: target.receivableId } : {}),
        ...(target.payableInstalmentId ? { payableInstalmentId: target.payableInstalmentId } : {}),
        amountCents: cents,
      });
      left -= cents;
    }
  }

  return rows;
};

function RecordPaymentForm({ preset, onClose }: { preset?: RecordPaymentPreset; onClose: () => void }) {
  const router = useRouter();
  const path = useLocalePath();
  const radioName = useId();

  const targets = preset?.allocations ?? [];
  const settling = targets.length > 0;

  // One key for the life of this dialog — see the module comment.
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const [direction, setDirection] = useState<PaymentDirection>(preset?.direction ?? "IN");
  const [kind, setKind] = useState<PaymentKind>(preset?.kind ?? "PAYMENT");
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [currency, setCurrency] = useState(preset?.currency ?? "GEL");
  const [amount, setAmount] = useState(
    preset?.amountCents ? toMajorUnits(preset.amountCents, preset.currency ?? "GEL") : "",
  );
  const [paidOn, setPaidOn] = useState(() => tbilisiDay());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  const presetPartner: PickerOption | null = preset?.counterparty?.partnerId
    ? { id: preset.counterparty.partnerId, label: preset.counterparty.partnerName ?? "Partner" }
    : null;
  const [partner, setPartner] = useState<PickerOption | null>(presetPartner);
  const [counterpartyName, setCounterpartyName] = useState(preset?.counterparty?.name ?? "");
  const [counterpartyEmail, setCounterpartyEmail] = useState(preset?.counterparty?.email ?? "");
  const [settle, setSettle] = useState<Settle>("OLDEST");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [recorded, setRecorded] = useState<{ payment: Payment; replayed: boolean } | null>(null);

  const isRefund = kind === "REFUND";
  const today = tbilisiDay();
  const amountCents = amount.trim() ? toMinorUnits(amount, currency) : null;
  const amountValid = amountCents !== null && amountCents > 0;

  const ceilingCents = targets.reduce((sum, target) => sum + target.amountCents, 0);
  const allocations = settling && amountValid ? plan(targets, amountCents) : [];
  const allocatedCents = allocations.reduce((sum, row) => sum + row.amountCents, 0);
  const leftoverCents = amountValid ? amountCents - allocatedCents : 0;
  // A refund cannot hand back more than is due back; extra money in is
  // simply credit, kept on the payment to allocate later.
  const refundTooLarge = settling && isRefund && amountValid && amountCents > ceilingCents;

  // Oldest-first walks open items; a refund is matched to something already
  // paid, which only a named item can say. Refunds without one stay unallocated.
  const oldestAvailable = !isRefund;
  const effectiveSettle: Settle = oldestAvailable ? settle : "NONE";
  const needsPartner = !settling && effectiveSettle === "OLDEST" && !partner;
  const needsCounterparty =
    !settling && effectiveSettle === "NONE" && !partner && !counterpartyName.trim() && !counterpartyEmail.trim();

  const ready =
    amountValid &&
    !refundTooLarge &&
    Boolean(paidOn) &&
    (!isRefund || reason.trim().length > 0) &&
    !needsPartner &&
    !needsCounterparty;

  const fieldError = (key: string) => fieldErrors[key] || undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || amountCents === null) return;

    setBusy(true);
    setError(null);
    setFieldErrors({});

    const body: RecordPaymentInput = {
      direction,
      kind,
      method,
      currency,
      amountCents,
      paidAt: middayOf(paidOn),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(isRefund ? { reason: reason.trim() } : {}),
    };

    if (settling) {
      body.allocations = allocations;
    } else {
      if (partner) body.counterpartyPartnerId = partner.id;
      else {
        if (counterpartyName.trim()) body.counterpartyName = counterpartyName.trim();
        if (counterpartyEmail.trim()) body.counterpartyEmail = counterpartyEmail.trim();
      }
      if (effectiveSettle === "OLDEST" && partner) {
        body.allocate = { mode: "OLDEST_DUE", partnerId: partner.id };
      }
    }

    try {
      const result = await recordPayment(body, idempotencyKey);
      router.refresh();

      if (settling) onClose();
      else setRecorded(result);
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(financeErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (recorded) {
    const { payment, replayed } = recorded;

    return (
      <div className="px-6 pt-4 pb-6">
        <p className="flex items-start gap-2 text-[0.9375rem] leading-relaxed text-body">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <span>
            {replayed ? "This payment had already been recorded — nothing was recorded twice. " : ""}
            <span className="font-medium text-ink">
              {paymentKindLabel(payment.direction, payment.kind)}: {formatMoney(payment.amountCents, payment.currency)}
            </span>
            {payment.unallocatedCents > 0
              ? `, of which ${formatMoney(payment.unallocatedCents, payment.currency)} is not yet allocated.`
              : ", fully allocated."}
          </span>
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={path(`/admin/finance/payments/${payment.id}`)}
            prefetch={false}
            className="inline-flex h-10 items-center gap-1.5 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Open the payment
            <ChevronRight size={14} className="rtl:-scale-x-100" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const directionChoice = (value: PaymentDirection) => {
    const selected = direction === value;
    const Icon = value === "IN" ? ArrowDownLeft : ArrowUpRight;
    const hint =
      value === "IN"
        ? isRefund
          ? "A supplier refunds us"
          : "From a buyer — an agency or a guest"
        : isRefund
          ? "We refund a buyer"
          : "To a supplier — a hotel, a driver, a guide";

    return (
      <label
        key={value}
        className={cn(
          "flex cursor-pointer items-start gap-2.5 rounded-sm border p-3 transition-colors",
          selected ? "border-ink bg-surface-soft" : "border-line bg-surface hover:border-ink/40",
        )}
      >
        <input
          type="radio"
          name={radioName}
          value={value}
          checked={selected}
          onChange={() => setDirection(value)}
          className="mt-0.5 size-4 shrink-0 accent-brand"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[0.875rem] font-medium text-ink">
            <Icon size={14} aria-hidden />
            {value === "IN" ? "Money in" : "Money out"}
          </span>
          <span className="mt-0.5 block text-[0.75rem] text-muted">{hint}</span>
        </span>
      </label>
    );
  };

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      {settling ? (
        <div className="rounded-sm bg-surface-soft p-3">
          <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">
            {paymentKindLabel(direction, kind)}
            {preset?.counterparty?.partnerName || preset?.counterparty?.name
              ? ` · ${preset?.counterparty?.partnerName ?? preset?.counterparty?.name}`
              : ""}
          </p>
          <ul className="mt-2 space-y-1">
            {targets.map((target, index) => (
              <li
                key={target.receivableId ?? target.payableInstalmentId ?? index}
                className="flex flex-wrap items-baseline justify-between gap-x-4 text-[0.8125rem]"
              >
                <span className="min-w-0 text-body">{target.label ?? "Item"}</span>
                <span className="text-muted tabular-nums">
                  {isRefund ? "due back " : "outstanding "}
                  {formatMoney(target.amountCents, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <fieldset>
            <legend className={labelClass}>Which way the money went</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">{(["IN", "OUT"] as const).map(directionChoice)}</div>
          </fieldset>
          <CheckboxField
            className="mt-3"
            label="This is a refund"
            hint={
              isRefund
                ? `Recorded as: ${paymentKindLabel(direction, "REFUND")}.`
                : "Money handed back after a cancellation or a correction."
            }
            checked={isRefund}
            onChange={(next) => setKind(next ? "REFUND" : "PAYMENT")}
          />
        </>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <TextInput
          label={`Amount (${currency})`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          required
          className="sm:col-span-1"
          error={
            fieldError("amountCents") ??
            (refundTooLarge ? `No more than ${formatMoney(ceilingCents, currency)} is due back.` : undefined)
          }
          hint={
            settling && !isRefund && leftoverCents > 0
              ? `${formatMoney(leftoverCents, currency)} more than is owed — kept on the payment, unallocated.`
              : undefined
          }
        />
        <SelectInput
          label="Currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          options={currencyOptions(preset?.currency)}
          disabled={settling}
          hint={settling ? "A payment settles items in their own currency." : undefined}
          error={fieldError("currency")}
        />
        <SelectInput
          label="Method"
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          options={METHODS.map((value) => ({ value, label: paymentMethodLabels[value] }))}
          error={fieldError("method")}
        />
        <TextInput
          label="Paid on"
          type="date"
          value={paidOn}
          max={today}
          onChange={(event) => setPaidOn(event.target.value)}
          required
          error={fieldError("paidAt")}
        />
        <TextInput
          label="Reference (optional)"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Bank transfer number, receipt…"
          autoComplete="off"
          maxLength={120}
          className="sm:col-span-2"
          error={fieldError("reference")}
        />
      </div>

      {!settling && (
        <div className="mt-5 border-t border-line pt-5">
          <EntityPicker
            label={direction === "IN" ? (isRefund ? "Supplier" : "Paid by (partner)") : isRefund ? "Refunded to (partner)" : "Paid to (partner)"}
            value={partner?.id ?? ""}
            valueLabel={partner?.label}
            onChange={setPartner}
            search={searchPartnerOptions}
            placeholder="Search partners"
            clearLabel="No partner account"
            error={fieldError("counterpartyPartnerId")}
          />

          {!partner && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextInput
                label="Or a name"
                value={counterpartyName}
                onChange={(event) => setCounterpartyName(event.target.value)}
                placeholder="A guest without an account"
                autoComplete="off"
                maxLength={200}
                error={fieldError("counterpartyName")}
              />
              <TextInput
                label="Email (optional)"
                type="email"
                value={counterpartyEmail}
                onChange={(event) => setCounterpartyEmail(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                error={fieldError("counterpartyEmail")}
              />
            </div>
          )}

          <fieldset className="mt-5">
            <legend className={labelClass}>What it settles</legend>
            <div className="mt-1.5 space-y-2">
              <label className={cn("flex items-start gap-2.5", !oldestAvailable && "opacity-60")}>
                <input
                  type="radio"
                  name={`${radioName}-settle`}
                  checked={effectiveSettle === "OLDEST"}
                  disabled={!oldestAvailable}
                  onChange={() => setSettle("OLDEST")}
                  className="mt-0.5 size-4 shrink-0 accent-brand"
                />
                <span className="text-[0.8125rem] leading-snug text-body">
                  {direction === "IN"
                    ? "The partner's oldest open receivables first"
                    : "The partner's oldest open supplier instalments first"}
                  <span className="mt-0.5 block text-[0.75rem] text-subtle">
                    {oldestAvailable
                      ? `Earliest due first, in ${currency} only. Anything left over stays on the payment, unallocated.`
                      : "A refund is matched to an item that was paid — leave it unallocated here and allocate it from the payment's page, or use Refund on the item itself."}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name={`${radioName}-settle`}
                  checked={effectiveSettle === "NONE"}
                  onChange={() => setSettle("NONE")}
                  className="mt-0.5 size-4 shrink-0 accent-brand"
                />
                <span className="text-[0.8125rem] leading-snug text-body">
                  Leave it unallocated
                  <span className="mt-0.5 block text-[0.75rem] text-subtle">
                    Recorded now, spread over items later from the payment&apos;s page.
                  </span>
                </span>
              </label>
            </div>
            {needsPartner && (
              <p className={cn(hintClass, "flex items-start gap-1.5 text-warning-text")}>
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                Choose the partner whose items this settles.
              </p>
            )}
            {needsCounterparty && (
              <p className={cn(hintClass, "flex items-start gap-1.5 text-warning-text")}>
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                Say who the money came from or went to: a partner, or a name.
              </p>
            )}
          </fieldset>
        </div>
      )}

      <div className="mt-5 grid gap-4">
        {isRefund && (
          <TextArea
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            required
            placeholder="Cancelled by the guest within the free period"
            hint="Kept on the payment and in the audit log."
            error={fieldError("reason")}
          />
        )}
        <TextArea
          label="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={1000}
          error={fieldError("note")}
        />
      </div>

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton type="submit" busy={busy} disabled={!ready}>
          {isRefund ? "Record refund" : "Record payment"}
          {amountValid ? ` · ${formatMoney(amountCents, currency)}` : ""}
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
    </form>
  );
}
