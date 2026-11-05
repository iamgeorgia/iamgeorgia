"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Star } from "lucide-react";
import { useEffect, useState } from "react";

import { Cell, DataTable, EmptyRow, Row } from "./DataTable";
import {
  ancestryLabel,
  destinationTypeLabels,
  destinationTypeOptions,
} from "@/lib/admin/destinations";
import { useLocalePath } from "@/lib/i18n/provider";
import type { DestinationSummary } from "@/types/catalogue";

/**
 * The destination register.
 *
 * The rows arrive ordered by `path`, which is tree order — a parent always sits
 * immediately above its children — so the list reads as a hierarchy without
 * anything here re-sorting it. The indent is drawn from the depth of the path
 * rather than from a client-side tree walk, which keeps that true even on page
 * two, where the parent of the first row is on the page before.
 *
 * Filtering goes through the URL, the same arrangement as the hotel and route
 * browsers: the work stays on the server, and a filtered view is a link
 * somebody can send. The search box is debounced because each change is a
 * navigation and therefore a request.
 *
 * The two counts are the reason this table is worth reading before touching
 * anything. A destination holding hotels or children cannot be deleted, and
 * the server says so with a 409 — seeing the numbers first is cheaper than
 * finding out from the error.
 */
export function DestinationsBrowser({
  data,
  total,
  page,
  pageSize,
  totalPages,
}: {
  data: DestinationSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const path = useLocalePath();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  /** Writes one filter into the URL, always resetting to the first page. */
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);

    if (value) next.set(key, value);
    else next.delete(key);

    next.delete("page");
    router.push(`${pathname}?${next}`);
  };

  useEffect(() => {
    const current = searchParams.get("search") ?? "";
    if (search === current) return;

    const timer = setTimeout(() => setParam("search", search), 350);
    return () => clearTimeout(timer);
    // `setParam` closes over the params it reads, so it is intentionally not a
    // dependency: including it would rebuild the timer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchParams]);

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(next));
    router.push(`${pathname}?${params}`);
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const filtered = Boolean(searchParams.get("search") || searchParams.get("type"));

  return (
    <div>
      <FilterDisclosure
        count={["type", "featured"].filter((key) => { const value = searchParams.get(key); return value && value !== "all"; }).length}
        lead={
        <label className="relative min-w-56 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search a place by name or slug"
            aria-label="Search destinations"
            className="h-10 w-full rounded-sm border border-line bg-surface ps-9 pe-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
          />
        </label>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={searchParams.get("type") ?? ""}
            onChange={(event) => setParam("type", event.target.value)}
            aria-label="Filter by type"
            className="h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-body focus:border-ink focus:outline-none"
          >
            <option value="">All types</option>
            {destinationTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={searchParams.get("featured") ?? ""}
            onChange={(event) => setParam("featured", event.target.value)}
            aria-label="Filter by featured"
            className="h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-body focus:border-ink focus:outline-none"
          >
            <option value="">Featured and not</option>
            <option value="true">Featured only</option>
            <option value="false">Not featured</option>
          </select>
        </div>
      </FilterDisclosure>

      <div className="mt-6 rounded-sm border border-line bg-surface">
        <DataTable
          caption="Destinations"
          columns={[
            { label: "Place" },
            { label: "Type", hideBelow: "sm" },
            { label: "Country", hideBelow: "lg" },
            { label: "Hotels", align: "end" },
            { label: "Children", align: "end", hideBelow: "md" },
            { label: "Coordinates", align: "end", hideBelow: "xl" },
          ]}
        >
          {data.length === 0 ? (
            <EmptyRow
              colSpan={6}
              message={
                filtered
                  ? "No destinations match those filters."
                  : "No destinations yet. Add a country first — everything else is filed inside one."
              }
            />
          ) : (
            data.map((destination) => {
              // Depth from the materialised path: `/georgia/imereti/kutaisi` is
              // two levels in. Capped so a deep tree cannot push the name off a
              // narrow screen.
              const depth = Math.min(destination.path.split("/").filter(Boolean).length - 1, 4);
              const ancestry = ancestryLabel(destination.path);

              return (
                <Row key={destination.id}>
                  <Cell>
                    <span
                      className="inline-flex min-w-0 items-center gap-2"
                      style={{ paddingInlineStart: `${depth * 1.125}rem` }}
                    >
                      <Link
                        href={path(`/admin/destinations/${destination.id}`)}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {destination.name}
                      </Link>
                      {destination.featured && (
                        <Star size={13} className="shrink-0 text-brand" aria-label="Featured" />
                      )}
                    </span>
                    <span
                      className="type-caption mt-0.5 block text-subtle"
                      style={{ paddingInlineStart: `${depth * 1.125}rem` }}
                    >
                      {ancestry ? `${ancestry} / ` : ""}
                      {destination.slug}
                    </span>
                  </Cell>
                  <Cell hideBelow="sm">{destinationTypeLabels[destination.type]}</Cell>
                  <Cell hideBelow="lg" className="font-mono text-[0.8125rem]">
                    {destination.countryCode}
                  </Cell>
                  <Cell align="end" className="tabular-nums">
                    {destination.hotelCount ?? 0}
                  </Cell>
                  <Cell align="end" hideBelow="md" className="tabular-nums">
                    {destination.childCount ?? 0}
                  </Cell>
                  <Cell align="end" hideBelow="xl" className="tabular-nums">
                    {destination.latitude === null || destination.longitude === null ? (
                      // Not a dash: an unplaced destination cannot centre a map,
                      // and the operator should see that as a gap rather than
                      // as an empty cell.
                      <span className="text-warning-text">Not placed</span>
                    ) : (
                      `${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)}`
                    )}
                  </Cell>
                </Row>
              );
            })
          )}
        </DataTable>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[0.8125rem] text-muted tabular-nums">
          {total === 0 ? "No destinations" : `Showing ${from}–${to} of ${total}`}
        </p>

        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="h-9 rounded-sm border border-line px-3 text-[0.8125rem] text-body disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-[0.8125rem] text-muted tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="h-9 rounded-sm border border-line px-3 text-[0.8125rem] text-body disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
