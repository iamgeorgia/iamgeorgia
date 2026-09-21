"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { Check, Copy, Loader2, MailPlus, PauseCircle, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { describeError } from "@/lib/api/client";
import { resendInvitation, reviewPartner, type ReviewAction } from "@/lib/api/partners";
import { cn } from "@/lib/utils";
import type { Partner, PartnerStatus } from "@/types";

/**
 * The review controls on a partner detail page.
 *
 * Which buttons appear is decided from the status, mirroring the transition
 * table in `server/services/partner.service.js`. That mirroring is a courtesy
 * to the operator, not a control: the server refuses an illegal transition
 * with a 409 whether or not a button for it was ever rendered, and the message
 * it returns is what gets shown here.
 */

type Pending = ReviewAction | "resend" | null;

const CAN: Record<ReviewAction | "resend", PartnerStatus[]> = {
  approve: ["PENDING_APPROVAL", "REGISTRATION_IN_PROGRESS"],
  reject: ["PENDING_APPROVAL", "REGISTRATION_IN_PROGRESS"],
  suspend: ["APPROVED"],
  reactivate: ["SUSPENDED", "REJECTED"],
  resend: ["INVITED", "REGISTRATION_IN_PROGRESS", "PENDING_APPROVAL", "REJECTED"],
};

export function PartnerActions({ partner }: { partner: Partner }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [suspending, setSuspending] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  const allows = (action: keyof typeof CAN) => CAN[action].includes(partner.status);

  const run = async (action: ReviewAction, body: Record<string, unknown> = {}) => {
    setPending(action);
    setError(null);
    setMessage(null);

    try {
      await reviewPartner(partner.id, action, body);
      setRejecting(false);
      setSuspending(false);
      setMessage(
        action === "approve"
          ? "Approved. The partner has been emailed and now has full access."
          : action === "reject"
            ? "Rejected. The partner has been emailed the reason you gave."
            : action === "suspend"
              ? "Suspended. Every open session for this partner has ended."
              : "Reinstated. The partner has full access again.",
      );
      // The page is a Server Component; refreshing is what re-reads the record
      // rather than patching a local copy that could drift from the server's.
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(null);
    }
  };

  const handleResend = async () => {
    setPending("resend");
    setError(null);
    setMessage(null);

    try {
      const result = await resendInvitation(partner.id);
      setLink(result.link.url);
      setMessage(
        result.emailSent
          ? `A new link has been emailed to ${result.email}. Any earlier link has stopped working.`
          : `A new link was created but could not be emailed to ${result.email}. Send it yourself.`,
      );
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(null);
    }
  };

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const busy = pending !== null;

  const primary =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60";
  const secondary =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60";
  const danger =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8 disabled:opacity-60";
  const field =
    "w-full rounded-sm border border-line bg-background px-3 py-2 text-[0.875rem] text-ink transition-colors focus:border-ink focus:outline-none";

  const spinner = (action: Pending) =>
    pending === action ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null;

  return (
    <AdminPanel title="Review">
      <div className="space-y-2.5">
        {allows("approve") && !rejecting && (
          <button type="button" disabled={busy} onClick={() => run("approve")} className={primary}>
            {spinner("approve") ?? <Check size={15} aria-hidden />}
            Approve partner
          </button>
        )}

        {allows("reject") && !rejecting && (
          <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={danger}>
            <X size={15} aria-hidden />
            Reject application
          </button>
        )}

        {/*
          A reason is mandatory server-side, because it is what the applicant is
          emailed. The internal note is optional and never leaves the panel.
        */}
        <AnimatePresence initial={false}>
          {rejecting && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 rounded-sm bg-surface-soft p-3">
                <div>
                  <label htmlFor="reject-reason" className="mb-1.5 block text-[0.75rem] font-medium text-muted">
                    Reason, shown to the partner
                  </label>
                  <textarea
                    id="reject-reason"
                    rows={3}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="We could not verify the registration number against the public register."
                    className={field}
                  />
                </div>

                <div>
                  <label htmlFor="reject-note" className="mb-1.5 block text-[0.75rem] font-medium text-muted">
                    Internal note, never sent
                  </label>
                  <textarea
                    id="reject-note"
                    rows={2}
                    value={internalNote}
                    onChange={(event) => setInternalNote(event.target.value)}
                    className={field}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || reason.trim().length === 0}
                    onClick={() =>
                      run("reject", {
                        reason: reason.trim(),
                        ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
                      })
                    }
                    className={danger}
                  >
                    {spinner("reject")}
                    Confirm rejection
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRejecting(false)}
                    className={secondary}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        {allows("suspend") && !suspending && (
          <button type="button" disabled={busy} onClick={() => setSuspending(true)} className={danger}>
            <PauseCircle size={15} aria-hidden />
            Suspend partner
          </button>
        )}

        <AnimatePresence initial={false}>
          {suspending && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 rounded-sm bg-surface-soft p-3">
                <div>
                  <label htmlFor="suspend-reason" className="mb-1.5 block text-[0.75rem] font-medium text-muted">
                    Why is this partner being suspended?
                  </label>
                  <textarea
                    id="suspend-reason"
                    rows={3}
                    value={suspendReason}
                    onChange={(event) => setSuspendReason(event.target.value)}
                    className={field}
                  />
                </div>
                <p className="text-[0.75rem] text-muted">
                  Every open session for this partner ends immediately.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || suspendReason.trim().length === 0}
                    onClick={() => run("suspend", { reason: suspendReason.trim() })}
                    className={danger}
                  >
                    {spinner("suspend")}
                    Confirm suspension
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSuspending(false)}
                    className={secondary}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        {allows("reactivate") && (
          <button type="button" disabled={busy} onClick={() => run("reactivate")} className={primary}>
            {spinner("reactivate") ?? <RotateCcw size={15} className="rtl:-scale-x-100" aria-hidden />}
            Reinstate partner
          </button>
        )}

        {allows("resend") && (
          <button type="button" disabled={busy} onClick={handleResend} className={secondary}>
            {spinner("resend") ?? <MailPlus size={15} aria-hidden />}
            Send a new invitation link
          </button>
        )}
      </div>

      {link && (
        <div className="mt-4 rounded-sm bg-surface-soft p-3">
          <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">
            Registration link
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] break-all text-body">{link}</p>
          <button
            type="button"
            onClick={copyLink}
            className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
          >
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}

      <p
        aria-live="polite"
        className={cn(
          "mt-4 text-[0.8125rem] leading-relaxed",
          error ? "text-error-text" : "text-muted",
        )}
      >
        {error ?? message}
      </p>
    </AdminPanel>
  );
}
