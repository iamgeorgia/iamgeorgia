"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { Check, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiError, describeError } from "@/lib/api/client";
import {
  changePassword,
  saveOwnFinancial,
  updateOwnAccount,
  updateOwnProfile,
} from "@/lib/api/partners";
import { partnerKindLabels } from "@/lib/admin/partners";
import { cn } from "@/lib/utils";
import type { Partner, PartnerFinancial } from "@/types";
import { can, type SessionUser } from "@/types/auth";

/**
 * Partner profile settings.
 *
 * Four independent forms rather than one. Each saves on its own, so a failed
 * IBAN cannot discard a corrected address typed in the same sitting, and each
 * sends only the section it owns — which keeps every request inside the
 * server's allow-list for that endpoint.
 *
 * The fields the approval was granted against are shown, but locked: a company
 * that could rewrite its own legal entity or registration number after being
 * vetted would make the review meaningless. The server drops them from a
 * profile update regardless of what this renders.
 */

const FIELD =
  "h-11 w-full rounded-sm border bg-background px-3 text-[0.875rem] text-ink transition-colors focus:outline-none";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

export function PortalSettings({
  partner,
  user,
  financial,
}: {
  partner: Partner;
  user: SessionUser;
  financial: PartnerFinancial | null;
}) {
  return (
    <div className="mt-10 space-y-6">
      {/* Absent for a role that may not edit the company (an agent, a
          finance user): a form that answers 403 on save is worse than none. */}
      {can(user, "partner.profile.write") && <CompanySection partner={partner} />}
      <AccountSection user={user} />
      {/* Absent entirely for a role that may not see bank details. */}
      {can(user, "partner.financial.read") && <FinancialSection financial={financial} />}
      <PasswordSection />
    </div>
  );
}

// --- Company -----------------------------------------------------------------

