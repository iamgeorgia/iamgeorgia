"use client";

import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BedDouble,
  CarFront,
  ChevronDown,
  Clock,
  Compass,
  ConciergeBell,
  Minus,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useState, useTransition } from "react";
import type { LucideIcon } from "lucide-react";

import { AddToCartButton } from "@/components/booking/AddToCartButton";
import { KosherPanel } from "@/components/packages/KosherPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { createOrderHolds } from "@/lib/api/orders";
import { ApiError } from "@/lib/api/client";
import type { CartItem } from "@/lib/booking/cart";
import { newIdempotencyKey, saveOrderCheckoutDraft } from "@/lib/booking/checkoutSession";
import { formatInstant, formatStayDate } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import {
  packageImageUrl,
  packageSearchQueryString,
  resolvedHotel,
  resolvedService,
  resolvedTour,
  resolvedTransfer,
  type PackageSearch,
  type SlotChoice,
} from "@/lib/packages/query";
import type {
  HotelAlternative,
  PackageQuote,
  QuotedComponent,
  TourAlternative,
  TransferAlternative,
} from "@/types/package";
import { cn } from "@/lib/utils";

interface PackageBuilderProps {
  slug: string;
  name: string;
  search: PackageSearch;
  quote: PackageQuote;
}

const ICONS: Record<QuotedComponent["componentType"], LucideIcon> = {
  HOTEL_STAY: BedDouble,
  TRANSFER: CarFront,
  TOUR: Compass,
  SERVICE: ConciergeBell,
};

/**
 * The trip as the buyer can still change it.
 *
 * Every figure here came from `/api/packages/:slug/quote` for the exact date,
 * party and choices in the URL, so each line is a real price for something
 * that could be sold at the moment the page rendered. Changing a room, a
 * vehicle or a departure rewrites the URL and re-renders on the server rather
 * than patching a total in the browser: the adjustment is allocated across
 * every line, so one changed slot moves all of them, and only the server
 * knows by how much.
 *
 * "Reserve" takes the holds before the buyer types a character of their name,
 * which is the difference between losing a room during checkout and losing it
 * during the choosing.
 */
