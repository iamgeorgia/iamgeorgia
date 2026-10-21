"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ImageOff, Search, Star } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { HotelStatusBadge } from "./HotelStatusBadge";
import {
  TOUR_CATEGORIES,
  TOUR_STATUSES,
  categoryLabel,
  tourCardImage,
  tourStatusLabels,
} from "@/lib/admin/tours";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import { cn } from "@/lib/utils";
import type { TourSummary } from "@/types/tour";

/**
 * The tour register.
 *
 * URL-driven like every live list in the panel: filters write a query string,
 * the Server Component above re-renders. Status, channel and supplier are on
 * the rows because an admin is asking.
 */

const columns: Column[] = [
  { label: "Tour" },
  { label: "Destination", hideBelow: "lg" },
  { label: "Category", hideBelow: "md" },
  { label: "Length", hideBelow: "md", align: "end" },
  { label: "Status" },
  { label: "From", align: "end", hideBelow: "md" },
];

export function ToursBrowser({
  data,
  total,
  page,
  totalPages,
}: {
  data: TourSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const localePath = useLocalePath();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("search") ?? "");

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in changes)) next.delete("page");

    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  useEffect(() => {
    const current = params.get("search") ?? "";
    if (search === current) return;

    const timer = setTimeout(() => apply({ search: search || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const field =
    "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";

  const thumb = (tour: TourSummary) => {
    const url = tourCardImage(tour);

    return url ? (
      // eslint-disable-next-line @next/next/no-img-element -- editorial or API-served
      <img src={url} alt="" className="size-10 shrink-0 rounded-sm object-cover" />
    ) : (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-subtle">
        <ImageOff size={15} aria-hidden />
      </span>
    );
  };

  return (
    <div>
      <FilterDisclosure
        count={["status", "category"].filter((key) => { const value = params.get(key); return value && value !== "all"; }).length}
        lead={
        <div className="relative min-w-[16rem] flex-1">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-subtle"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title, slug or region"
            aria-label="Search tours"
            className={cn(field, "w-full ps-9")}
          />
        </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={params.get("status") ?? "all"}
            onChange={(event) => apply({ status: event.target.value })}
            aria-label="Filter by status"
            className={field}
          >
            <option value="all">All statuses</option>
            {TOUR_STATUSES.map((value) => (
              <option key={value} value={value}>
                {tourStatusLabels[value]}
              </option>
            ))}
          </select>

          <select
            value={params.get("category") ?? "all"}
            onChange={(event) => apply({ category: event.target.value })}
            aria-label="Filter by category"
            className={field}
          >
            <option value="all">All categories</option>
            {TOUR_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value)}
              </option>
            ))}
          </select>
        </div>
      </FilterDisclosure>

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0 ? "No tours match these filters." : `${total} tour${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", pending && "opacity-60")}>
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Tours">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((tour) => (
                <Row key={tour.id}>
                  <Cell>
                    <span className="flex items-center gap-3">
                      {thumb(tour)}
                      <span>
                        <Link
                          href={localePath(`/admin/tours/${tour.id}`)}
                          className="font-medium text-ink underline-offset-4 hover:underline"
                        >
                          {tour.title}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-muted">
                          <Star size={11} aria-hidden />
                          {tour.rating.toFixed(1)}
                          {tour.supplier && <span> · {tour.supplier.name}</span>}
                          {tour.b2cEnabled && <span> · Public</span>}
                        </span>
                      </span>
                    </span>
                  </Cell>
                  <Cell hideBelow="lg">{tour.destination?.name ?? "—"}</Cell>
                  <Cell hideBelow="md">{categoryLabel(tour.category)}</Cell>
                  <Cell hideBelow="md" align="end">
                    {tour.durationDays} {tour.durationDays === 1 ? "day" : "days"}
                  </Cell>
                  <Cell>{tour.status && <HotelStatusBadge status={tour.status} />}</Cell>
                  <Cell align="end" className="tabular-nums">
                    {tour.priceFrom
                      ? formatMoney(tour.priceFrom.amountCents, tour.priceFrom.currency)
                      : "—"}
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>

        <ul className="flex flex-col gap-3 lg:hidden">
          {data.length === 0 && <li className="py-12 text-center text-muted">Nothing to show.</li>}
          {data.map((tour) => (
            <li key={tour.id} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {thumb(tour)}
                  <Link
                    href={localePath(`/admin/tours/${tour.id}`)}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {tour.title}
                  </Link>
                </div>
                {tour.status && <HotelStatusBadge status={tour.status} />}
              </div>
              <p className="mt-2 text-[0.8125rem] text-muted">
                {categoryLabel(tour.category)} · {tour.durationLabel}
                {tour.destination && <> · {tour.destination.name}</>}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
            className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[0.8125rem] text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => apply({ page: String(page + 1) })}
            className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
