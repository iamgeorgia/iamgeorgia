"use client";

import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Info,
  Minus,
  Plus,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { CheckoutSummary } from "./CheckoutSummary";
import { MobileCheckoutSummary } from "./MobileCheckoutSummary";
import { HoldCountdown } from "@/components/booking/HoldCountdown";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { confirmBooking, releaseHold } from "@/lib/api/bookings";
import { ApiError } from "@/lib/api/client";
import { bookingErrorKey, needsNewOffer } from "@/lib/booking/errors";
import {
  checkoutDraftServerSnapshot,
  checkoutDraftSnapshot,
  clearCheckoutDraft,
  newIdempotencyKey,
  subscribeCheckoutDraft,
} from "@/lib/booking/checkoutSession";
import { nightsBetween } from "@/lib/booking/stay";
import { KosherRequests } from "./KosherRequests";
import { featureLabel } from "@/lib/hotels/kosher";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { BookingGuestInput, BookingGuestType, BookingRequestInput } from "@/types/booking";
import { cn } from "@/lib/utils";

interface CheckoutFormProps {
  /** From the URL, so a refresh resumes the same hold rather than taking another. */
  holdToken: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Guest details, and the one button on this site that commits a room.
 *
 * Two things about it are load-bearing. The room is already held before this
 * page renders, so nobody loses it while typing their surname — and the hold
 * runs out, visibly, so nobody else is kept from the room by an abandoned tab.
 * And the request carries no amount at all: identifiers, dates and people. The
 * server prices the booking from the held offer, which is the only way a total
 * on a confirmation can be trusted.
 *
 * The idempotency key is minted once per hold and reused across retries, so a
 * double-clicked button or a resubmitted form returns the first booking rather
 * than taking a second room.
 */
export function CheckoutForm({ holdToken }: CheckoutFormProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t, intlLocale } = useI18n();

  // sessionStorage is an external store, and `ready` is what distinguishes
  // "not read yet" from "nothing there" — a skeleton from a wrong message.
  const stored = useSyncExternalStore(
    subscribeCheckoutDraft,
    checkoutDraftSnapshot,
    checkoutDraftServerSnapshot,
  );
  // A draft left by a different hold is not this checkout's summary.
  const draft = stored.draft?.holdToken === holdToken ? stored.draft : null;
  const hydrated = stored.ready;

  // Set once, by the countdown, when the hold lapses; the synchronous check
  // covers a draft that was already stale when the page loaded, so the
  // expired panel shows on the first render rather than a frame later.
  const [lapsed, setLapsed] = useState(false);
  const [openedAt] = useState(() => Date.now());

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [requests, setRequests] = useState<BookingRequestInput[]>([]);
  const [guests, setGuests] = useState<BookingGuestInput[]>([]);
  /**
   * Codes the server refused, so the failure lands on the rows that caused it.
   *
   * It should be unreachable — the picker only offers what the property already
   * told us it does — but a property that dropped a facility between the hotel
   * page loading and the form being submitted would produce exactly this, and
   * "something went wrong" is a poor way to say "they stopped doing mikveh".
   */
  const [unsupported, setUnsupported] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.booking.errors | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Minted here when the draft is gone, so a retry is still idempotent. */
  const [fallbackKey] = useState(newIdempotencyKey);

  const expiresAt = draft ? Date.parse(draft.hold.expiresAt) : null;
  const expired = lapsed || (expiresAt !== null && expiresAt <= openedAt);

  const nights = useMemo(() => {
    if (!draft) return 0;

    return (
      draft.offer?.quote.totals.nights ??
      nightsBetween(draft.hold.checkIn, draft.hold.checkOut)
    );
  }, [draft]);

  const backHref = draft ? path(`/hotels/${draft.hotelSlug}`) : path("/hotels");

  /** Leaving deliberately gives the room back now rather than in a few minutes. */
  const abandon = async () => {
    if (holdToken) {
      // A hold that has already gone is not an error worth showing anyone.
      await releaseHold(holdToken).catch(() => undefined);
    }
    clearCheckoutDraft();
    router.push(backHref);
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!firstName.trim()) errors["leadGuest.firstName"] = t.booking.checkout.required;
    if (!lastName.trim()) errors["leadGuest.lastName"] = t.booking.checkout.required;
    if (!email.trim()) errors["leadGuest.email"] = t.booking.checkout.required;
    else if (!EMAIL.test(email.trim())) errors["leadGuest.email"] = t.booking.checkout.invalidEmail;

