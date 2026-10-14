"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, FileText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import {
  CheckboxField,
  FormError,
  NumberInput,
  SelectInput,
  SubmitButton,
  TextInput,
} from "@/components/admin/FormControls";
import { Modal } from "@/components/ui/Modal";
import { invoiceKindLabels, invoiceLanguageLabel, invoiceStatusLabels, invoiceStatusTone } from "@/lib/admin/finance";
import { ApiError, describeError } from "@/lib/api/client";
import { invoicePdfUrl, requestInvoice } from "@/lib/api/invoices";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Receivable } from "@/types/finance";
import type { InvoiceKind, InvoiceLineInput, InvoiceStatus, InvoiceSummary, InvoicingSettings } from "@/types/invoice";

import { formatFinanceDate } from "./PaymentFormat";

const TONES = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
} as const;

function InvoicePill({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        TONES[invoiceStatusTone[status]],
      )}
    >
      {invoiceStatusLabels[status]}
    </span>
  );
}

const COLUMNS: Column[] = [
  { label: "Kind" },
  { label: "Number" },
  { label: "Status" },
  { label: "Amount", align: "end" },
  { label: "Issued", hideBelow: "lg" },
  { label: "", align: "end" },
];

const KIND_OPTIONS: { value: Exclude<InvoiceKind, "CORRECTION">; label: string }[] = [
  { value: "PROFORMA", label: invoiceKindLabels.PROFORMA },
  { value: "VAT", label: invoiceKindLabels.VAT },
  { value: "ADVANCE", label: invoiceKindLabels.ADVANCE },
  { value: "FINAL", label: invoiceKindLabels.FINAL },
];

const linkClass = "text-brand-text underline-offset-4 hover:underline";

const reasonMessages: Record<string, string> = {
  INVOICING_DISABLED: "Invoicing is switched off on this server.",
  NOTHING_OWED: "Nothing is owed on this item.",
};

const invoiceErrorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    const reason = (error.details as { reason?: string } | null | undefined)?.reason;
    if (reason && reasonMessages[reason]) return reasonMessages[reason];
    // Any other refusal (a live document already exists, and so on) carries its own sentence.
    return error.message;
  }
  return describeError(error, "Could not issue the document.");
};

/**
 * The documents issued for one receivable, and the button that issues another
 * by hand. The server writes the draft at once and the outbox creates it at
 * InvoiceOcean, so the new row appears as "Queued" and gains its number later.
 */
