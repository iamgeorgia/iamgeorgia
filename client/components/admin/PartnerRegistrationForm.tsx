"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

import { ApiError, describeError } from "@/lib/api/client";
import { createPartner, type AdminCreatePartnerInput } from "@/lib/api/partners";
import { PARTNER_KINDS, partnerKindLabels } from "@/lib/admin/partners";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { PartnerKind } from "@/types";

/**
 * Registering a partner from the panel.
 *
 * The three modes are the whole point of the screen, and they differ in how
 * much the admin has to know:
 *
 *   invite   — a name, a type and an email address. The invitee supplies the
 *              rest through a link, and the application comes back for review.
 *   activate — the admin has the company's paperwork in front of them and
 *              enters it; the contact only needs to choose a password.
 *   approve  — the same, for a company that has already been vetted offline.
 *
 * Client-side validation here is a courtesy that saves a round trip. The
 * server validates and normalizes everything again — it is the only side that
 * can check an IBAN checksum against a unique registration number — and its
 * field errors are merged back into this form's own error map.
 */

type Mode = AdminCreatePartnerInput["mode"];

interface Values {
  mode: Mode;
  name: string;
  legalName: string;
  kind: PartnerKind;
  registrationNumber: string;
  legalAddress: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  firstName: string;
  lastName: string;
  position: string;
  contactPhone: string;
  contactEmail: string;
  iban: string;
  swift: string;
  bankName: string;
  notes: string;
}

type Errors = Partial<Record<keyof Values, string>>;

const EMPTY: Values = {
  mode: "invite",
  name: "",
  legalName: "",
  kind: "HOTEL",
  registrationNumber: "",
  legalAddress: "",
  city: "",
  country: "GE",
  phone: "",
  email: "",
  website: "",
  firstName: "",
  lastName: "",
  position: "",
  contactPhone: "",
  contactEmail: "",
  iban: "",
  swift: "",
  bankName: "",
  notes: "",
};

const MODES: { value: Mode; title: string; description: string }[] = [
  {
    value: "invite",
    title: "Send a registration link",
    description:
      "Email a secure single-use link. They complete the company details and choose a password, then the application comes back to you for approval.",
  },
  {
    value: "activate",
    title: "Create the account now",
    description:
      "You enter everything. They receive a link to set a password, and the application waits for your approval.",
  },
  {
    value: "approve",
    title: "Create and approve at once",
    description:
      "For a company already vetted offline. They get a password link and full access straight away.",
  },
];

/** The server maps its own field paths; these are the ones this form owns. */
const SERVER_FIELD_MAP: Record<string, keyof Values> = {
  "company.name": "name",
  "company.legalName": "legalName",
  "company.kind": "kind",
  "company.registrationNumber": "registrationNumber",
  "company.legalAddress": "legalAddress",
  "company.city": "city",
  "company.country": "country",
  "company.phone": "phone",
  "company.email": "email",
  "company.website": "website",
  "contact.firstName": "firstName",
  "contact.lastName": "lastName",
  "contact.position": "position",
  "contact.phone": "contactPhone",
  "contact.email": "contactEmail",
  "financial.iban": "iban",
  "financial.swift": "swift",
  "financial.bankName": "bankName",
  company: "name",
};

