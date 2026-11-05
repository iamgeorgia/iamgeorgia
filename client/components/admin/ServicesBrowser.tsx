"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Plus, Search } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { HotelStatusBadge } from "./HotelStatusBadge";
import { NewServiceForm } from "./NewServiceForm";
import { FilterChip } from "@/components/ui/FilterChip";
import {
  SERVICE_CATEGORIES,
  SERVICE_STATUSES,
  confirmationModeLabels,
  serviceBasisLabels,
  serviceCategoryLabels,
  serviceStatusLabels,
} from "@/lib/admin/services";
import { formatMoney } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import { cn } from "@/lib/utils";
import type { CancellationPolicy, DestinationNode } from "@/types/catalogue";
import type { PartnerSummary } from "@/types/partner";
import type { ServiceSummary } from "@/types/service";

/**
 * The service register, and the form that adds to it.
 *
 * URL-driven like every live list in the panel: filters write a query string
 * and the Server Component above re-renders. Creating is on this screen rather
 * than behind an `/admin/services/new` route because a service is one form's
 * worth of fields with nothing to fill in afterwards — a wizard step that
 * lands on a screen asking for the same things again is a step for its own
 * sake.
 */

const columns: Column[] = [
  { label: "Service" },
  { label: "Category", hideBelow: "md" },
  { label: "Priced", hideBelow: "lg" },
  { label: "Per unit", align: "end" },
  { label: "Confirmation", hideBelow: "lg" },
  { label: "Status" },
];

export function ServicesBrowser({
  data,
  total,
  page,
  totalPages,
  destinations,
  suppliers,
  policies,
}: {
  data: ServiceSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  destinations: DestinationNode[];
  suppliers: PartnerSummary[];
  policies: CancellationPolicy[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const localePath = useLocalePath();
  const [pending, startTransition] = useTransition();
  const can = useCan();
  const canCreate = can("catalogue.write");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [adding, setAdding] = useState(false);

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

  const kosherOnly = params.get("kosher") === "true";

  const field =
    "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";

  /**
   * What the admin's own price for one unit is.
   *
   * `unitPrice` is the viewer's price, and this viewer is staff — so where a
   * fixed sell exists the two agree, and where it does not the figure is the
   * default markup on the net. The net is shown under it because that is the
   * number an operator is checking against the supplier's invoice.
   */
  const unitPrice = (service: ServiceSummary) => (
    <>
      <span className="block font-medium text-ink">
        {formatMoney(service.unitPrice.amountCents, service.unitPrice.currency)}
      </span>
      {service.netCents !== undefined && (
        <span className="type-caption mt-0.5 block text-subtle">
          net {formatMoney(service.netCents, service.currency)}
          {service.sellCents != null && " · fixed"}
        </span>
      )}
    </>
  );

  return (
    <div>
      <FilterDisclosure
        count={["status", "category"].filter((key) => { const value = params.get(key); return value && value !== "all"; }).length + (kosherOnly ? 1 : 0)}
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
            placeholder="Search by name or slug"
            aria-label="Search services"
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
            {SERVICE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {serviceStatusLabels[value]}
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
            {SERVICE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {serviceCategoryLabels[value]}
              </option>
            ))}
          </select>

          {/* A chip rather than a third select: kosher is on or off, and a
              two-option dropdown hides a switch behind a click. */}
          <FilterChip
            selected={kosherOnly}
            onClick={() => apply({ kosher: kosherOnly ? null : "true" })}
          >
            Kosher only
          </FilterChip>

          {canCreate && (
            <button
              type="button"
              onClick={() => setAdding((current) => !current)}
              aria-expanded={adding}
              className="ms-auto inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              New service
            </button>
          )}
        </div>
      </FilterDisclosure>

      {canCreate && adding && (
        <AdminPanel className="mt-5" title="A new service">
          <NewServiceForm
            destinations={destinations}
            suppliers={suppliers}
            policies={policies}
            onCancel={() => setAdding(false)}
          />
        </AdminPanel>
      )}

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0
          ? "No services match these filters."
          : `${total} service${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", pending && "opacity-60")}>
        <div className="hidden rounded-sm border border-line bg-surface lg:block">
          <DataTable columns={columns} caption="Services">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show." />
            ) : (
              data.map((service) => (
                <Row key={service.id}>
                  <Cell>
                    <Link
                      href={localePath(`/admin/services/${service.id}`)}
                      className="font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {service.name}
                    </Link>
                    <span className="type-caption mt-0.5 block text-subtle">
                      <span className="font-mono">{service.slug}</span>
                      {service.isKosher && <span> · Kosher</span>}
                      {service.supplier && <span> · {service.supplier.name}</span>}
                    </span>
                  </Cell>
                  <Cell hideBelow="md">{serviceCategoryLabels[service.category]}</Cell>
                  <Cell hideBelow="lg">{serviceBasisLabels[service.basis]}</Cell>
                  <Cell align="end" className="tabular-nums">
                    {unitPrice(service)}
                  </Cell>
                  <Cell hideBelow="lg">{confirmationModeLabels[service.confirmationMode]}</Cell>
                  <Cell>{service.status && <HotelStatusBadge status={service.status} />}</Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>

        <ul className="flex flex-col gap-3 lg:hidden">
          {data.length === 0 && <li className="py-12 text-center text-muted">Nothing to show.</li>}
          {data.map((service) => (
            <li key={service.id} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={localePath(`/admin/services/${service.id}`)}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  {service.name}
                </Link>
                {service.status && <HotelStatusBadge status={service.status} />}
              </div>
              <p className="mt-2 text-[0.8125rem] text-muted">
                {serviceCategoryLabels[service.category]} · {serviceBasisLabels[service.basis]} ·{" "}
                {formatMoney(service.unitPrice.amountCents, service.unitPrice.currency)}
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
