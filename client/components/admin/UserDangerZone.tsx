"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useAdminViewer } from "./AdminViewerContext";
import { describeError } from "@/lib/api/client";
import { deleteUser } from "@/lib/api/users";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ManagedUser } from "@/types/user";

/**
 * Deleting a staff account.
 *
 * Offered only for an invitation nobody used or an account already switched
 * off: an active account is deactivated first, so that "gone" is always two
 * deliberate steps. The typed address travels to the server, which refuses
 * the delete unless it matches — the confirmation is a check, not theatre.
 */
export function UserDangerZone({ user }: { user: ManagedUser }) {
  const router = useRouter();
  const path = useLocalePath();
  const viewer = useAdminViewer();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (viewer?.id === user.id || user.status === "ACTIVE") return null;

  const matches = confirm.trim() === user.email;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);

    try {
      await deleteUser("staff", user.id, confirm.trim());
      // Nothing left to render here, so leave before refreshing.
      router.replace(path("/admin/users"));
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
      setDeleting(false);
    }
  };

  return (
    <AdminPanel title="Delete this account" className="border-error/30">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        {user.status === "INVITED"
          ? "Withdraws the invitation and removes the account. The link stops working."
          : "Removes the account for good. Deactivated is usually enough — it keeps the name on file and can be undone."}{" "}
        Bookings they made keep their record; only the link to this person goes.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8"
        >
          <Trash2 size={15} aria-hidden />
          {user.status === "INVITED" ? "Delete invitation" : "Delete account"}
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
                  htmlFor="delete-user-confirm"
                  className="mb-1.5 block text-[0.8125rem] font-medium text-ink"
                >
                  Type <span className="font-mono break-all">{user.email}</span> to confirm
                </label>
                <input
                  id="delete-user-confirm"
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    setError(null);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "delete-user-error" : undefined}
                  className={cn(
                    "h-11 w-full rounded-sm border bg-background px-3 font-mono text-[0.875rem] text-ink transition-colors focus:outline-none",
                    error ? "border-error" : "border-line focus:border-ink",
                  )}
                />
              </div>

              {error && (
                <p id="delete-user-error" role="alert" className="text-[0.8125rem] text-error-text">
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
        The audit log keeps the email address, so who removed this account and when stays on file.
      </p>
    </AdminPanel>
  );
}
