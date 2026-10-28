"use client";

import { useEffect, useMemo, useState } from "react";

import { ActiveFilterChips } from "./ActiveFilterChips";
import { ChipGroup, type ChipOption } from "./ChipGroup";
import { DateRangeFields } from "./DateRangeFields";
import { FilterBar } from "./FilterBar";
import { QuickPresets } from "./QuickPresets";
import { SearchField, filterControlClass, filterLabelClass } from "./SearchField";
import { SortSelect } from "./SortSelect";
import type { useFilterUrl } from "./useFilterUrl";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import {
  activePreset,
  bookingFiltersFromParams,
  clearedFilters,
  describeFilters,
  presetFilters,
  withoutFilter,
  APPROVAL_FILTERS,
  approvalFilterLabels,
  PAYMENT_STATUSES,
  paymentStatusLabels,
  type BookingFilterState,
  type BookingPresetId,
} from "@/lib/admin/bookingFilters";
import { BOOKING_SOURCES, bookingSourceLabels } from "@/lib/admin/bookings";
import { getPartnerClient, listPartnersClient } from "@/lib/api/partners";
import { getUserClient, listUsersClient } from "@/lib/api/users";
import type { BookingPaymentStatus, BookingSource } from "@/types/booking";

/**
 * The filter kit assembled for a booking register.
 *
 * Every register — hotels, transfers, tours, services, orders, and the
 * register of every booking — renders this once above its table, naming
 * only what differs: its own statuses, what its date column is called, and
 * whether a partner or a manager can be chosen here. Everything else (quick
 * views, payment chips, source, created range, sort, the active chips) is
 * the same control reading the same URL keys, so an operator who learns one
 * register has learned them all.
 *
 * The state is read off the URL on every render rather than kept here: the
 * URL is the truth, and the Server Component above re-renders from it.
 */

const SECONDARY_KEYS: (keyof BookingFilterState)[] = [
  "approval",
  "paymentStatus",
  "invoiceStatus",
  "paymentMethod",
  "source",
  "partnerId",
  "customerId",
  "managerId",
  "destinationId",
  "createdFrom",
  "createdTo",
  "sort",
];

export interface BookingFiltersProps {
  url: ReturnType<typeof useFilterUrl>;
  /** The register's own statuses, as chips. */
  statuses: ChipOption[];
  statusLabel: (status: string) => string;
  /** One line under the chips when exactly one status is chosen. */
  statusHints?: Record<string, string>;
  /** The register of every booking only: which products to show. */
  products?: ChipOption[];
  productLabel?: (product: string) => string;
  /** "Arriving", "Pick-up", "Departing", "Travelling". */
  dateLabel: string;
  searchPlaceholder: string;
  searchLabel: string;
  /** `YYYY-MM-DD` from the server render, so the presets hydrate the same. */
  today: string;
  /** Offered on the admin registers; a partner's own portal has no such filter. */
  showPartner?: boolean;
  /** Offered to staff: who is handling the booking. */
  showManager?: boolean;
  /** Presets this register cannot offer. */
  excludePresets?: BookingPresetId[];
  /** URL keys that are navigation rather than filters and survive a preset or a clear. */
  keep?: readonly string[];
  /** The register's own extra controls, beside the search box. */
  children?: React.ReactNode;
}

