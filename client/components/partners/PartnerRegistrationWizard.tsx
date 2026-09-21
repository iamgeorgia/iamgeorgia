"use client";

import { AnimatePresence, m } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock } from "lucide-react";
import { useState } from "react";

import { ApiError, describeError } from "@/lib/api/client";
import { acceptInvitation } from "@/lib/api/partners";
import { PARTNER_KINDS, partnerKindLabels } from "@/lib/admin/partners";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { InvitationPreview, PartnerKind } from "@/types";

/**
 * The invited partner's registration form.
 *
 * Four steps rather than one long page. The information is genuinely in four
 * groups — the company, the person, where money goes, and the account — and
 * asking for an IBAN in the same breath as a trading name is what makes
 * onboarding forms get abandoned.
 *
 * Each step validates before it will advance, so an error is always visible on
 * the screen that caused it. The server validates everything again on submit,
 * and anything it rejects is mapped back to the step that owns the field, which
 * is then reopened.
 */

interface Values {
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
  iban: string;
  swift: string;
  bankName: string;
  accountHolder: string;
  password: string;
  confirmPassword: string;
}

type Errors = Partial<Record<keyof Values, string>>;

const STEPS = ["Company", "Contact", "Payment", "Password"] as const;

/** Which step owns which field, so a server error reopens the right one. */
const STEP_FIELDS: (keyof Values)[][] = [
  ["name", "legalName", "kind", "registrationNumber", "legalAddress", "city", "country", "phone", "email", "website"],
  ["firstName", "lastName", "position", "contactPhone"],
  ["iban", "swift", "bankName", "accountHolder"],
  ["password", "confirmPassword"],
];

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
  "financial.iban": "iban",
  "financial.swift": "swift",
  "financial.bankName": "bankName",
  "financial.accountHolder": "accountHolder",
  password: "password",
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 12;

