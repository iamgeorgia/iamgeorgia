"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  LogOut,
  MailPlus,
  PauseCircle,
  RotateCcw,
  Star,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useId, useState } from "react";

import { ApiError, describeError } from "@/lib/api/client";
import {
  changeUserRole,
  deactivateUser,
  deleteUser,
  inviteUser,
  reactivateUser,
  resendUserActivation,
  revokeUserSessions,
  setPrimaryContact,
} from "@/lib/api/users";
import { useLocalePath } from "@/lib/i18n/provider";
import { dateTimeFormat } from "@/lib/intl";
import {
  TEAM_MAX,
  teamRoleDescriptions,
  teamRoleLabel,
  teamRoleLabels,
  teamStatusLabels,
  type TeamRole,
} from "@/lib/partners/team";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/types/auth";
import type { Role as RoleKey } from "@/types/partner";
import type { Role } from "@/types/rbac";
import type { IssuedActivation, ManagedUser, UserStatus } from "@/types/user";

/**
 * A partner's own team: who can sign in for the company, and what each of
 * them may do.
 *
 * Which actions appear is decided from the viewer's role and the member's
 * status, mirroring the ceilings and state checks in
 * `server/services/user.service.js`. That is a courtesy, not a control: the
 * server refuses anything out of bounds, and its message is what gets shown.
 * Every mutation ends in `router.refresh()`, so the list is always the
 * server's, never a local copy patched to look right.
 */

const FIELD =
  "h-11 w-full rounded-sm border bg-background px-3 text-[0.875rem] text-ink transition-colors focus:outline-none";

const PRIMARY =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60 sm:w-auto";
const SECONDARY =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60 sm:w-auto";
const DANGER =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8 disabled:opacity-60 sm:w-auto";

const STATUS_TONE: Record<UserStatus, string> = {
  ACTIVE: "bg-success/12 text-success",
  INVITED: "bg-warning/15 text-warning-text",
  DEACTIVATED: "bg-surface-soft text-muted",
};

// Pinned to Tbilisi so the server render and the browser agree on the day.
const formatDate = (iso: string) =>
  dateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Tbilisi",
  }).format(new Date(iso));

const formatDateTime = (iso: string) =>
  dateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tbilisi",
  }).format(new Date(iso));

export function TeamSection({
  members,
  total,
  viewer,
  grantable,
}: {
  members: ManagedUser[];
  total: number;
  viewer: SessionUser;
  /** Roles the server will let the viewer hand out. Nothing else is offered. */
  grantable: Role[];
}) {
  // Outlives the row it is about: a deleted member's row is gone after the
  // refresh, so the confirmation has to be said from up here.
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="mt-10 space-y-6">
      <InviteCard grantable={grantable} total={total} />

      <section className="rounded-sm border border-line bg-surface">
        <div className="p-5 sm:p-6">
          <h2 className="font-display text-[1.25rem] text-ink">Members</h2>
          <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
            {total} of {TEAM_MAX} places used. Invitations and deactivated members count too;
            delete one to free its place.
          </p>
          <p aria-live="polite" className="text-[0.8125rem] text-success empty:hidden">
            {notice && (
              <span className="mt-3 inline-flex items-center gap-1.5">
                <Check size={14} aria-hidden />
                {notice}
              </span>
            )}
          </p>
        </div>

        {members.length === 0 ? (
          <p className="border-t border-line p-5 text-[0.875rem] text-muted sm:p-6">
            No one is on the team yet.
          </p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                viewer={viewer}
                grantable={grantable}
                // The server checks the ceiling on both ends of a move: the
                // member gaining the primary contact and the one losing it.
                primaryHolderRole={members.find((other) => other.isPrimaryContact)?.role ?? null}
                onNotice={setNotice}
              />
            ))}
          </ul>
        )}
      </section>

      <RolesGuide />
    </div>
  );
}

// --- Invite ------------------------------------------------------------------

type FormStatus = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

const EMPTY_INVITE = { email: "", firstName: "", lastName: "" };

