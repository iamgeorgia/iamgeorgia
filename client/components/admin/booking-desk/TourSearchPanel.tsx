"use client";

import { Loader2, Search } from "lucide-react";
import { useState } from "react";

import { chooseButtonClass, offerRowClass, parseChildAges, searchButtonClass } from "./wizard";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { FormError, NumberInput, TextInput } from "@/components/admin/FormControls";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import type { ServiceSelection } from "@/lib/admin/manualBooking";
import { confirmationModeLabels, formatDeparture, unavailableReasonLabels } from "@/lib/admin/tours";
import { describeError } from "@/lib/api/client";
import { getTourAvailabilityClient, listPublicToursClient } from "@/lib/api/tours";
import { formatMoney } from "@/lib/money";
import type { TourAvailability } from "@/types/tour";

/** The dated tour search of the desk: a tour, a window and a party, then every departure that can be sold. */
export function TourSearchPanel({
  asPartnerId,
  onChoose,
}: {
  asPartnerId: string | null;
  onChoose: (selection: ServiceSelection) => void;
}) {
  const today = todayISO();
  const [tour, setTour] = useState<{ slug: string; title: string } | null>(null);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDaysISO(today, 30));
  const [adults, setAdults] = useState("2");
  const [childAges, setChildAges] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TourAvailability | null>(null);

  const searchTours = async (term: string): Promise<PickerOption[]> => {
    const found = await listPublicToursClient({ search: term || undefined, pageSize: 10 }, { asPartnerId });
    return found.data.map((entry) => ({ id: entry.slug, label: entry.title, meta: entry.location, badge: entry.durationLabel }));
  };

  const search = async () => {
    if (!tour) return setError("Choose a tour first.");
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const found = await getTourAvailabilityClient(
        tour.slug,
        { from, to, adults: Math.max(1, Number.parseInt(adults, 10) || 1), childAges: parseChildAges(childAges) },
        { asPartnerId },
      );
      setResult(found);
    } catch (caught) {
      setError(describeError(caught, "Could not search this tour."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EntityPicker
          label="Tour"
          className="sm:col-span-2 lg:col-span-4"
          value={tour?.slug ?? ""}
          valueLabel={tour?.title}
          onChange={(choice) => {
            setTour(choice ? { slug: choice.id, title: choice.label } : null);
            setResult(null);
          }}
          search={searchTours}
          placeholder="Search tours by name"
          clearLabel="No tour"
        />
        <TextInput label="Departing from" type="date" value={from} min={today} onChange={(event) => setFrom(event.target.value)} />
        <TextInput label="Until" type="date" value={to} min={from} max={addDaysISO(from, 61)} onChange={(event) => setTo(event.target.value)} hint="Up to 62 days." />
        <NumberInput label="Adults" min={1} max={50} value={adults} onChange={(event) => setAdults(event.target.value)} />
        <TextInput label="Children's ages" hint="Comma separated: 7, 12." value={childAges} onChange={(event) => setChildAges(event.target.value)} placeholder="None" />
      </div>

      <div>
        <button type="button" onClick={search} disabled={busy} className={searchButtonClass}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
          Find departures
        </button>
      </div>

      <FormError message={error} />

      {result && (
        <div className="flex flex-col gap-4" aria-live="polite">
          {result.options.length === 0 && <p className="text-[0.8125rem] text-muted">This tour has no option on sale.</p>}
          {result.options.map(({ option, dates }) => {
            const available = dates.filter((entry) => entry.available);
            const reasons = dates.filter((entry) => !entry.available);
            return (
              <div key={option.id}>
                <p className="text-[0.8125rem] font-semibold text-ink">
                  {option.name}
                  <span className="ms-2 font-normal text-muted">
                    {option.kind === "PRIVATE" ? "Private" : "Shared"} · {confirmationModeLabels[option.confirmationMode]}
                  </span>
                </p>
                {available.length === 0 ? (
                  <p className="mt-1 text-[0.8125rem] text-muted">
                    Nothing can be sold in this window
                    {reasons[0] && !reasons[0].available ? ` (${unavailableReasonLabels[reasons[0].reason].toLowerCase()})` : ""}.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {available.map((entry) =>
                      entry.available ? (
                        <div key={entry.token} className={offerRowClass}>
                          <div className="min-w-0">
                            <p className="text-[0.875rem] font-medium text-ink">{formatDeparture(entry.date, entry.endDate)}</p>
                            <p className="text-[0.75rem] text-muted">
                              {entry.departureTime ? `Departs ${entry.departureTime} · ` : ""}
                              {entry.availableUnits} {entry.availableUnits === 1 ? "unit" : "units"} left
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[0.9375rem] font-semibold text-ink tabular-nums">
                              {formatMoney(entry.quote.totals.totalCents, entry.quote.currency)}
                            </span>
                            <button
                              type="button"
                              className={chooseButtonClass}
                              onClick={() =>
                                onChoose({
                                  product: "TOUR",
                                  offerToken: entry.token,
                                  tourTitle: tour?.title ?? result.tour.title,
                                  optionName: option.name,
                                  date: entry.date,
                                  endDate: entry.endDate,
                                  adults: result.party.adults,
                                  childAges: parseChildAges(childAges),
                                  currency: entry.quote.currency,
                                  totalCents: entry.quote.totals.totalCents,
                                })
                              }
                            >
                              Choose
                            </button>
                          </div>
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
