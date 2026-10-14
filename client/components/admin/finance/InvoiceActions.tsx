"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, FileDown, Loader2, Mail, RotateCw } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { FormError, SubmitButton, TextArea, TextInput } from "@/components/admin/FormControls";
import { Modal } from "@/components/ui/Modal";
import { ApiError, describeError } from "@/lib/api/client";
import { cancelInvoice, invoicePdfUrl, retryInvoice, sendInvoice } from "@/lib/api/invoices";
import { invoiceStatusHints } from "@/lib/admin/finance";
import { cn } from "@/lib/utils";
import type { Invoice, InvoiceStatus } from "@/types/invoice";

type Dialog = "send" | "cancel" | "retry" | null;

const secondary =
  "inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:pointer-events-none disabled:opacity-50";

const primary =
  "inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover";

const SENDABLE: InvoiceStatus[] = ["ISSUED", "SENT", "PAID", "PARTIAL"];
const CANCELLABLE: InvoiceStatus[] = ["DRAFT", "ISSUED", "SENT", "PARTIAL", "ERROR"];

const reasonMessages: Record<string, string> = {
  NOT_ISSUED: "This document has not been issued yet, so it cannot be sent.",
  NOT_A_PROFORMA: "Only a proforma can be cancelled. A VAT invoice is corrected instead.",
  NOT_CANCELLABLE: "This document can no longer be cancelled.",
  NOT_FAILED: "Only a failed document can be retried.",
  INVOICING_DISABLED: "Invoicing is switched off on this server.",
};

const invoiceErrorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    const reason = (error.details as { reason?: string } | null | undefined)?.reason;
    if (reason && reasonMessages[reason]) return reasonMessages[reason];
  }
  return describeError(error);
};

/**
 * What staff can do to one document: open its PDF, email it to the buyer,
 * cancel an unpaid proforma, or retry one the provider refused. Each action
 * answers at once; the status moves on its own a few seconds later.
 */
export function InvoiceActions({
  invoice,
  canWrite,
  enabled,
}: {
  invoice: Invoice;
  canWrite: boolean;
  /** False when invoicing is switched off on the server. */
  enabled: boolean;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);

  const canSend = canWrite && SENDABLE.includes(invoice.status);
  const canCancel = canWrite && invoice.kind === "PROFORMA" && CANCELLABLE.includes(invoice.status);
  const canRetry = canWrite && invoice.status === "ERROR";

  return (
    <AdminPanel title="Actions">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:flex-col">
        {invoice.hasPdf && (
          <a href={invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer" className={primary}>
            <FileDown size={15} aria-hidden />
            Open PDF
          </a>
        )}

        {canSend && (
          <button type="button" onClick={() => setDialog("send")} className={secondary}>
            <Mail size={15} aria-hidden />
            Send by email
          </button>
        )}

        {canRetry && (
          <button type="button" onClick={() => setDialog("retry")} disabled={!enabled} className={secondary}>
            <RotateCw size={15} aria-hidden />
            Retry
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            onClick={() => setDialog("cancel")}
            className={cn(secondary, "text-error-text hover:border-error/60 hover:text-error-text")}
          >
            <Ban size={15} aria-hidden />
            Cancel proforma
          </button>
        )}
      </div>

      {canRetry && !enabled && (
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted">
          Invoicing is switched off on this server, so a retry cannot be sent yet.
        </p>
      )}

      <p className="mt-4 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-muted">
        {invoiceStatusHints[invoice.status]}
      </p>

      <Modal open={dialog === "send"} onClose={() => setDialog(null)} title="Send by email" size="sm">
        {dialog === "send" && <SendForm invoice={invoice} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === "cancel"} onClose={() => setDialog(null)} title="Cancel this proforma" size="sm">
        {dialog === "cancel" && <CancelForm invoice={invoice} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === "retry"} onClose={() => setDialog(null)} title="Try again" size="sm">
        {dialog === "retry" && <RetryForm invoice={invoice} onClose={() => setDialog(null)} />}
      </Modal>
    </AdminPanel>
  );
}

/** Shared submit routine: run, refresh, then show either the success note or what was refused. */
function useAction(onClose: () => void, closeOnSuccess = true) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);

    try {
      await action();
      router.refresh();
      if (closeOnSuccess) onClose();
      else setDone(success);
    } catch (caught) {
      setError(invoiceErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, done, run };
}

function Buttons({
  busy,
  onClose,
  children,
  danger,
  finished,
}: {
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
  danger?: boolean;
  finished?: boolean;
}) {
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {!finished &&
        (danger ? (
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {children}
          </button>
        ) : (
          <SubmitButton type="submit" busy={busy}>
            {children}
          </SubmitButton>
        ))}
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
      >
        {finished ? "Close" : "Cancel"}
      </button>
    </div>
  );
}

function SendForm({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [to, setTo] = useState("");
  const { busy, error, done, run } = useAction(onClose, false);
  const usual = invoice.buyer.email;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => sendInvoice(invoice.id, to.trim() || undefined), "Queued — InvoiceOcean emails it within a minute.");
      }}
      className="px-6 pt-4 pb-6"
    >
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        {usual
          ? `The provider emails this document to ${usual}.`
          : "The provider emails this document to the buyer on file."}
      </p>

      <TextInput
        className="mt-5"
        label="Send to a different address"
        type="email"
        value={to}
        onChange={(event) => setTo(event.target.value)}
        maxLength={200}
        disabled={Boolean(done)}
        placeholder="Optional"
        hint="Leave empty to use the buyer's own address."
      />

      {done && (
        <p role="status" className="mt-4 text-[0.8125rem] leading-relaxed text-success">
          {done}
        </p>
      )}
      <FormError message={error} />
      <Buttons busy={busy} onClose={onClose} finished={Boolean(done)}>
        Send
      </Buttons>
    </form>
  );
}

function CancelForm({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction(onClose);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => cancelInvoice(invoice.id, reason.trim() || undefined), "Cancelled.");
      }}
      className="px-6 pt-4 pb-6"
    >
      <p className="flex items-start gap-2 rounded-sm border border-error/40 bg-surface px-4 py-3 text-[0.8125rem] leading-relaxed text-error-text">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          {invoice.number ? `Proforma ${invoice.number}` : "This proforma"} will be cancelled here and at the
          provider. It cannot be reopened; a new proforma is issued if something is still owed.
        </span>
      </p>

      <TextArea
        className="mt-5"
        label="Reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Optional"
      />

      <FormError message={error} />
      <Buttons busy={busy} onClose={onClose} danger>
        Cancel proforma
      </Buttons>
    </form>
  );
}

function RetryForm({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { busy, error, run } = useAction(onClose);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => retryInvoice(invoice.id), "Queued.");
      }}
      className="px-6 pt-4 pb-6"
    >
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        This sends the document to the provider again. Do this once the cause shown on the page is fixed.
      </p>

      <FormError message={error} />
      <Buttons busy={busy} onClose={onClose}>
        Retry now
      </Buttons>
    </form>
  );
}
