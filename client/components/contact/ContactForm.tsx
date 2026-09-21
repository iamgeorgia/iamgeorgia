"use client";

import { AnimatePresence, m } from "framer-motion";
import { Check, Info } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

interface FormValues {
  name: string;
  email: string;
  travellers: string;
  month: string;
  interests: string[];
  message: string;
}

type Errors = Partial<Record<"name" | "email" | "message", string>>;

const interestOptions = [
  "Mountains & hiking",
  "Wine & food",
  "Culture & history",
  "Skiing",
  "Black Sea",
  "Photography",
];

const months = [
  "Not sure yet",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const initialValues: FormValues = {
  name: "",
  email: "",
  travellers: "2",
  month: "Not sure yet",
  interests: [],
  message: "",
};

/**
 * Front-end only. Validation runs in the browser and submitting swaps to a
 * local success state — nothing is sent, stored or emailed.
 */
export function ContactForm() {
  const path = useLocalePath();
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = (): Errors => {
    const next: Errors = {};
    if (values.name.trim().length < 2) next.name = "Please tell us your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      next.email = "Please enter a valid email address.";
    }
    if (values.message.trim().length < 10) {
      next.message = "A sentence or two about your trip helps us reply properly.";
    }
    return next;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) setSubmitted(true);
  };

  const field =
    "h-12 w-full rounded-sm border bg-surface px-3.5 text-sm text-ink transition-colors focus:outline-none";
  const labelClass = "type-caption mb-1.5 block text-muted";

  if (submitted) {
    return (
      <m.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="border border-line bg-surface p-8 text-center lg:p-12"
      >
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-surface-soft text-brand-text">
          <Check size={24} aria-hidden />
        </span>
        <h2 className="type-h3 mt-6">Thank you, {values.name.split(" ")[0]}</h2>
        <p className="type-body mt-3 text-muted">
          In a live product your enquiry would now be with a trip planner. Here, it is the end
          of the prototype flow — nothing was sent or stored.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setValues(initialValues);
              setSubmitted(false);
            }}
          >
            Send another
          </Button>
          <Button href={path("/tours")}>Browse tours</Button>
        </div>
      </m.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="border border-line bg-surface p-6 lg:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-1">
          <label htmlFor="name" className={labelClass}>
            Your name *
          </label>
          <input
            id="name"
            value={values.name}
            onChange={(event) => set("name", event.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "name-error" : undefined}
            className={cn(field, errors.name ? "border-error" : "border-line focus:border-ink")}
          />
          <FieldError id="name-error" message={errors.name} />
        </div>

        <div className="sm:col-span-1">
          <label htmlFor="email" className={labelClass}>
            Email *
          </label>
          <input
            id="email"
            type="email"
            value={values.email}
            onChange={(event) => set("email", event.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
            className={cn(field, errors.email ? "border-error" : "border-line focus:border-ink")}
          />
          <FieldError id="email-error" message={errors.email} />
        </div>

        <div>
          <label htmlFor="travellers" className={labelClass}>
            Travellers
          </label>
          <select
            id="travellers"
            value={values.travellers}
            onChange={(event) => set("travellers", event.target.value)}
            className={cn(field, "border-line focus:border-ink")}
          >
            {["1", "2", "3–4", "5–8", "9+"].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="month" className={labelClass}>
            When are you thinking?
          </label>
          <select
            id="month"
            value={values.month}
            onChange={(event) => set("month", event.target.value)}
            className={cn(field, "border-line focus:border-ink")}
          >
            {months.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="mt-7">
        <legend className={labelClass}>What are you most interested in?</legend>
        <div className="flex flex-wrap gap-2">
          {interestOptions.map((interest) => {
            const selected = values.interests.includes(interest);
            return (
              <button
                key={interest}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  set(
                    "interests",
                    selected
                      ? values.interests.filter((item) => item !== interest)
                      : [...values.interests, interest],
                  )
                }
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-[0.8125rem] font-medium transition-colors",
                  selected
                    ? "border-ink bg-ink text-on-dark"
                    : "border-line text-body hover:border-subtle hover:text-ink",
                )}
              >
                {interest}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-7">
        <label htmlFor="message" className={labelClass}>
          Tell us about your trip *
        </label>
        <textarea
          id="message"
          rows={5}
          value={values.message}
          onChange={(event) => set("message", event.target.value)}
          placeholder="How long you have, what you like eating, whether you would rather walk or be driven…"
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? "message-error" : undefined}
          className={cn(
            "w-full rounded-sm border bg-surface p-3.5 text-sm text-ink transition-colors focus:outline-none",
            errors.message ? "border-error" : "border-line focus:border-ink",
          )}
        />
        <FieldError id="message-error" message={errors.message} />
      </div>

      <p className="type-caption mt-6 flex items-start gap-2.5 rounded-sm bg-surface-soft p-4 text-body">
        <Info size={15} className="mt-px shrink-0 text-brand-text" aria-hidden />
        This form is part of a front-end prototype. Nothing is submitted, emailed or stored.
      </p>

      <Button type="submit" size="lg" className="mt-6" fullWidth>
        Send enquiry
      </Button>
    </form>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <AnimatePresence>
      {message && (
        <m.p
          id={id}
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="type-caption overflow-hidden text-error-text"
        >
          <span className="block pt-1.5">{message}</span>
        </m.p>
      )}
    </AnimatePresence>
  );
}