export function BookingFilters({
  url,
  statuses,
  statusLabel,
  statusHints,
  products,
  productLabel,
  dateLabel,
  searchPlaceholder,
  searchLabel,
  today,
  showPartner = false,
  showManager = false,
  excludePresets = [],
  keep = [],
  children,
}: BookingFiltersProps) {
  const { record, apply, replace } = url;

  const state = useMemo(
    () =>
      bookingFiltersFromParams(record, {
        statuses: statuses.map((option) => option.value),
        products: products?.map((option) => option.value),
      }),
    [record, statuses, products],
  );

  // The names behind the ids the URL carries, for the picker and the chips.
  // Resolved once per id; a name the viewer may not read stays an id.
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let stale = false;
    const lookups: Promise<void>[] = [];

    if (state.partnerId && !names[`partner:${state.partnerId}`]) {
      const id = state.partnerId;
      lookups.push(
        getPartnerClient(id)
          .then((partner) => {
            if (!stale) setNames((current) => ({ ...current, [`partner:${id}`]: partner.name }));
          })
          .catch(() => undefined),
      );
    }
    if (state.managerId && !names[`user:${state.managerId}`]) {
      const id = state.managerId;
      lookups.push(
        getUserClient("staff", id)
          .then((user) => {
            if (!stale) setNames((current) => ({ ...current, [`user:${id}`]: user.fullName }));
          })
          .catch(() => undefined),
      );
    }

    return () => {
      stale = true;
    };
    // Keyed on the ids alone: `names` changing is the effect's own doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.partnerId, state.managerId]);

  const partnerName = state.partnerId ? (names[`partner:${state.partnerId}`] ?? null) : null;
  const managerName = state.managerId ? (names[`user:${state.managerId}`] ?? null) : null;

  const chips = describeFilters(state, {
    statusLabel,
    productLabel,
    dateLabel,
    partnerName,
    managerName,
  });

  const preset = activePreset(state, today);
  const secondaryCount = SECONDARY_KEYS.filter((key) => {
    const value = state[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  }).length;

  const searchPartners = async (term: string): Promise<PickerOption[]> => {
    const found = await listPartnersClient({ q: term || undefined, status: "APPROVED", pageSize: 10 });
    return found.data.map((partner) => ({ id: partner.id, label: partner.name, meta: partner.reference }));
  };

  const searchStaff = async (term: string): Promise<PickerOption[]> => {
    const found = await listUsersClient("staff", { q: term || undefined, pageSize: 10 });
    return found.data.map((user) => ({ id: user.id, label: user.fullName, meta: user.email }));
  };

  return (
    <div className="flex flex-col gap-4">
      <QuickPresets
        active={preset}
        exclude={excludePresets}
        onSelect={(id) => replace({ ...presetFilters(id, today), search: state.search, page: 1 }, keep)}
      />

      <FilterBar
        count={secondaryCount}
        primary={
          <>
            <SearchField
              value={state.search ?? ""}
              onCommit={(next) => apply({ search: next || null })}
              placeholder={searchPlaceholder}
              label={searchLabel}
            />
            <DateRangeFields
              label={dateLabel}
              from={state.from ?? ""}
              to={state.to ?? ""}
              today={today}
              onChange={(range) => apply({ from: range.from, to: range.to })}
            />
            {children}
          </>
        }
        secondary={
          <>
            <div className="flex flex-col gap-1.5">
              <span className={filterLabelClass}>Payment</span>
              <ChipGroup<BookingPaymentStatus>
                label="Payment status"
                options={PAYMENT_STATUSES.map((status) => ({ value: status, label: paymentStatusLabels[status] }))}
                value={state.paymentStatus ?? []}
                onChange={(next) => apply({ paymentStatus: next })}
              />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={filterLabelClass}>Approval</span>
              <select
                value={state.approval ?? ""}
                onChange={(event) => apply({ approval: event.target.value || null })}
                className={filterControlClass}
              >
                <option value="">Any</option>
                {APPROVAL_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {approvalFilterLabels[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={filterLabelClass}>Source</span>
              <select
                value={state.source?.[0] ?? ""}
                onChange={(event) => apply({ source: event.target.value ? [event.target.value] : null })}
                className={filterControlClass}
              >
                <option value="">Any source</option>
                {BOOKING_SOURCES.map((source: BookingSource) => (
                  <option key={source} value={source}>
                    {bookingSourceLabels[source]}
                  </option>
                ))}
              </select>
            </label>

            {showPartner && (
              <EntityPicker
                label="Partner"
                className="w-56"
                value={state.partnerId ?? ""}
                valueLabel={partnerName}
                onChange={(choice) => apply({ partnerId: choice?.id ?? null })}
                search={searchPartners}
                placeholder="Any partner"
                clearLabel="Any partner"
              />
            )}

            {showManager && (
              <EntityPicker
                label="Manager"
                className="w-56"
                value={state.managerId ?? ""}
                valueLabel={managerName}
                onChange={(choice) => apply({ managerId: choice?.id ?? null })}
                search={searchStaff}
                placeholder="Anyone"
                clearLabel="Anyone"
              />
            )}

            <DateRangeFields
              label="Created"
              from={state.createdFrom ?? ""}
              to={state.createdTo ?? ""}
              today={today}
              direction="back"
              onChange={(range) => apply({ createdFrom: range.from, createdTo: range.to })}
            />

            <SortSelect value={state.sort ?? ""} onChange={(next) => apply({ sort: next })} />
          </>
        }
      />

      {(statuses.length > 0 || products) && (
        <div className="flex flex-col gap-3">
          {products && (
            <ChipGroup
              label="Product"
              options={products}
              value={state.product ?? []}
              onChange={(next) => apply({ product: next })}
              allLabel="All products"
            />
          )}
          {statuses.length > 0 && (
            <ChipGroup
              label="Status"
              options={statuses}
              value={state.status ?? []}
              onChange={(next) => apply({ status: next })}
              allLabel="Any status"
            />
          )}
          {/* One status selected is a queue with a meaning; three is a filter. */}
          {statusHints && state.status?.length === 1 && statusHints[state.status[0]] && (
            <p className="text-[0.8125rem] text-muted">{statusHints[state.status[0]]}</p>
          )}
        </div>
      )}

      <ActiveFilterChips
        chips={chips}
        onRemove={(chip) => replace(withoutFilter(state, chip.clear), keep)}
        onClear={() => replace(clearedFilters(), keep)}
      />
    </div>
  );
}