function InviteCard({ grantable, total }: { grantable: Role[]; total: number }) {
  const router = useRouter();
  // A second owner is a role change, never an invitation.
  const roles = grantable.filter((option) => option.key !== "PARTNER_OWNER");
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY_INVITE);
  const [role, setRole] = useState<string>(
    (roles.find((option) => option.key === "PARTNER_AGENT") ?? roles[0])?.key ?? "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });
  const [issued, setIssued] = useState<IssuedActivation | null>(null);
  const full = total >= TEAM_MAX;

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      return Object.fromEntries(Object.entries(current).filter(([field]) => field !== key));
    });
    setStatus({ kind: "idle" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "saving" });
    setErrors({});

    try {
      const result = await inviteUser("team", {
        email: values.email.trim(),
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        role,
      });

      setIssued(result);
      setValues(EMPTY_INVITE);
      setOpen(false);
      setStatus({ kind: "idle" });
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const mapped = caught.fieldErrors();
        // A taken address answers 409 with `{ field: "email" }`, not a zod issue.
        const details = caught.details as { field?: string } | null | undefined;
        if (details && typeof details === "object" && details.field) {
          mapped[details.field] = caught.message;
        }
        setErrors(mapped);
      }
      setStatus({ kind: "error", message: describeError(caught) });
    }
  };

  if (roles.length === 0) return null;

  return (
    <section className="rounded-sm border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[1.25rem] text-ink">Invite a team member</h2>
          <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
            They get an email with a link to set their own password. You can copy the link
            and send it yourself too.
          </p>
        </div>

        {!open && !full && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setIssued(null);
            }}
            className={PRIMARY}
          >
            <UserPlus size={15} aria-hidden />
            Invite someone
          </button>
        )}
      </div>

      {full && (
        <p className="mt-4 rounded-sm bg-surface-soft p-3 text-[0.8125rem] leading-relaxed text-body">
          Your team has all {TEAM_MAX} places filled. Delete an invitation or a deactivated
          member to make room.
        </p>
      )}

      {issued && (
        <div className="mt-5">
          <IssuedLink
            issued={issued}
            heading={`Invitation created for ${issued.user.fullName}`}
            onDismiss={() => setIssued(null)}
          />
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <m.form
            onSubmit={submit}
            noValidate
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field
                id="invite-firstName"
                label="First name"
                autoComplete="off"
                value={values.firstName}
                onChange={set("firstName")}
                error={errors.firstName}
              />
              <Field
                id="invite-lastName"
                label="Last name"
                autoComplete="off"
                value={values.lastName}
                onChange={set("lastName")}
                error={errors.lastName}
              />
              <Field
                id="invite-email"
                label="Email address"
                type="email"
                autoComplete="off"
                hint="This is how they will sign in."
                value={values.email}
                onChange={set("email")}
                error={errors.email}
                wide
              />

              <fieldset className="sm:col-span-2">
                <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink">Role</legend>
                <div className="grid gap-2">
                  {roles.map((option) => (
                    <label
                      key={option.key}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-sm border p-3 transition-colors",
                        role === option.key ? "border-ink bg-surface-soft" : "border-line hover:border-ink/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="invite-role"
                        value={option.key}
                        checked={role === option.key}
                        onChange={() => {
                          setRole(option.key);
                          setStatus({ kind: "idle" });
                        }}
                        className="mt-0.5 accent-brand"
                      />
                      <span className="min-w-0">
                        <span className="block text-[0.875rem] font-medium text-ink">
                          {option.name}
                        </span>
                        <span className="block text-[0.8125rem] leading-relaxed text-muted">
                          {roleDescription(option)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {errors.role && (
                  <p role="alert" className="mt-1.5 text-[0.75rem] text-error-text">
                    {errors.role}
                  </p>
                )}
              </fieldset>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <button type="submit" disabled={status.kind === "saving"} className={PRIMARY}>
                {status.kind === "saving" ? (
                  <Loader2 size={15} className="animate-spin" aria-hidden />
                ) : (
                  <MailPlus size={15} aria-hidden />
                )}
                Send invitation
              </button>
              <button
                type="button"
                disabled={status.kind === "saving"}
                onClick={() => {
                  setOpen(false);
                  setErrors({});
                  setStatus({ kind: "idle" });
                }}
                className={SECONDARY}
              >
                Cancel
              </button>
              <p aria-live="polite" className="text-[0.8125rem] text-error-text">
                {status.kind === "error" && status.message}
              </p>
            </div>
          </m.form>
        )}
      </AnimatePresence>
    </section>
  );
}

// --- One member --------------------------------------------------------------

type Action =
  | "role"
  | "primary"
  | "revoke"
  | "resend"
  | "deactivate"
  | "reactivate"
  | "delete";

function MemberRow({
  member,
  viewer,
  grantable,
  primaryHolderRole,
  onNotice,
}: {
  member: ManagedUser;
  viewer: SessionUser;
  grantable: Role[];
  primaryHolderRole: RoleKey | null;
  onNotice: (notice: string | null) => void;
}) {
  const router = useRouter();
  const path = useLocalePath();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedActivation | null>(null);
  const [role, setRole] = useState<string>(member.role);
  const [deactivating, setDeactivating] = useState(false);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  const self = member.id === viewer.id;
  // The server lets you manage an account whose role you could hand out
  // yourself, so the same list answers both questions.
  const grantableKeys = new Set(grantable.map((option) => option.key));
  const manageable = !self && grantableKeys.has(member.role);
  const mayTakePrimary = primaryHolderRole === null || grantableKeys.has(primaryHolderRole);
  const roles = grantable;
  const chosen = grantable.find((option) => option.key === role);
  const busy = pending !== null;
  const { status } = member;

  const run = async (action: Action, call: () => Promise<unknown>, success: string) => {
    setPending(action);
    setError(null);
    setMessage(null);
    onNotice(null);

    try {
      await call();
      setMessage(success);
      setDeactivating(false);
      setReason("");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(null);
    }
  };

  const resend = async () => {
    setPending("resend");
    setError(null);
    setMessage(null);
    setIssued(null);
    onNotice(null);

    try {
      setIssued(await resendUserActivation("team", member.id));
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    setPending("delete");
    setError(null);
    setMessage(null);
    onNotice(null);

    try {
      await deleteUser("team", member.id, confirmEmail.trim());
      onNotice(
        status === "INVITED"
          ? `The invitation to ${member.email} was withdrawn.`
          : `${member.fullName} was deleted from the team.`,
      );
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(null);
    }
  };

  const spinner = (action: Action) =>
    pending === action ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null;

  return (
    <li className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] font-medium text-ink">
            <span className="min-w-0 wrap-break-word">{member.fullName}</span>
            {self && (
              <span className="rounded-sm bg-surface-soft px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted">
                You
              </span>
            )}
            {member.isPrimaryContact && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-brand/10 px-1.5 py-0.5 text-[0.6875rem] font-medium text-brand-text">
                <Star size={11} aria-hidden />
                Primary contact
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[0.8125rem] break-all text-muted">{member.email}</p>
          <p className="mt-1 text-[0.75rem] text-subtle">{activityLine(member)}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-sm border border-line px-2 py-0.5 text-[0.75rem] font-medium text-body">
            {teamRoleLabel(member.role)}
          </span>
          <span
            className={cn(
              "rounded-sm px-2 py-0.5 text-[0.75rem] font-medium",
              STATUS_TONE[status],
            )}
          >
            {teamStatusLabels[status]}
          </span>
        </div>
      </div>

      {self ? (
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted">
          You can&apos;t change your own account here. Edit your own details in{" "}
          <Link
            href={path("/portal/settings")}
            className="text-brand-text underline-offset-4 hover:underline"
          >
            Settings
          </Link>
          .
        </p>
      ) : !manageable ? (
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted">
          Only an owner can change an owner&apos;s or an admin&apos;s account.
        </p>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
            className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
          >
            Manage
            <ChevronDown
              size={14}
              aria-hidden
              className={cn("transition-transform", open && "rotate-180")}
            />
          </button>

          <AnimatePresence initial={false}>
            {open && (
              <m.div
                id={panelId}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-4 rounded-sm bg-surface-soft p-4">
                  {/* Role */}
                  <div>
                    <label
                      htmlFor={`${panelId}-role`}
                      className="mb-1.5 block text-[0.8125rem] font-medium text-ink"
                    >
                      Role
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        id={`${panelId}-role`}
                        value={role}
                        disabled={busy}
                        onChange={(event) => setRole(event.target.value)}
                        className={cn(FIELD, "border-line focus:border-ink sm:max-w-56")}
                      >
                        {roles.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || role === member.role}
                        onClick={() =>
                          run(
                            "role",
                            () => changeUserRole("team", member.id, role),
                            `${member.firstName}'s role is now ${chosen?.name ?? role}. They have been signed out and will see it when they sign in again.`,
                          )
                        }
                        className={cn(SECONDARY, "h-11")}
                      >
                        {spinner("role")}
                        Change role
                      </button>
                    </div>
                    <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
                      {chosen ? roleDescription(chosen) : ""} Changing it signs them out everywhere.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap">
                    {status === "ACTIVE" && !member.isPrimaryContact && mayTakePrimary && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            "primary",
                            () => setPrimaryContact(member.id),
                            `${member.firstName} is now the primary contact. We will write to them first.`,
                          )
                        }
                        className={SECONDARY}
                      >
                        {spinner("primary") ?? <Star size={15} aria-hidden />}
                        Make primary contact
                      </button>
                    )}

                    {status === "ACTIVE" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            "revoke",
                            () => revokeUserSessions("team", member.id),
                            `${member.firstName} has been signed out on every device.`,
                          )
                        }
                        className={SECONDARY}
                      >
                        {spinner("revoke") ?? <LogOut size={15} className="rtl:-scale-x-100" aria-hidden />}
                        Sign out everywhere
                      </button>
                    )}

                    {status === "INVITED" && (
                      <button type="button" disabled={busy} onClick={resend} className={SECONDARY}>
                        {spinner("resend") ?? <MailPlus size={15} aria-hidden />}
                        Resend activation link
                      </button>
                    )}

                    {status === "DEACTIVATED" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            "reactivate",
                            () => reactivateUser("team", member.id),
                            `${member.firstName} can sign in again.`,
                          )
                        }
                        className={SECONDARY}
                      >
                        {spinner("reactivate") ?? <RotateCcw size={15} className="rtl:-scale-x-100" aria-hidden />}
                        Reactivate
                      </button>
                    )}

                    {status === "ACTIVE" && !deactivating && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDeactivating(true);
                          setDeleting(false);
                        }}
                        className={DANGER}
                      >
                        <PauseCircle size={15} aria-hidden />
                        Deactivate
                      </button>
                    )}

                    {(status === "INVITED" || status === "DEACTIVATED") && !deleting && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDeleting(true);
                          setDeactivating(false);
                        }}
                        className={DANGER}
                      >
                        <Trash2 size={15} aria-hidden />
                        {status === "INVITED" ? "Withdraw invitation" : "Delete"}
                      </button>
                    )}
                  </div>

                  {/* Deactivate: a confirmation step with an optional reason. */}
                  {deactivating && status === "ACTIVE" && (
                    <div className="space-y-3 rounded-sm border border-line bg-surface p-3">
                      <div>
                        <label
                          htmlFor={`${panelId}-reason`}
                          className="mb-1.5 block text-[0.8125rem] font-medium text-ink"
                        >
                          Reason <span className="font-normal text-muted">(optional)</span>
                        </label>
                        <input
                          id={`${panelId}-reason`}
                          value={reason}
                          maxLength={500}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="Left the company"
                          className={cn(FIELD, "border-line focus:border-ink")}
                        />
                      </div>
                      <p className="text-[0.75rem] leading-relaxed text-muted">
                        {member.firstName} is signed out at once and cannot sign in until you
                        reactivate them. Their bookings stay as they are.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(
                              "deactivate",
                              () => deactivateUser("team", member.id, reason.trim() || undefined),
                              `${member.firstName} has been deactivated and signed out.`,
                            )
                          }
                          className={DANGER}
                        >
                          {spinner("deactivate")}
                          Confirm deactivation
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setDeactivating(false)}
                          className={SECONDARY}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Delete: type the address back, as the server requires. */}
                  {deleting && (status === "INVITED" || status === "DEACTIVATED") && (
                    <div className="space-y-3 rounded-sm border border-error/40 bg-surface p-3">
                      <p className="text-[0.8125rem] leading-relaxed text-body">
                        {status === "INVITED"
                          ? "The invitation link stops working and the place on your team is freed. "
                          : "The account is removed for good and its place on your team is freed. "}
                        This cannot be undone.
                      </p>
                      <div>
                        <label
                          htmlFor={`${panelId}-confirm`}
                          className="mb-1.5 block text-[0.8125rem] font-medium text-ink"
                        >
                          Type <span className="font-mono break-all">{member.email}</span> to
                          confirm
                        </label>
                        <input
                          id={`${panelId}-confirm`}
                          type="email"
                          value={confirmEmail}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => setConfirmEmail(event.target.value)}
                          className={cn(FIELD, "border-line focus:border-ink")}
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          disabled={
                            busy ||
                            confirmEmail.trim().toLowerCase() !== member.email.toLowerCase()
                          }
                          onClick={remove}
                          className={DANGER}
                        >
                          {spinner("delete") ?? <Trash2 size={15} aria-hidden />}
                          {status === "INVITED" ? "Withdraw invitation" : "Delete for good"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDeleting(false);
                            setConfirmEmail("");
                          }}
                          className={SECONDARY}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {issued && (
                    <IssuedLink
                      issued={issued}
                      heading="New activation link"
                      replaced
                      onDismiss={() => setIssued(null)}
                    />
                  )}

                  <p
                    aria-live="polite"
                    className={cn(
                      "text-[0.8125rem] leading-relaxed empty:hidden",
                      error ? "text-error-text" : "text-success",
                    )}
                  >
                    {error ?? message}
                  </p>
                </div>
              </m.div>
            )}
          </AnimatePresence>
        </>
      )}
    </li>
  );
}