export function PartnerRegistrationForm() {
  const router = useRouter();
  const path = useLocalePath();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    reference: string;
    name: string;
    url: string;
    emailSent: boolean;
    email: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const full = values.mode !== "invite";

  const set = (key: keyof Values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    // Clear a visible error as soon as the field is touched, but never raise a
    // new one mid-typing — nothing is more irritating than a form that scolds
    // you for an email address you are three characters into.
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const validate = (): Errors => {
    const next: Errors = {};
    const required = (key: keyof Values, message: string, min = 2) => {
      if (values[key].trim().length < min) next[key] = message;
    };

    required("name", "Enter the trading name");
    required("firstName", "Enter a first name");
    required("lastName", "Enter a last name");

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.contactEmail.trim())) {
      next.contactEmail = "Enter a valid email address";
    }

    if (full) {
      required("legalName", "Enter the registered legal entity");
      required("registrationNumber", "Enter the company registration number", 4);
      required("legalAddress", "Enter the legal address", 4);
      required("city", "Enter a city");
      if (!/^[A-Za-z]{2}$/.test(values.country.trim())) {
        next.country = "Use a two-letter country code, for example GE";
      }
      if (values.phone.replace(/\D/g, "").length < 7) {
        next.phone = "Enter a valid phone number";
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) {
        next.email = "Enter a valid company email address";
      }
    }

    // Bank details are optional, but half of them is not usable.
    if ((values.iban.trim() || values.swift.trim()) && !values.iban.trim()) {
      next.iban = "Enter the IBAN as well, or leave both blank";
    }
    if ((values.iban.trim() || values.swift.trim()) && !values.swift.trim()) {
      next.swift = "Enter the SWIFT/BIC as well, or leave both blank";
    }

    return next;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validate();
    setErrors(found);
    setFormError(null);

    if (Object.keys(found).length > 0) return;

    const trimmed = (value: string) => value.trim() || undefined;

    const body: AdminCreatePartnerInput = {
      mode: values.mode,
      company: {
        name: values.name.trim(),
        kind: values.kind,
        ...(full || values.legalName.trim() ? { legalName: trimmed(values.legalName) } : {}),
        ...(trimmed(values.registrationNumber)
          ? { registrationNumber: values.registrationNumber.trim() }
          : {}),
        ...(trimmed(values.legalAddress) ? { legalAddress: values.legalAddress.trim() } : {}),
        ...(trimmed(values.city) ? { city: values.city.trim() } : {}),
        ...(trimmed(values.country) ? { country: values.country.trim() } : {}),
        ...(trimmed(values.phone) ? { phone: values.phone.trim() } : {}),
        ...(trimmed(values.email) ? { email: values.email.trim() } : {}),
        ...(trimmed(values.website) ? { website: values.website.trim() } : {}),
      },
      contact: {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.contactEmail.trim(),
        ...(trimmed(values.position) ? { position: values.position.trim() } : {}),
        ...(trimmed(values.contactPhone) ? { phone: values.contactPhone.trim() } : {}),
      },
      ...(values.iban.trim() && values.swift.trim()
        ? {
            financial: {
              iban: values.iban.trim(),
              swift: values.swift.trim(),
              ...(trimmed(values.bankName) ? { bankName: values.bankName.trim() } : {}),
            },
          }
        : {}),
      ...(trimmed(values.notes) ? { notes: values.notes.trim() } : {}),
    };

    setSubmitting(true);

    try {
      const created = await createPartner(body);

      setResult({
        reference: created.partner.reference,
        name: created.partner.name,
        url: created.link.url,
        emailSent: created.emailSent,
        email: values.contactEmail.trim(),
      });
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fieldErrors = caught.fieldErrors();
        const mapped: Errors = {};

        for (const [serverPath, message] of Object.entries(fieldErrors)) {
          const key = SERVER_FIELD_MAP[serverPath];
          if (key) mapped[key] = message;
        }

        setErrors(mapped);
      }
      // A conflict (duplicate email, duplicate registration number) has no
      // field path, so it belongs at the top of the form rather than nowhere.
      setFormError(describeError(caught));
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (result) {
    return (
      <m.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-8 rounded-sm border border-line bg-surface p-6"
      >
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-success/12 text-success">
          <Check size={20} aria-hidden />
        </span>

        <h2 className="mt-4 font-display text-[1.375rem] text-ink">{result.name} is on the network</h2>

        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
          Partner ID <span className="font-mono text-ink">{result.reference}</span>.{" "}
          {result.emailSent
            ? `A link has been emailed to ${result.email}.`
            : `The link could not be emailed to ${result.email} — send it yourself.`}
        </p>

        {/*
          The link is shown whether or not the email went out. A mail server
          being briefly unreachable should not leave an admin with a partner
          they have no way to onboard.
        */}
        <div className="mt-5 rounded-sm bg-surface-soft p-3">
          <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">
            {values.mode === "invite" ? "Registration link" : "Password link"}
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] break-all text-body">{result.url}</p>
          <button
            type="button"
            onClick={copyLink}
            className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
          >
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={path("/admin/partners")}
            className="inline-flex h-10 items-center rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Back to partners
          </a>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setValues(EMPTY);
              setErrors({});
              setSubmitting(false);
            }}
            className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
          >
            Add another
          </button>
        </div>
      </m.section>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-6">
      <section className="rounded-sm border border-line bg-surface p-5">
        <h2 className="text-[0.9375rem] font-semibold text-ink">How do you want to onboard them?</h2>

        <div className="mt-4 space-y-2.5">
          {MODES.map((mode) => (
            <label
              key={mode.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-sm border p-3.5 transition-colors",
                values.mode === mode.value
                  ? "border-ink bg-surface-soft"
                  : "border-line hover:border-ink/30",
              )}
            >
              <input
                type="radio"
                name="mode"
                value={mode.value}
                checked={values.mode === mode.value}
                onChange={() => set("mode")(mode.value)}
                className="mt-1 size-4 shrink-0 accent-(--color-brand)"
              />
              <span className="min-w-0">
                <span className="block text-[0.875rem] font-medium text-ink">{mode.title}</span>
                <span className="mt-1 block text-[0.8125rem] leading-relaxed text-muted">
                  {mode.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <Section
        title="The business"
        description={
          full
            ? "Everything here is required before the partner can be approved."
            : "Only the trading name and type are needed now — the invitee fills in the rest."
        }
      >
        <Field id="name" label="Trading name" required value={values.name} onChange={set("name")} error={errors.name} />

        <div>
          <label htmlFor="kind" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
            Partner type <span className="text-error-text">*</span>
          </label>
          <select
            id="kind"
            value={values.kind}
            onChange={(event) => set("kind")(event.target.value)}
            className="h-11 w-full rounded-sm border border-line bg-background px-3 text-[0.875rem] text-ink transition-colors focus:border-ink focus:outline-none"
          >
            {PARTNER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {partnerKindLabels[kind]}
              </option>
            ))}
          </select>
        </div>

        <Field
          id="legalName"
          label="Registered legal entity"
          required={full}
          value={values.legalName}
          onChange={set("legalName")}
          error={errors.legalName}
        />
        <Field
          id="registrationNumber"
          label="Registration number"
          required={full}
          hint="The company identification number on the public register."
          value={values.registrationNumber}
          onChange={set("registrationNumber")}
          error={errors.registrationNumber}
        />
        <Field
          id="legalAddress"
          label="Legal address"
          required={full}
          value={values.legalAddress}
          onChange={set("legalAddress")}
          error={errors.legalAddress}
        />
        <Field id="city" label="City" required={full} value={values.city} onChange={set("city")} error={errors.city} />
        <Field
          id="country"
          label="Country"
          required={full}
          hint="Two-letter ISO code, for example GE."
          value={values.country}
          onChange={set("country")}
          error={errors.country}
        />
        <Field
          id="phone"
          label="Company phone"
          required={full}
          type="tel"
          value={values.phone}
          onChange={set("phone")}
          error={errors.phone}
        />
        <Field
          id="email"
          label="Company email"
          required={full}
          type="email"
          value={values.email}
          onChange={set("email")}
          error={errors.email}
        />
        <Field
          id="website"
          label="Website"
          hint="Optional. A bare domain is fine."
          value={values.website}
          onChange={set("website")}
          error={errors.website}
        />
      </Section>

      <Section
        title="Main contact"
        description="The person we correspond with. They receive the link and become the partner's owner account."
      >
        <Field
          id="firstName"
          label="First name"
          required
          value={values.firstName}
          onChange={set("firstName")}
          error={errors.firstName}
        />
        <Field
          id="lastName"
          label="Last name"
          required
          value={values.lastName}
          onChange={set("lastName")}
          error={errors.lastName}
        />
        <Field
          id="position"
          label="Position"
          value={values.position}
          onChange={set("position")}
          error={errors.position}
        />
        <Field
          id="contactPhone"
          label="Phone"
          type="tel"
          value={values.contactPhone}
          onChange={set("contactPhone")}
          error={errors.contactPhone}
        />
        <Field
          id="contactEmail"
          label="Email address"
          required
          type="email"
          hint="The link is bound to this address and can only be completed from it."
          value={values.contactEmail}
          onChange={set("contactEmail")}
          error={errors.contactEmail}
        />
      </Section>

      <Section
        title="Bank details"
        description="Optional here — the partner can supply them during registration. Only administrators and the partner's own owner and finance users can ever read them back."
      >
        <Field id="iban" label="IBAN" value={values.iban} onChange={set("iban")} error={errors.iban} />
        <Field id="swift" label="SWIFT / BIC" value={values.swift} onChange={set("swift")} error={errors.swift} />
        <Field
          id="bankName"
          label="Bank"
          value={values.bankName}
          onChange={set("bankName")}
          error={errors.bankName}
        />
      </Section>

      <Section title="Internal note" description="Never shown to the partner." single>
        <div className="sm:col-span-2">
          <textarea
            id="notes"
            rows={3}
            value={values.notes}
            onChange={(event) => set("notes")(event.target.value)}
            className="w-full rounded-sm border border-line bg-background px-3 py-2 text-[0.875rem] text-ink transition-colors focus:border-ink focus:outline-none"
          />
        </div>
      </Section>

      {formError && (
        <p role="alert" className="rounded-sm bg-error/8 px-4 py-3 text-[0.875rem] text-error-text">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
        >
          {submitting && <Loader2 size={16} className="animate-spin" aria-hidden />}
          {values.mode === "invite" ? "Send the invitation" : "Create the partner"}
        </button>
        <a
          href={path("/admin/partners")}
          className="text-[0.875rem] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
  single,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  single?: boolean;
}) {
  return (
    <section className="rounded-sm border border-line bg-surface p-5">
      <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{description}</p>}
      <div className={cn("mt-4 grid gap-4", !single && "sm:grid-cols-2")}>{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  type?: string;
}) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ");

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
        {label}
        {required && <span className="text-error-text"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        className={cn(
          "h-11 w-full rounded-sm border bg-background px-3 text-[0.875rem] text-ink transition-colors focus:outline-none",
          error ? "border-error" : "border-line focus:border-ink",
        )}
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
