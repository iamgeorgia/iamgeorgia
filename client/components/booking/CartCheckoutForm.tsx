"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Clock, Info, Minus, Plus, ShoppingBag, Timer } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { HoldCountdown } from "@/components/booking/HoldCountdown";
import { MobileCheckoutSummary } from "@/components/booking/MobileCheckoutSummary";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiError } from "@/lib/api/client";
import {
  confirmCustomOrder,
  createCustomOrderHolds,
  releaseCustomOrderHolds,
} from "@/lib/api/orders";
import {
  cartPayloads,
  cartSnapshotTotal,
  clearCart,
  removeFromCart,
  type CartItem,
} from "@/lib/booking/cart";
import {
  cartCheckoutDraftServerSnapshot,
  cartCheckoutDraftSnapshot,
  clearCartCheckoutDraft,
  newIdempotencyKey,
  saveCartCheckoutDraft,
  subscribeCartCheckoutDraft,
} from "@/lib/booking/checkoutSession";
import { creditLimitFigures } from "@/lib/booking/errors";
import { formatStayDate } from "@/lib/booking/stay";
import { useCart } from "@/lib/booking/useCart";
import { fill } from "@/lib/i18n/fill";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type {
  CustomOrderConflictDetails,
  CustomOrderGoneItem,
  CustomOrderHold,
  CustomOrderItemInput,
  OrderTraveller,
} from "@/types/order";
import { cn } from "@/lib/utils";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const keyOf = (items: readonly CartItem[]) => items.map((item) => item.id).join("|");

/** The reason a hold or a confirmation was refused, from the server's envelope. */
const reasonOf = (error: unknown): string | null => {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as { reason?: unknown } | undefined;

  return typeof details?.reason === "string" ? details.reason : null;
};

/**
 * One cart line as the confirmation wants it: the payload, plus the hold the
 * checkout took for it and what the traveller asked of it. Only a hotel and a
 * tour accept per-item requests; the rest are told through the order's own.
 */
function toOrderItem(
  item: CartItem,
  hold: CustomOrderHold["holds"][string] | undefined,
  requests: string | undefined,
): CustomOrderItemInput {
  const payload = item.payload;
  const note = requests?.trim() || undefined;

  switch (payload.type) {
    case "HOTEL_STAY":
    case "TOUR":
      return {
        ...payload,
        holdToken: typeof hold === "string" ? hold : undefined,
        specialRequests: note,
      };
    case "PACKAGE":
      return { ...payload, holdTokens: hold && typeof hold === "object" ? hold : undefined };
    default:
      return payload;
  }
}

type HoldFailure = { key: string; kind: "UNAVAILABLE" | "DISABLED" | "generic"; items: CustomOrderGoneItem[] };

/**
 * The details, and the button that books the whole cart as one trip.
 *
 * On arrival the rooms and seats are held (`POST /orders/custom/holds`) and
 * the countdown starts. The holds live in the tab's draft, keyed to the exact
 * list they were taken for, so a refresh resumes them rather than taking a
 * second set — with one room left, a second hold would fail against the
 * first — and a list edited since (an item removed after a refusal) releases
 * the old holds and takes fresh ones.
 *
 * The request carries no amount. The server re-prices every token and answers
 * a moved price or a vanished item with one 409 naming every item involved,
 * which the panel below renders with a remove link per row.
 */
