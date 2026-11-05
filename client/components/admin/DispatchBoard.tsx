"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { useCan } from "./AdminViewerContext";
import { Cell, DataTable, EmptyRow, Row } from "./DataTable";
import { TransferLegStatusBadge } from "./DispatchBadges";
import { LegActions } from "./LegActions";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { LEG_STATUSES, formatPickup, legStatusLabels } from "@/lib/admin/dispatch";
import { useLocalePath } from "@/lib/i18n/provider";
import type { DispatchLeg } from "@/types/driver";

/**
 * The dispatch board: every leg, soonest first, with who is on it and what
 * can be done next. Filters live in the URL like every other admin list and
 * apply only when set — an empty date field means no bound; the actions are
 * per row.
 */
export function DispatchBoard({
  data,
  total,
  page,
  pageSize,
  totalPages,
  from,
  to,
}: {
  data: DispatchLeg[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Empty when the list is not bounded on that side. */
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const path = useLocalePath();
  const can = useCan();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  // Without this the Actions column would be a column of nothing, so it goes.
  const canDispatch = can("dispatch.write");
  const columnCount = canDispatch ? 6 : 5;

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

  const control =
    "h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-body focus:border-ink focus:outline-none";

  return (
    <div>
      <FilterDisclosure
        count={(from ? 1 : 0) + (to ? 1 : 0) + (searchParams.get("legStatus") ? 1 : 0)}
        lead={
          <label className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Reference or passenger"
              aria-label="Search legs"
              className={`${control} w-full ps-9 pe-3 text-ink`}
            />
          </label>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[0.75rem] font-semibold text-muted">
            From
            <input type="date" value={from} onChange={(event) => setParam("from", event.target.value)} className={`${control} mt-1 block`} />
          </label>
          <label className="text-[0.75rem] font-semibold text-muted">
            To
            <input type="date" value={to} onChange={(event) => setParam("to", event.target.value)} className={`${control} mt-1 block`} />
          </label>
          <select
            value={searchParams.get("legStatus") ?? ""}
            onChange={(event) => setParam("legStatus", event.target.value)}
            aria-label="Filter by status"
            className={control}
          >
            <option value="">Every status</option>
            {LEG_STATUSES.map((status) => (
              <option key={status} value={status}>
                {legStatusLabels[status]}
              </option>
            ))}
          </select>
        </div>
      </FilterDisclosure>

      {!canDispatch && (
        <ReadOnlyNote needs="dispatch.write" what="Assigning drivers and moving legs" className="mt-6" />
      )}

      <div className="mt-6 rounded-sm border border-line bg-surface">
        <DataTable
          caption="Transfer legs"
          columns={[
            { label: "Pick-up" },
            { label: "Journey" },
            { label: "Party", align: "end", hideBelow: "md" },
            { label: "Status" },
            { label: "Driver", hideBelow: "lg" },
            ...(canDispatch ? [{ label: "Actions" }] : []),
          ]}
        >
          {data.length === 0 ? (
            <EmptyRow colSpan={columnCount} message="Nothing to dispatch in this window." />
          ) : (
            data.map((leg) => (
              <Row key={leg.id}>
                <Cell className="tabular-nums whitespace-nowrap">
                  {formatPickup(leg.pickupAt, leg.timezone)}
                  {leg.booking.flightNumber && (
                    <span className="type-caption mt-0.5 block text-subtle">✈ {leg.booking.flightNumber}</span>
                  )}
                </Cell>
                <Cell>
                  <Link
                    href={path(`/admin/transfers/bookings/${leg.booking.reference}`)}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {leg.from} → {leg.to}
                  </Link>
                  <span className="type-caption mt-0.5 block text-subtle">
                    {leg.booking.reference}
                    {leg.direction === "RETURN" ? " · return" : ""} · {leg.booking.leadPassengerName}
                    {leg.booking.partner ? ` · ${leg.booking.partner.name}` : ""}
                  </span>
                </Cell>
                <Cell align="end" hideBelow="md" className="tabular-nums">
                  {leg.booking.passengers}
                  <span className="type-caption block text-subtle">{leg.booking.luggage} bags</span>
                </Cell>
                <Cell>
                  <TransferLegStatusBadge status={leg.status} />
                </Cell>
                <Cell hideBelow="lg">
                  {leg.assignment ? (
                    <>
                      <Link
                        href={path(`/admin/transfers/drivers/${leg.assignment.driver.id}`)}
                        className="text-ink underline-offset-4 hover:underline"
                      >
                        {leg.assignment.driver.firstName} {leg.assignment.driver.lastName}
                      </Link>
                      <span className="type-caption block text-subtle">
                        {leg.assignment.vehicle
                          ? `${leg.assignment.vehicle.make} ${leg.assignment.vehicle.model} · ${leg.assignment.vehicle.plateNumber}`
                          : "No car yet"}
                      </span>
                    </>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </Cell>
                {canDispatch && (
                  <Cell>
                    <LegActions leg={leg} compact />
                  </Cell>
                )}
              </Row>
            ))
          )}
        </DataTable>
      </div>

      <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-[0.8125rem] text-muted">
        <p aria-live="polite">{total === 0 ? "No legs" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</p>
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
