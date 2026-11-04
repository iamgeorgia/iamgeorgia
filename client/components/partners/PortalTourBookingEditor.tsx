"use client";

import { useRouter } from "next/navigation";
import { Check, Loader2, Lock } from "lucide-react";
import { useState } from "react";

import { amendTourBooking } from "@/lib/api/tours";
import { ApiError, describeError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { TourBooking } from "@/types/tour";

/**
 * Amending a tour booking, from the partner side.
 *
 * The paperwork around the sale — who leads, how to reach them, where to
 * collect them, what the guide should know. Not the sale: the departure, the
 * option, the party and every figure are locked with the reason stated,
 * because moving any of them means giving the seats back and taking them
 * again at whatever they cost today.
 */

const FIELD =
  "h-11 w-full rounded-sm border bg-surface px-3 text-[0.875rem] text-ink transition-colors placeholder:text-subtle focus:outline-none";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const leadNameOf = (booking: TourBooking) => {
  const row = booking.travellers.find((traveller) => traveller.isLead);
  if (row) return { firstName: row.firstName, lastName: row.lastName };

  const [first, ...rest] = booking.leadTravellerName.split(" ");
  return { firstName: first ?? "", lastName: rest.join(" ") };
};

export function PortalTourBookingEditor({ booking }: { booking: TourBooking }) {
  const router = useRouter();
  const lead = leadNameOf(booking);

  const [values, setValues] = useState({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: booking.leadTravellerEmail,
    phone: booking.leadTravellerPhone ?? "",
    pickupNote: booking.pickupNote ?? "",
    specialRequests: booking.specialRequests ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const amendable = booking.status === "CONFIRMED" || booking.status === "PENDING";

  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) =>
      current[key] ? Object.fromEntries(Object.entries(current).filter(([field]) => field !== key)) : current,
    );
    setStatus({ kind: "idle" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "saving" });
    setErrors({});

    try {
      await amendTourBooking(booking.reference, {
        leadTraveller: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          email: values.email.trim(),
          phone: values.phone.trim() || null,
        },
        pickupNote: values.pickupNote.trim() || null,
        specialRequests: values.specialRequests.trim() || null,
      });

      setStatus({ kind: "saved" });
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(
          Object.fromEntries(
            Object.entries(caught.fieldErrors()).map(([path, message]) => [path.replace(/^leadTraveller\./, ""), message]),
          ),
        );
      }
      setStatus({ kind: "error", message: describeError(caught, "Something went wrong. Nothing was changed.") });
    }
  };

  if (!amendable) {
    return (
      <section className="rounded-md border border-line bg-surface px-4 py-5 sm:px-5">
        <h2 className="text-[0.9375rem] font-semibold text-ink">Booking details</h2>
        <p className="mt-3 text-[0.875rem] leading-relaxed text-muted">
          {booking.status === "CANCELLED"
            ? "This booking is cancelled, so its details are now a record of what was sold and cannot be edited."
            : "This journey has finished. Its details are kept as they were at the time and cannot be edited."}
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-line bg-surface">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2 className="text-[0.9375rem] font-semibold text-ink">Booking details</h2>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
          Correct who is leading the group and what the operator should know. Changes reach the
          operator immediately.
        </p>
      </div>

      <div className="grid gap-x-4 gap-y-5 px-4 py-5 sm:grid-cols-2 sm:px-5">
        <Field id="firstName" label="Lead traveller first name" value={values.firstName} onChange={set("firstName")} error={errors.firstName} />
        <Field id="lastName" label="Lead traveller last name" value={values.lastName} onChange={set("lastName")} error={errors.lastName} />
        <Field id="email" label="Email" type="email" hint="Where the voucher and any change of plan is sent." value={values.email} onChange={set("email")} error={errors.email} />
        <Field id="phone" label="Phone" type="tel" hint="Leave blank to remove it." value={values.phone} onChange={set("phone")} error={errors.phone} />
        <Field id="pickupNote" label="Pick-up note" hint="A hotel name and address, if the option collects the group." value={values.pickupNote} onChange={set("pickupNote")} error={errors.pickupNote} />

        <div className="sm:col-span-2">
          <label htmlFor="specialRequests" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
            What the operator should know
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
          {errors.specialRequests && <p className="mt-1 text-[0.75rem] text-error-text">{errors.specialRequests}</p>}
        </div>

        <div className="rounded-sm bg-surface-soft p-4 sm:col-span-2">
          <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink">
            <Lock size={14} className="shrink-0 text-muted" aria-hidden />
            Departure, party and price cannot be edited
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
            Changing any of those means giving the seats back and taking them again at whatever they
            cost today. Cancel this booking and make a new one — the cancellation terms tell you what
            that costs right now.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-line px-4 py-3.5 sm:px-5">
        {status.kind === "error" && (
          <p role="alert" className="me-auto text-[0.8125rem] text-error-text">{status.message}</p>
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
        className={cn(FIELD, error ? "border-error focus:border-error" : "border-line focus:border-ink")}
      />
      {error ? (
        <p className="mt-1 text-[0.75rem] text-error-text">{error}</p>
      ) : (
        hint && <p className="mt-1 text-[0.75rem] text-subtle">{hint}</p>
      )}
    </div>
  );
}
