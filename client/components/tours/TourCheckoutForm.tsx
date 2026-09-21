"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Clock, Info, Minus, Plus, ShieldCheck, Timer } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { TourCheckoutSummary } from "./TourCheckoutSummary";
import { MobileCheckoutSummary } from "@/components/booking/MobileCheckoutSummary";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { confirmTourBooking, releaseTourHold } from "@/lib/api/tours";
import { ApiError } from "@/lib/api/client";
import { bookingErrorKey, needsNewOffer } from "@/lib/booking/errors";
import {
  clearTourCheckoutDraft,
  newIdempotencyKey,
  subscribeTourCheckoutDraft,
  tourCheckoutDraftServerSnapshot,
  tourCheckoutDraftSnapshot,
} from "@/lib/booking/checkoutSession";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { BookingGuestType } from "@/types/booking";
import type { TourTravellerInput } from "@/types/tour";
import { cn } from "@/lib/utils";

interface TourCheckoutFormProps {
  /** From the URL, so a refresh resumes the same hold rather than taking another. */
  holdToken: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** mm:ss, and never negative — an expired hold has its own panel. */
const countdown = (msLeft: number): string => {
  const total = Math.max(0, Math.floor(msLeft / 1000));

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Traveller details, and the button that commits the seats.
 *
 * The seats are already held before this page renders, so nobody loses them
 * while typing a surname — and the hold runs out, visibly, so nobody else is
 * kept from them by an abandoned tab. The request carries no amount at all:
 * the server prices the booking from the held offer.
 *
 * An on-request option ends in a *request*, not a confirmation: the seats are
 * claimed now and the operator answers within two days. The button and the
 * confirmation page both say so.
 */
export function TourCheckoutForm({ holdToken }: TourCheckoutFormProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t, intlLocale } = useI18n();

  const stored = useSyncExternalStore(
    subscribeTourCheckoutDraft,
    tourCheckoutDraftSnapshot,
    tourCheckoutDraftServerSnapshot,
  );
  // A draft left by a different hold is not this checkout's summary.
  const draft = stored.draft?.holdToken === holdToken ? stored.draft : null;
  const hydrated = stored.ready;

  const [now, setNow] = useState(() => Date.now());

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [travellers, setTravellers] = useState<TourTravellerInput[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.booking.errors | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Minted here when the draft is gone, so a retry is still idempotent. */
  const [fallbackKey] = useState(newIdempotencyKey);

  const expiresAt = draft ? Date.parse(draft.hold.expiresAt) : null;
  const expired = expiresAt !== null && expiresAt <= now;
  const onRequest =
    (draft?.hold.confirmationMode ?? draft?.option.confirmationMode) === "ON_REQUEST";

  useEffect(() => {
    if (expiresAt === null || expired) return;

    const id = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(id);
  }, [expiresAt, expired]);

  const backHref = draft ? path(`/tours/${draft.tourSlug}`) : path("/tours");

  /** Leaving deliberately gives the seats back now rather than in a few minutes. */
  const abandon = async () => {
    if (holdToken) {
      await releaseTourHold(holdToken).catch(() => undefined);
    }
    clearTourCheckoutDraft();
    router.push(backHref);
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!firstName.trim()) errors["leadTraveller.firstName"] = t.booking.checkout.required;
    if (!lastName.trim()) errors["leadTraveller.lastName"] = t.booking.checkout.required;
    if (!email.trim()) errors["leadTraveller.email"] = t.booking.checkout.required;
    else if (!EMAIL.test(email.trim())) errors["leadTraveller.email"] = t.booking.checkout.invalidEmail;

    travellers.forEach((traveller, index) => {
      if (!traveller.firstName.trim()) errors[`travellers.${index}.firstName`] = t.booking.checkout.required;
      if (!traveller.lastName.trim()) errors[`travellers.${index}.lastName`] = t.booking.checkout.required;
    });

    setFieldErrors(errors);

    return Object.keys(errors).length === 0;
  };

  const submit = async () => {
    if (!holdToken || submitting || expired || !validate()) return;

    setSubmitting(true);
    setErrorKey(null);

    const leadEmail = email.trim();

    try {
      const booking = await confirmTourBooking({
        holdToken,
        leadTraveller: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: leadEmail,
          phone: phone.trim() || undefined,
        },
        travellers:
          travellers.length > 0
            ? travellers.map((traveller) => ({
                type: traveller.type ?? "ADULT",
                firstName: traveller.firstName.trim(),
                lastName: traveller.lastName.trim(),
                age: traveller.age,
                passportNumber: traveller.passportNumber?.trim() || undefined,
                nationality: traveller.nationality?.trim().toUpperCase() || undefined,
                dietary: traveller.dietary?.trim() || undefined,
              }))
            : undefined,
        specialRequests: specialRequests.trim() || undefined,
        pickupNote: pickupNote.trim() || undefined,
        source: "web",
        idempotencyKey: draft?.idempotencyKey ?? fallbackKey,
      });

      clearTourCheckoutDraft();
      // `replace`, so the back button cannot return to a checkout whose hold
      // has just been committed.
      router.replace(
        path(`/booking/confirmation/${booking.reference}?email=${encodeURIComponent(leadEmail)}`),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setFieldErrors(error.fieldErrors());
      }

      setErrorKey(bookingErrorKey(error));
      setSubmitting(false);
    }
  };