function activityLine(member: ManagedUser): string {
  if (member.status === "INVITED") {
    const when = member.invitedAt ? ` ${formatDate(member.invitedAt)}` : "";
    const by = member.invitedBy ? ` by ${member.invitedBy.fullName}` : "";
    return `Invited${when}${by}. Has not set a password yet.`;
  }

  const lastSeen = member.lastLoginAt
    ? `Last signed in ${formatDateTime(member.lastLoginAt)}`
    : "Never signed in";

  if (member.status === "DEACTIVATED") {
    const when = member.deactivatedAt ? ` on ${formatDate(member.deactivatedAt)}` : "";
    return `Deactivated${when}. ${lastSeen}.`;
  }

  return `${lastSeen}.`;
}

// --- The link to pass on -----------------------------------------------------

/**
 * An activation link, shown with a copy button whatever happened to the email:
 * when the mail did not go out it is the only way in, and when it did, the
 * inviter may still want to send it over chat.
 */
function IssuedLink({
  issued,
  heading,
  replaced = false,
  onDismiss,
}: {
  issued: IssuedActivation;
  heading: string;
  replaced?: boolean;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(issued.link.url);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div role="status" className="rounded-sm border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">{heading}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:text-ink"
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      <p
        className={cn(
          "mt-1.5 text-[0.8125rem] leading-relaxed",
          issued.emailSent ? "text-body" : "text-warning-text",
        )}
      >
        {issued.emailSent
          ? `We emailed this link to ${issued.email}.`
          : `We could not email this link to ${issued.email}. Copy it and send it yourself.`}{" "}
        It works once and expires {formatDateTime(issued.link.expiresAt)} (Tbilisi time).
        {replaced && " Any earlier link for this account has stopped working."}
      </p>

      <p className="mt-2 font-mono text-[0.6875rem] break-all text-body">{issued.link.url}</p>

      <button
        type="button"
        onClick={copyLink}
        className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
      >
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {copied ? "Copied" : "Copy link"}
      </button>
      {copyFailed && (
        <p className="mt-1 text-[0.75rem] text-error-text">
          Your browser would not copy it. Select the link above and copy it by hand.
        </p>
      )}
    </div>
  );
}

