"use client";

import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import { HotelFilters } from "./HotelFilters";
import { HotelListItem } from "./HotelListItem";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { SearchField } from "@/components/ui/SearchField";
import { hotelSortOptions, type HotelSort } from "@/data/hotels";
import {
  buildFacets,
  countActiveFilters,
  defaultFilters,
  matchesFilters,
  type HotelFilterState,
} from "@/lib/hotels/filters";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import type { UiDictionary } from "@/lib/i18n/ui/en";
import type { Hotel } from "@/types";

/** The sort values are kebab-case in the data and camelCase in the dictionary. */
const SORT_KEYS = {
  recommended: "recommended",
  "price-low": "priceLow",
  "price-high": "priceHigh",
  rating: "rating",
} as const satisfies Record<HotelSort, keyof UiDictionary["hotels"]["sort"]>;

interface HotelExplorerProps {
  hotels: Hotel[];
}

/**
 * Catalogue browsing: what exists, at indicative prices.
 *
 * Dates are deliberately not here. They belong to the search form above, which
 * puts them in the URL and turns the page into a real dated search — a second,
 * cosmetic date picker beside a working one is worse than none, because only
 * one of them affects what is on screen.
 *
 * Destination is in both places, and they do different jobs: the form picks one
 * and narrows what the server sends, the panel narrows within what came back
 * and takes several at once. When the form has already chosen, one destination
 * comes back, and the panel's row drops out rather than echoing it.
 */
export function HotelExplorer({ hotels }: HotelExplorerProps) {
  const { t, locale } = useI18n();
  const path = useLocalePath();
  const [filters, setFilters] = useState<HotelFilterState>(defaultFilters);
  const [sort, setSort] = useState<HotelSort>("recommended");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Derived from the whole list, never from the filtered one: options that
  // vanished as you used them would make the panel impossible to walk back.
  const facets = useMemo(() => buildFacets(hotels), [hotels]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = hotels.filter(
      (hotel) =>
        matchesFilters(hotel, filters) &&
        (!needle || `${hotel.name} ${hotel.location} ${hotel.address}`.toLowerCase().includes(needle)),
    );

    const sorted = [...filtered];
    if (sort === "price-low") sorted.sort((a, b) => a.priceFrom - b.priceFrom);
    if (sort === "price-high") sorted.sort((a, b) => b.priceFrom - a.priceFrom);
    if (sort === "rating") sorted.sort((a, b) => b.guestScore - a.guestScore);
    return sorted;
  }, [hotels, filters, sort, query]);

  const reset = () => {
    setFilters(defaultFilters);
    setQuery("");
  };

  const activeFilterCount = countActiveFilters(filters);

  return (
    <>
      <Container className="pt-12 pb-24 lg:pt-16 lg:pb-32">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <aside className="hidden lg:col-span-3 lg:block">
            {/*
             * The panel is taller than a laptop viewport once a catalogue has
             * destinations, stars and facilities in it, and a sticky column
             * that cannot scroll simply cuts the last rows off. Its own scroll
             * region keeps the bottom of the list reachable.
             */}
            <div className="sticky top-28 max-h-[calc(100dvh-8rem)] overflow-y-auto pe-1 pb-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="type-h4">{t.actions.filters}</h2>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={reset}
                    className="type-caption shrink-0 text-brand-text underline-offset-4 hover:underline"
                  >
                    {t.actions.clearAll}
                  </button>
                )}
              </div>
              <div className="mt-6">
                <HotelFilters value={filters} onChange={setFilters} facets={facets} />
              </div>
            </div>
          </aside>

          <div className="min-w-0 lg:col-span-9">
            <SearchField
              value={query}
              onChange={setQuery}
              tone="dark"
              label={t.hotels.searchLabel}
              placeholder={t.hotels.searchPlaceholder}
              className="mb-6"
            />

            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
              <p className="type-body-sm text-muted" aria-live="polite">
                <span className="font-medium text-ink">
                  {plural(locale, results.length, t.units.property)}
                </span>
              </p>

              {/* `max-w-full min-w-0`: a Georgian sort option is wider than a
                  phone, and a wrapped flex item is otherwise sized to its
                  content, so the select gets to shrink instead of the page. */}
              <div className="flex max-w-full min-w-0 items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => setFiltersOpen(true)}
                >
                  <SlidersHorizontal size={15} aria-hidden />
                  {t.actions.filters}
                  {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                </Button>

                <label className="flex min-w-0 items-center gap-2">
                  <span className="type-caption hidden text-muted sm:inline">
                    {t.actions.sortBy}
                  </span>
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as HotelSort)}
                    className="h-10 max-w-full min-w-0 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-body focus:border-ink focus:outline-none"
                  >
                    {hotelSortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t.hotels.sort[SORT_KEYS[option.value]]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {results.length > 0 ? (
              <div className="mt-6 flex flex-col gap-5">
                {results.map((hotel) => (
                  <HotelListItem key={hotel.id} hotel={hotel} />
                ))}
              </div>
            ) : (
              <div className="mt-6">
                <EmptyState
                  title={t.hotels.emptyTitle}
                  description={t.hotels.emptyBody}
                  onReset={reset}
                  action={{ label: t.actions.askUsToFindOne, href: path("/contact") }}
                />
              </div>
            )}
          </div>
        </div>
      </Container>

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t.actions.filters}
        size="md"
      >
        <div className="pt-4">
          <div className="px-6 pb-6">
            <HotelFilters value={filters} onChange={setFilters} facets={facets} />
          </div>
          {/*
           * Pinned to the foot of the dialog's scroll area rather than parked
           * after the last fieldset. Sitting in the flow, "Show 6 properties"
           * scrolled out of reach the moment anyone opened the facilities —
           * and on a phone that is the one control that has to stay under the
           * thumb while the list behind it changes.
           */}
          <div className="sticky bottom-0 flex flex-wrap gap-3 border-t border-line bg-background px-6 py-4">
            {/* `grow` rather than `fullWidth`: both share the row when they fit
                and "Show 12 properties" takes a row of its own when it does not. */}
            <Button variant="outline" className="grow" onClick={reset}>
              {t.actions.clearAll}
            </Button>
            <Button className="grow" onClick={() => setFiltersOpen(false)}>
              {fill(t.hotels.showProperties, {
                count: plural(locale, results.length, t.units.property),
              })}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
