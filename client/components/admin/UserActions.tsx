"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { Info, Loader2, LogOut, MailPlus, PauseCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useAdminViewer } from "./AdminViewerContext";
import { ActivationLinkNotice } from "./InviteUserModal";
import { roleLabel, staffRoleDescriptions, staffRoleLabels, type StaffRole } from "@/lib/admin/users";
import { describeError } from "@/lib/api/client";
import {
  changeUserRole,
  deactivateUser,
  reactivateUser,
  resendUserActivation,
  revokeUserSessions,
} from "@/lib/api/users";
import { cn } from "@/lib/utils";
import { STAFF_ROLES, type IssuedActivation, type ManagedUser } from "@/types/user";

type Pending = "role" | "deactivate" | "reactivate" | "revoke" | "resend" | null;

/**
 * What a super admin can do to one staff account.
 *
 * Which buttons appear follows the account's status, mirroring the rules in
 * `server/services/user.service.js` — an invitation is resent or deleted, not
 * deactivated; only a live account has sessions to end. The server enforces
 * all of it regardless (and the self and last-super-admin rules besides), and
 * its message is what lands under the buttons when it refuses.
 */
export function UserActions({ user }: { user: ManagedUser }) {
  const router = useRouter();
  const viewer = useAdminViewer();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedActivation | null>(null);

  const [role, setRole] = useState<StaffRole>(user.role as StaffRole);
  const [confirmingRole, setConfirmingRole] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [reason, setReason] = useState("");

  if (viewer?.id === user.id) {
    return (
      <AdminPanel title="Actions">
        <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-muted">
          <Info size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
          This is your own account. Nobody changes their own role or switches themselves off —
          another super admin has to do it, so that no one can lock the panel by accident or
          raise their own access.
        </p>
      </AdminPanel>
    );
  }

  const run = async (action: Exclude<Pending, null>, task: () => Promise<string>) => {
    setPending(action);
    setError(null);
    setMessage(null);

    try {
      setMessage(await task());
      // The page is a Server Component; refreshing re-reads the account
      // rather than patching a local copy that could drift from the server's.
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(null);
    }
  };

  const handleRole = () =>
    run("role", async () => {
      await changeUserRole("staff", user.id, role);
      setConfirmingRole(false);
      return `Now ${staffRoleLabels[role]}. Their open sessions have ended; the new role applies when they sign in again.`;
    });

  const handleDeactivate = () =>
    run("deactivate", async () => {
      await deactivateUser("staff", user.id, reason.trim() || undefined);
      setDeactivating(false);
      setReason("");
      return "Deactivated. They have been signed out everywhere and cannot sign in again.";
    });

  const handleReactivate = () =>
    run("reactivate", async () => {
      await reactivateUser("staff", user.id);
      return "Reactivated. They can sign in again with their existing password.";
    });

  const handleRevoke = () =>
    run("revoke", async () => {
      const { revoked } = await revokeUserSessions("staff", user.id);
      return revoked === 0
        ? "They had no open sessions. Nothing needed ending."
        : `Ended ${revoked === 1 ? "1 session" : `${revoked} sessions`}. They will have to sign in again.`;
    });

  const handleResend = () =>
    run("resend", async () => {
      const result = await resendUserActivation("staff", user.id);
      setIssued(result);
      return "A new link has been issued. Any earlier link has stopped working.";
    });

  const busy = pending !== null;

  const primary =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60";
  const secondary =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60";
  const danger =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8 disabled:opacity-60";
  const field =
    "w-full rounded-sm border border-line bg-background px-3 text-[0.875rem] text-ink transition-colors focus:border-ink focus:outline-none";

  const spinner = (action: Pending) =>
    pending === action ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null;

  const reveal = {
    initial: { opacity: 0, height: 0 },
    animate: { opacity: 1, height: "auto" },
    exit: { opacity: 0, height: 0 },
    transition: { duration: 0.18 },
    className: "overflow-hidden",
  } as const;

  return (
    <AdminPanel title="Actions">
      <div className="space-y-2.5">
        {/* Role */}
        <div>
          <label htmlFor="user-role" className="mb-1.5 block text-[0.75rem] font-medium text-muted">
            Role
          </label>
          <select
            id="user-role"
            value={role}
            disabled={busy}
            onChange={(event) => {
              setRole(event.target.value as StaffRole);
              setConfirmingRole(false);
            }}
            className={cn(field, "h-10")}
          >
            {STAFF_ROLES.map((value) => (
              <option key={value} value={value}>
                {staffRoleLabels[value]}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-subtle">{staffRoleDescriptions[role]}</p>
        </div>

        {role !== user.role && !confirmingRole && (
          <button type="button" disabled={busy} onClick={() => setConfirmingRole(true)} className={primary}>
            <ShieldCheck size={15} aria-hidden />
            Change role to {staffRoleLabels[role]}
          </button>
        )}

        <AnimatePresence initial={false}>
          {confirmingRole && role !== user.role && (
            <m.div {...reveal}>
              <div className="space-y-3 rounded-sm bg-surface-soft p-3">
                <p className="text-[0.8125rem] leading-relaxed text-body">
                  From {roleLabel(user.role)} to {staffRoleLabels[role]}. Every session{" "}
                  {user.fullName} has open ends now, and the new role applies when they sign in
                  again.
                </p>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={handleRole} className={primary}>
                    {spinner("role")}
                    Confirm change
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirmingRole(false);
                      setRole(user.role as StaffRole);
                    }}
                    className={secondary}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        <div className="space-y-2.5 border-t border-line pt-4">
          {user.status === "INVITED" && (
            <button type="button" disabled={busy} onClick={handleResend} className={secondary}>
              {spinner("resend") ?? <MailPlus size={15} aria-hidden />}
              Send a new activation link
            </button>
          )}

          {user.status === "ACTIVE" && (
            <button type="button" disabled={busy} onClick={handleRevoke} className={secondary}>
              {spinner("revoke") ?? <LogOut size={15} className="rtl:-scale-x-100" aria-hidden />}
              Sign out everywhere
            </button>
          )}

          {user.status === "ACTIVE" && !deactivating && (
            <button type="button" disabled={busy} onClick={() => setDeactivating(true)} className={danger}>
              <PauseCircle size={15} aria-hidden />
              Deactivate account
            </button>
          )}

          <AnimatePresence initial={false}>
            {deactivating && user.status === "ACTIVE" && (
              <m.div {...reveal}>
                <div className="space-y-3 rounded-sm bg-surface-soft p-3">
                  <div>
                    <label
                      htmlFor="deactivate-reason"
                      className="mb-1.5 block text-[0.75rem] font-medium text-muted"
                    >
                      Reason (optional, kept in the audit log)
                    </label>
                    <textarea
                      id="deactivate-reason"
                      rows={2}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      className={cn(field, "py-2")}
                    />
                  </div>
                  <p className="text-[0.75rem] text-muted">
                    They are signed out everywhere at once. You can reactivate the account later.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={handleDeactivate} className={danger}>
                      {spinner("deactivate")}
                      Confirm deactivation
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDeactivating(false)}
                      className={secondary}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </m.div>
            )}
          </AnimatePresence>

          {user.status === "DEACTIVATED" && (
            <button type="button" disabled={busy} onClick={handleReactivate} className={primary}>
              {spinner("reactivate") ?? <RotateCcw size={15} className="rtl:-scale-x-100" aria-hidden />}
              Reactivate account
            </button>
          )}

          {user.status === "INVITED" && (
            <p className="text-[0.75rem] leading-relaxed text-subtle">
              An invitation that was never used is not deactivated — delete it below if they
              should not join after all.
            </p>
          )}
        </div>
      </div>

      {issued && <ActivationLinkNotice issued={issued} className="mt-4" />}

      <p
        aria-live="polite"
        className={cn(
          "mt-4 text-[0.8125rem] leading-relaxed empty:hidden",
          error ? "text-error-text" : "text-muted",
        )}
      >
        {error ?? message}
      </p>
    </AdminPanel>
  );
}