/** The server's description of a role, or ours for a built-in one it left blank. */
const roleDescription = (role: Role): string =>
  role.description ?? (role.key in teamRoleDescriptions ? teamRoleDescriptions[role.key as TeamRole] : "");

// --- What the roles mean -----------------------------------------------------

function RolesGuide() {
  return (
    <section className="rounded-sm border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-display text-[1.25rem] text-ink">What each role can do</h2>
      <dl className="mt-4 space-y-3">
        {(Object.keys(teamRoleLabels) as TeamRole[]).map((role) => (
          <div key={role} className="sm:flex sm:gap-4">
            <dt className="text-[0.875rem] font-medium text-ink sm:w-24 sm:shrink-0">
              {teamRoleLabels[role]}
            </dt>
            <dd className="text-[0.8125rem] leading-relaxed text-muted">
              {teamRoleDescriptions[role]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// --- Shared ------------------------------------------------------------------

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  autoComplete,
  wide,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  wide?: boolean;
}) {
  const describedBy = [error && `${id}-error`, hint && !error && `${id}-hint`]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn(wide && "sm:col-span-2")}>
      <label htmlFor={id} className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        className={cn(FIELD, error ? "border-error" : "border-line focus:border-ink")}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-[0.75rem] text-muted">
          {hint}
        </p>
      )}
      <AnimatePresence>
        {error && (
          <m.p
            id={`${id}-error`}
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-1.5 overflow-hidden text-[0.75rem] text-error-text"
          >
            {error}
          </m.p>
        )}
      </AnimatePresence>
    </div>
  );
}