export function PartnerRegistrationWizard({
  token,
  invitation,
}: {
  token: string;
  invitation: InvitationPreview;
}) {
  const path = useLocalePath();
  const company = invitation.company;
  const prefill = invitation.prefill.contact ?? {};

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>({
    // Anything the admin already entered is replayed, so the invitee is not
    // asked to retype what we asked them to confirm.
    name: company?.name ?? "",
    legalName: company?.legalName ?? "",
    kind: company?.kind ?? "HOTEL",
    registrationNumber: company?.registrationNumber ?? "",
    legalAddress: company?.legalAddress ?? "",
    city: company?.city ?? "",
    country: company?.country ?? "GE",
    phone: company?.phone ?? "",
    email: company?.email ?? "",
    website: company?.website ?? "",
    firstName: prefill.firstName ?? "",
    lastName: prefill.lastName ?? "",
    position: prefill.position ?? "",
    contactPhone: prefill.phone ?? "",
    iban: "",
    swift: "",
    bankName: "",
    accountHolder: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ reference: string; companyName: string } | null>(null);

  const set = (key: keyof Values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const validateStep = (index: number): Errors => {
    const next: Errors = {};
    const required = (key: keyof Values, message: string, min = 2) => {
      if (values[key].trim().length < min) next[key] = message;
    };

    if (index === 0) {
      required("name", "Enter your trading name");
      required("legalName", "Enter the registered legal entity");
      required("registrationNumber", "Enter your company registration number", 4);
      required("legalAddress", "Enter the legal address", 4);
      required("city", "Enter a city");
      if (!/^[A-Za-z]{2}$/.test(values.country.trim())) {
        next.country = "Use a two-letter country code, for example GE";
      }
      if (values.phone.replace(/\D/g, "").length < 7) next.phone = "Enter a valid phone number";
      if (!EMAIL.test(values.email.trim())) next.email = "Enter a valid company email address";
    }

    if (index === 1) {
      required("firstName", "Enter your first name");
      required("lastName", "Enter your last name");
    }

    if (index === 2) {
      // Checked properly on the server, which runs the mod-97 checksum. This is
      // only enough to catch a blank or an obvious typo before a round trip.
      if (values.iban.replace(/\s/g, "").length < 15) next.iban = "Enter your IBAN";
      if (!/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(values.swift.replace(/\s/g, ""))) {
        next.swift = "Enter a valid SWIFT/BIC code";
      }
    }

    if (index === 3) {
      if (values.password.length < MIN_PASSWORD) {
        next.password = `Use at least ${MIN_PASSWORD} characters`;
      }
      if (values.confirmPassword !== values.password) {
        next.confirmPassword = "Both passwords must match";
      }
    }

    return next;
  };

  const advance = () => {
    const found = validateStep(step);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep((current) => current + 1);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validateStep(3);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    const optional = (value: string) => (value.trim() ? value.trim() : undefined);

    setSubmitting(true);

    try {
      const result = await acceptInvitation(token, {
        company: {
          name: values.name.trim(),
          legalName: values.legalName.trim(),
          kind: values.kind,
          registrationNumber: values.registrationNumber.trim(),
          legalAddress: values.legalAddress.trim(),
          city: values.city.trim(),
          country: values.country.trim(),
          phone: values.phone.trim(),
          email: values.email.trim(),
          ...(optional(values.website) ? { website: values.website.trim() } : {}),
        },
        contact: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          // The account email is the invited address. It is not editable here,
          // and the server checks it against the invitation regardless.
          email: invitation.email,
          ...(optional(values.position) ? { position: values.position.trim() } : {}),
          ...(optional(values.contactPhone) ? { phone: values.contactPhone.trim() } : {}),
        },
        financial: {
          iban: values.iban.trim(),
          swift: values.swift.trim(),
          ...(optional(values.bankName) ? { bankName: values.bankName.trim() } : {}),
          ...(optional(values.accountHolder) ? { accountHolder: values.accountHolder.trim() } : {}),
        },
        password: values.password,
      });

      setDone({ reference: result.reference, companyName: result.companyName });
    } catch (caught) {
      if (caught instanceof ApiError) {
        const mapped: Errors = {};

        for (const [serverPath, message] of Object.entries(caught.fieldErrors())) {
          const key = SERVER_FIELD_MAP[serverPath];
          if (key) mapped[key] = message;
        }

        setErrors(mapped);

        // Reopen the earliest step that has a problem, rather than leaving the
        // person on the password screen wondering what is wrong with it.
        const offending = STEP_FIELDS.findIndex((fields) => fields.some((field) => mapped[field]));
        if (offending >= 0) setStep(offending);
      }
      setFormError(describeError(caught));
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <m.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-10 rounded-sm border border-line bg-surface p-8 text-center"
      >
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
          <Check size={24} aria-hidden />
        </span>

        <h2 className="mt-6 font-display text-[1.75rem] leading-tight text-ink">
          Thank you — your application is with us
        </h2>

        <p className="mt-4 text-[1rem] leading-relaxed text-muted">
          {done.companyName} has been registered under Partner ID{" "}
          <span className="font-mono text-ink">{done.reference}</span>. Quote it in any
          correspondence with us.
        </p>

        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          Our partnerships team reviews every application by hand. We will email you as soon as
          there is a decision — you can sign in at any time to check where it has got to.
        </p>

        <a
          href={path("/portal")}
          className="mt-8 inline-flex h-12 items-center rounded-sm bg-brand px-6 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover"
        >
          Sign in to your account
        </a>
      </m.section>
    );
  }

  const last = step === STEPS.length - 1;

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-10">
      <ol className="flex flex-wrap gap-2" aria-label="Registration progress">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors",
                index === step
                  ? "bg-ink text-on-dark"
                  : index < step
                    ? "bg-success/12 text-success"
                    : "bg-surface-soft text-muted",
              )}
            >
              {index < step ? <Check size={13} aria-hidden /> : <span>{index + 1}</span>}
              {label}
            </span>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <m.section
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18 }}
          className="mt-6 rounded-sm border border-line bg-surface p-5 sm:p-6"
        >
          {step === 0 && (
            <Fieldset
              legend="About the company"
              hint="As it appears on your registration certificate."
            >
              <Field id="name" label="Trading name" required value={values.name} onChange={set("name")} error={errors.name} />
              <Field id="legalName" label="Registered legal entity" required value={values.legalName} onChange={set("legalName")} error={errors.legalName} />

              <div>
                <label htmlFor="kind" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
                  What do you provide? <span className="text-error-text">*</span>
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

              <Field id="registrationNumber" label="Company registration number" required value={values.registrationNumber} onChange={set("registrationNumber")} error={errors.registrationNumber} />
              <Field id="legalAddress" label="Legal address" required value={values.legalAddress} onChange={set("legalAddress")} error={errors.legalAddress} />
              <Field id="city" label="City" required value={values.city} onChange={set("city")} error={errors.city} />
              <Field id="country" label="Country" required hint="Two-letter code, e.g. GE." value={values.country} onChange={set("country")} error={errors.country} />
              <Field id="phone" label="Company phone" required type="tel" value={values.phone} onChange={set("phone")} error={errors.phone} />
              <Field id="email" label="Company email" required type="email" value={values.email} onChange={set("email")} error={errors.email} />
              <Field id="website" label="Website or social page" hint="Optional." value={values.website} onChange={set("website")} error={errors.website} />
            </Fieldset>
          )}

          {step === 1 && (
            <Fieldset
              legend="Who should we speak to?"
              hint="This person becomes the owner of your account and can add colleagues later."
            >
              <Field id="firstName" label="First name" required value={values.firstName} onChange={set("firstName")} error={errors.firstName} />
              <Field id="lastName" label="Last name" required value={values.lastName} onChange={set("lastName")} error={errors.lastName} />
              <Field id="position" label="Position" hint="Optional." value={values.position} onChange={set("position")} error={errors.position} />
              <Field id="contactPhone" label="Direct phone" hint="Optional." type="tel" value={values.contactPhone} onChange={set("contactPhone")} error={errors.contactPhone} />

              {/*
                Read-only, and not submitted from here. The invitation is bound
                to one address; the server refuses any other, so letting it be
                edited would only invite a confusing rejection.
              */}
              <div className="sm:col-span-2">
                <label htmlFor="invited-email" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
                  Email address
                </label>
                <input
                  id="invited-email"
                  type="email"
                  value={invitation.email}
                  readOnly
                  aria-describedby="invited-email-hint"
                  className="h-11 w-full cursor-not-allowed rounded-sm border border-line bg-surface-soft px-3 text-[0.875rem] text-muted"
                />
                <p id="invited-email-hint" className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-muted">
                  <Lock size={11} aria-hidden />
                  Your invitation was issued to this address and can only be completed from it.
                </p>
              </div>
            </Fieldset>
          )}

          {step === 2 && (
            <Fieldset
              legend="Where should we send payments?"
              hint="Only our finance team and your own owner and finance users can ever read these back."
            >
              <Field id="iban" label="Bank account number / IBAN" required value={values.iban} onChange={set("iban")} error={errors.iban} />
              <Field id="swift" label="SWIFT / BIC" required value={values.swift} onChange={set("swift")} error={errors.swift} />
              <Field id="bankName" label="Bank" hint="Optional." value={values.bankName} onChange={set("bankName")} error={errors.bankName} />
              <Field id="accountHolder" label="Account holder" hint="Optional, if different from the legal entity." value={values.accountHolder} onChange={set("accountHolder")} error={errors.accountHolder} />
            </Fieldset>
          )}

          {step === 3 && (
            <Fieldset
              legend="Choose a password"
              hint={`At least ${MIN_PASSWORD} characters. A short phrase you will remember beats a short word with symbols in it.`}
            >
              <Field id="password" label="Password" required type="password" autoComplete="new-password" value={values.password} onChange={set("password")} error={errors.password} />
              <Field id="confirmPassword" label="Confirm password" required type="password" autoComplete="new-password" value={values.confirmPassword} onChange={set("confirmPassword")} error={errors.confirmPassword} />

              <p className="text-[0.8125rem] leading-relaxed text-muted sm:col-span-2">
                Submitting sends your application to our partnerships team. You will be able to sign
                in straight away to follow its progress, but the platform itself opens once you are
                approved.
              </p>
            </Fieldset>
          )}
        </m.section>
      </AnimatePresence>

      {formError && (
        <p role="alert" className="mt-4 rounded-sm bg-error/8 px-4 py-3 text-[0.875rem] text-error-text">
          {formError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((current) => current - 1)}
            className="inline-flex h-12 items-center gap-2 rounded-sm border border-line bg-surface px-5 text-[0.9375rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
          >
            <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden />
            Back
          </button>
        )}

        {last ? (
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-12 items-center gap-2 rounded-sm bg-brand px-6 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            {submitting && <Loader2 size={16} className="animate-spin" aria-hidden />}
            Submit application
          </button>
        ) : (
          <button
            type="button"
            onClick={advance}
            className="inline-flex h-12 items-center gap-2 rounded-sm bg-brand px-6 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            Continue
            <ArrowRight size={16} className="rtl:-scale-x-100" aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}

function Fieldset({
  legend,
  hint,
  children,
}: {
  legend: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="font-display text-[1.25rem] text-ink">{legend}</legend>
      {hint && <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">{hint}</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
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
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
}) {
  const describedBy = [error && `${id}-error`, hint && !error && `${id}-hint`]
    .filter(Boolean)
    .join(" ");

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
        autoComplete={autoComplete}
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
