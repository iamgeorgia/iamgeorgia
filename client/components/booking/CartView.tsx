"use client";

import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  BedDouble,
  CarFront,
  Compass,
  ConciergeBell,
  Package,
  RefreshCw,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { quoteCustomOrder } from "@/lib/api/orders";
import {
  cartCurrencies,
  cartPayloads,
  cartSnapshotTotal,
  removeFromCart,
  type CartItem,
} from "@/lib/booking/cart";
import { useCart } from "@/lib/booking/useCart";
import { formatStayDate } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type {
  CustomOrderGoneItem,
  CustomOrderItemType,
  CustomOrderQuote,
  CustomOrderQuoteItem,
} from "@/types/order";
import { cn } from "@/lib/utils";

const ICONS: Record<CustomOrderItemType, LucideIcon> = {
  HOTEL_STAY: BedDouble,
  TRANSFER: CarFront,
  TOUR: Compass,
  SERVICE: ConciergeBell,
  PACKAGE: Package,
};

/** The item ids in order: the key a quote was taken for. */
const keyOf = (items: readonly CartItem[]) => items.map((item) => item.id).join("|");

/**
 * The cart, priced today.
 *
 * What the traveller sees first is the snapshot each item was added with —
 * rendered from the browser, before any round trip. A quote is then taken
 * for the whole list (`POST /orders/custom/quote`, which writes nothing), and
 * every line that moved says what it was and what it is, every line that
 * went says so and offers removal, and the total becomes today's. The quote
 * is keyed to the exact list it priced: remove an item and it is taken again,
 * because a package's discount and the order's span both depend on the rest.
 *
 * No money is computed here beyond adding up the snapshots for the "when
 * added" line. The figure that is charged comes from the server, twice more:
 * at the hold and at confirmation.
 */
