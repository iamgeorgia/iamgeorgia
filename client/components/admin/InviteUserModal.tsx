"use client";

import { useRouter } from "next/navigation";
import { Check, Copy, MailCheck, MailWarning, UserPlus } from "lucide-react";
import { useState } from "react";

import { FormError, SelectInput, SubmitButton, TextInput } from "./FormControls";
import { Modal } from "@/components/ui/Modal";
import { formatPartnerDateTime } from "@/lib/admin/partners";
import { roleLabel, staffRoleDescriptions, staffRoleLabels } from "@/lib/admin/users";
import { ApiError, describeError } from "@/lib/api/client";
import { inviteUser } from "@/lib/api/users";
import { cn } from "@/lib/utils";
import { STAFF_INVITE_ROLES, type IssuedActivation } from "@/types/user";

/**
 * The link an invitation or a resend produced, with a **Copy link** button.
 *
 * Shown on screen as well as emailed, always: the email can fail (and says so
 * here when it did), and a colleague sat at the next desk is faster to send a
 * link to over chat than to wait for a mailbox.
 */
export function ActivationLinkNotice({
  issued,
  className,
}: {
  issued: IssuedActivation;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    await navigator.clipboard.writeText(issued.link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("rounded-sm bg-surface-soft p-3", className)}>
      <p
        className={cn(
          "flex items-start gap-2 text-[0.8125rem] leading-relaxed",
          issued.emailSent ? "text-body" : "text-warning-text",
        )}
      >
        {issued.emailSent ? (
          <MailCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
        ) : (
          <MailWarning size={15} className="mt-0.5 shrink-0" aria-hidden />
        )}
        {issued.emailSent
          ? `The activation link has been emailed to ${issued.email}.`
          : `The link was created but could not be emailed to ${issued.email}. Copy it and send it yourself.`}
      </p>

      <p className="mt-3 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
        Activation link
      </p>
      <p className="mt-1 font-mono text-[0.6875rem] break-all text-body">{issued.link.url}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <span className="text-[0.75rem] text-muted">
          Works until {formatPartnerDateTime(issued.link.expiresAt)}
        </span>
      </div>
    </div>
  );
}

type InviteRole = (typeof STAFF_INVITE_ROLES)[number];

interface InviteValues {
  firstName: string;
  lastName: string;
  email: string;
  role: InviteRole | "";
  position: string;
  phone: string;
}

const empty: InviteValues = {
  firstName: "",
  lastName: "",
  email: "",
  role: "",
  position: "",
  phone: "",
};

/**
 * The Staff list's "Invite staff" button and the dialog behind it.
 *
 * Super admin is not on offer: an invitation never creates one. Promoting an
 * existing, activated account is a role change on that person's page, so the
 * top rank is only ever handed to someone who has already signed in.
 */
export function InviteUserButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
      >
        <UserPlus size={15} aria-hidden />
        Invite staff
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Invite a colleague" size="md">
        {open && <InviteForm onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function InviteForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState<InviteValues>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<IssuedActivation | null>(null);

  const set = <K extends keyof InviteValues>(key: K, value: InviteValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const ready =
    values.firstName.trim().length > 0 &&
    values.lastName.trim().length > 0 &&
    values.email.trim().length > 3 &&
    values.role !== "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || values.role === "") return;

    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await inviteUser("staff", {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        role: values.role,
        ...(values.position.trim() ? { position: values.position.trim() } : {}),
        ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
      });
      setIssued(result);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const errors = caught.fieldErrors();
        // A taken address answers 409 with `{ field: "email" }` rather than a
        // zod issue, so it is mapped onto the field by hand.
        const field = (caught.details as { field?: string } | null | undefined)?.field;
        if (field) errors[field] = caught.message;
        setFieldErrors(errors);
      }
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <div className="px-6 pt-4 pb-6">
        <p className="text-[0.9375rem] leading-relaxed text-body">
          <span className="font-medium text-ink">{issued.user.fullName}</span> has been invited as{" "}
          {roleLabel(issued.user.role)}. They choose a
          password through the link below, and can sign in from then on.
        </p>

        <ActivationLinkNotice issued={issued} className="mt-4" />

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => {
              setIssued(null);
              setValues(empty);
            }}
            className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
          >
            Invite someone else
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        They are emailed a link to choose a password. The link works for 48 hours, and you can
        copy it from here once it is issued.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <TextInput
          label="First name"
          value={values.firstName}
          onChange={(event) => set("firstName", event.target.value)}
          autoComplete="off"
          required
          error={fieldErrors.firstName || undefined}
        />
        <TextInput
          label="Last name"
          value={values.lastName}
          onChange={(event) => set("lastName", event.target.value)}
          autoComplete="off"
          required
          error={fieldErrors.lastName || undefined}
        />
        <TextInput
          label="Email"
          type="email"
          value={values.email}
          onChange={(event) => set("email", event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
          className="sm:col-span-2"
          error={fieldErrors.email || undefined}
        />
        <SelectInput
          label="Role"
          value={values.role}
          onChange={(event) => set("role", event.target.value as InviteRole)}
          placeholder="Choose a role"
          options={STAFF_INVITE_ROLES.map((role) => ({ value: role, label: staffRoleLabels[role] }))}
          hint={values.role ? staffRoleDescriptions[values.role] : "Decides what they can see and change."}
          className="sm:col-span-2"
          error={fieldErrors.role || undefined}
        />
        <TextInput
          label="Position (optional)"
          value={values.position}
          onChange={(event) => set("position", event.target.value)}
          placeholder="Reservations manager"
          error={fieldErrors.position || undefined}
        />
        <TextInput
          label="Phone (optional)"
          type="tel"
          value={values.phone}
          onChange={(event) => set("phone", event.target.value)}
          error={fieldErrors.phone || undefined}
        />
      </div>

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton type="submit" busy={busy} disabled={!ready}>
          Send invitation
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
