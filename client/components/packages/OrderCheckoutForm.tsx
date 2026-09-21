"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, Clock, Info, Minus, Plus, Timer } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { OrderCheckoutSummary } from "./OrderCheckoutSummary";
import { MobileCheckoutSummary } from "@/components/booking/MobileCheckoutSummary";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiError } from "@/lib/api/client";
import { confirmOrder, releaseOrderHolds } from "@/lib/api/orders";
import {
  clearOrderCheckoutDraft,
  newIdempotencyKey,
  orderCheckoutDraftServerSnapshot,
  orderCheckoutDraftSnapshot,
  subscribeOrderCheckoutDraft,
} from "@/lib/booking/checkoutSession";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { hasOnRequestSlot, resolvedService, resolvedTour } from "@/lib/packages/query";
import { formatMoney } from "@/lib/money";
import type { OrderPriceChangedDetails, OrderTraveller, OrderUnavailableDetails } from "@/types/order";
import { cn } from "@/lib/utils";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** mm:ss, and never negative — an expired hold has its own panel. */
const countdown = (msLeft: number): string => {
  const total = Math.max(0, Math.floor(msLeft / 1000));

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * The details, and the button that commits four bookings at once.
 *
 * Unlike the hotel and tour checkouts there is no token in the URL: a
 * composite offer runs to several thousand characters and its holds are a map
 * rather than one string, so the whole thing lives in the tab's own draft.
 * A refresh resumes it; a fresh tab has nothing and says so, which is honest —
 * the rooms are held against the offer, not against the address bar.
 *
 * The request carries no amount. The server re-prices every slot from the
 * signed offer, and answers a moved price or a vanished room with one 409
 * naming every slot involved, which is what the two panels below render.
 */
export function OrderCheckoutForm() {
  const router = useRouter();
  const path = useLocalePath();
  const { t, intlLocale } = useI18n();

  const stored = useSyncExternalStore(
    subscribeOrderCheckoutDraft,
    orderCheckoutDraftSnapshot,
    orderCheckoutDraftServerSnapshot,
  );
  const draft = stored.draft;
  const hydrated = stored.ready;

  const [now, setNow] = useState(() => Date.now());

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [travellers, setTravellers] = useState<OrderTraveller[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.orders.errors | null>(null);
  const [priceChanged, setPriceChanged] = useState<OrderPriceChangedDetails | null>(null);
  const [unavailable, setUnavailable] = useState<OrderUnavailableDetails | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Minted here when the draft is gone, so a retry is still idempotent. */
  const [fallbackKey] = useState(newIdempotencyKey);

  const expiresAt = draft?.holdExpiresAt ? Date.parse(draft.holdExpiresAt) : null;
  const expired = expiresAt !== null && expiresAt <= now;

  useEffect(() => {
    if (expiresAt === null || expired) return;

    const id = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(id);
  }, [expiresAt, expired]);

  const backHref = draft ? path(`/packages/${draft.packageSlug}`) : path("/packages");

  /** Leaving deliberately gives the rooms and seats back now. */
  const abandon = async () => {
    if (draft && Object.keys(draft.holdTokens).length > 0) {
      await releaseOrderHolds(draft.holdTokens).catch(() => undefined);
    }
    clearOrderCheckoutDraft();
    router.push(backHref);
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!firstName.trim()) errors["leadGuest.firstName"] = t.booking.checkout.required;
    if (!lastName.trim()) errors["leadGuest.lastName"] = t.booking.checkout.required;
    if (!email.trim()) errors["leadGuest.email"] = t.booking.checkout.required;
    else if (!EMAIL.test(email.trim())) errors["leadGuest.email"] = t.booking.checkout.invalidEmail;

    travellers.forEach((traveller, index) => {
      if (!traveller.firstName.trim())
        errors[`travellers.${index}.firstName`] = t.booking.checkout.required;
      if (!traveller.lastName.trim())
        errors[`travellers.${index}.lastName`] = t.booking.checkout.required;
    });

    setFieldErrors(errors);

    return Object.keys(errors).length === 0;
  };

  const submit = async () => {
    if (!draft || submitting || expired || !validate()) return;

    setSubmitting(true);
    setErrorKey(null);
    setPriceChanged(null);
    setUnavailable(null);

    const leadEmail = email.trim();

    try {
      const order = await confirmOrder({
        packageToken: draft.packageToken,
        holdTokens:
          Object.keys(draft.holdTokens).length > 0 ? draft.holdTokens : undefined,
        leadGuest: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: leadEmail,
          phone: phone.trim() || undefined,
        },
        travellers:
          travellers.length > 0
            ? travellers.map((traveller) => ({
                firstName: traveller.firstName.trim(),
                lastName: traveller.lastName.trim(),
                age: traveller.age,
              }))
            : undefined,
        specialRequests: specialRequests.trim() || undefined,
        flightNumber: flightNumber.trim() || undefined,
        pickupAddress: pickupAddress.trim() || undefined,
        source: "web",
        idempotencyKey: draft.idempotencyKey ?? fallbackKey,
      });

      clearOrderCheckoutDraft();
      // `replace`, so the back button cannot return to a checkout whose holds
      // have just been committed.
      router.replace(
        path(`/booking/confirmation/${order.reference}?email=${encodeURIComponent(leadEmail)}`),
      );
    } catch (error) {
      handleFailure(error);
      setSubmitting(false);
    }
  };

  /**
   * A refusal is per-slot, and each kind reads differently.
   *
   * A moved price and a vanished room both mean "go back and re-quote", but a
   * buyer deserves to know which of the four parts moved and by how much —
   * that is exactly what the server sends, and hiding it behind one sentence
   * would waste the round trip it cost.
   */
  const handleFailure = (error: unknown) => {
    if (!(error instanceof ApiError)) {
      setErrorKey("generic");

      return;
    }

    if (error.status === 400) {
      setFieldErrors(error.fieldErrors());
      setErrorKey("generic");

      return;
    }

    const details = error.details as { reason?: string } | undefined;

    if (error.status === 409 && details?.reason === "PRICE_CHANGED") {
      setPriceChanged(details as OrderPriceChangedDetails);

      return;
    }

    if (error.status === 409 && details?.reason === "UNAVAILABLE") {
      setUnavailable(details as OrderUnavailableDetails);

      return;
    }

    if (error.status === 409 && details?.reason === "KOSHER_INELIGIBLE") {
      setErrorKey("kosherBody");

      return;
    }

    if (error.status === 409 && details?.reason === "PACKAGE_CHANGED") {
      setErrorKey("packageChanged");

      return;
    }

    if (error.status === 409 && details?.reason === "NOT_ON_SALE") {
      setErrorKey("notOnSale");

      return;
    }

    setErrorKey(error.status === 410 ? "holdExpired" : "generic");
  };

  const setTraveller = (index: number, patch: Partial<OrderTraveller>) =>
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

  if (!draft) {
    return (
      <Container className="py-20">
        <EmptyState
          icon={Info}
          title={t.orders.checkout.noDraftTitle}
          description={t.orders.checkout.noDraftBody}
          action={{ label: t.orders.checkout.findPackage, href: path("/packages") }}
        />
      </Container>
    );
  }

  if (expired) {
    return (
      <Container className="py-20">
        <EmptyState
          icon={Timer}
          title={t.orders.checkout.expiredTitle}
          description={t.orders.checkout.expiredBody}
          action={{ label: t.orders.checkout.backToPackage, href: backHref }}
        />
      </Container>
    );
  }

  const onRequest = hasOnRequestSlot(draft.quote);
  const onRequestLabels = draft.quote.components
    .filter((component) => {
      if (!component.included) return false;

      return (
        resolvedTour(component)?.option.confirmationMode === "ON_REQUEST" ||
        resolvedService(component)?.service.confirmationMode === "ON_REQUEST"
      );
    })
    .map((component) => component.label)
    .join(", ");

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
            title={t.orders.checkout.summary}
            total={formatMoney(draft.quote.totals.totalCents, draft.quote.currency, intlLocale)}
            className="mb-8"
          >
            <OrderCheckoutSummary packageName={draft.packageName} quote={draft.quote} />
          </MobileCheckoutSummary>

          {expiresAt !== null && (
            <p className="flex items-center gap-2.5 rounded-sm border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
              <Clock size={16} className="shrink-0" aria-hidden />
              <span>
                {t.orders.checkout.heldNotice} ·{" "}
                <span className="font-medium tabular-nums">
                  {fill(t.booking.checkout.expiresIn, { time: countdown(expiresAt - now) })}
                </span>
              </span>
            </p>
          )}

          {onRequest && (
            <p className="mt-4 flex items-start gap-2.5 rounded-sm border border-line bg-surface-soft/60 px-4 py-3 text-sm text-body">
              <Info size={16} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
              {fill(t.orders.checkout.onRequestNotice, { items: onRequestLabels })}
            </p>
          )}

          {/* --- what the server refused, slot by slot --------------------- */}
          {priceChanged && (
            <div className="mt-4 rounded-sm border border-line bg-surface-soft px-4 py-3.5">
              <p className="type-body-sm flex items-center gap-2 font-semibold text-ink">
                <AlertCircle size={16} className="shrink-0 text-brand-text" aria-hidden />
                {t.orders.errors.priceChangedTitle}
              </p>
              <p className="type-caption mt-1.5 text-muted">{t.orders.errors.priceChangedBody}</p>
              <ul className="type-caption mt-2 flex flex-col gap-1 text-body">
                {priceChanged.components.map((component) => (
                  <li key={component.slotIndex}>
                    {fill(t.orders.errors.priceChangedRow, {
                      label: component.label,
                      was: formatMoney(component.quotedCents, draft.quote.currency, intlLocale),
                      now: formatMoney(component.currentCents, draft.quote.currency, intlLocale),
                    })}
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" href={backHref} className="mt-3">
                {t.orders.errors.requeryTrip}
              </Button>
            </div>
          )}

          {unavailable && (
            <div className="mt-4 rounded-sm border border-line bg-surface-soft px-4 py-3.5">
              <p className="type-body-sm flex items-center gap-2 font-semibold text-ink">
                <AlertCircle size={16} className="shrink-0 text-brand-text" aria-hidden />
                {t.orders.errors.unavailableTitle}
              </p>
              <p className="type-caption mt-1.5 text-muted">{t.orders.errors.unavailableBody}</p>
              <ul className="type-caption mt-2 flex flex-col gap-1 text-body">
                {unavailable.slots.map((slot) => (
                  <li key={slot.slotIndex}>
                    {slot.label}
                    {slot.reason in t.packages.quote.slotReasons
                      ? ` — ${t.packages.quote.slotReasons[slot.reason as keyof typeof t.packages.quote.slotReasons]}`
                      : ""}
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" href={backHref} className="mt-3">
                {t.orders.errors.requeryTrip}
              </Button>
            </div>
          )}

          {errorKey && (
            <p role="alert" className="type-body-sm mt-4 rounded-sm bg-surface-soft p-3.5 text-brand-text">
              {errorKey === "kosherBody" ? t.orders.errors.kosherTitle : ""}{" "}
              {t.orders.errors[errorKey]}
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
                <h2 className="type-h3">{t.orders.checkout.leadGuest}</h2>
                <p className="type-body-sm mt-2 text-muted">{t.orders.checkout.leadGuestHint}</p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {field(
                    "leadGuest.firstName",
                    t.booking.checkout.firstName,
                    firstName,
                    setFirstName,
                    { required: true, autoComplete: "given-name" },
                  )}
                  {field("leadGuest.lastName", t.booking.checkout.lastName, lastName, setLastName, {
                    required: true,
                    autoComplete: "family-name",
                  })}
                  {field("leadGuest.email", t.booking.checkout.email, email, setEmail, {
                    required: true,
                    type: "email",
                    autoComplete: "email",
                  })}
                  {field("leadGuest.phone", t.booking.checkout.phoneOptional, phone, setPhone, {
                    type: "tel",
                    autoComplete: "tel",
                  })}
                </div>
                <p className="type-caption mt-2 text-muted">{t.booking.checkout.emailHint}</p>
              </section>

              <section className="mt-10">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="type-h3">{t.orders.checkout.travellers}</h2>
                  <button
                    type="button"
                    onClick={() =>
                      setTravellers((current) => [...current, { firstName: "", lastName: "" }])
                    }
                    className="type-caption inline-flex items-center gap-1.5 text-brand-text underline-offset-4 hover:underline"
                  >
                    <Plus size={13} aria-hidden />
                    {t.orders.checkout.addTraveller}
                  </button>
                </div>
                <p className="type-body-sm mt-2 text-muted">{t.orders.checkout.travellersHint}</p>

                {travellers.length > 0 && (
                  <ul className="mt-5 flex flex-col gap-5">
                    {travellers.map((traveller, index) => (
                      // Positional: "traveller 2" is an ordinal, not an id.
                      <li key={index} className="border border-line p-4">
                        <div className="flex items-center justify-between">
                          <span className="type-caption font-semibold tracking-wide text-muted uppercase">
                            {fill(t.orders.checkout.travellerNumber, { number: index + 2 })}
                          </span>
                          <button
                            type="button"
                            aria-label={fill(t.orders.checkout.removeTraveller, {
                              number: index + 2,
                            })}
                            onClick={() =>
                              setTravellers((current) =>
                                current.filter((_, position) => position !== index),
                              )
                            }
                            className="text-muted transition-colors hover:text-ink"
                          >
                            <Minus size={15} aria-hidden />
                          </button>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {field(
                            `travellers.${index}.firstName`,
                            t.booking.checkout.firstName,
                            traveller.firstName,
                            (next) => setTraveller(index, { firstName: next }),
                            { required: true },
                          )}
                          {field(
                            `travellers.${index}.lastName`,
                            t.booking.checkout.lastName,
                            traveller.lastName,
                            (next) => setTraveller(index, { lastName: next }),
                            { required: true },
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="mt-10">
                <div className="grid gap-4 sm:grid-cols-2">
                  {field(
                    "flightNumber",
                    t.orders.checkout.flightNumber,
                    flightNumber,
                    setFlightNumber,
                    { maxLength: 20 },
                  )}
                  {field(
                    "pickupAddress",
                    t.orders.checkout.pickupAddress,
                    pickupAddress,
                    setPickupAddress,
                    { maxLength: 200 },
                  )}
                </div>
                <p className="type-caption mt-2 text-muted">
                  {t.orders.checkout.flightNumberHint}
                </p>

                <label className="mt-6 block">
                  <span className={labelClass}>{t.orders.checkout.specialRequests}</span>
                  <textarea
                    value={specialRequests}
                    rows={3}
                    maxLength={1000}
                    onChange={(event) => setSpecialRequests(event.target.value)}
                    className="w-full rounded-sm border border-line bg-background p-3 text-sm text-ink focus:border-ink focus:outline-none"
                  />
                </label>
                <p className="type-caption mt-1.5 text-muted">
                  {t.orders.checkout.specialRequestsHint}
                </p>
              </section>

              <p className="type-caption mt-8 text-muted">{t.orders.checkout.terms}</p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting
                    ? t.orders.checkout.confirming
                    : onRequest
                      ? t.orders.checkout.request
                      : t.orders.checkout.confirm}
                </Button>
                <Button variant="ghost" onClick={() => void abandon()}>
                  {t.orders.checkout.backToPackage}
                </Button>
              </div>
            </fieldset>
          </form>
        </div>

        <div className="hidden lg:col-span-5 lg:block">
          <OrderCheckoutSummary
            packageName={draft.packageName}
            quote={draft.quote}
            className="lg:sticky lg:top-24"
          />
        </div>
      </div>
    </Container>
  );
}