function CompanySection({ partner }: { partner: Partner }) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: partner.name,
    legalAddress: partner.legalAddress ?? "",
    taxId: partner.taxId ?? "",
    city: partner.city ?? "",
    phone: partner.phone ?? "",
    email: partner.email ?? "",
    website: partner.website ?? "",
  });
  const [links, setLinks] = useState(partner.socialLinks);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      // Clear the error on the field being typed into, and leave the rest.
      return Object.fromEntries(Object.entries(current).filter(([field]) => field !== key));
    });
    setStatus({ kind: "idle" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "saving" });
    setErrors({});

    try {
      await updateOwnProfile({
        name: values.name.trim(),
        legalAddress: values.legalAddress.trim(),
        // An empty box means "remove it", which the server accepts as null.
        taxId: values.taxId.trim() || null,
        city: values.city.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        // An empty box means "remove it", which the server accepts as null.
        website: values.website.trim() || null,
        socialLinks: links.filter((link) => link.label.trim() && link.url.trim()),
      });

      setStatus({ kind: "saved" });
      router.refresh();
    } catch (caught) {
      handleFailure(caught, setErrors, setStatus, (path) => path.replace(/^company\./, ""));
    }
  };

  return (
    <Section
      title="Company"
      description="How we list and contact your business."
      status={status}
      onSubmit={submit}
    >
      <Field id="name" label="Trading name" value={values.name} onChange={set("name")} error={errors.name} />
      <Field id="city" label="City" value={values.city} onChange={set("city")} error={errors.city} />
      <Field
        id="legalAddress"
        label="Legal address"
        value={values.legalAddress}
        onChange={set("legalAddress")}
        error={errors.legalAddress}
        wide
      />
      <Field
        id="taxId"
        label="Tax ID / VAT number"
        hint="Printed as the buyer on your invoices."
        value={values.taxId}
        onChange={set("taxId")}
        error={errors.taxId}
        wide
      />
      <Field id="phone" label="Company phone" type="tel" value={values.phone} onChange={set("phone")} error={errors.phone} />
      <Field id="email" label="Company email" type="email" value={values.email} onChange={set("email")} error={errors.email} />
      <Field
        id="website"
        label="Website"
        hint="Leave blank to remove it."
        value={values.website}
        onChange={set("website")}
        error={errors.website}
        wide
      />

      <div className="sm:col-span-2">
        <p className="mb-2 text-[0.8125rem] font-medium text-ink">Social pages</p>

        <div className="space-y-2">
          {links.map((link, index) => (
            <div key={index} className="flex flex-wrap gap-2">
              <input
                aria-label={`Social page ${index + 1} label`}
                placeholder="Instagram"
                value={link.label}
                onChange={(event) =>
                  setLinks(links.map((l, i) => (i === index ? { ...l, label: event.target.value } : l)))
                }
                className={cn(FIELD, "border-line focus:border-ink sm:w-40")}
              />
              <input
                aria-label={`Social page ${index + 1} address`}
                placeholder="https://instagram.com/yourcompany"
                value={link.url}
                onChange={(event) =>
                  setLinks(links.map((l, i) => (i === index ? { ...l, url: event.target.value } : l)))
                }
                className={cn(FIELD, "border-line focus:border-ink min-w-0 flex-1")}
              />
              <button
                type="button"
                onClick={() => setLinks(links.filter((_, i) => i !== index))}
                aria-label={`Remove social page ${index + 1}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-sm border border-line text-muted transition-colors hover:border-error/40 hover:text-error-text"
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        {links.length < 10 && (
          <button
            type="button"
            onClick={() => setLinks([...links, { label: "", url: "" }])}
            className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
          >
            <Plus size={13} aria-hidden />
            Add a page
          </button>
        )}
      </div>

      {/*
        Shown so a partner can read back what we hold, and locked because these
        are the facts the approval was granted against.
      */}
      <div className="mt-2 rounded-sm bg-surface-soft p-4 sm:col-span-2">
        <p className="flex items-center gap-1.5 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
          <Lock size={11} aria-hidden />
          Verified at approval
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {[
            { label: "Partner ID", value: partner.reference, mono: true },
            { label: "Registered legal entity", value: partner.legalName ?? "—" },
            { label: "Registration number", value: partner.registrationNumber ?? "—" },
            { label: "Partner type", value: partnerKindLabels[partner.kind] },
            { label: "Country", value: partner.country ?? "—" },
          ].map((item) => (
            <div key={item.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-[0.8125rem] text-muted">{item.label}</dt>
              <dd className={cn("text-end text-[0.8125rem] text-ink", item.mono && "font-mono")}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[0.75rem] leading-relaxed text-subtle">
          These were checked when your application was approved, so they can only be changed by
          our partnerships team. Reply to any email from us if one of them is wrong.
        </p>
      </div>
    </Section>
  );
}

// --- The person --------------------------------------------------------------

function AccountSection({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [values, setValues] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    position: user.position ?? "",
    phone: user.phone ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus({ kind: "idle" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "saving" });
    setErrors({});

    try {
      await updateOwnAccount({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        position: values.position.trim() || null,
        phone: values.phone.trim() || null,
      });

      setStatus({ kind: "saved" });
      router.refresh();
    } catch (caught) {
      handleFailure(caught, setErrors, setStatus);
    }
  };

  return (
    <Section
      title="Your details"
      description="The name and number we use when we get in touch with you."
      status={status}
      onSubmit={submit}
    >
      <Field id="firstName" label="First name" value={values.firstName} onChange={set("firstName")} error={errors.firstName} />
      <Field id="lastName" label="Last name" value={values.lastName} onChange={set("lastName")} error={errors.lastName} />
      <Field id="position" label="Position" value={values.position} onChange={set("position")} error={errors.position} />
      <Field id="userPhone" label="Direct phone" type="tel" value={values.phone} onChange={set("phone")} error={errors.phone} />

      {/*
        Read-only: this is the login identifier and the address every decision
        was sent to, so moving it needs a verification round trip rather than a
        text field.
      */}
      <div className="sm:col-span-2">
        <label htmlFor="userEmail" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
          Email address
        </label>
        <input
          id="userEmail"
          type="email"
          value={user.email}
          readOnly
          aria-describedby="userEmail-hint"
          className={cn(FIELD, "cursor-not-allowed border-line bg-surface-soft text-muted")}
        />
        <p id="userEmail-hint" className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-muted">
          <Lock size={11} aria-hidden />
          This is how you sign in. Ask us to change it and we will move your account across.
        </p>
      </div>
    </Section>
  );
}

// --- Bank details ------------------------------------------------------------

function FinancialSection({ financial }: { financial: PartnerFinancial | null }) {
  const router = useRouter();
  const [values, setValues] = useState({
    iban: financial?.iban ?? "",
    swift: financial?.swift ?? "",
    bankName: financial?.bankName ?? "",
    accountHolder: financial?.accountHolder ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus({ kind: "idle" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "saving" });
    setErrors({});

    try {
      await saveOwnFinancial({
        iban: values.iban.trim(),
        swift: values.swift.trim(),
        ...(values.bankName.trim() ? { bankName: values.bankName.trim() } : {}),
        ...(values.accountHolder.trim() ? { accountHolder: values.accountHolder.trim() } : {}),
      });

      setStatus({ kind: "saved" });
      router.refresh();
    } catch (caught) {
      handleFailure(caught, setErrors, setStatus);
    }
  };

  return (
    <Section
      title="Bank details"
      description="Where we send your payments. Only you and our finance team can read these."
      status={status}
      onSubmit={submit}
      submitLabel={financial ? "Save changes" : "Add bank details"}
    >
      <Field id="iban" label="Bank account number / IBAN" value={values.iban} onChange={set("iban")} error={errors.iban} />
      <Field id="swift" label="SWIFT / BIC" value={values.swift} onChange={set("swift")} error={errors.swift} />
      <Field id="bankName" label="Bank" value={values.bankName} onChange={set("bankName")} error={errors.bankName} />
      <Field
        id="accountHolder"
        label="Account holder"
        value={values.accountHolder}
        onChange={set("accountHolder")}
        error={errors.accountHolder}
      />
    </Section>
  );
}

// --- Password ----------------------------------------------------------------

function PasswordSection() {
  const [values, setValues] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus({ kind: "idle" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    if (values.next !== values.confirm) {
      setErrors({ confirm: "Both passwords must match" });
      return;
    }

    setStatus({ kind: "saving" });

    try {
      await changePassword(values.current, values.next);

      setValues({ current: "", next: "", confirm: "" });
      setStatus({ kind: "saved" });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setErrors({ current: caught.message });
        setStatus({ kind: "idle" });
        return;
      }
      handleFailure(caught, setErrors, setStatus, (path) =>
        path === "newPassword" ? "next" : path === "currentPassword" ? "current" : path,
      );
    }
  };

  return (
    <Section
      title="Password"
      description="Changing it signs you out everywhere else, but keeps you signed in here."
      status={status}
      savedMessage="Password changed. Other devices have been signed out."
      onSubmit={submit}
      submitLabel="Change password"
    >
      <Field
        id="current"
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={values.current}
        onChange={set("current")}
        error={errors.current}
        wide
      />
      <Field
        id="next"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        value={values.next}
        onChange={set("next")}
        error={errors.next}
      />
      <Field
        id="confirm"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={values.confirm}
        onChange={set("confirm")}
        error={errors.confirm}
      />
    </Section>
  );
}

// --- Shared ------------------------------------------------------------------

/**
 * Turns an ApiError into field errors where it can, and a form-level message
 * where it cannot. `remap` translates the server's field path into whatever
 * this particular form calls it.
 */
function handleFailure(
  caught: unknown,
  setErrors: (errors: Record<string, string>) => void,
  setStatus: (status: Status) => void,
  remap: (path: string) => string = (path) => path,
) {
  if (caught instanceof ApiError) {
    const mapped: Record<string, string> = {};

    for (const [path, message] of Object.entries(caught.fieldErrors())) {
      mapped[remap(path)] = message;
    }

    setErrors(mapped);
  }

  setStatus({ kind: "error", message: describeError(caught) });
}

function Section({
  title,
  description,
  children,
  status,
  onSubmit,
  submitLabel = "Save changes",
  savedMessage = "Saved.",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  status: Status;
  onSubmit: (event: React.FormEvent) => void;
  submitLabel?: string;
  savedMessage?: string;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="rounded-sm border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-display text-[1.25rem] text-ink">{title}</h2>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">{description}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line pt-4">
        <button
          type="submit"
          disabled={status.kind === "saving"}
          className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
        >
          {status.kind === "saving" && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {submitLabel}
        </button>

        <p
          aria-live="polite"
          className={cn(
            "text-[0.8125rem]",
            status.kind === "error" ? "text-error-text" : "text-success",
          )}
        >
          {status.kind === "saved" && (
            <span className="inline-flex items-center gap-1.5">
              <Check size={14} aria-hidden />
              {savedMessage}
            </span>
          )}
          {status.kind === "error" && status.message}
        </p>
      </div>
    </form>
  );
}

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
