"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Cell, DataTable, EmptyRow, Row } from "./DataTable";
import { FleetStatusBadge } from "./FleetBadges";
import { fleetStatusOptions } from "@/lib/admin/fleet";
import { useLocalePath } from "@/lib/i18n/provider";
import type { FleetVehicleAdmin } from "@/types/driver";

/**
 * The fleet register. Filters live in the URL, as every admin list's do.
 */
export function FleetBrowser({
  data,
  total,
  page,
  pageSize,
  totalPages,
}: {
  data: FleetVehicleAdmin[];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchParams]);

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(next));
    router.push(`${pathname}?${params}`);
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const thumb = (vehicle: FleetVehicleAdmin) =>
    vehicle.mainImage?.variants.find((variant) => variant.variant === "thumb")?.url ?? vehicle.mainImage?.url;

  return (
    <div>
      <FilterDisclosure
        count={["status"].filter((key) => { const value = searchParams.get(key); return value && value !== "all"; }).length}
        lead={
        <label className="relative min-w-56 flex-1">
          <Search size={15} className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by make, model or plate"
            aria-label="Search the fleet"
            className="h-10 w-full rounded-sm border border-line bg-surface ps-9 pe-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
          />
        </label>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={searchParams.get("status") ?? ""}
            onChange={(event) => setParam("status", event.target.value)}
            aria-label="Filter by status"
            className="h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-body focus:border-ink focus:outline-none"
          >
            <option value="">Any status</option>
            {fleetStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </FilterDisclosure>

      <div className="mt-6 rounded-sm border border-line bg-surface">
        <DataTable
          caption="Fleet"
          columns={[
            { label: "Car" },
            { label: "Sold as", hideBelow: "md" },
            { label: "Seats", align: "end", hideBelow: "sm" },
            { label: "Drivers", hideBelow: "lg" },
            { label: "Status" },
          ]}
        >
          {data.length === 0 ? (
            <EmptyRow colSpan={5} message="No cars match those filters." />
          ) : (
            data.map((vehicle) => (
              <Row key={vehicle.id}>
                <Cell>
                  <div className="flex items-center gap-3">
                    {thumb(vehicle) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- API-served
                      <img src={thumb(vehicle)} alt="" className="h-10 w-14 shrink-0 rounded-sm object-cover" />
                    ) : (
                      <span className="h-10 w-14 shrink-0 rounded-sm bg-surface-soft" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <Link
                        href={path(`/admin/transfers/fleet/${vehicle.id}`)}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {vehicle.make} {vehicle.model}
                      </Link>
                      <span className="type-caption mt-0.5 block font-mono text-subtle">
                        {vehicle.plateNumber}
                        {vehicle.colour ? ` · ${vehicle.colour}` : ""}
                        {vehicle.year ? ` · ${vehicle.year}` : ""}
                      </span>
                    </div>
                  </div>
                </Cell>
                <Cell hideBelow="md">
                  {vehicle.vehicleClass?.name ?? "—"}
                  {vehicle.provider && (
                    <span className="type-caption mt-0.5 block text-subtle">{vehicle.provider.name}</span>
                  )}
                </Cell>
                <Cell align="end" hideBelow="sm" className="tabular-nums">
                  {vehicle.passengerCapacity}
                </Cell>
                <Cell hideBelow="lg">
                  {vehicle.drivers.length === 0
                    ? "—"
                    : vehicle.drivers.map((driver) => `${driver.firstName} ${driver.lastName}`).join(", ")}
                </Cell>
                <Cell>
                  <FleetStatusBadge status={vehicle.status} />
                </Cell>
              </Row>
            ))
          )}
        </DataTable>
      </div>

      <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-[0.8125rem] text-muted">
        <p aria-live="polite">
          {total === 0 ? "No cars" : `${from}–${to} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)} className="h-8 rounded-sm border border-line px-3 disabled:opacity-40">
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => goToPage(page + 1)} className="h-8 rounded-sm border border-line px-3 disabled:opacity-40">
            Next
          </button>
        </div>
      </nav>
    </div>
  );
}