export function PackageBuilder({ slug, name, search, quote }: PackageBuilderProps) {
  const router = useRouter();
  const path = useLocalePath();
  const { t, locale, intlLocale } = useI18n();

  const [repricing, startRepricing] = useTransition();
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [holding, setHolding] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.orders.errors | null>(null);

  const push = (next: PackageSearch) => {
    setOpenSlot(null);
    startRepricing(() => {
      router.push(path(`/packages/${slug}${packageSearchQueryString(next)}`), { scroll: false });
    });
  };

  const choose = (slotIndex: number, choice: SlotChoice) =>
    push({ ...search, choices: { ...search.choices, [slotIndex]: choice } });

  const toggle = (slotIndex: number, included: boolean) =>
    push({
      ...search,
      exclude: included
        ? search.exclude.filter((slot) => slot !== slotIndex)
        : [...search.exclude, slotIndex],
    });

  const reserve = async () => {
    if (!quote.token) return;

    setErrorKey(null);
    setHolding(true);

    try {
      // Holds first: only hotel and tour slots reserve anything, and the
      // server answers with the earliest expiry across them.
      const hold = await createOrderHolds(quote.token);

      saveOrderCheckoutDraft({
        packageToken: quote.token,
        quote,
        packageSlug: slug,
        packageName: name,
        search,
        holdTokens: hold.holdTokens,
        holdExpiresAt: hold.expiresAt,
        idempotencyKey: newIdempotencyKey(),
      });

      router.push(path("/packages/checkout"));
    } catch (error) {
      // A room or seat went between rendering and clicking. Ordinary on a
      // popular date, and nothing typed is lost — the page simply re-quotes.
      setErrorKey(
        error instanceof ApiError && error.status === 409 ? "holdExpired" : "generic",
      );
      setHolding(false);
      router.refresh();
    }
  };

  /**
   * The whole priced trip for the cart, as one item. The cart's checkout
   * flattens it into its components under this name, holding each slot then
   * — not now — so a package waiting in a cart keeps no room from anyone.
   */
  const cartItem = (): Omit<CartItem, "id" | "addedAt"> => ({
    payload: { type: "PACKAGE", packageToken: quote.token ?? "" },
    display: {
      title: name,
      detail: quote.components
        .filter((component) => component.included)
        .map((component) => component.label)
        .join(" · "),
      dates: { from: quote.startDate, to: quote.endDate },
      priceCents: quote.totals.totalCents,
      currency: quote.currency,
      image: packageImageUrl(quote.package),
      href: `/packages/${slug}${packageSearchQueryString(search)}`,
      packageName: name,
    },
  });

  const party = [
    plural(locale, search.adults, t.units.adult),
    search.childAges.length > 0 ? plural(locale, search.childAges.length, t.units.child) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const money = (cents: number) => formatMoney(cents, quote.currency, intlLocale);
  const busy = repricing || holding;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
      {/* --- the slots ---------------------------------------------------- */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
          <h2 className="type-h4">{t.packages.quote.heading}</h2>
          <p className="type-body-sm text-muted">
            {fill(t.packages.quote.pricedFor, {
              dates: `${formatStayDate(quote.startDate, intlLocale)} – ${formatStayDate(quote.endDate, intlLocale)}`,
              party,
            })}
          </p>
        </div>

        <ul className={cn("mt-6 flex flex-col gap-4", repricing && "opacity-60 transition-opacity")}>
          {quote.components.map((component) => (
            <SlotRow
              key={component.slotIndex}
              component={component}
              currency={quote.currency}
              open={openSlot === component.slotIndex}
              busy={busy}
              onOpen={() =>
                setOpenSlot((current) =>
                  current === component.slotIndex ? null : component.slotIndex,
                )
              }
              onChoose={(choice) => choose(component.slotIndex, choice)}
              onToggle={(included) => toggle(component.slotIndex, included)}
            />
          ))}
        </ul>
      </div>

      {/* --- the price ---------------------------------------------------- */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="border border-line bg-surface p-5 shadow-card">
          {quote.kosher && <KosherPanel kosher={quote.kosher} className="mb-5" />}

          {!quote.available && (
            <div className="mb-5 flex gap-2.5 rounded-sm bg-surface-soft p-3.5">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
              <div>
                <p className="type-body-sm font-semibold text-ink">
                  {t.packages.quote.unavailableTitle}
                </p>
                <p className="type-caption mt-1 text-muted">
                  {quote.unavailableReason
                    ? t.packages.quote.unavailable[quote.unavailableReason]
                    : t.packages.quote.unavailable.COMPONENT_UNAVAILABLE}
                </p>
              </div>
            </div>
          )}

          <dl className="flex flex-col gap-2">
            <div className="type-body-sm flex items-baseline justify-between gap-4">
              <dt className="text-muted">{t.packages.quote.componentsTotal}</dt>
              <dd className="tabular-nums text-body">{money(quote.totals.componentsSellCents)}</dd>
            </div>

            {quote.totals.adjustmentCents !== 0 && (
              <div className="type-body-sm flex items-baseline justify-between gap-4">
                <dt className={quote.totals.adjustmentCents < 0 ? "text-accent-green" : "text-muted"}>
                  {quote.totals.adjustmentCents < 0
                    ? t.packages.quote.discount
                    : t.packages.quote.supplement}
                </dt>
                <dd
                  className={cn(
                    "tabular-nums",
                    quote.totals.adjustmentCents < 0 ? "text-accent-green" : "text-body",
                  )}
                >
                  {money(quote.totals.adjustmentCents)}
                </dd>
              </div>
            )}

            <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-3">
              <dt className="type-body font-semibold text-ink">{t.packages.quote.total}</dt>
              <dd className="type-h4 tabular-nums text-ink">{money(quote.totals.totalCents)}</dd>
            </div>

            {typeof quote.totals.marginCents === "number" && (
              <div className="type-caption flex items-baseline justify-between gap-4 text-muted">
                <dt>{t.packages.quote.margin}</dt>
                <dd className="tabular-nums">{money(quote.totals.marginCents)}</dd>
              </div>
            )}
          </dl>

          <p className="type-caption mt-2 text-muted">{t.packages.quote.totalHint}</p>

          {errorKey && (
            <p className="type-body-sm mt-4 rounded-sm bg-surface-soft p-3 text-brand-text">
              {t.orders.errors[errorKey]}
            </p>
          )}

          <Button
            fullWidth
            size="lg"
            className="mt-5"
            disabled={!quote.available || !quote.token || busy}
            onClick={() => void reserve()}
          >
            {holding ? t.packages.quote.holding : t.packages.quote.reserve}
          </Button>
          <AddToCartButton
            item={cartItem}
            size="lg"
            fullWidth
            className="mt-3"
            disabled={!quote.available || !quote.token || busy}
          />
        </div>
      </aside>
    </div>
  );
}

// --- one slot ---------------------------------------------------------------

interface SlotRowProps {
  component: QuotedComponent;
  currency: string;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onChoose: (choice: SlotChoice) => void;
  onToggle: (included: boolean) => void;
}

function SlotRow({ component, currency, open, busy, onOpen, onChoose, onToggle }: SlotRowProps) {
  const { t, locale, intlLocale } = useI18n();
  const Icon = ICONS[component.componentType];
  const money = (cents: number) => formatMoney(cents, currency, intlLocale);

  const hotel = resolvedHotel(component);
  const transfer = resolvedTransfer(component);
  const tour = resolvedTour(component);
  const service = resolvedService(component);

  const onRequest =
    tour?.option.confirmationMode === "ON_REQUEST" ||
    service?.service.confirmationMode === "ON_REQUEST";

  /** What the slot resolved to, in one or two lines under the label. */
  const detail = (() => {
    if (hotel) {
      return (
        <>
          <p className="type-body-sm text-ink">
            {fill(t.packages.quote.nightsAt, { count: hotel.nights, hotel: hotel.hotel.name })}
          </p>
          <p className="type-caption text-muted">
            {fill(t.packages.quote.roomFor, {
              room: hotel.roomType.name,
              party: plural(locale, hotel.rooms, t.units.room),
            })}
            {hotel.ratePlan.mealPlanName ? ` · ${hotel.ratePlan.mealPlanName}` : ""}
          </p>
          {hotel.freeCancellationUntil && (
            <p className="type-caption mt-1 inline-flex items-center gap-1.5 text-accent-green">
              <ShieldCheck size={12} aria-hidden />
              {fill(t.packages.quote.freeUntil, {
                date: formatStayDate(hotel.freeCancellationUntil.slice(0, 10), intlLocale),
              })}
            </p>
          )}
          {hotel.payableAtPropertyCents > 0 && (
            <p className="type-caption text-muted">
              {fill(t.packages.quote.payAtProperty, {
                amount: money(hotel.payableAtPropertyCents),
              })}
            </p>
          )}
        </>
      );
    }

    if (transfer) {
      const pickup = transfer.legs[0]?.pickupAt;

      return (
        <>
          <p className="type-body-sm text-ink">
            {transfer.from.name} → {transfer.to.name}
          </p>
          <p className="type-caption text-muted">
            {transfer.vehicle.name}
            {pickup ? ` · ${formatInstant(pickup, intlLocale)}` : ""}
          </p>
        </>
      );
    }

    if (tour) {
      return (
        <>
          <p className="type-body-sm text-ink">{tour.tour.title}</p>
          <p className="type-caption text-muted">
            {tour.option.name} · {formatStayDate(tour.date, intlLocale)}
            {tour.departureTime
              ? ` · ${fill(t.packages.quote.departsAt, { time: tour.departureTime })}`
              : ""}
          </p>
        </>
      );
    }

    if (service) {
      return (
        <>
          <p className="type-body-sm text-ink">{service.service.name}</p>
          <p className="type-caption text-muted">
            {formatStayDate(service.date, intlLocale)}
            {service.quantity > 1
              ? ` · ${fill(t.packages.quote.quantity, { count: service.quantity })}`
              : ""}
          </p>
        </>
      );
    }

    return (
      <p className="type-caption text-muted">
        {component.reason
          ? t.packages.quote.slotReasons[component.reason]
          : t.packages.quote.slotReasons.UNAVAILABLE}
      </p>
    );
  })();

  const alternatives = component.alternatives;
  const canChoose = alternatives.length > 0 && component.included && component.resolved !== null;

  return (
    <li
      className={cn(
        "border border-line bg-surface p-4",
        !component.included && "bg-surface-soft opacity-75",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-brand-text">
          <Icon size={17} aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-caption font-semibold tracking-wide text-muted uppercase">
              {component.label}
            </span>
            {component.required ? (
              <Badge tone="outline">{t.packages.required}</Badge>
            ) : (
              <Badge tone="neutral">{t.packages.optional}</Badge>
            )}
            {onRequest && <Badge tone="neutral">{t.packages.quote.onRequest}</Badge>}
          </div>

          <div className="mt-1.5">{detail}</div>

          {onRequest && (
            <p className="type-caption mt-1.5 flex items-center gap-1.5 text-muted">
              <Clock size={12} aria-hidden />
              {t.packages.quote.onRequestHint}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {component.included && component.resolved && (
            <>
              <span className="type-body-sm tabular-nums text-ink">
                {money(component.lineTotalCents)}
              </span>
              {component.adjustmentCents !== 0 && (
                <span className="type-caption tabular-nums text-accent-green">
                  {money(component.adjustmentCents)}
                </span>
              )}
            </>
          )}

          {!component.required && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onToggle(!component.included)}
              className="type-caption inline-flex items-center gap-1.5 text-muted underline-offset-4 transition-colors hover:text-ink hover:underline disabled:opacity-50"
            >
              {component.included ? (
                <>
                  <Minus size={12} aria-hidden />
                  {t.packages.quote.remove}
                </>
              ) : (
                <>
                  <Plus size={12} aria-hidden />
                  {t.packages.quote.include}
                </>
              )}
            </button>
          )}

          {canChoose && (
            <button
              type="button"
              disabled={busy}
              onClick={onOpen}
              aria-expanded={open}
              className="type-caption inline-flex items-center gap-1 text-brand-text underline-offset-4 transition-colors hover:underline disabled:opacity-50"
            >
              {t.packages.quote.change}
              <ChevronDown
                size={12}
                aria-hidden
                className={cn("transition-transform", open && "rotate-180")}
              />
            </button>
          )}
        </div>
      </div>

      {open && canChoose && (
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4">
          <li className="type-caption px-2 pb-1 text-muted">{t.packages.quote.alternatives}</li>
          {alternatives.map((alternative) => (
            <AlternativeRow
              key={alternativeKey(alternative)}
              componentType={component.componentType}
              alternative={alternative}
              currency={currency}
              busy={busy}
              onChoose={onChoose}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const alternativeKey = (alternative: HotelAlternative | TransferAlternative | TourAlternative) =>
  "ratePlanId" in alternative
    ? `${alternative.hotelId}:${alternative.ratePlanId}`
    : "vehicleId" in alternative
      ? alternative.vehicleId
      : alternative.tourOptionId;

interface AlternativeRowProps {
  componentType: QuotedComponent["componentType"];
  alternative: HotelAlternative | TransferAlternative | TourAlternative;
  currency: string;
  busy: boolean;
  onChoose: (choice: SlotChoice) => void;
}

/**
 * One other way to fill the slot.
 *
 * The price shown is that offer's own standalone sell, not the line total it
 * would become: the package adjustment is reallocated across every line when
 * the choice changes, so the only honest way to show the new total is to ask
 * the server, which is what clicking does.
 */
function AlternativeRow({
  componentType,
  alternative,
  currency,
  busy,
  onChoose,
}: AlternativeRowProps) {
  const { t, intlLocale } = useI18n();

  const { label, sublabel, choice } = (() => {
    if (componentType === "HOTEL_STAY") {
      const hotel = alternative as HotelAlternative;

      return {
        label: hotel.roomTypeName,
        sublabel: `${hotel.hotelName} · ${hotel.ratePlanName}`,
        choice: { hotelId: hotel.hotelId, ratePlanId: hotel.ratePlanId } satisfies SlotChoice,
      };
    }

    if (componentType === "TRANSFER") {
      const transfer = alternative as TransferAlternative;

      return {
        label: transfer.vehicleName,
        sublabel: transfer.vehicleClass,
        choice: { vehicleId: transfer.vehicleId } satisfies SlotChoice,
      };
    }

    const tour = alternative as TourAlternative;

    return {
      label: tour.optionName,
      sublabel: t.tours.optionKinds[tour.kind],
      choice: { tourOptionId: tour.tourOptionId } satisfies SlotChoice,
    };
  })();

  return (
    <li>
      <button
        type="button"
        disabled={busy}
        onClick={() => onChoose(choice)}
        className="flex w-full items-center justify-between gap-4 rounded-sm px-2 py-2 text-start transition-colors hover:bg-surface-soft disabled:opacity-50"
      >
        <span className="min-w-0">
          <span className="type-body-sm block truncate text-ink">{label}</span>
          <span className="type-caption block truncate text-muted">{sublabel}</span>
        </span>
        <span className="type-body-sm shrink-0 tabular-nums text-body">
          {formatMoney(alternative.sellCents, currency, intlLocale)}
        </span>
      </button>
    </li>
  );
}

/** Exported for the checkout summary, which lists the same lines read-only. */
export { ICONS as slotIcons };
