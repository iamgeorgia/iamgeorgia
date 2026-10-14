"use client";

import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import { TourCard } from "./TourCard";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChip } from "@/components/ui/FilterChip";
import { SearchField } from "@/components/ui/SearchField";
import { plural } from "@/lib/i18n/plural";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { matchesDuration, tourCategories, tourDurations } from "@/lib/tours/query";
import type { TourCategory, TourSummary } from "@/types/tour";

interface TourExplorerProps {
  tours: TourSummary[];
  regions: string[];
}

type Sort = "recommended" | "price-low" | "price-high" | "duration";

/** Values and dictionary keys — the wording comes from `t.tours.sort`. */
const sortOptions = [
  { value: "recommended", key: "recommended" },
  { value: "price-low", key: "priceLow" },
  { value: "price-high", key: "priceHigh" },
  { value: "duration", key: "duration" },
] as const;

const priceOf = (tour: TourSummary) => tour.priceFrom?.amountCents ?? Number.POSITIVE_INFINITY;

/**
 * Browsing the catalogue without a date.
 *
 * The whole ACTIVE catalogue is a few dozen records, so it is filtered in the
 * browser: a search box that round-tripped to the server for ten tours would
 * be slower and no more correct. The moment a date is involved the page above
 * switches to the server's dated search instead, because availability is not
 * something this component can know.
 */
export function TourExplorer({ tours, regions }: TourExplorerProps) {
  const { t, locale } = useI18n();
  const path = useLocalePath();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TourCategory | null>(null);
  const [duration, setDuration] = useState<string | null>(null);
  const [region, setRegion] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("recommended");

  const hasFilters = query !== "" || category !== null || duration !== null || region !== "all";

  const results = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();

    const filtered = tours.filter((tour) => {
      if (category && tour.category !== category) return false;
      if (duration && !matchesDuration(tour.durationDays, duration)) return false;
      if (region !== "all" && tour.location !== region) return false;
      if (
        normalisedQuery &&
        !`${tour.title} ${tour.location} ${tour.summary}`.toLowerCase().includes(normalisedQuery)
      ) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered];
    if (sort === "price-low") sorted.sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === "price-high") sorted.sort((a, b) => priceOf(b) - priceOf(a));
    if (sort === "duration") sorted.sort((a, b) => a.durationDays - b.durationDays);
    return sorted;
  }, [tours, query, category, duration, region, sort]);

  const reset = () => {
    setQuery("");
    setCategory(null);
    setDuration(null);
    setRegion("all");
  };

  return (
    <section className="py-16 lg:py-20">
      <Container>
        <div className="border-b border-line pb-8">
          <SearchField
            value={query}
            onChange={setQuery}
            tone="dark"
            label={t.tours.searchLabel}
            placeholder={t.tours.searchPlaceholder}
            className="max-w-xl"
          />

          {/* One grid for both rows, so the label column is as wide as the
              longest label in the reader's language ("Длительность",
              "ხანგრძლივობა") and the two rows of chips still start on the same
              line. On a phone each label sits above its chips instead. */}
          <div className="mt-8 grid items-center gap-x-4 gap-y-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-5">
            <span className="type-caption text-muted">{t.tours.filterType}</span>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip selected={category === null} onClick={() => setCategory(null)}>
                {t.common.all}
              </FilterChip>
              {tourCategories.map((item) => (
                <FilterChip
                  key={item}
                  selected={category === item}
                  onClick={() => setCategory(category === item ? null : item)}
                >
                  {t.tours.categories[item]}
                </FilterChip>
              ))}
            </div>

            <span className="type-caption mt-2.5 text-muted sm:mt-0">{t.tours.filterLength}</span>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip selected={duration === null} onClick={() => setDuration(null)}>
                {t.common.any}
              </FilterChip>
              {tourDurations.map((item) => (
                <FilterChip
                  key={item}
                  selected={duration === item}
                  onClick={() => setDuration(duration === item ? null : item)}
                >
                  {t.tours.durations[item]}
                </FilterChip>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 py-6">
          <p className="type-body-sm text-muted">
            <span className="font-medium text-ink">
              {plural(locale, results.length, t.units.journey)}
            </span>
            {hasFilters && ` ${t.tours.matchingFilters}`}
          </p>

          {/* `max-w-full min-w-0`, as on the hotel list: a wrapped flex item is
              sized to its content, and the Georgian sort option at the 16px
              touch size is wider than a phone. */}
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
            <label className="flex min-w-0 items-center gap-2">
              <span className="sr-only">{t.a11y.filterByRegion}</span>
              <select
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                className="h-10 max-w-full min-w-0 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-body focus:border-ink focus:outline-none"
              >
                <option value="all">{t.tours.allRegions}</option>
                {regions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-0 items-center gap-2">
              <SlidersHorizontal size={15} className="text-muted" aria-hidden />
              <span className="sr-only">{t.a11y.sortTours}</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                className="h-10 max-w-full min-w-0 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-body focus:border-ink focus:outline-none"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t.tours.sort[option.key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {results.length > 0 ? (
          <div className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((tour) => (
              <TourCard key={tour.id} tour={tour} />
            ))}
          </div>
        ) : (
          <EmptyState
            title={t.tours.emptyTitle}
            description={t.tours.emptyBody}
            onReset={reset}
            action={{ label: t.actions.planCustomTrip, href: path("/contact") }}
          />
        )}
      </Container>
    </section>
  );
}