  const setTraveller = (index: number, patch: Partial<TourTravellerInput>) =>
    setTravellers((current) =>
      current.map((traveller, position) =>
        position === index ? { ...traveller, ...patch } : traveller,
      ),
    );

  // --- states before the form ---------------------------------------------

  if (!hydrated) {
    return (
      <Container className="py-24">
        <div className="mx-auto h-48 max-w-xl animate-pulse rounded-sm bg-surface-soft" />
      </Container>
    );
  }

  if (!holdToken) {
    return (
      <Container className="py-20">
        <EmptyState
          icon={Info}
          title={t.tours.checkout.noHoldTitle}
          description={t.tours.checkout.noHoldBody}
          action={{ label: t.tours.checkout.findTour, href: path("/tours") }}
        />
      </Container>
    );
  }

  if (expired) {
    return (
      <Container className="py-20">
        <EmptyState
          icon={Timer}
          title={t.tours.checkout.expiredTitle}
          description={t.tours.checkout.expiredBody}
          action={{ label: t.tours.checkout.backToTour, href: backHref }}
        />
      </Container>
    );
  }

  const inputClass =
    "h-11 w-full rounded-sm border border-line bg-background px-3 text-sm text-ink focus:border-ink focus:outline-none";
  const labelClass = "type-caption mb-1.5 block text-muted";

