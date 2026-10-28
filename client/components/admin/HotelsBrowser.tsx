"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BadgeCheck, ImageOff, Search, ShieldAlert, Star } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { HotelStatusBadge } from "./HotelStatusBadge";
import {
  HOTEL_STATUSES,
  PROPERTY_TYPES,
  cardImage,
  hotelStatusLabels,
} from "@/lib/admin/hotels";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import { cn } from "@/lib/utils";
import type { HotelSummary } from "@/types/catalogue";

/**
 * The property list.
 *
 * URL-driven like every live list in the panel: filters write a query string,
 * the Server Component above re-renders. The rows come straight from the API's
 * summary shape — status, supplier and counts are on it because an admin is
 * asking.
 */

const columns: Column[] = [
  { label: "Property" },
  { label: "Destination", hideBelow: "lg" },
  { label: "Type", hideBelow: "md" },
  { label: "Status" },
  { label: "From", align: "end", hideBelow: "md" },
];

export function HotelsBrowser({
  data,
  total,
  page,
  totalPages,
}: {
  data: HotelSummary[];
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

  const thumb = (hotel: HotelSummary) => {
    const url = cardImage(hotel.coverImage);

    return url ? (
      // eslint-disable-next-line @next/next/no-img-element -- API-served image;
      // next/image would need the CDN host allow-listed per environment.
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
        count={["status", "propertyType"].filter((key) => { const value = params.get(key); return value && value !== "all"; }).length}
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
            placeholder="Search by name, slug or address"
            aria-label="Search properties"
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
            {HOTEL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {hotelStatusLabels[value]}
              </option>
            ))}
          </select>

          <select
            value={params.get("propertyType") ?? "all"}
            onChange={(event) => apply({ propertyType: event.target.value })}
            aria-label="Filter by property type"
            className={field}
          >
            <option value="all">All types</option>
            {PROPERTY_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </FilterDisclosure>

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0 ? "No properties match these filters." : `${total} propert${total === 1 ? "y" : "ies"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", pending && "opacity-60")}>
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Hotel properties">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((hotel) => (
                <Row key={hotel.id}>
                  <Cell>
                    <span className="flex items-center gap-3">
                      {thumb(hotel)}
                      <span>
                        <Link
                          href={localePath(`/admin/hotels/${hotel.id}`)}
                          className="font-medium text-ink underline-offset-4 hover:underline"
                        >
                          {hotel.name}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-muted">
                          <Star size={11} aria-hidden />
                          {hotel.starRating}
                          {hotel.supplier && <span> · {hotel.supplier.name}</span>}
                          {/* Only ever from the server's derived flag, and only
                              the certified case gets a mark — a property that
                              merely offers kosher services says so on its own
                              screen rather than earning a badge in a register. */}
                          {hotel.kosher?.certified && (
                            <span className="inline-flex items-center gap-0.5 text-success">
                              <BadgeCheck size={11} aria-hidden />
                              Kosher
                            </span>
                          )}
                          {hotel.kosher?.certificationState === "EXPIRED" && (
                            <span className="inline-flex items-center gap-0.5 text-error-text">
                              <ShieldAlert size={11} aria-hidden />
                              Kosher cert expired
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                  </Cell>
                  <Cell hideBelow="lg">{hotel.destination?.name ?? "—"}</Cell>
                  <Cell hideBelow="md">{hotel.propertyType}</Cell>
                  <Cell>{hotel.status && <HotelStatusBadge status={hotel.status} />}</Cell>
                  <Cell align="end" className="tabular-nums">
                    {hotel.priceFrom
                      ? formatMoney(hotel.priceFrom.amountCents, hotel.priceFrom.currency)
                      : "—"}
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>

        <ul className="flex flex-col gap-3 lg:hidden">
          {data.length === 0 && <li className="py-12 text-center text-muted">Nothing to show.</li>}
          {data.map((hotel) => (
            <li key={hotel.id} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {thumb(hotel)}
                  <Link
                    href={localePath(`/admin/hotels/${hotel.id}`)}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {hotel.name}
                  </Link>
                </div>
                {hotel.status && <HotelStatusBadge status={hotel.status} />}
              </div>
              <p className="mt-2 text-[0.8125rem] text-muted">
                {hotel.propertyType}
                {hotel.destination && <> · {hotel.destination.name}</>}
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
