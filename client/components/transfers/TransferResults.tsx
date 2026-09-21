"use client";

import { useSearchParams } from "next/navigation";
import { CarFront, MapPinned, SlidersHorizontal, SnowflakeIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { TransferCard } from "./TransferCard";
import {
  countActiveFilters,
  defaultTransferFilters,
  TransferFilters,
  type TransferFilterState,
} from "./TransferFilters";
import { TransferJourneyBar } from "./TransferJourneyBar";
import { TransferSearch } from "./TransferSearch";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { isSearchable, parseTransferQuery, serializeTransferQuery } from "@/lib/transfers/query";
import { passengerBands, transferSortOptions, type TransferSort } from "@/lib/transfers/vocabulary";
import type { TransferOffer, TransferPoint, TransferQuoteResult } from "@/types/transfer";

/**
 * The results list.
 *
 * Offers arrive already priced, from the server, as a prop. This component used
 * to compute the fares itself and fake a network delay to make the skeletons
 * visible; both are gone. What it still owns is everything that happens to
 * results already in hand — narrowing and ordering them — which is the right
 * split, because a chip toggle should not cost a round trip.
 */
export function TransferResults({
  result,
  unavailableReason,
}: {
  result: TransferQuoteResult | null;
  /** Why there is nothing to show, when the server declined to quote. */
  unavailableReason?: string | null;
}) {
  const searchParams = useSearchParams();
  const path = useLocalePath();
  const { t, locale, intlLocale } = useI18n();

  const query = useMemo(() => parseTransferQuery(searchParams), [searchParams]);
  const selectedSlug = searchParams.get("selected");
  const journeyKey = serializeTransferQuery(query);

  /**
   * Filters are stamped with the journey they were chosen against. A new
   * journey invalidates them — most obviously the price ceiling, which was set
   * against a different set of fares — so they fall back to the defaults
   * without an effect having to reach in and reset them.
   */
  const [filterState, setFilterState] = useState({
    journey: journeyKey,
    filters: defaultTransferFilters,
  });
  const filters =
    filterState.journey === journeyKey ? filterState.filters : defaultTransferFilters;
  const setFilters = (next: TransferFilterState) =>
    setFilterState({ journey: journeyKey, filters: next });

  const [sort, setSort] = useState<TransferSort>("recommended");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const searchable = isSearchable(query);
  // Memoised because it feeds two more memos: without it the `?? []` builds a
  // fresh array every render and neither of them would ever cache.
  const available = useMemo(() => result?.offers ?? [], [result]);
  const currency = available[0]?.quote.currency ?? "GEL";

  const total = (offer: TransferOffer) => offer.quote.totals.totalCents;
  const duration = (offer: TransferOffer) =>
    offer.quote.legs.reduce((longest, leg) => Math.max(longest, leg.durationMinutes), 0);

  const priceBounds = useMemo(() => {
    if (available.length === 0) return { min: 0, max: 100 };
    const totals = available.map(total);
    return { min: Math.floor(Math.min(...totals)), max: Math.ceil(Math.max(...totals)) };
  }, [available]);

  const results = useMemo(() => {
    const filtered = available.filter(({ vehicle }) => {
      if (filters.vehicleBodies.length && !filters.vehicleBodies.includes(vehicle.body)) {
        return false;
      }
      if (filters.kinds.length && !filters.kinds.includes(vehicle.kind)) return false;
      if (filters.minRating > 0 && (vehicle.provider?.rating ?? 0) < filters.minRating) {
        return false;
      }
      if (
        filters.features.length &&
        !filters.features.every((feature) => vehicle.features.includes(feature))
      ) {
        return false;
      }
      if (filters.passengerBands.length) {
        const inBand = filters.passengerBands.some((value) => {
          const band = passengerBands.find((entry) => entry.value === value);
          return band
            ? vehicle.maxPassengers >= band.min && vehicle.maxPassengers <= band.max
            : false;
        });
        if (!inBand) return false;
      }
      return true;
    });

    const ceiling = filters.maxPrice;
    const priced = ceiling === null ? filtered : filtered.filter((offer) => total(offer) <= ceiling);

    const sorted = [...priced];
    if (sort === "recommended") {
      sorted.sort((a, b) => a.vehicle.recommendedRank - b.vehicle.recommendedRank);
    }
    if (sort === "price-low") sorted.sort((a, b) => total(a) - total(b));
    if (sort === "rating") {
      sorted.sort(
        (a, b) =>
          (b.vehicle.provider?.rating ?? 0) - (a.vehicle.provider?.rating ?? 0) ||
          (b.vehicle.provider?.reviewCount ?? 0) - (a.vehicle.provider?.reviewCount ?? 0),
      );
    }
    if (sort === "duration") sorted.sort((a, b) => duration(a) - duration(b));
    return sorted;
  }, [available, filters, sort]);

  const activeFilterCount = countActiveFilters(filters);
  const reset = () => setFilters(defaultTransferFilters);

  const detailHref = (offer: TransferOffer) =>
    `${path(`/transfers/${offer.vehicle.slug}`)}?${serializeTransferQuery(query)}`;

  /* --- No journey to price yet ------------------------------------------- */
  if (!searchable) {
    return (
      <Container className="pt-10 pb-24 lg:pt-14 lg:pb-32">
        <EmptyState
          icon={MapPinned}
          title={t.transfers.results.noJourneyTitle}
          description={t.transfers.results.noJourneyBody}
        />
        <div className="mx-auto mt-10 max-w-4xl">
          <TransferSearch initialQuery={query} />
        </div>
      </Container>
    );
  }

  /* --- The server declined to quote --------------------------------------- */
  if (unavailableReason) {
    return (
      <Container className="pt-10 pb-24 lg:pt-14 lg:pb-32">
        <EmptyState
          icon={MapPinned}
          title={t.transfers.results.emptyTitle}
          description={unavailableReason}
          action={{ label: t.transfers.results.changeSearch, href: path("/transfers") }}
        />
        <div className="mx-auto mt-10 max-w-4xl">
          <TransferSearch initialQuery={query} />
        </div>
      </Container>
    );
  }

  return (
    <>
      <Container className="pt-8">
        <TransferJourneyBar query={query} from={result?.from} to={result?.to} />
      </Container>

      <Container className="pt-8 pb-24 lg:pt-10 lg:pb-32">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <aside className="hidden lg:col-span-3 lg:block">
            <div className="sticky top-28">
              <div className="flex items-baseline justify-between">
                <h2 className="type-h4">{t.actions.filters}</h2>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={reset}
                    className="type-caption text-brand-text underline-offset-4 hover:underline"
                  >
                    {t.actions.clearAll}
                  </button>
                )}
              </div>
              <div className="mt-6">
                <TransferFilters
                  value={filters}
                  onChange={setFilters}
                  priceBounds={priceBounds}
                  currency={currency}
                />
              </div>
            </div>
          </aside>

          <div className="min-w-0 lg:col-span-9">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
              <p className="type-body-sm text-muted" aria-live="polite">
                <span className="font-medium text-ink">
                  {plural(locale, results.length, t.units.transfer)}
                </span>{" "}
                {t.transfers.results.availableFor}
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
                    onChange={(event) => setSort(event.target.value as TransferSort)}
                    className="h-10 max-w-full min-w-0 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-body focus:border-ink focus:outline-none"
                  >
                    {transferSortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t.transfers.sort[option.key]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {results.length > 0 ? (
              <div className="mt-6 flex flex-col gap-5">
                {results.map((offer) => (
                  <TransferCard
                    key={offer.vehicle.id}
                    offer={offer}
                    query={query}
                    href={detailHref(offer)}
                    selected={offer.vehicle.slug === selectedSlug}
                    intlLocale={intlLocale}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-6">
                <EmptyState
                  icon={result?.closed ? SnowflakeIcon : CarFront}
                  title={
                    result?.closed
                      ? t.transfers.results.closedTitle
                      : t.transfers.results.emptyTitle
                  }
                  description={
                    result?.closed
                      ? t.transfers.results.closedBody
                      : available.length === 0
                        ? t.transfers.results.emptyCapacity
                        : t.transfers.results.emptyFilters
                  }
                  onReset={activeFilterCount > 0 ? reset : undefined}
                  resetLabel={t.actions.clearFilters}
                  action={{
                    label: t.transfers.results.changeSearch,
                    href: path("/transfers"),
                  }}
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
        <div className="px-6 pt-4 pb-6">
          <TransferFilters
            value={filters}
            onChange={setFilters}
            priceBounds={priceBounds}
            currency={currency}
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="outline" className="grow" onClick={reset}>
              {t.actions.clearAll}
            </Button>
            <Button className="grow" onClick={() => setFiltersOpen(false)}>
              {fill(t.transfers.results.show, {
                count: plural(locale, results.length, t.units.transfer),
              })}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export type { TransferPoint };