export function CartView() {
  const { t, locale, intlLocale } = useI18n();
  const path = useLocalePath();
  const cart = useCart();

  const [quote, setQuote] = useState<CustomOrderQuote | null>(null);
  /** The list the quote in hand was taken for; a different list has none. */
  const [quotedKey, setQuotedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);

  const items = cart.items;
  const key = keyOf(items);
  const currencies = cartCurrencies(items);
  const currency = currencies[0] ?? null;

  // A quote is owed whenever the list in hand has neither been priced nor
  // failed to price. Derived rather than held, so the effect below never
  // sets state synchronously — it only reports what the server said.
  const quoting = cart.ready && items.length > 0 && quotedKey !== key && failedKey !== key;
  const quoteFailed = failedKey === key;

  useEffect(() => {
    if (!quoting || inFlight.current === key) return;

    inFlight.current = key;
    const payloads = cartPayloads(items);

    void (async () => {
      try {
        const result = await quoteCustomOrder({ items: payloads });

        // The list may have changed while the call was out; a quote for a
        // different list is not a quote for this one.
        if (inFlight.current !== key) return;

        setQuote(result);
        setQuotedKey(key);
      } catch {
        if (inFlight.current === key) setFailedKey(key);
      } finally {
        if (inFlight.current === key) inFlight.current = null;
      }
    })();
  }, [quoting, key, items]);

  /** "Refresh prices": forget the quote in hand, and the effect takes another. */
  const refresh = () => {
    inFlight.current = null;
    setQuotedKey(null);
    setFailedKey(null);
  };

  // --- states before the list ----------------------------------------------

  if (!cart.ready) {
    return (
      <Container className="py-12">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="flex flex-col gap-4 lg:col-span-8">
            <div className="h-32 animate-pulse rounded-sm bg-surface-soft" />
            <div className="h-32 animate-pulse rounded-sm bg-surface-soft" />
          </div>
          <div className="h-56 animate-pulse rounded-sm bg-surface-soft lg:col-span-4" />
        </div>
      </Container>
    );
  }

  if (items.length === 0) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={ShoppingBag}
          title={t.orders.cart.emptyTitle}
          description={t.orders.cart.emptyBody}
          action={{ label: t.nav.packages, href: path("/packages") }}
        />
        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
          {(
            [
              ["hotels", "/hotels"],
              ["tours", "/tours"],
              ["transfers", "/transfers"],
            ] as const
          ).map(([navKey, href]) => (
            <li key={navKey}>
              <Link
                href={path(href)}
                className="type-body-sm text-brand-text underline-offset-4 hover:underline"
              >
                {t.nav[navKey]}
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    );
  }

  // --- what the quote said about each item ---------------------------------

  const fresh = quotedKey === key ? quote : null;
  const linesByIndex = new Map<number, CustomOrderQuoteItem[]>();
  const goneByIndex = new Map<number, CustomOrderGoneItem>();

  if (fresh?.available) {
    for (const line of fresh.items) {
      const existing = linesByIndex.get(line.index) ?? [];
      existing.push(line);
      linesByIndex.set(line.index, existing);
    }
  } else if (fresh && fresh.reason === "UNAVAILABLE") {
    for (const gone of fresh.items) goneByIndex.set(gone.index, gone);
  }

  const mixed =
    currencies.length > 1 || (fresh !== null && !fresh.available && fresh.reason === "MIXED_CURRENCY");
  const mixedList =
    fresh && !fresh.available && fresh.reason === "MIXED_CURRENCY"
      ? fresh.currencies.join(", ")
      : currencies.join(", ");
  const anyGone = goneByIndex.size > 0;
  const anyMoved = fresh?.available === true && fresh.priceChanged;
  const canCheckout = !quoting && !mixed && !anyGone;

  const money = (cents: number, code = currency ?? "GEL") => formatMoney(cents, code, intlLocale);

  return (
    <Container className="pt-6 pb-24 lg:pb-32">
      <p className="type-body-sm text-muted">
        {fill(t.orders.cart.count, { count: plural(locale, items.length, t.units.item) })}
        {currency && <> · {fill(t.orders.cart.pricedIn, { currency })}</>}
      </p>

      <div className="mt-6 grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-8">
          {/* --- notices ------------------------------------------------- */}
          {mixed && (
            <Notice tone="error">{fill(t.orders.cart.currencyGuard, { currencies: mixedList })}</Notice>
          )}
          {anyGone && <Notice tone="error">{t.orders.cart.unavailableNotice}</Notice>}
          {anyMoved && <Notice tone="warning">{t.orders.cart.priceChangedNotice}</Notice>}
          {quoteFailed && <Notice tone="warning">{t.orders.cart.quoteFailed}</Notice>}

          <ul className="flex flex-col gap-4">
            {items.map((item, index) => (
              <li key={item.id}>
                <CartItemCard
                  item={item}
                  lines={linesByIndex.get(index) ?? null}
                  gone={goneByIndex.get(index) ?? null}
                  money={money}
                  onRemove={() => removeFromCart(item.id)}
                />
              </li>
            ))}
          </ul>
        </div>

        {/* --- the summary ------------------------------------------------- */}
        <aside className="lg:col-span-4">
          <div className="border border-line bg-surface p-5 shadow-card lg:sticky lg:top-36">
            <h2 className="type-h4">{t.orders.cart.summary}</h2>

            <dl className="mt-4 flex flex-col gap-2">
              {fresh?.available ? (
                <>
                  <div className="type-body-sm flex items-baseline justify-between gap-4">
                    <dt className="text-muted">{t.orders.cart.itemsTotal}</dt>
                    <dd className="tabular-nums text-body">
                      {money(fresh.totals.componentsSellCents, fresh.currency)}
                    </dd>
                  </div>
                  {fresh.totals.adjustmentCents !== 0 && (
                    <div className="type-body-sm flex items-baseline justify-between gap-4">
                      <dt className="text-accent-green">{t.orders.cart.discounts}</dt>
                      <dd className="tabular-nums text-accent-green">
                        {money(fresh.totals.adjustmentCents, fresh.currency)}
                      </dd>
                    </div>
                  )}
                  <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-3">
                    <dt className="type-body font-semibold text-ink">{t.orders.cart.total}</dt>
                    <dd className="type-h4 tabular-nums text-ink">
                      {money(fresh.totals.sellTotalCents, fresh.currency)}
                    </dd>
                  </div>
                </>
              ) : (
                <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
                  <dt className="type-body font-semibold text-ink">
                    {t.orders.cart.totalWhenAdded}
                  </dt>
                  <dd className="type-h4 tabular-nums text-ink">
                    {money(cartSnapshotTotal(items))}
                  </dd>
                </div>
              )}
            </dl>

            <p className="type-caption mt-2 text-muted" aria-live="polite">
              {quoting ? t.orders.cart.checking : t.orders.cart.totalHint}
            </p>

            <div className="mt-5 flex flex-col gap-3">
              {canCheckout ? (
                <Button href={path("/cart/checkout")} size="lg" fullWidth>
                  {t.orders.cart.checkout}
                </Button>
              ) : (
                <Button size="lg" fullWidth disabled>
                  {t.orders.cart.checkout}
                </Button>
              )}
              <Button variant="outline" fullWidth disabled={quoting} onClick={refresh}>
                <RefreshCw size={15} className={cn(quoting && "animate-spin")} aria-hidden />
                {quoting ? t.orders.cart.checking : t.orders.cart.refresh}
              </Button>
              <Button variant="ghost" fullWidth href={path("/packages")}>
                {t.orders.cart.keepBrowsing}
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </Container>
  );
}

// --- one item -----------------------------------------------------------------

interface CartItemCardProps {
  item: CartItem;
  /** The quote's lines for this item: one, or one per package component. */
  lines: CustomOrderQuoteItem[] | null;
  gone: CustomOrderGoneItem | null;
  money: (cents: number, currency?: string) => string;
  onRemove: () => void;
}

function CartItemCard({ item, lines, gone, money, onRemove }: CartItemCardProps) {
  const { t, intlLocale } = useI18n();
  const path = useLocalePath();
  const { display, payload } = item;
  const Icon = ICONS[payload.type];
  const isPackage = payload.type === "PACKAGE";

  const now = lines ? lines.reduce((sum, line) => sum + line.lineTotalCents, 0) : null;
  const moved = lines?.some((line) => line.priceChanged) ?? false;
  const reasonText =
    gone && gone.reason in t.packages.quote.slotReasons
      ? t.packages.quote.slotReasons[gone.reason as keyof typeof t.packages.quote.slotReasons]
      : t.orders.cart.unavailable;

  const dates = display.dates
    ? display.dates.to && display.dates.to !== display.dates.from
      ? `${formatStayDate(display.dates.from, intlLocale)} – ${formatStayDate(display.dates.to, intlLocale)}`
      : formatStayDate(display.dates.from, intlLocale)
    : null;

  /** A package's lines arrive prefixed with its name; under its own card that is noise. */
  const lineLabel = (label: string) =>
    display.packageName && label.startsWith(`${display.packageName} · `)
      ? label.slice(display.packageName.length + 3)
      : label;

  return (
    <article
      className={cn(
        "border border-line bg-surface",
        gone && "border-error/40 bg-surface-soft",
      )}
      aria-labelledby={`cart-item-${item.id}`}
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:p-5">
        <div className="relative aspect-4/3 overflow-hidden rounded-sm bg-surface-soft sm:aspect-square">
          {display.image ? (
            <Image
              src={display.image}
              alt=""
              fill
              sizes="(max-width: 640px) 90vw, 7rem"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-brand-text">
              <Icon size={28} aria-hidden />
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={payload.type === "PACKAGE" ? "brand" : "neutral"}>
                  {payload.type === "PACKAGE"
                    ? t.nav.packages
                    : t.orders.componentTypes[payload.type]}
                </Badge>
                {gone && <Badge tone="outline">{t.orders.cart.unavailable}</Badge>}
                {moved && !gone && <Badge tone="outline">{t.orders.cart.priceMoved}</Badge>}
              </div>
              <h3 id={`cart-item-${item.id}`} className="type-h4 mt-2">
                {display.title}
              </h3>
              {display.detail && (
                <p className="type-body-sm mt-0.5 text-body">{display.detail}</p>
              )}
              {dates && <p className="type-caption mt-1 text-muted">{dates}</p>}
            </div>

            <div className="text-end">
              <p className={cn("type-h4 tabular-nums", gone ? "text-muted line-through" : "text-ink")}>
                {money(now ?? display.priceCents, display.currency)}
              </p>
              {moved && now !== null && (
                <p className="type-caption mt-0.5 text-warning-text">
                  {fill(t.orders.cart.wasNow, {
                    was: money(display.priceCents, display.currency),
                    now: money(now, display.currency),
                  })}
                </p>
              )}
            </div>
          </div>

          {gone && (
            <p className="type-body-sm mt-3 flex items-start gap-2 text-error-text">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
              {reasonText}
            </p>
          )}

          {isPackage && lines && lines.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="type-caption font-semibold tracking-wide text-muted uppercase">
                {t.orders.cart.includes}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {lines.map((line) => (
                  <li
                    key={line.slotIndex}
                    className="type-caption flex items-baseline justify-between gap-4 text-body"
                  >
                    <span className="min-w-0">
                      {lineLabel(line.label)}
                      {line.priceChanged && (
                        <span className="ms-2 text-warning-text">
                          {fill(t.orders.cart.wasNow, {
                            was: money(line.quotedCents, display.currency),
                            now: money(line.currentCents, display.currency),
                          })}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {money(line.lineTotalCents, display.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link
              href={path(display.href)}
              className="type-caption text-brand-text underline-offset-4 hover:underline"
            >
              {t.orders.cart.open}
            </Link>
            <button
              type="button"
              onClick={onRemove}
              aria-label={fill(t.orders.cart.removeItem, { title: display.title })}
              className={cn(
                "type-caption inline-flex items-center gap-1.5 underline-offset-4 hover:underline",
                gone ? "font-medium text-error-text" : "text-muted hover:text-ink",
              )}
            >
              <Trash2 size={13} aria-hidden />
              {t.orders.cart.remove}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function Notice({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className={cn(
        "type-body-sm mb-4 flex items-start gap-2.5 rounded-sm border px-4 py-3",
        tone === "error"
          ? "border-error/30 bg-error/5 text-error-text"
          : "border-warning/40 bg-warning/5 text-warning-text",
      )}
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