export function CartCheckoutForm() {
  const router = useRouter();
  const path = useLocalePath();
  const { t, intlLocale } = useI18n();

  const cart = useCart();
  const stored = useSyncExternalStore(
    subscribeCartCheckoutDraft,
    cartCheckoutDraftSnapshot,
    cartCheckoutDraftServerSnapshot,
  );
  const draft = stored.draft;
  const ready = cart.ready && stored.ready;
  const items = cart.items;
  const key = keyOf(items);

  const [openedAt] = useState(() => Date.now());
  /** The expiry the countdown reached, so a fresh hold is not born expired. */
  const [lapsedAt, setLapsedAt] = useState<string | null>(null);
  /** The draft whose holds the server said were spent (410). */
  const [spentKey, setSpentKey] = useState<string | null>(null);
  const [holdFailure, setHoldFailure] = useState<HoldFailure | null>(null);
  const inFlight = useRef<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [travellers, setTravellers] = useState<OrderTraveller[]>([]);
  /** Keyed by cart item id, for the hotel and tour lines. */
  const [itemRequests, setItemRequests] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.orders.errors | null>(null);
  const [creditMessage, setCreditMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<CustomOrderConflictDetails | null>(null);
  const [mixedCurrencies, setMixedCurrencies] = useState<string[] | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // --- the holds -----------------------------------------------------------

  const draftMatches = draft !== null && draft.itemIds.join("|") === key;
  const expiresAt = draftMatches && draft.holdExpiresAt ? Date.parse(draft.holdExpiresAt) : null;
  const expired =
    draftMatches &&
    ((draft.holdExpiresAt !== null && lapsedAt === draft.holdExpiresAt) ||
      spentKey === draft.idempotencyKey ||
      (expiresAt !== null && expiresAt <= openedAt));

  // Holds are owed whenever the list in hand has none and has not failed to
  // get them. Derived, so the effect below never sets state synchronously.
  const holding = ready && items.length > 0 && !draftMatches && holdFailure?.key !== key;

  useEffect(() => {
    if (!holding || inFlight.current === key) return;

    inFlight.current = key;
    const stale = draft;
    const itemIds = items.map((item) => item.id);
    const payloads = cartPayloads(items);

    void (async () => {
      try {
        // Holds from a list that has since changed go back first, so the
        // fresh ones are not refused by our own earlier claim.
        if (stale) await releaseCustomOrderHolds(stale.holds).catch(() => undefined);

        const held = await createCustomOrderHolds(payloads);

        if (inFlight.current !== key) return;

        saveCartCheckoutDraft({
          itemIds,
          holds: held.holds,
          holdExpiresAt: held.expiresAt,
          idempotencyKey: newIdempotencyKey(),
        });
      } catch (error) {
        if (inFlight.current !== key) return;

        const reason = reasonOf(error);
        const details =
          error instanceof ApiError ? (error.details as { items?: CustomOrderGoneItem[] }) : null;

        setHoldFailure({
          key,
          kind:
            reason === "CART_DISABLED"
              ? "DISABLED"
              : error instanceof ApiError && [404, 409, 410].includes(error.status)
                ? "UNAVAILABLE"
                : "generic",
          items: Array.isArray(details?.items) ? details.items : [],
        });
      } finally {
        if (inFlight.current === key) inFlight.current = null;
      }
    })();
  }, [holding, key, items, draft]);

  /** After a lapse or a refusal: forget what we had, and the effect holds afresh. */
  const holdAgain = () => {
    inFlight.current = null;
    clearCartCheckoutDraft();
    setHoldFailure(null);
    setConflict(null);
    setErrorKey(null);
  };

  /** Leaving deliberately gives the rooms and seats back now. */
  const abandon = async () => {
    if (draft) await releaseCustomOrderHolds(draft.holds).catch(() => undefined);
    clearCartCheckoutDraft();
    router.push(path("/cart"));
  };

  // --- the confirmation ----------------------------------------------------

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
    if (!draft || !draftMatches || submitting || expired || !validate()) return;

    setSubmitting(true);
    setErrorKey(null);
    setCreditMessage(null);
    setConflict(null);
    setMixedCurrencies(null);

    const leadEmail = email.trim();

    try {
      const order = await confirmCustomOrder({
        items: items.map((item, index) =>
          toOrderItem(item, draft.holds[String(index)], itemRequests[item.id]),
        ),
        name: t.orders.cart.defaultName,
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
        idempotencyKey: draft.idempotencyKey,
      });

      // The holds are spent, not released: the order now owns the rooms.
      clearCart();
      clearCartCheckoutDraft();
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

    const credit = creditLimitFigures(error);

    if (credit) {
      setCreditMessage(fill(t.booking.errors.creditLimit, credit));

      return;
    }

    const reason = reasonOf(error);

    if (reason === "CART_DISABLED") {
      setDisabled(true);

      return;
    }

    if (error.status === 409 && (reason === "UNAVAILABLE" || reason === "PRICE_CHANGED")) {
      setConflict(error.details as CustomOrderConflictDetails);

      return;
    }

    if (error.status === 422 && reason === "MIXED_CURRENCY") {
      const details = error.details as { currencies?: string[] };
      setMixedCurrencies(Array.isArray(details.currencies) ? details.currencies : []);

      return;
    }

    if (error.status === 410 || reason === "HOLD_EXPIRED") {
      if (draft) setSpentKey(draft.idempotencyKey);

      return;
    }

    if (error.status === 422 && reason === "EMPTY") {
      setErrorKey("generic");

      return;
    }

    setErrorKey("generic");
  };

  const setTraveller = (index: number, patch: Partial<OrderTraveller>) =>
    setTravellers((current) =>
      current.map((traveller, position) =>
        position === index ? { ...traveller, ...patch } : traveller,
      ),
    );

  // --- states before the form ---------------------------------------------

  if (!ready) {
    return (
      <Container className="py-24">
        <div className="mx-auto h-48 max-w-xl animate-pulse rounded-sm bg-surface-soft" />
      </Container>
    );
  }

  if (disabled) {
    return (
      <Container className="py-20">
        <EmptyState
          icon={Info}
          title={t.orders.cart.disabledTitle}
          description={t.orders.cart.disabledBody}
          action={{ label: t.nav.packages, href: path("/packages") }}
        />
      </Container>
    );
  }

  if (items.length === 0) {
    return (
      <Container className="py-20">
        <EmptyState
          icon={ShoppingBag}
          title={t.orders.cart.emptyTitle}
          description={t.orders.cart.emptyBody}
          action={{ label: t.nav.packages, href: path("/packages") }}
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
          description={t.orders.cart.expiredBody}
          onReset={holdAgain}
          resetLabel={t.orders.cart.tryHoldAgain}
        />
        <p className="mt-6 text-center">
          <Link
            href={path("/cart")}
            className="type-body-sm text-brand-text underline-offset-4 hover:underline"
          >
            {t.orders.cart.backToCart}
          </Link>
        </p>
      </Container>
    );
  }

  const currency = items[0].display.currency;
  const money = (cents: number) => formatMoney(cents, currency, intlLocale);
  const total = cartSnapshotTotal(items);
  const titleOf = (index: number) => items[index]?.display.title ?? `#${index + 1}`;

  const inputClass =
    "h-11 w-full rounded-sm border border-line bg-background px-3 text-sm text-ink focus:border-ink focus:outline-none";
  const textareaClass =
    "w-full rounded-sm border border-line bg-background p-3 text-sm text-ink focus:border-ink focus:outline-none";
  const labelClass = "type-caption mb-1.5 block text-muted";

  const field = (
    fieldKey: string,
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
        aria-invalid={Boolean(fieldErrors[fieldKey])}
        aria-describedby={fieldErrors[fieldKey] ? `${fieldKey}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, fieldErrors[fieldKey] && "border-error")}
      />
      {fieldErrors[fieldKey] && (
        <span id={`${fieldKey}-error`} role="alert" className="type-caption mt-1 block text-error-text">
          {fieldErrors[fieldKey]}
        </span>
      )}
    </label>
  );

  const summary = (
    <div className="border border-line bg-surface p-5 shadow-card">
      <h2 className="type-h4">{t.orders.checkout.summary}</h2>
      <ul className="mt-4 divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-4 py-2.5">
            <span className="min-w-0">
              <span className="type-body-sm block text-ink">{item.display.title}</span>
              {item.display.detail && (
                <span className="type-caption block text-muted">{item.display.detail}</span>
              )}
              {item.display.dates && (
                <span className="type-caption block text-muted">
                  {formatStayDate(item.display.dates.from, intlLocale)}
                  {item.display.dates.to &&
                    item.display.dates.to !== item.display.dates.from &&
                    ` – ${formatStayDate(item.display.dates.to, intlLocale)}`}
                </span>
              )}
            </span>
            <span className="type-body-sm shrink-0 tabular-nums text-body">
              {money(item.display.priceCents)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line pt-3">
        <span className="type-body font-semibold text-ink">{t.orders.cart.total}</span>
        <span className="type-h4 tabular-nums text-ink">{money(total)}</span>
      </div>
      <p className="type-caption mt-2 text-muted">{t.orders.cart.totalHint}</p>
    </div>
  );

  const refusedRows = (rows: { index: number; children: React.ReactNode }[]) => (
    <ul className="type-caption mt-2 flex flex-col gap-2 text-body">
      {rows.map((row) => {
        const item = items[row.index];

        return (
          <li key={row.index} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="min-w-0">{row.children}</span>
            {item && (
              <span className="flex shrink-0 gap-4">
                <Link
                  href={path(item.display.href)}
                  className="text-brand-text underline-offset-4 hover:underline"
                >
                  {t.orders.cart.reAdd}
                </Link>
                <button
                  type="button"
                  onClick={() => removeFromCart(item.id)}
                  className="font-medium text-error-text underline-offset-4 hover:underline"
                >
                  {t.orders.cart.remove}
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Container className="pt-6 pb-24 lg:pb-32">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-7">
          <MobileCheckoutSummary
            title={t.orders.checkout.summary}
            total={money(total)}
            className="mb-8"
          >
            {summary}
          </MobileCheckoutSummary>

          {/* --- the holds: taken, being taken, or refused ----------------- */}
          {holding && (
            <p
              role="status"
              className="flex items-center gap-2.5 rounded-sm border border-line bg-surface-soft/60 px-4 py-3 text-sm text-body"
            >
              <Clock size={16} className="shrink-0 animate-pulse text-brand-text" aria-hidden />
              {t.orders.cart.holding}
            </p>
          )}

          {draftMatches && expiresAt !== null && (
            <p className="flex items-center gap-2.5 rounded-sm border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
              <Clock size={16} className="shrink-0" aria-hidden />
              <span>
                {t.orders.checkout.heldNotice} ·{" "}
                <span className="font-medium tabular-nums">
                  <HoldCountdown
                    expiresAt={expiresAt}
                    template={t.booking.checkout.expiresIn}
                    onExpire={() => setLapsedAt(draft?.holdExpiresAt ?? null)}
                  />
                </span>
              </span>
            </p>
          )}

          {holdFailure && holdFailure.key === key && (
            <div role="alert" className="rounded-sm border border-error/30 bg-error/5 px-4 py-3.5">
              <p className="type-body-sm flex items-center gap-2 font-semibold text-error-text">
                <AlertCircle size={16} className="shrink-0" aria-hidden />
                {holdFailure.kind === "DISABLED"
                  ? t.orders.cart.disabledTitle
                  : t.orders.cart.holdFailedTitle}
              </p>
              <p className="type-caption mt-1.5 text-body">
                {holdFailure.kind === "DISABLED"
                  ? t.orders.cart.disabledBody
                  : holdFailure.kind === "UNAVAILABLE"
                    ? t.orders.cart.holdFailedBody
                    : t.orders.errors.generic}
              </p>
              {holdFailure.items.length > 0 &&
                refusedRows(
                  holdFailure.items.map((gone) => ({
                    index: gone.index,
                    children: (
                      <>
                        {titleOf(gone.index)}
                        {gone.reason in t.packages.quote.slotReasons &&
                          ` — ${t.packages.quote.slotReasons[gone.reason as keyof typeof t.packages.quote.slotReasons]}`}
                      </>
                    ),
                  })),
                )}
              {holdFailure.kind !== "DISABLED" && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button variant="outline" size="sm" onClick={holdAgain}>
                    {t.orders.cart.tryHoldAgain}
                  </Button>
                  <Button variant="ghost" size="sm" href={path("/cart")}>
                    {t.orders.cart.backToCart}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* --- what the server refused, item by item --------------------- */}
          {conflict && (
            <div className="mt-4 rounded-sm border border-line bg-surface-soft px-4 py-3.5">
              <p className="type-body-sm flex items-center gap-2 font-semibold text-ink">
                <AlertCircle size={16} className="shrink-0 text-brand-text" aria-hidden />
                {conflict.reason === "PRICE_CHANGED"
                  ? t.orders.errors.priceChangedTitle
                  : t.orders.errors.unavailableTitle}
              </p>
              <p className="type-caption mt-1.5 text-muted">
                {conflict.reason === "PRICE_CHANGED"
                  ? t.orders.cart.priceChangedBody
                  : t.orders.cart.unavailableBody}
              </p>
              {conflict.reason === "PRICE_CHANGED"
                ? refusedRows(
                    conflict.items.map((drifted) => ({
                      index: drifted.index,
                      children: (
                        <>
                          {fill(t.orders.errors.priceChangedRow, {
                            label: titleOf(drifted.index),
                            was: money(drifted.quotedCents),
                            now: money(drifted.currentCents),
                          })}
                          {drifted.components && drifted.components.length > 0 && (
                            <span className="block text-muted">
                              {drifted.components
                                .map((component) =>
                                  fill(t.orders.errors.priceChangedRow, {
                                    label: component.label,
                                    was: money(component.quotedCents),
                                    now: money(component.currentCents),
                                  }),
                                )
                                .join(" · ")}
                            </span>
                          )}
                        </>
                      ),
                    })),
                  )
                : refusedRows(
                    conflict.items.map((gone) => ({
                      index: gone.index,
                      children: (
                        <>
                          {titleOf(gone.index)}
                          {gone.reason in t.packages.quote.slotReasons &&
                            ` — ${t.packages.quote.slotReasons[gone.reason as keyof typeof t.packages.quote.slotReasons]}`}
                        </>
                      ),
                    })),
                  )}
              <Button variant="outline" size="sm" href={path("/cart")} className="mt-3">
                {t.orders.cart.refresh}
              </Button>
            </div>
          )}

          {mixedCurrencies && (
            <p role="alert" className="type-body-sm mt-4 rounded-sm bg-surface-soft p-3.5 text-brand-text">
              {fill(t.orders.cart.mixedCurrency, { currencies: mixedCurrencies.join(", ") })}
            </p>
          )}

          {creditMessage && (
            <p role="alert" className="type-body-sm mt-4 rounded-sm bg-surface-soft p-3.5 text-brand-text">
              {creditMessage}
            </p>
          )}

          {errorKey && (
            <p role="alert" className="type-body-sm mt-4 rounded-sm bg-surface-soft p-3.5 text-brand-text">
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
            <fieldset disabled={submitting || !draftMatches} className="contents">
              <section>
                <h2 className="type-h3">{t.orders.checkout.leadGuest}</h2>
                <p className="type-body-sm mt-2 text-muted">{t.orders.checkout.leadGuestHint}</p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {field("leadGuest.firstName", t.booking.checkout.firstName, firstName, setFirstName, {
                    required: true,
                    autoComplete: "given-name",
                  })}
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
                            aria-label={fill(t.orders.checkout.removeTraveller, { number: index + 2 })}
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
                <h2 className="type-h3">{t.orders.checkout.specialRequests}</h2>

                {items
                  .filter((item) => item.payload.type === "HOTEL_STAY" || item.payload.type === "TOUR")
                  .map((item) => (
                    <label key={item.id} className="mt-5 block">
                      <span className={labelClass}>
                        {fill(t.orders.cart.itemRequests, { title: item.display.title })}
                      </span>
                      <textarea
                        value={itemRequests[item.id] ?? ""}
                        rows={2}
                        maxLength={1000}
                        onChange={(event) =>
                          setItemRequests((current) => ({ ...current, [item.id]: event.target.value }))
                        }
                        className={textareaClass}
                      />
                      <span className="type-caption mt-1 block text-muted">
                        {t.orders.cart.itemRequestsHint}
                      </span>
                    </label>
                  ))}

                <label className="mt-5 block">
                  <span className={labelClass}>{t.orders.checkout.specialRequests}</span>
                  <textarea
                    value={specialRequests}
                    rows={3}
                    maxLength={1000}
                    onChange={(event) => setSpecialRequests(event.target.value)}
                    className={textareaClass}
                  />
                </label>
                <p className="type-caption mt-1.5 text-muted">
                  {t.orders.checkout.specialRequestsHint}
                </p>
              </section>

              <p className="type-caption mt-8 text-muted">{t.orders.checkout.terms}</p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button type="submit" size="lg" disabled={submitting || !draftMatches}>
                  {submitting ? t.orders.checkout.confirming : t.orders.cart.confirm}
                </Button>
                <Button variant="ghost" onClick={() => void abandon()}>
                  {t.orders.cart.backToCart}
                </Button>
              </div>
            </fieldset>
          </form>
        </div>

        <div className="hidden lg:col-span-5 lg:block">
          <div className="lg:sticky lg:top-24">{summary}</div>
        </div>
      </div>
    </Container>
  );
}
