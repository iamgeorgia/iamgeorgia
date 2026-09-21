"use client";

import { useMemo, useState } from "react";

import { PackageCard } from "@/components/packages/PackageCard";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChip } from "@/components/ui/FilterChip";
import { SearchField } from "@/components/ui/SearchField";
import { plural } from "@/lib/i18n/plural";
import { useI18n } from "@/lib/i18n/provider";
import { packageDurations } from "@/lib/packages/query";
import type { PackageSummary } from "@/types/package";

interface PackageExplorerProps {
  packages: PackageSummary[];
  regions: string[];
}

/**
 * The undated catalogue: what exists, filtered in the browser.
 *
 * Filtering here rather than on the server is deliberate and matches the tours
 * index — the whole catalogue is a page of records, and a region chip should
 * not cost a round trip. The moment a date is involved it stops being a
 * catalogue and becomes a quote, which only the server can price.
 */
export function PackageExplorer({ packages, regions }: PackageExplorerProps) {
  const { t, locale } = useI18n();

  const [search, setSearch] = useState("");
  const [duration, setDuration] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [kosherOnly, setKosherOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return packages.filter((pkg) => {
      if (kosherOnly && !pkg.kosher) return false;
      if (region && pkg.destination?.name !== region) return false;

      if (duration) {
        if (duration === "2-3" && (pkg.nights < 2 || pkg.nights > 3)) return false;
        if (duration === "4-6" && (pkg.nights < 4 || pkg.nights > 6)) return false;
        if (duration === "7" && pkg.nights < 7) return false;
      }

      if (needle) {
        const haystack = [pkg.name, pkg.summary, pkg.destination?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(needle)) return false;
      }

      return true;
    });
  }, [packages, search, duration, region, kosherOnly]);

  const reset = () => {
    setSearch("");
    setDuration(null);
    setRegion(null);
    setKosherOnly(false);
  };

  return (
    <section className="py-16 lg:py-20">
      <Container>
        <div className="flex flex-col gap-5">
          <SearchField
            value={search}
            onChange={setSearch}
            label={t.packages.searchLabel}
            placeholder={t.packages.searchPlaceholder}
          />

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="type-caption me-1 text-muted">{t.packages.filterLength}</span>
              {packageDurations.map((bucket) => (
                <FilterChip
                  key={bucket}
                  selected={duration === bucket}
                  onClick={() => setDuration(duration === bucket ? null : bucket)}
                >
                  {t.packages.durations[bucket]}
                </FilterChip>
              ))}
              <FilterChip selected={kosherOnly} onClick={() => setKosherOnly(!kosherOnly)}>
                {t.packages.kosherOnly}
              </FilterChip>
            </div>

            {regions.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="type-caption me-1 text-muted">{t.packages.allRegions}</span>
                {regions.map((name) => (
                  <FilterChip
                    key={name}
                    selected={region === name}
                    onClick={() => setRegion(region === name ? null : name)}
                  >
                    {name}
                  </FilterChip>
                ))}
              </div>
            )}
          </div>

          <p className="type-caption text-muted">
            {plural(locale, filtered.length, t.units.result)} {t.packages.matchingFilters}
          </p>
        </div>

        {filtered.length > 0 ? (
          <div className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((pkg, index) => (
              <PackageCard key={pkg.id} pkg={pkg} eager={index < 3} />
            ))}
          </div>
        ) : (
          <div className="mt-10">
            <EmptyState
              title={t.packages.emptyTitle}
              description={t.packages.emptyBody}
              onReset={reset}
              resetLabel={t.actions.clearFilters}
            />
          </div>
        )}
      </Container>
    </section>
  );
}
