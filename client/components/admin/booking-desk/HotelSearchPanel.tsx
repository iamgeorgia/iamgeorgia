"use client";

import { Loader2, Search } from "lucide-react";
import { useState } from "react";

import { chooseButtonClass, offerRowClass, parseChildAges, searchButtonClass } from "./wizard";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { FormError, NumberInput, TextInput } from "@/components/admin/FormControls";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import { formatStay } from "@/lib/admin/bookings";
import type { ServiceSelection } from "@/lib/admin/manualBooking";
import { describeError } from "@/lib/api/client";
import { getHotelAvailabilityClient, listPublicHotelsClient } from "@/lib/api/search";
import { formatMoney } from "@/lib/money";
import type { HotelAvailability } from "@/types/booking";

/**
 * The hotel search of the desk: a property, dates and a party, then every
 * room and rate that can be booked, each with its price for this buyer.
 * The offer's token carries the price into the booking; nothing here is
 * sent but the token.
 */
export function HotelSearchPanel({
  asPartnerId,
  onChoose,
}: {
  asPartnerId: string | null;
  onChoose: (selection: ServiceSelection) => void;
}) {
  const today = todayISO();
  const [hotel, setHotel] = useState<{ slug: string; name: string } | null>(null);
  const [checkIn, setCheckIn] = useState(addDaysISO(today, 7));
  const [checkOut, setCheckOut] = useState(addDaysISO(today, 10));
  const [adults, setAdults] = useState("2");
  const [childAges, setChildAges] = useState("");
  const [rooms, setRooms] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HotelAvailability | null>(null);

  const searchHotels = async (term: string): Promise<PickerOption[]> => {
    const found = await listPublicHotelsClient({ search: term || undefined, pageSize: 10 }, { asPartnerId });
    return found.data.map((entry) => ({ id: entry.slug, label: entry.name, meta: entry.destination?.name ?? null }));
  };

  const search = async () => {
    if (!hotel) return setError("Choose a property first.");
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const found = await getHotelAvailabilityClient(
        hotel.slug,
        {
          checkIn,
          checkOut,
          adults: Math.max(1, Number.parseInt(adults, 10) || 1),
          childAges: parseChildAges(childAges),
          rooms: Math.max(1, Number.parseInt(rooms, 10) || 1),
        },
        { asPartnerId },
      );
      setResult(found);
    } catch (caught) {
      setError(describeError(caught, "Could not search this property."));
    } finally {
      setBusy(false);
    }
  };

  const offers = result?.roomTypes.flatMap((room) => room.offers.map((offer) => ({ room, offer }))) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <EntityPicker
          label="Property"
          className="sm:col-span-2 lg:col-span-3"
          value={hotel?.slug ?? ""}
          valueLabel={hotel?.name}
          onChange={(choice) => {
            setHotel(choice ? { slug: choice.id, name: choice.label } : null);
            setResult(null);
          }}
          search={searchHotels}
          placeholder="Search hotels by name"
          clearLabel="No property"
        />
        <TextInput label="Check in" type="date" value={checkIn} min={today} onChange={(event) => setCheckIn(event.target.value)} />
        <TextInput label="Check out" type="date" value={checkOut} min={checkIn} onChange={(event) => setCheckOut(event.target.value)} />
        <NumberInput label="Rooms" min={1} max={9} value={rooms} onChange={(event) => setRooms(event.target.value)} />
        <NumberInput label="Adults" min={1} max={20} value={adults} onChange={(event) => setAdults(event.target.value)} />
        <TextInput
          label="Children's ages"
          hint="One age per child, comma separated: 7, 12."
          value={childAges}
          onChange={(event) => setChildAges(event.target.value)}
          placeholder="None"
        />
      </div>

      <div>
        <button type="button" onClick={search} disabled={busy} className={searchButtonClass}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
          Search rooms
        </button>
      </div>

      <FormError message={error} />

      {result && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="text-[0.8125rem] text-muted">
            {offers.length === 0
              ? "Nothing can be booked for these dates and this party."
              : `${offers.length} ${offers.length === 1 ? "offer" : "offers"} · ${result.nights} ${result.nights === 1 ? "night" : "nights"}`}
          </p>
          {offers.map(({ room, offer }) => (
            <div key={offer.token} className={offerRowClass}>
              <div className="min-w-0">
                <p className="text-[0.875rem] font-medium text-ink">
                  {room.name} · {offer.name}
                </p>
                <p className="text-[0.75rem] text-muted">
                  {offer.terms.mealPlan?.name ?? "Room only"} · {offer.terms.cancellation.refundable ? "Refundable" : "Non-refundable"} ·{" "}
                  {offer.availableUnits} left
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
                      product: "HOTEL",
                      offerToken: offer.token,
                      hotelName: hotel?.name ?? "",
                      roomName: room.name,
                      ratePlanName: offer.name,
                      checkIn,
                      checkOut,
                      nights: result.nights,
                      rooms: Math.max(1, Number.parseInt(rooms, 10) || 1),
                      adults: Math.max(1, Number.parseInt(adults, 10) || 1),
                      childAges: parseChildAges(childAges),
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
          {offers.length > 0 && <p className="text-[0.75rem] text-subtle">{formatStay(checkIn, checkOut, result.nights)}</p>}
        </div>
      )}
    </div>
  );
}
