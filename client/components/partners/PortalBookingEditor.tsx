"use client";

import { useRouter } from "next/navigation";
import { Check, Loader2, Lock } from "lucide-react";
import { useState } from "react";

import { amendBooking } from "@/lib/api/bookings";
import { ApiError, describeError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { Booking } from "@/types/booking";

/**
 * Amending a booking, from the partner side.
 *
 * The boundary is the point of this form. What a partner may change is the
 * paperwork around the sale — who is arriving, how to reach them, and what the
 * property should be told. What they may not change is the sale: dates, rooms,
 * board and every figure are shown here, locked, with the reason stated, rather
 * than left off the screen. A partner who cannot find the date field should
 * discover *why* here, not by writing to support.
 *
 * That boundary is not enforced by this component. The server's schema is
 * strict and simply has no field for a date or an amount, so the rule holds
 * whether the request comes from this form or from curl.
 */

const FIELD =
  "h-11 w-full rounded-sm border bg-surface px-3 text-[0.875rem] text-ink transition-colors placeholder:text-subtle focus:outline-none";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/** Splits the denormalised lead name only when the rooming list cannot answer. */
const leadNameOf = (booking: Booking) => {
  const row = booking.bookingRooms.flatMap((room) => room.guests).find((guest) => guest.isLead);
  if (row) return { firstName: row.firstName, lastName: row.lastName };

  const [first, ...rest] = booking.leadGuestName.split(" ");
  return { firstName: first ?? "", lastName: rest.join(" ") };
};

export function PortalBookingEditor({ booking }: { booking: Booking }) {
  const router = useRouter();
  const lead = leadNameOf(booking);

  const [values, setValues] = useState({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: booking.leadGuestEmail,
    phone: booking.leadGuestPhone ?? "",
    specialRequests: booking.specialRequests ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // A stay that is over, or one that was cancelled, is a record rather than a
  // plan. The server refuses either with a 409; saying so before the button is
  // pressed is the difference between a form and a trap.
  const amendable = booking.status === "CONFIRMED" || booking.status === "PENDING";

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) =>
      current[key]
        ? Object.fromEntries(Object.entries(current).filter(([field]) => field !== key))
        : current,
    );
    setStatus({ kind: "idle" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "saving" });
    setErrors({});

    try {
      await amendBooking(booking.reference, {
        leadGuest: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          email: values.email.trim(),
          // An empty box means "remove it", which the server accepts as null.
          phone: values.phone.trim() || null,
        },
        specialRequests: values.specialRequests.trim() || null,
      });

      setStatus({ kind: "saved" });
      // The record above this form is server-rendered, so the corrected name
      // has to come back down rather than be patched in locally.
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = caught.fieldErrors();
        // The server nests them under `leadGuest.`; the inputs are flat.
        setErrors(
          Object.fromEntries(
            Object.entries(fields).map(([path, message]) => [
              path.replace(/^leadGuest\./, ""),
              message,
            ]),
          ),
        );
      }

      setStatus({
        kind: "error",
        message: describeError(caught, "Something went wrong. Nothing was changed."),
      });
    }
  };

  if (!amendable) {
    return (
      <section className="rounded-md border border-line bg-surface px-4 py-5 sm:px-5">
        <h2 className="text-[0.9375rem] font-semibold text-ink">Booking details</h2>
        <p className="mt-3 text-[0.875rem] leading-relaxed text-muted">
          {booking.status === "CANCELLED"
            ? "This booking is cancelled, so its details are now a record of what was sold and cannot be edited."
            : "This stay has finished. Its details are kept as they were at the time and cannot be edited."}
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-line bg-surface">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2 className="text-[0.9375rem] font-semibold text-ink">Booking details</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
          Correct who is arriving and what the property should know. Changes reach the property
          immediately.
        </p>
      </div>

      <div className="grid gap-x-4 gap-y-5 px-4 py-5 sm:grid-cols-2 sm:px-5">
        <Field
          id="firstName"
          label="Lead guest first name"
          value={values.firstName}
          onChange={set("firstName")}
          error={errors.firstName}
        />
        <Field
          id="lastName"
          label="Lead guest last name"
          value={values.lastName}
          onChange={set("lastName")}
          error={errors.lastName}
        />
        <Field
          id="email"
          label="Email"
          type="email"
          hint="Where the confirmation and any change of plan is sent."
          value={values.email}
          onChange={set("email")}
          error={errors.email}
        />
        <Field
          id="phone"
          label="Phone"
          type="tel"
          hint="Leave blank to remove it."
          value={values.phone}
          onChange={set("phone")}
          error={errors.phone}
        />

        <div className="sm:col-span-2">
          <label
            htmlFor="specialRequests"
            className="mb-1.5 block text-[0.8125rem] font-medium text-ink"
          >
            What the property should know
          </label>
          <textarea
            id="specialRequests"
            value={values.specialRequests}
            onChange={(event) => set("specialRequests")(event.target.value)}
            rows={3}
            maxLength={1000}
            className={cn(
              "w-full rounded-sm border bg-surface px-3 py-2.5 text-[0.875rem] text-ink transition-colors placeholder:text-subtle focus:outline-none",
              errors.specialRequests ? "border-error focus:border-error" : "border-line focus:border-ink",
            )}
          />
          <p className="mt-1 text-[0.75rem] text-subtle">
            A late arrival, a quiet room, a cot. Requests are passed on but never guaranteed.
          </p>
          {errors.specialRequests && (
            <p className="mt-1 text-[0.75rem] text-error-text">{errors.specialRequests}</p>
          )}
        </div>

        {/* What is deliberately out of reach, and why. */}
        <div className="rounded-sm bg-surface-soft p-4 sm:col-span-2">
          <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink">
            <Lock size={14} className="shrink-0 text-muted" aria-hidden />
            Dates, rooms and price cannot be edited
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
            Changing any of those means giving the rooms back and taking them again at whatever
            they cost today. Cancel this booking and make a new one — the cancellation terms on this page
            tell you what that costs right now.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-line px-4 py-3.5 sm:px-5">
        {status.kind === "error" && (
          <p role="alert" className="me-auto text-[0.8125rem] text-error-text">
            {status.message}
          </p>
        )}
        {status.kind === "saved" && (
          <p role="status" className="me-auto flex items-center gap-1.5 text-[0.8125rem] text-success">
            <Check size={14} aria-hidden />
            Saved
          </p>
        )}

        <button
          type="submit"
          disabled={status.kind === "saving"}
          className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-brand px-5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:pointer-events-none disabled:opacity-60"
        >
          {status.kind === "saving" && <Loader2 size={14} className="animate-spin" aria-hidden />}
          Save changes
        </button>
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(FIELD, error ? "border-error focus:border-error" : "border-line focus:border-ink")}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[0.75rem] text-error-text">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-[0.75rem] text-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