export function ReceivableInvoicesPanel({
  receivable,
  canWrite,
  canRead,
  settings,
}: {
  receivable: Receivable;
  canWrite: boolean;
  canRead: boolean;
  settings: InvoicingSettings | null;
}) {
  const path = useLocalePath();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!canRead) return null;

  const invoices = receivable.invoices ?? [];
  const money = (cents: number, currency: string) => formatMoney(cents, currency);
  const issuable =
    (receivable.status === "OPEN" || receivable.status === "PARTIAL" || receivable.status === "PAID") &&
    receivable.amountCents > 0;
  const enabled = Boolean(settings?.enabled);

  const action =
    canWrite && issuable ? (
      <button
        type="button"
        onClick={() => {
          setNote(null);
          setOpen(true);
        }}
        disabled={!enabled}
        title={enabled ? undefined : "Invoicing is not switched on for this server."}
        className="inline-flex h-9 items-center gap-2 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
      >
        <FilePlus2 size={15} aria-hidden />
        Issue a document
      </button>
    ) : undefined;

  const pdf = (invoice: InvoiceSummary) =>
    invoice.hasPdf ? (
      <a href={invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer" className={linkClass}>
        PDF
      </a>
    ) : null;

  return (
    <AdminPanel
      title="Invoices"
      description="Proformas and VAT invoices issued for this item."
      action={action}
      bodyClassName="p-0"
    >
      {canWrite && issuable && !enabled && (
        <p className="border-b border-line px-5 py-3 text-[0.8125rem] text-muted">
          Invoicing is not switched on for this server.
        </p>
      )}
      {note && (
        <p role="status" className="border-b border-line px-5 py-3 text-[0.8125rem] text-success">
          {note}
        </p>
      )}

      <div className="hidden md:block">
        <DataTable columns={COLUMNS} caption="Documents issued for this receivable">
          {invoices.length === 0 && (
            <EmptyRow colSpan={COLUMNS.length} message="No document has been issued for this item yet." />
          )}
          {invoices.map((invoice) => (
            <Row key={invoice.id}>
              <Cell className="whitespace-nowrap">{invoiceKindLabels[invoice.kind]}</Cell>
              <Cell className="font-mono text-[0.8125rem] whitespace-nowrap">{invoice.number ?? "—"}</Cell>
              <Cell>
                <InvoicePill status={invoice.status} />
                {invoice.syncError && (
                  <p className="mt-1 max-w-[16rem] text-[0.75rem] text-error-text">{invoice.syncError}</p>
                )}
              </Cell>
              <Cell align="end" className="font-medium tabular-nums whitespace-nowrap text-ink">
                {money(invoice.totalCents, invoice.currency)}
              </Cell>
              <Cell hideBelow="lg" className="whitespace-nowrap">
                {formatFinanceDate(invoice.issueDate)}
              </Cell>
              <Cell align="end" className="whitespace-nowrap">
                <span className="inline-flex items-center gap-3">
                  <Link href={path(`/admin/finance/invoices/${invoice.id}`)} prefetch={false} className={linkClass}>
                    Open
                  </Link>
                  {pdf(invoice)}
                </span>
              </Cell>
            </Row>
          ))}
        </DataTable>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {invoices.length === 0 && (
          <li className="p-5 text-center text-[0.8125rem] text-muted">No document has been issued for this item yet.</li>
        )}
        {invoices.map((invoice) => (
          <li key={invoice.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-[0.8125rem]">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <FileText size={14} className="shrink-0 text-subtle" aria-hidden />
                  {invoiceKindLabels[invoice.kind]}
                  <span className="font-mono font-normal text-muted">{invoice.number ?? "—"}</span>
                </p>
                <p className="mt-0.5 text-muted">Issued {formatFinanceDate(invoice.issueDate)}</p>
              </div>
              <p className="shrink-0 text-[0.875rem] font-medium text-ink tabular-nums">
                {money(invoice.totalCents, invoice.currency)}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <InvoicePill status={invoice.status} />
              <span className="inline-flex items-center gap-4 text-[0.8125rem]">
                <Link href={path(`/admin/finance/invoices/${invoice.id}`)} prefetch={false} className={linkClass}>
                  Open
                </Link>
                {pdf(invoice)}
              </span>
            </div>
            {invoice.syncError && <p className="mt-2 text-[0.75rem] text-error-text">{invoice.syncError}</p>}
          </li>
        ))}
      </ul>

      <Modal open={open} onClose={() => setOpen(false)} title="Issue a document" size="md">
        {open && settings && (
          <IssueInvoiceForm
            receivable={receivable}
            settings={settings}
            onClose={() => setOpen(false)}
            onQueued={() =>
              setNote("Queued. The document is created at InvoiceOcean within a few seconds; reload to see its number.")
            }
          />
        )}
      </Modal>
    </AdminPanel>
  );
}

interface LineDraft {
  description: string;
  quantity: string;
  amount: string;
  vat: string;
}

const emptyLine = (): LineDraft => ({ description: "", quantity: "1", amount: "", vat: "" });

function IssueInvoiceForm({
  receivable,
  settings,
  onClose,
  onQueued,
}: {
  receivable: Receivable;
  settings: InvoicingSettings;
  onClose: () => void;
  onQueued: () => void;
}) {
  const router = useRouter();
  const hasLiveProforma = (receivable.invoices ?? []).some(
    (invoice) => invoice.kind === "PROFORMA" && invoice.status !== "CANCELLED" && invoice.status !== "ERROR",
  );

  const [kind, setKind] = useState<Exclude<InvoiceKind, "CORRECTION">>(hasLiveProforma ? "VAT" : "PROFORMA");
  const [lang, setLang] = useState(settings.defaultLang);
  const [dueDate, setDueDate] = useState("");
  const [noDue, setNoDue] = useState(false);
  const [vat, setVat] = useState(String(settings.defaultTaxBps / 100));
  const [custom, setCustom] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const languages = settings.languages.length > 0 ? settings.languages : [settings.defaultLang];

  const patchLine = (index: number, change: Partial<LineDraft>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...change } : line)));

  const percentToBps = (value: string): number | null => {
    const parsed = Number(value);
    return value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
      ? Math.round(parsed * 100)
      : null;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const taxRateBps = percentToBps(vat);
    if (vat.trim() !== "" && taxRateBps === null) {
      setError("The VAT rate must be between 0 and 100.");
      return;
    }

    let lineInputs: InvoiceLineInput[] | undefined;

    if (custom) {
      lineInputs = [];
      for (const [index, line] of lines.entries()) {
        const amount = Number(line.amount);
        const quantity = Number(line.quantity);
        const lineVat = line.vat.trim() === "" ? undefined : percentToBps(line.vat);

        if (!line.description.trim()) return setError(`Line ${index + 1} needs a description.`);
        if (!Number.isInteger(quantity) || quantity < 1) return setError(`Line ${index + 1}: quantity must be a whole number, 1 or more.`);
        if (line.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) {
          return setError(`Line ${index + 1}: enter the amount.`);
        }
        if (lineVat === null) return setError(`Line ${index + 1}: the VAT rate must be between 0 and 100.`);

        lineInputs.push({
          description: line.description.trim(),
          quantity,
          totalGrossCents: Math.round(amount * 100),
          ...(lineVat !== undefined ? { taxRateBps: lineVat } : {}),
        });
      }
      if (lineInputs.length === 0) return setError("Add at least one line.");
    }

    setBusy(true);

    try {
      await requestInvoice(receivable.id, {
        kind,
        lang,
        ...(noDue ? { dueDate: null } : dueDate ? { dueDate } : {}),
        ...(taxRateBps !== null ? { taxRateBps } : {}),
        ...(lineInputs ? { lines: lineInputs } : {}),
      });
      onQueued();
      router.refresh();
      onClose();
    } catch (caught) {
      setError(invoiceErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="px-6 pt-4 pb-6">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Issues a document for {receivable.reference} at InvoiceOcean. It is written here at once and
        created there within a few seconds.
        {hasLiveProforma && " A proforma already exists for this item, so a VAT invoice is suggested."}
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SelectInput label="Kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} options={KIND_OPTIONS} />
        <SelectInput
          label="Language"
          value={lang}
          onChange={(event) => setLang(event.target.value)}
          options={languages.map((code) => ({ value: code, label: invoiceLanguageLabel(code) }))}
        />
        <div>
          <TextInput
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            disabled={noDue}
            hint="Leave empty to use this item's due date."
          />
          <CheckboxField className="mt-2" label="No due date" checked={noDue} onChange={setNoDue} />
        </div>
        <NumberInput
          label="VAT rate (%)"
          min={0}
          max={100}
          step="0.01"
          value={vat}
          onChange={(event) => setVat(event.target.value)}
          hint="Applied to every line that has no rate of its own."
        />
      </div>

      <CheckboxField
        className="mt-5"
        label="Write the lines myself"
        hint="Otherwise the lines are built from the booking."
        checked={custom}
        onChange={setCustom}
      />

      {custom && (
        <div className="mt-4 space-y-3">
          {lines.map((line, index) => (
            <div key={index} className="rounded-sm border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_5rem_7rem_5rem]">
                <TextInput
                  label="Description"
                  value={line.description}
                  maxLength={300}
                  onChange={(event) => patchLine(index, { description: event.target.value })}
                />
                <NumberInput
                  label="Qty"
                  min={1}
                  step={1}
                  value={line.quantity}
                  onChange={(event) => patchLine(index, { quantity: event.target.value })}
                />
                <NumberInput
                  label={`Amount (${receivable.currency})`}
                  min={0}
                  step="0.01"
                  value={line.amount}
                  onChange={(event) => patchLine(index, { amount: event.target.value })}
                />
                <NumberInput
                  label="VAT %"
                  min={0}
                  max={100}
                  step="0.01"
                  value={line.vat}
                  placeholder={vat}
                  onChange={(event) => patchLine(index, { vat: event.target.value })}
                />
              </div>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  className="mt-2 inline-flex items-center gap-1.5 text-[0.75rem] text-muted hover:text-error-text"
                >
                  <Trash2 size={13} aria-hidden />
                  Remove line
                </button>
              )}
            </div>
          ))}
          <p className="text-[0.75rem] text-subtle">Amounts include VAT. Enter the total for each line, not a unit price.</p>
          {lines.length < 50 && (
            <button
              type="button"
              onClick={() => setLines((current) => [...current, emptyLine()])}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
            >
              <Plus size={13} aria-hidden />
              Add a line
            </button>
          )}
        </div>
      )}

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton type="submit" busy={busy}>
          Issue {kind === "VAT" ? "VAT invoice" : invoiceKindLabels[kind].toLowerCase()}
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