    guests.forEach((guest, index) => {
      if (!guest.firstName.trim()) errors[`guests.${index}.firstName`] = t.booking.checkout.required;
      if (!guest.lastName.trim()) errors[`guests.${index}.lastName`] = t.booking.checkout.required;
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
      const booking = await confirmBooking({
        holdToken,
        leadGuest: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: leadEmail,
          phone: phone.trim() || undefined,
        },
        guests: guests.length > 0 ? guests : undefined,
        specialRequests: specialRequests.trim() || undefined,
        // Structured requirements alongside the prose. The server checks each
        // against what the property actually offers and answers 422 naming any
        // it cannot meet, rather than accepting a promise it cannot keep.
        requests: requests.length > 0 ? requests : undefined,
        source: "web",
        idempotencyKey: draft?.idempotencyKey ?? fallbackKey,
      });

      clearCheckoutDraft();
      // `replace`, so the back button cannot return to a checkout whose hold
      // has just been committed.
      router.replace(
        path(
          `/booking/confirmation/${booking.reference}?email=${encodeURIComponent(leadEmail)}`,
        ),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setFieldErrors(error.fieldErrors());
      }

      // 422 with a list of codes: the property does not offer some of what was
      // asked for. Marked on the rows themselves, so the fix is obvious.
      if (error instanceof ApiError && error.status === 422) {
        const details = error.details as { unsupported?: unknown } | undefined;
        const codes = Array.isArray(details?.unsupported) ? details.unsupported : [];

        setUnsupported(codes.filter((code): code is string => typeof code === "string"));
      }

      setErrorKey(bookingErrorKey(error));
      setSubmitting(false);
    }
  };

  const setGuest = (index: number, patch: Partial<BookingGuestInput>) =>
    setGuests((current) =>
      current.map((guest, position) => (position === index ? { ...guest, ...patch } : guest)),
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
          title={t.booking.checkout.noHoldTitle}
          description={t.booking.checkout.noHoldBody}
          action={{ label: t.booking.checkout.findStay, href: path("/hotels") }}
        />
      </Container>
    );
  }

  if (expired) {
    return (
      <Container className="py-20">
        <EmptyState
          icon={Timer}
          title={t.booking.checkout.expiredTitle}
          description={t.booking.checkout.expiredBody}
          action={{ label: t.booking.checkout.backToProperty, href: backHref }}
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
    options: { type?: string; required?: boolean; autoComplete?: string } = {},
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
            title={t.booking.checkout.summary}
            total={
              draft?.offer
                ? formatMoney(draft.offer.quote.totals.totalCents, draft.offer.quote.currency, intlLocale)
                : null
            }
            className="mb-8"
          >
            <CheckoutSummary draft={draft} nights={nights} />
          </MobileCheckoutSummary>

          {expiresAt !== null && (
            <p className="flex items-center gap-2.5 rounded-sm border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
              <Clock size={16} className="shrink-0" aria-hidden />
              <span>
                {t.booking.checkout.heldNotice} ·{" "}
                <span className="font-medium tabular-nums">
                  <HoldCountdown
                    expiresAt={expiresAt}
                    template={t.booking.checkout.expiresIn}
                    onExpire={() => setLapsed(true)}
                  />
                </span>
              </span>
            </p>
          )}

          {!draft && (
            <p className="mt-4 flex items-start gap-2.5 rounded-sm border border-line bg-surface-soft/60 px-4 py-3 text-sm text-muted">
              <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
              {t.booking.checkout.partialDraft}
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
                <h2 className="type-h3">{t.booking.checkout.leadGuest}</h2>
                <p className="type-body-sm mt-2 text-muted">{t.booking.checkout.leadGuestHint}</p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {field("leadGuest.firstName", t.booking.checkout.firstName, firstName, setFirstName, {
                    required: true,
                    autoComplete: "given-name",
                  })}
                  {field("leadGuest.lastName", t.booking.checkout.lastName, lastName, setLastName, {
                    required: true,
                    autoComplete: "family-name",
                  })}
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    {field("leadGuest.email", t.booking.checkout.email, email, setEmail, {
                      type: "email",
                      required: true,
                      autoComplete: "email",
                    })}
                    <p className="type-caption mt-1.5 text-subtle">{t.booking.checkout.emailHint}</p>
                  </div>
                  {field("leadGuest.phone", t.booking.checkout.phoneOptional, phone, setPhone, {
                    type: "tel",
                    autoComplete: "tel",
                  })}
                </div>
              </section>

              <section className="mt-12 border-t border-line pt-10">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="type-h3">{t.booking.checkout.otherGuests}</h2>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={fill(t.booking.checkout.removeGuest, { number: guests.length })}
                      disabled={guests.length === 0}
                      onClick={() => setGuests((current) => current.slice(0, -1))}
                      className="flex size-8 items-center justify-center rounded-sm border border-line text-body transition-colors hover:border-ink disabled:opacity-35"
                    >
                      <Minus size={14} aria-hidden />
                    </button>
                    <span className="type-body-sm w-8 text-center tabular-nums">
                      {guests.length}
                    </span>
                    <button
                      type="button"
                      aria-label={t.booking.checkout.addGuest}
                      disabled={guests.length >= 20}
                      onClick={() =>
                        setGuests((current) => [
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
                <p className="type-body-sm mt-2 text-muted">{t.booking.checkout.otherGuestsHint}</p>

                <div className="mt-5 flex flex-col gap-5">
                  {guests.map((guest, index) => (
                    // Positional: "guest 2" is an ordinal, not an id.
                    <div key={index} className="border border-line bg-surface p-4">
                      <p className="type-caption mb-3 font-medium text-ink">
                        {fill(t.booking.checkout.guestNumber, { number: index + 1 })}
                      </p>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {field(
                          `guests.${index}.firstName`,
                          t.booking.checkout.firstName,
                          guest.firstName,
                          (value) => setGuest(index, { firstName: value }),
                        )}
                        {field(
                          `guests.${index}.lastName`,
                          t.booking.checkout.lastName,
                          guest.lastName,
                          (value) => setGuest(index, { lastName: value }),
                        )}
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className={labelClass}>{t.booking.checkout.guestType}</span>
                          <select
                            value={guest.type ?? "ADULT"}
                            onChange={(event) =>
                              setGuest(index, {
                                type: event.target.value as BookingGuestType,
                                // An adult carries no age; leaving a stale one
                                // behind would send the server a contradiction.
                                age: event.target.value === "ADULT" ? undefined : guest.age,
                              })
                            }
                            className={inputClass}
                          >
                            <option value="ADULT">{t.booking.checkout.adult}</option>
                            <option value="CHILD">{t.booking.checkout.child}</option>
                            <option value="INFANT">{t.booking.checkout.infant}</option>
                          </select>
                        </label>

                        {guest.type && guest.type !== "ADULT" && (
                          <label className="block">
                            <span className={labelClass}>{t.booking.checkout.age}</span>
                            <input
                              type="number"
                              min={0}
                              max={17}
                              value={guest.age ?? ""}
                              onChange={(event) =>
                                setGuest(index, {
                                  age: event.target.value ? Number(event.target.value) : undefined,
                                })
                              }
                              className={inputClass}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/*
               * Before the free text, not after it.
               *
               * An agency that has already ticked "kosher meals" and "Shabbat
               * elevator" writes a shorter, more useful note — and the
               * structured half is the half the property can actually answer
               * one by one.
               */}
              <KosherRequests
                available={draft?.requestableCodes ?? []}
                value={requests}
                onChange={(next) => {
                  setRequests(next);
                  setUnsupported([]);
                }}
                unsupported={unsupported}
              />

              {unsupported.length > 0 && (
                <p role="alert" className="mt-3 text-sm text-error-text">
                  {fill(t.booking.requirements.unsupported, {
                    items: unsupported.map((code) => featureLabel(t, code)).join(", "),
                  })}
                </p>
              )}

              <section className="mt-12 border-t border-line pt-10">
                <h2 className="type-h3">{t.booking.checkout.specialRequests}</h2>
                <p className="type-body-sm mt-2 text-muted">
                  {t.booking.checkout.specialRequestsHint}
                </p>
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
                          {t.booking.checkout.backToProperty}
                        </a>
                      </>
                    )}
                  </span>
                </p>
              )}

              <p className="type-caption mt-8 flex items-start gap-2 text-muted">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
                {t.booking.checkout.terms}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting ? t.booking.checkout.confirming : t.booking.checkout.confirmStay}
                </Button>
                <button
                  type="button"
                  onClick={() => void abandon()}
                  className="type-body-sm inline-flex items-center gap-1.5 text-muted underline-offset-4 hover:text-ink hover:underline"
                >
                  <ArrowLeft size={15} className="rtl:-scale-x-100" aria-hidden />
                  {t.booking.checkout.backToProperty}
                </button>
              </div>
            </fieldset>
          </form>
        </div>

        <aside className="hidden lg:col-span-5 lg:block">
          <div className="lg:sticky lg:top-36">
            <CheckoutSummary draft={draft} nights={nights} />
          </div>
        </aside>
      </div>
    </Container>
  );
}
