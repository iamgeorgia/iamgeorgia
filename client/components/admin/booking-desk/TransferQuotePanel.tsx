"use client";

import { Loader2, Search } from "lucide-react";
import { useState } from "react";

import { chooseButtonClass, offerRowClass, searchButtonClass } from "./wizard";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { FormError, NumberInput, SelectInput, TextInput } from "@/components/admin/FormControls";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import type { ServiceSelection } from "@/lib/admin/manualBooking";
import { describeError } from "@/lib/api/client";
import { quoteTransfersClient, searchTransferPoints } from "@/lib/api/transfers";
import { formatMoney } from "@/lib/money";
import type { TransferQuoteResult } from "@/types/transfer";

/**
 * The transfer quote of the desk: two points, a date and time, a party and
 * its luggage, then every vehicle that can carry them, priced for this
 * buyer. The quote's token carries the fare into the booking.
 */
export function TransferQuotePanel({
  asPartnerId,
  onChoose,
}: {
  asPartnerId: string | null;
  onChoose: (selection: ServiceSelection) => void;
}) {
  const today = todayISO();
  const [from, setFrom] = useState<{ slug: string; name: string } | null>(null);
  const [to, setTo] = useState<{ slug: string; name: string } | null>(null);
  const [date, setDate] = useState(addDaysISO(today, 7));
  const [time, setTime] = useState("10:00");
  const [tripType, setTripType] = useState<"ONE_WAY" | "RETURN">("ONE_WAY");
  const [returnDate, setReturnDate] = useState(addDaysISO(today, 10));
  const [returnTime, setReturnTime] = useState("10:00");
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [luggage, setLuggage] = useState("2");
  const [cabinBags, setCabinBags] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferQuoteResult | null>(null);

  const searchPoints = async (term: string): Promise<PickerOption[]> => {
    const found = await searchTransferPoints(term);
    return found.data.map((point) => ({ id: point.slug, label: point.name, meta: point.region, badge: point.code }));
  };

  const number = (value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  const search = async () => {
    if (!from || !to) return setError("Choose where the journey starts and ends.");
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const found = await quoteTransfersClient(
        {
          from: from.slug,
          to: to.slug,
          date,
          time,
          tripType,
          ...(tripType === "RETURN" ? { returnDate, returnTime } : {}),
          adults: Math.max(1, number(adults, 1)),
          children: number(children, 0),
          luggage: number(luggage, 0),
          cabinBags: number(cabinBags, 0),
        },
        { asPartnerId },
      );
      setResult(found);
    } catch (caught) {
      setError(describeError(caught, "Could not quote this journey."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EntityPicker
          label="From"
          className="sm:col-span-1 lg:col-span-2"
          value={from?.slug ?? ""}
          valueLabel={from?.name}
          onChange={(choice) => setFrom(choice ? { slug: choice.id, name: choice.label } : null)}
          search={searchPoints}
          placeholder="Airport, city, hotel…"
        />
        <EntityPicker
          label="To"
          className="sm:col-span-1 lg:col-span-2"
          value={to?.slug ?? ""}
          valueLabel={to?.name}
          onChange={(choice) => setTo(choice ? { slug: choice.id, name: choice.label } : null)}
          search={searchPoints}
          placeholder="Airport, city, hotel…"
        />
        <TextInput label="Pick-up date" type="date" value={date} min={today} onChange={(event) => setDate(event.target.value)} />
        <TextInput label="Pick-up time" type="time" value={time} onChange={(event) => setTime(event.target.value)} hint="Local time at the pick-up point." />
        <SelectInput
          label="Journey"
          value={tripType}
          onChange={(event) => setTripType(event.target.value as "ONE_WAY" | "RETURN")}
          options={[
            { value: "ONE_WAY", label: "One way" },
            { value: "RETURN", label: "Return" },
          ]}
        />
        {tripType === "RETURN" ? (
          <>
            <TextInput label="Return date" type="date" value={returnDate} min={date} onChange={(event) => setReturnDate(event.target.value)} />
            <TextInput label="Return time" type="time" value={returnTime} onChange={(event) => setReturnTime(event.target.value)} />
          </>
        ) : (
          <div className="hidden lg:block" aria-hidden />
        )}
        <NumberInput label="Adults" min={1} max={50} value={adults} onChange={(event) => setAdults(event.target.value)} />
        <NumberInput label="Children" min={0} max={50} value={children} onChange={(event) => setChildren(event.target.value)} />
        <NumberInput label="Large bags" min={0} max={50} value={luggage} onChange={(event) => setLuggage(event.target.value)} />
        <NumberInput label="Cabin bags" min={0} max={50} value={cabinBags} onChange={(event) => setCabinBags(event.target.value)} />
      </div>

      <div>
        <button type="button" onClick={search} disabled={busy} className={searchButtonClass}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
          Get quotes
        </button>
      </div>

      <FormError message={error} />

      {result && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="text-[0.8125rem] text-muted">
            {result.closed
              ? "The road is closed on these dates."
              : result.offers.length === 0
                ? "No vehicle can carry this party on this journey."
                : `${result.offers.length} ${result.offers.length === 1 ? "vehicle" : "vehicles"} · ${result.from.name} → ${result.to.name}`}
          </p>
          {result.offers.map((offer) => (
            <div key={offer.token} className={offerRowClass}>
              <div className="min-w-0">
                <p className="text-[0.875rem] font-medium text-ink">{offer.vehicle.name}</p>
                <p className="text-[0.75rem] text-muted">
                  {offer.vehicle.vehicleExample} · up to {offer.vehicle.maxPassengers} passengers, {offer.vehicle.maxLuggage} bags
                  {offer.quote.perSeat ? " · per seat" : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[0.9375rem] font-semibold text-ink tabular-nums">
                  {formatMoney(offer.quote.totals.totalCents, offer.quote.currency)}
                </span>
                <button
                  type="button"
                  className={chooseButtonClass}
                  onClick={() =>
                    onChoose({
                      product: "TRANSFER",
                      quoteToken: offer.token,
                      from: result.from.name,
                      to: result.to.name,
                      pickupAt: offer.quote.legs[0]?.pickupAt ?? `${date}T${time}:00`,
                      returnPickupAt: offer.quote.legs[1]?.pickupAt ?? null,
                      vehicleName: offer.vehicle.name,
                      tripType,
                      passengers: Math.max(1, number(adults, 1)) + number(children, 0),
                      currency: offer.quote.currency,
                      totalCents: offer.quote.totals.totalCents,
                    })
                  }
                >
                  Choose
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
