"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Cell, DataTable, EmptyRow, Row } from "./DataTable";
import { categoryLabels, categoryOptions, tierLabels, tierOptions } from "@/lib/admin/transfers";
import { useLocalePath } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type { TransferRoute } from "@/types/transfer";

/**
 * The route register.
 *
 * Filtering goes through the URL rather than through local state, which is what
 * makes a filtered view shareable and, more usefully, what keeps the work on
 * the server: with nearly four hundred routes, filtering an array the browser
 * already holds would mean shipping all four hundred first.
 *
 * The search box is debounced because it writes to the URL, and a navigation
 * per keystroke would be a request per keystroke.
 */
export function TransferRoutesBrowser({
  data,
  total,
  page,
  pageSize,
  totalPages,
}: {
  data: TransferRoute[];
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

  return (
    <div>
      <FilterDisclosure
        count={["tier", "category"].filter((key) => { const value = searchParams.get(key); return value && value !== "all"; }).length}
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
            placeholder="Search a route, or either end of one"
            aria-label="Search routes"
            className="h-10 w-full rounded-sm border border-line bg-surface ps-9 pe-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
          />
        </label>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={searchParams.get("tier") ?? ""}
            onChange={(event) => setParam("tier", event.target.value)}
            aria-label="Filter by tier"
            className="h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-body focus:border-ink focus:outline-none"
          >
            <option value="">All tiers</option>
            {tierOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={searchParams.get("category") ?? ""}
            onChange={(event) => setParam("category", event.target.value)}
            aria-label="Filter by category"
            className="h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-body focus:border-ink focus:outline-none"
          >
            <option value="">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </FilterDisclosure>

      <div className="mt-6 rounded-sm border border-line bg-surface">
        <DataTable
          caption="Transfer routes"
          columns={[
            { label: "Route" },
            { label: "Tier", hideBelow: "sm" },
            { label: "Category", hideBelow: "md" },
            { label: "Distance", align: "end", hideBelow: "lg" },
            { label: "From", align: "end" },
            { label: "Status" },
          ]}
        >
          {data.length === 0 ? (
            <EmptyRow colSpan={6} message="No routes match those filters." />
          ) : (
            data.map((route) => (
              <Row key={route.id}>
                <Cell>
                  <Link
                    href={path(`/admin/transfers/routes/${route.id}`)}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {route.from.name}
                      <ArrowRight size={13} className="text-subtle" aria-hidden />
                      {route.to.name}
                    </span>
                  </Link>
                  {route.stops.length > 0 && (
                    <span className="type-caption mt-0.5 block text-subtle">
                      via {route.stops.map((stop) => stop.point.name).join(", ")}
                    </span>
                  )}
                </Cell>
                <Cell hideBelow="sm">{tierLabels[route.tier]}</Cell>
                <Cell hideBelow="md">{categoryLabels[route.category]}</Cell>
                <Cell align="end" hideBelow="lg">
                  {route.distanceKm} km
                </Cell>
                <Cell align="end" className="tabular-nums">
                  {route.startingFromCents === null ? (
                    // Not "0" and not a dash: no price means the distance engine
                    // will quote it, and the operator should see that as a gap.
                    <span className="text-warning-text">Not priced</span>
                  ) : (
                    formatMoney(route.startingFromCents, "GEL")
                  )}
                </Cell>
                <Cell>
                  <RouteStatus status={route.status} />
                </Cell>
              </Row>
            ))
          )}
        </DataTable>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[0.8125rem] text-muted tabular-nums">
          {total === 0 ? "No routes" : `Showing ${from}–${to} of ${total}`}
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

const statusTone: Record<string, string> = {
  ACTIVE: "border-success/40 bg-success/10 text-success",
  DRAFT: "border-line bg-surface-soft text-muted",
  INACTIVE: "border-line bg-surface-soft text-muted",
  ARCHIVED: "border-line bg-surface-soft text-subtle",
};

function RouteStatus({ status }: { status?: string }) {
  const key = status ?? "DRAFT";

  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide uppercase ${
        statusTone[key] ?? statusTone.DRAFT
      }`}
    >
      {key.toLowerCase()}
    </span>
  );
}