  const field = (
    key: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    options: { type?: string; required?: boolean; autoComplete?: string; maxLength?: number } = {},
  ) => (
    <label className="block">
      <span className={labelClass}>
        {label}
        {options.required && <span aria-hidden> *</span>}
      </span>
      <input
        type={options.type ?? "text"}
        value={value}
        required={options.required}
        autoComplete={options.autoComplete}
        maxLength={options.maxLength}
        aria-invalid={Boolean(fieldErrors[key])}
        aria-describedby={fieldErrors[key] ? `${key}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, fieldErrors[key] && "border-error")}
      />
      {fieldErrors[key] && (
        <span id={`${key}-error`} role="alert" className="type-caption mt-1 block text-error-text">
          {fieldErrors[key]}
        </span>
      )}
    </label>
  );

  return (
    <Container className="pt-6 pb-24 lg:pb-32">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-7">
          <MobileCheckoutSummary
            title={t.tours.checkout.summary}
            total={
              draft
                ? formatMoney(draft.offer.quote.totals.totalCents, draft.offer.quote.currency, intlLocale)
                : null
            }
            className="mb-8"
          >
            <TourCheckoutSummary draft={draft} />
          </MobileCheckoutSummary>

          {expiresAt !== null && (
            <p className="flex items-center gap-2.5 rounded-sm border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
              <Clock size={16} className="shrink-0" aria-hidden />
              <span>
                {t.tours.checkout.heldNotice} ·{" "}
                <span className="font-medium tabular-nums">
                  {fill(t.booking.checkout.expiresIn, { time: countdown(expiresAt - now) })}
                </span>
              </span>
            </p>
          )}

          {!draft && (
            <p className="mt-4 flex items-start gap-2.5 rounded-sm border border-line bg-surface-soft/60 px-4 py-3 text-sm text-muted">
              <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
              {t.tours.checkout.partialDraft}
            </p>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            noValidate
            className="mt-8"
          >
            <fieldset disabled={submitting} className="contents">
              <section>
                <h2 className="type-h3">{t.tours.checkout.leadTraveller}</h2>
                <p className="type-body-sm mt-2 text-muted">{t.tours.checkout.leadTravellerHint}</p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {field("leadTraveller.firstName", t.booking.checkout.firstName, firstName, setFirstName, {
                    required: true,
                    autoComplete: "given-name",
                  })}
                  {field("leadTraveller.lastName", t.booking.checkout.lastName, lastName, setLastName, {
                    required: true,
                    autoComplete: "family-name",
                  })}
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    {field("leadTraveller.email", t.booking.checkout.email, email, setEmail, {
                      type: "email",
                      required: true,
                      autoComplete: "email",
                    })}
                    <p className="type-caption mt-1.5 text-subtle">{t.booking.checkout.emailHint}</p>
                  </div>
                  {field("leadTraveller.phone", t.booking.checkout.phoneOptional, phone, setPhone, {
                    type: "tel",
                    autoComplete: "tel",
                  })}
                </div>
              </section>

              <section className="mt-12 border-t border-line pt-10">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="type-h3">{t.tours.checkout.otherTravellers}</h2>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={fill(t.tours.checkout.removeTraveller, { number: travellers.length })}
                      disabled={travellers.length === 0}
                      onClick={() => setTravellers((current) => current.slice(0, -1))}
                      className="flex size-8 items-center justify-center rounded-sm border border-line text-body transition-colors hover:border-ink disabled:opacity-35"
                    >
                      <Minus size={14} aria-hidden />
                    </button>
                    <span className="type-body-sm w-8 text-center tabular-nums">
                      {travellers.length}
                    </span>
                    <button
                      type="button"
                      aria-label={t.tours.checkout.addTraveller}
                      disabled={travellers.length >= 59}
                      onClick={() =>
                        setTravellers((current) => [
                          ...current,
                          { type: "ADULT", firstName: "", lastName: "" },
                        ])
                      }
                      className="flex size-8 items-center justify-center rounded-sm border border-line text-body transition-colors hover:border-ink disabled:opacity-35"
                    >
                      <Plus size={14} aria-hidden />
                    </button>
                  </span>
                </div>
                <p className="type-body-sm mt-2 text-muted">{t.tours.checkout.otherTravellersHint}</p>

                <div className="mt-5 flex flex-col gap-5">
                  {travellers.map((traveller, index) => (
                    // Positional: "traveller 2" is an ordinal, not an id.
                    <div key={index} className="border border-line bg-surface p-4">
                      <p className="type-caption mb-3 font-medium text-ink">
                        {fill(t.tours.checkout.travellerNumber, { number: index + 1 })}
                      </p>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {field(
                          `travellers.${index}.firstName`,
                          t.booking.checkout.firstName,
                          traveller.firstName,
                          (value) => setTraveller(index, { firstName: value }),
                        )}
                        {field(
                          `travellers.${index}.lastName`,
                          t.booking.checkout.lastName,
                          traveller.lastName,
                          (value) => setTraveller(index, { lastName: value }),
                        )}
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className={labelClass}>{t.booking.checkout.guestType}</span>
                          <select
                            value={traveller.type ?? "ADULT"}
                            onChange={(event) =>
                              setTraveller(index, {
                                type: event.target.value as BookingGuestType,
                                age: event.target.value === "ADULT" ? undefined : traveller.age,
                              })
                            }
                            className={inputClass}
                          >
                            <option value="ADULT">{t.booking.checkout.adult}</option>
                            <option value="CHILD">{t.booking.checkout.child}</option>
                            <option value="INFANT">{t.booking.checkout.infant}</option>
                          </select>
                        </label>

                        {traveller.type && traveller.type !== "ADULT" && (
                          <label className="block">
                            <span className={labelClass}>{t.booking.checkout.age}</span>
                            <input
                              type="number"
                              min={0}
                              max={17}
                              value={traveller.age ?? ""}
                              onChange={(event) =>
                                setTraveller(index, {
                                  age: event.target.value ? Number(event.target.value) : undefined,
                                })
                              }
                              className={inputClass}
                            />
                          </label>
                        )}
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {field(
                          `travellers.${index}.passportNumber`,
                          t.tours.checkout.passport,
                          traveller.passportNumber ?? "",
                          (value) => setTraveller(index, { passportNumber: value }),
                          { maxLength: 40 },
                        )}
                        <div>
                          {field(
                            `travellers.${index}.nationality`,
                            t.tours.checkout.nationality,
                            traveller.nationality ?? "",
                            (value) => setTraveller(index, { nationality: value }),
                            { maxLength: 2 },
                          )}
                          <p className="type-caption mt-1.5 text-subtle">
                            {t.tours.checkout.nationalityHint}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3">
                        {field(
                          `travellers.${index}.dietary`,
                          t.tours.checkout.dietary,
                          traveller.dietary ?? "",
                          (value) => setTraveller(index, { dietary: value }),
                          { maxLength: 200 },
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-12 border-t border-line pt-10">
                <h2 className="type-h3">{t.tours.checkout.pickupNote}</h2>
                <p className="type-body-sm mt-2 text-muted">{t.tours.checkout.pickupNoteHint}</p>
                <input
                  value={pickupNote}
                  onChange={(event) => setPickupNote(event.target.value)}
                  maxLength={300}
                  className={cn(inputClass, "mt-4")}
                />

                <h2 className="type-h3 mt-10">{t.tours.checkout.specialRequests}</h2>
                <p className="type-body-sm mt-2 text-muted">{t.tours.checkout.specialRequestsHint}</p>
                <textarea
                  value={specialRequests}
                  onChange={(event) => setSpecialRequests(event.target.value)}
                  maxLength={1000}
                  rows={4}
                  className="mt-4 w-full rounded-sm border border-line bg-background px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none"
                />
              </section>

              {errorKey && (
                <p
                  role="alert"
                  className="mt-8 flex items-start gap-2.5 rounded-sm border border-error/30 bg-error/5 px-4 py-3 text-sm text-error-text"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    {t.booking.errors[errorKey]}
                    {needsNewOffer(errorKey) && (
                      <>
                        {" "}
                        <a href={backHref} className="underline underline-offset-4">
                          {t.tours.checkout.backToTour}
                        </a>
                      </>
                    )}
                  </span>
                </p>
              )}

              {onRequest && (
                <p className="type-body-sm mt-8 rounded-sm border border-warning/30 bg-warning/5 px-4 py-3 text-warning-text">
                  {t.tours.checkout.onRequestNotice}
                </p>
              )}

              <p className="type-caption mt-8 flex items-start gap-2 text-muted">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
                {t.tours.checkout.terms}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting
                    ? t.tours.checkout.confirming
                    : onRequest
                      ? t.tours.checkout.request
                      : t.tours.checkout.confirm}
                </Button>
                <button
                  type="button"
                  onClick={() => void abandon()}
                  className="type-body-sm inline-flex items-center gap-1.5 text-muted underline-offset-4 hover:text-ink hover:underline"
                >
                  <ArrowLeft size={15} className="rtl:-scale-x-100" aria-hidden />
                  {t.tours.checkout.backToTour}
                </button>
              </div>
            </fieldset>
          </form>
        </div>

        <aside className="hidden lg:col-span-5 lg:block">
          <div className="lg:sticky lg:top-36">
            <TourCheckoutSummary draft={draft} />
          </div>
        </aside>
      </div>
    </Container>
  );
}
