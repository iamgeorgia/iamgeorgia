"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { ApiError, describeError } from "@/lib/api/client";
import { deletePartner } from "@/lib/api/partners";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { Partner } from "@/types";

/**
 * Deleting a partner.
 *
 * Kept apart from the review actions, and behind a typed confirmation, because
 * it is the only irreversible thing on the screen. Suspending is what you want
 * almost every time — it withdraws access immediately and can be undone — so
 * the copy here says so rather than leaving an operator to work it out after
 * the fact.
 *
 * The confirmation is not theatre: the Partner ID travels to the server, which
 * refuses the delete unless it matches the record. Nothing about this is
 * enforced by hiding the button.
 */
export function PartnerDangerZone({ partner }: { partner: Partner }) {
  const router = useRouter();
  const path = useLocalePath();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const matches = confirm.trim().toUpperCase() === partner.reference;
  const accountCount = partner.users.length;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);

    try {
      await deletePartner(partner.id, confirm.trim());
      // Nothing left to render on this page, so leave before refreshing.
      router.replace(path("/admin/partners"));
      router.refresh();
    } catch (caught) {
      const details = caught instanceof ApiError && caught.details && typeof caught.details === "object"
        ? (caught.details as { reason?: string; bookings?: number; ledgerEntries?: number })
        : null;
      setError(
        details?.reason === "USE_TERMINATE"
          ? `This partner has ${details.bookings ?? 0} booking${details.bookings === 1 ? "" : "s"} and ${details.ledgerEntries ?? 0} ledger entr${details.ledgerEntries === 1 ? "y" : "ies"}, so it cannot be deleted. Use Terminate partner in the Review panel instead: it ends the relationship and keeps the records.`
          : describeError(caught),
      );
      setDeleting(false);
    }
  };

  return (
    <AdminPanel title="Delete this partner" className="border-error/30">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Removes the company, {accountCount === 1 ? "its account" : `all ${accountCount} accounts`},
        its bank details and its invitations. This cannot be undone, and the Partner ID{" "}
        <span className="font-mono text-ink">{partner.reference}</span> is never reissued.
      </p>

      {partner.status === "APPROVED" && (
        <p className="mt-3 flex items-start gap-2 rounded-sm bg-warning/12 p-3 text-[0.8125rem] leading-relaxed text-warning-text">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          This partner is approved and working. Suspending withdraws their access straight away
          and can be reversed — that is almost always what you want instead.
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8"
        >
          <Trash2 size={15} aria-hidden />
          Delete partner
        </button>
      ) : (
        <AnimatePresence initial={false}>
          <m.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-3 rounded-sm bg-surface-soft p-3">
              <div>
                <label
                  htmlFor="delete-confirm"
                  className="mb-1.5 block text-[0.8125rem] font-medium text-ink"
                >
                  Type <span className="font-mono">{partner.reference}</span> to confirm
                </label>
                <input
                  id="delete-confirm"
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    setError(null);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "delete-error" : undefined}
                  className={cn(
                    "h-11 w-full rounded-sm border bg-background px-3 font-mono text-[0.875rem] text-ink transition-colors focus:outline-none",
                    error ? "border-error" : "border-line focus:border-ink",
                  )}
                />
              </div>

              {error && (
                <p id="delete-error" role="alert" className="text-[0.8125rem] text-error-text">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!matches || deleting}
                  onClick={handleDelete}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {deleting ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                  ) : (
                    <Trash2 size={15} aria-hidden />
                  )}
                  Delete permanently
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setOpen(false);
                    setConfirm("");
                    setError(null);
                  }}
                  className="inline-flex h-10 w-full items-center justify-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          </m.div>
        </AnimatePresence>
      )}

      <p className="mt-4 text-[0.75rem] leading-relaxed text-subtle">
        The audit trail survives deletion, so who removed this record and when stays on file.
      </p>
    </AdminPanel>
  );
}
