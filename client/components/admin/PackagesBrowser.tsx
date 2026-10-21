"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ImageOff, Search, Star } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { HotelStatusBadge } from "./HotelStatusBadge";
import { PACKAGE_STATUSES, packageCardImage, packageStatusLabels } from "@/lib/admin/packages";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import { cn } from "@/lib/utils";
import type { PackageSummary } from "@/types/package";

/**
 * The package register.
 *
 * URL-driven like every live list in the panel: filters write a query string,
 * the Server Component above re-renders.
 *
 * The "from" column is the sampled indicative price the daily sweeper writes,
 * not a quote — a package with no figure has simply not priced on any sample
 * date yet, which for a draft is normal and for an active package is worth
 * noticing.
 */

const columns: Column[] = [
  { label: "Package" },
  { label: "Destination", hideBelow: "lg" },
  { label: "Nights", hideBelow: "md", align: "end" },
  { label: "Parts", hideBelow: "md", align: "end" },
  { label: "Status" },
  { label: "From", align: "end", hideBelow: "md" },
];

export function PackagesBrowser({
  data,
  total,
  page,
  totalPages,
}: {
  data: PackageSummary[];
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
    "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink focus:border-ink focus:outline-none";

  return (
    <div className={cn(pending && "opacity-60 transition-opacity")}>
      <FilterDisclosure
        count={["status", "kosher"].filter((key) => { const value = params.get(key); return value && value !== "all"; }).length}
        lead={
        <label className="relative min-w-56 flex-1">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or slug"
            aria-label="Search packages"
            className={cn(field, "w-full ps-9")}
          />
        </label>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={params.get("status") ?? "all"}
            onChange={(event) => apply({ status: event.target.value })}
            aria-label="Status"
            className={field}
          >
            <option value="all">Any status</option>
            {PACKAGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {packageStatusLabels[status]}
              </option>
            ))}
          </select>

          <select
            value={params.get("kosher") ?? "all"}
            onChange={(event) => apply({ kosher: event.target.value })}
            aria-label="Kosher"
            className={field}
          >
            <option value="all">Kosher and not</option>
            <option value="true">Kosher only</option>
            <option value="false">Not kosher</option>
          </select>
        </div>
      </FilterDisclosure>

      <div className="mt-5">
        <DataTable columns={columns} caption="Packages">
          {data.length === 0 ? (
            <EmptyRow colSpan={columns.length} message="No packages match those filters." />
          ) : (
            data.map((pkg) => {
              const cover = packageCardImage(pkg);

              return (
                <Row key={pkg.id}>
                  <Cell>
                    <span className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-soft">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element -- editorial or API-served
                          <img src={cover} alt="" className="size-full object-cover" />
                        ) : (
                          <ImageOff size={15} className="text-muted" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0">
                        <Link
                          href={localePath(`/admin/packages/${pkg.id}`)}
                          className="flex items-center gap-1.5 font-medium text-ink underline-offset-4 hover:underline"
                        >
                          {pkg.name}
                          {pkg.featured && (
                            <Star size={12} className="text-brand-text" aria-label="Featured" />
                          )}
                        </Link>
                        <span className="block truncate text-[0.75rem] text-muted">{pkg.slug}</span>
                      </span>
                    </span>
                  </Cell>
                  <Cell hideBelow="lg">{pkg.destination?.name ?? "—"}</Cell>
                  <Cell hideBelow="md" align="end">
                    {pkg.nights}
                  </Cell>
                  <Cell hideBelow="md" align="end">
                    {pkg.componentCount}
                  </Cell>
                  <Cell>{pkg.status && <HotelStatusBadge status={pkg.status} />}</Cell>
                  <Cell hideBelow="md" align="end" className="tabular-nums">
                    {pkg.priceFrom
                      ? formatMoney(pkg.priceFrom.amountCents, pkg.priceFrom.currency)
                      : "—"}
                  </Cell>
                </Row>
              );
            })
          )}
        </DataTable>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-[0.8125rem] text-muted">
          <span>
            Page {page} of {totalPages} · {total} packages
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => apply({ page: String(page - 1) })}
              className="h-9 rounded-sm border border-line px-3 font-medium text-ink transition-colors hover:border-ink disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => apply({ page: String(page + 1) })}
              className="h-9 rounded-sm border border-line px-3 font-medium text-ink transition-colors hover:border-ink disabled:opacity-40"
            >
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
