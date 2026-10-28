"use client";

import { BedDouble, CarFront, Compass, ConciergeBell, Loader2, Search, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { chooseButtonClass, parseChildAges, searchButtonClass } from "./wizard";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { FormError, NumberInput, SelectInput, TextInput } from "@/components/admin/FormControls";
import { formatStayDate } from "@/lib/admin/bookings";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import type { ServiceSelection } from "@/lib/admin/manualBooking";
import { slotReasonLabels, unavailableReasonLabels } from "@/lib/admin/packages";
import { describeError } from "@/lib/api/client";
import { listPublicPackagesClient, quotePackageClient } from "@/lib/api/packages";
import { formatMoney } from "@/lib/money";
import { resolvedHotel, resolvedService, resolvedTour, resolvedTransfer, type SlotChoice } from "@/lib/packages/query";
import { cn } from "@/lib/utils";
import type { HotelAlternative, PackageQuote, QuotedComponent, TourAlternative, TransferAlternative } from "@/types/package";

/**
 * The package search of the desk: a package, a start date and a party, then
 * the quote — every slot resolved and priced for this buyer, with the other
 * allowed choices for a slot and the optional slots that can be dropped.
 * Changing a choice asks the server again, because the package adjustment
 * is reallocated across every line when one of them changes. The quote's
 * token is what the booking carries; it goes into the cart as one line and
 * is flattened into its components when the order is made.
 */

const ICONS: Record<QuotedComponent["componentType"], LucideIcon> = {
  HOTEL_STAY: BedDouble,
  TRANSFER: CarFront,
  TOUR: Compass,
  SERVICE: ConciergeBell,
};

/** One line that says what a slot resolved to, for the row here and the chip on the Service step. */
export function describeComponent(component: QuotedComponent): string {
  const hotel = resolvedHotel(component);
  if (hotel) {
    return `${hotel.nights} ${hotel.nights === 1 ? "night" : "nights"} at ${hotel.hotel.name} · ${hotel.roomType.name}${
      hotel.ratePlan.mealPlanName ? ` · ${hotel.ratePlan.mealPlanName}` : ""
    }`;
  }
  const transfer = resolvedTransfer(component);
  if (transfer) {
    const pickup = transfer.legs[0]?.pickupAt;
    return `${transfer.from.name} → ${transfer.to.name} · ${transfer.vehicle.name}${pickup ? ` · ${formatStayDate(pickup.slice(0, 10))}` : ""}`;
  }
  const tour = resolvedTour(component);
  if (tour) return `${tour.tour.title} · ${tour.option.name} · ${formatStayDate(tour.date)}${tour.departureTime ? ` at ${tour.departureTime}` : ""}`;
  const service = resolvedService(component);
  if (service) return `${service.service.name} · ${formatStayDate(service.date)}${service.quantity > 1 ? ` · ×${service.quantity}` : ""}`;
  return component.reason ? slotReasonLabels[component.reason] : "Could not be filled";
}

/** The choice a slot currently resolves to, so the select can show it. */
const currentChoiceKey = (component: QuotedComponent): string => {
  const hotel = resolvedHotel(component);
  if (hotel) return `${hotel.hotel.id}:${hotel.ratePlan.id}`;
  const transfer = resolvedTransfer(component);
  if (transfer) return transfer.vehicle.id;
  const tour = resolvedTour(component);
  if (tour) return tour.option.id;
  return "";
};

const alternativeOption = (
  componentType: QuotedComponent["componentType"],
  alternative: HotelAlternative | TransferAlternative | TourAlternative,
  currency: string,
): { key: string; label: string; choice: SlotChoice } => {
  if (componentType === "HOTEL_STAY") {
    const hotel = alternative as HotelAlternative;
    return {
      key: `${hotel.hotelId}:${hotel.ratePlanId}`,
      label: `${hotel.roomTypeName} · ${hotel.ratePlanName} (${hotel.hotelName}) — ${formatMoney(hotel.sellCents, currency)}`,
      choice: { hotelId: hotel.hotelId, ratePlanId: hotel.ratePlanId },
    };
  }
  if (componentType === "TRANSFER") {
    const transfer = alternative as TransferAlternative;
    return { key: transfer.vehicleId, label: `${transfer.vehicleName} — ${formatMoney(transfer.sellCents, currency)}`, choice: { vehicleId: transfer.vehicleId } };
  }
  const tour = alternative as TourAlternative;
  return { key: tour.tourOptionId, label: `${tour.optionName} — ${formatMoney(tour.sellCents, currency)}`, choice: { tourOptionId: tour.tourOptionId } };
};

export function PackageQuotePanel({
  asPartnerId,
  onChoose,
}: {
  asPartnerId: string | null;
  onChoose: (selection: ServiceSelection) => void;
}) {
  const today = todayISO();
  const [pkg, setPkg] = useState<{ slug: string; name: string } | null>(null);
  const [startDate, setStartDate] = useState(addDaysISO(today, 21));
  const [adults, setAdults] = useState("2");
  const [childAges, setChildAges] = useState("");
  const [rooms, setRooms] = useState("1");
  const [choices, setChoices] = useState<Record<number, SlotChoice>>({});
  const [exclude, setExclude] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<PackageQuote | null>(null);

  const searchPackages = async (term: string): Promise<PickerOption[]> => {
    const found = await listPublicPackagesClient({ search: term || undefined, pageSize: 10 }, { asPartnerId });
    return found.data.map((entry) => ({
      id: entry.slug,
      label: entry.name,
      meta: `${entry.nights} ${entry.nights === 1 ? "night" : "nights"}${entry.destination ? ` · ${entry.destination.name}` : ""}`,
      badge: entry.kosher ? "Kosher" : null,
    }));
  };

  const party = () => ({
    adults: Math.max(1, Number.parseInt(adults, 10) || 1),
    childAges: parseChildAges(childAges),
    rooms: Math.max(1, Number.parseInt(rooms, 10) || 1),
  });

  const runQuote = async (nextChoices: Record<number, SlotChoice>, nextExclude: number[]) => {
    if (!pkg) return setError("Choose a package first.");
    setBusy(true);
    setError(null);

    try {
      const found = await quotePackageClient(
        pkg.slug,
        {
          startDate,
          ...party(),
          choices: Object.keys(nextChoices).length > 0 ? JSON.stringify(nextChoices) : undefined,
          exclude: nextExclude.length > 0 ? nextExclude : undefined,
        },
        { asPartnerId },
      );
      setQuote(found);
    } catch (caught) {
      setError(describeError(caught, "Could not price this package."));
    } finally {
      setBusy(false);
    }
  };

  const search = () => {
    // A new search starts from the package's own defaults.
    setChoices({});
    setExclude([]);
    setQuote(null);
    void runQuote({}, []);
  };

  const choose = (slotIndex: number, choice: SlotChoice) => {
    const next = { ...choices, [slotIndex]: choice };
    setChoices(next);
    void runQuote(next, exclude);
  };

  const toggle = (slotIndex: number, included: boolean) => {
    const next = included ? exclude.filter((slot) => slot !== slotIndex) : [...exclude, slotIndex];
    setExclude(next);
    void runQuote(choices, next);
  };

  const add = () => {
    if (!quote || !quote.available || !quote.token || !pkg) return;
    const chosen = party();
    onChoose({
      product: "PACKAGE",
      packageToken: quote.token,
      packageSlug: pkg.slug,
      packageName: pkg.name,
      startDate: quote.startDate,
      endDate: quote.endDate,
      adults: chosen.adults,
      childAges: chosen.childAges,
      rooms: chosen.rooms,
      components: quote.components
        .filter((component) => component.included)
        .map((component) => ({
          slotIndex: component.slotIndex,
          componentType: component.componentType,
          label: component.label,
          detail: describeComponent(component),
        })),
      currency: quote.currency,
      totalCents: quote.totals.totalCents,
    });
  };

  const sellable = Boolean(quote?.available && quote.token);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EntityPicker
          label="Package"
          className="sm:col-span-2 lg:col-span-4"
          value={pkg?.slug ?? ""}
          valueLabel={pkg?.name}
          onChange={(choice) => {
            setPkg(choice ? { slug: choice.id, name: choice.label } : null);
            setQuote(null);
          }}
          search={searchPackages}
          placeholder="Search packages by name"
          clearLabel="No package"
        />
        <TextInput label="Start date" type="date" value={startDate} min={today} onChange={(event) => setStartDate(event.target.value)} />
        <NumberInput label="Rooms" min={1} max={9} value={rooms} onChange={(event) => setRooms(event.target.value)} />
        <NumberInput label="Adults" min={1} max={60} value={adults} onChange={(event) => setAdults(event.target.value)} />
        <TextInput label="Children's ages" hint="Comma separated: 7, 12." value={childAges} onChange={(event) => setChildAges(event.target.value)} placeholder="None" />
      </div>

      <div>
        <button type="button" onClick={search} disabled={busy} className={searchButtonClass}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
          Price package
        </button>
      </div>

      <FormError message={error} />

      {quote && (
        <div className={cn("flex flex-col gap-3", busy && "opacity-60 transition-opacity")} aria-live="polite">
          <p className="text-[0.8125rem] text-muted">
            {formatStayDate(quote.startDate)} – {formatStayDate(quote.endDate)} · {quote.party.adults} {quote.party.adults === 1 ? "adult" : "adults"}
            {quote.party.children > 0 ? `, ${quote.party.children} ${quote.party.children === 1 ? "child" : "children"}` : ""} · {quote.rooms}{" "}
            {quote.rooms === 1 ? "room" : "rooms"}
          </p>

          {!quote.available && (
            <p role="alert" className="rounded-sm border border-warning/50 bg-warning/10 px-4 py-3 text-[0.8125rem] text-warning-text">
              This package cannot be sold for this date and party
              {quote.unavailableReason ? `: ${unavailableReasonLabels[quote.unavailableReason].toLowerCase()}` : ""}.
            </p>
          )}

          {quote.kosher && quote.kosher.blockers.length > 0 && (
            <ul className="rounded-sm border border-error/40 bg-error/5 px-4 py-3 text-[0.8125rem] text-error-text">
              {quote.kosher.blockers.map((finding) => (
                <li key={`${finding.code}-${finding.slotIndex ?? ""}`}>{finding.message}</li>
              ))}
            </ul>
          )}

          <ul className="flex flex-col gap-2">
            {quote.components.map((component) => {
              const Icon = ICONS[component.componentType];
              const current = currentChoiceKey(component);
              const options = component.alternatives.map((alternative) => alternativeOption(component.componentType, alternative, quote.currency));
              const canChoose = component.included && component.resolved !== null && options.length > 0;
              return (
                <li
                  key={component.slotIndex}
                  className={cn("flex flex-wrap items-start justify-between gap-3 rounded-sm border border-line px-4 py-3", !component.included && "bg-surface-soft opacity-75")}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-brand-text">
                      <Icon size={15} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">
                        {component.label}
                        <span className="ms-2 font-normal normal-case tracking-normal">{component.required ? "required" : "optional"}</span>
                      </p>
                      <p className="text-[0.875rem] text-ink">{describeComponent(component)}</p>
                      {canChoose && (
                        <SelectInput
                          label="Choice"
                          className="mt-2 max-w-md"
                          value={current}
                          disabled={busy}
                          onChange={(event) => {
                            const picked = options.find((option) => option.key === event.target.value);
                            if (picked) choose(component.slotIndex, picked.choice);
                          }}
                          options={[
                            ...(options.some((option) => option.key === current) ? [] : [{ value: current, label: "As quoted" }]),
                            ...options.map((option) => ({ value: option.key, label: option.label })),
                          ]}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {component.included && component.resolved && (
                      <span className="text-[0.9375rem] font-semibold text-ink tabular-nums">{formatMoney(component.lineTotalCents, quote.currency)}</span>
                    )}
                    {component.included && component.resolved && component.adjustmentCents !== 0 && (
                      <span className="text-[0.75rem] text-muted tabular-nums">incl. {formatMoney(component.adjustmentCents, quote.currency)}</span>
                    )}
                    {!component.required && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggle(component.slotIndex, !component.included)}
                        className="text-[0.75rem] font-medium text-brand-text underline-offset-4 hover:underline disabled:opacity-50"
                      >
                        {component.included ? "Leave out" : "Include"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-4 py-3">
            <p className="text-[0.8125rem] text-muted">
              Components {formatMoney(quote.totals.componentsSellCents, quote.currency)}
              {quote.totals.adjustmentCents !== 0 && (
                <>
                  {" "}
                  · {quote.totals.adjustmentCents < 0 ? "discount" : "supplement"} {formatMoney(quote.totals.adjustmentCents, quote.currency)}
                </>
              )}
              {" · "}
              <span className="font-semibold text-ink tabular-nums">{formatMoney(quote.totals.totalCents, quote.currency)}</span>
            </p>
            <button type="button" onClick={add} disabled={!sellable || busy} className={chooseButtonClass}>
              Add package
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
