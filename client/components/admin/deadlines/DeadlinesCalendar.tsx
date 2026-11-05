"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { DeadlineAgenda } from "./DeadlineAgenda";
import { DeadlineModal, type MoveOutcome } from "./DeadlineModal";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { ChipGroup } from "@/components/admin/filters/ChipGroup";
import { FilterBar } from "@/components/admin/filters/FilterBar";
import { filterLabelClass } from "@/components/admin/filters/SearchField";
import { useFilterUrl } from "@/components/admin/filters/useFilterUrl";
import { MonthGrid } from "@/components/admin/MonthGrid";
import {
  CALENDAR_VIEWS,
  DEADLINE_KINDS,
  DEADLINE_PRODUCTS,
  DEADLINE_STATUSES,
  calendarRange,
  calendarStateToParams,
  daysBetween,
  deadlineKindLabels,
  deadlineProductLabels,
  deadlineStatusLabels,
  describeCalendarFilters,
  groupByDay,
  hasCalendarFilters,
  monthGridDays,
  rangeTitle,
  stepAnchor,
  withoutCalendarFilter,
  type CalendarView,
  type DeadlineCalendarState,
} from "@/lib/admin/deadlines";
import { getPartnerClient, listPartnersClient } from "@/lib/api/partners";
import { getUserClient, listUsersClient } from "@/lib/api/users";
import { cn } from "@/lib/utils";
import type { Deadline } from "@/types/deadline";

const viewLabels: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day" };

const subscribeNoop = () => () => {};
const narrowQuery = "(max-width: 767px)";

/** True below `md`, false on the server and during hydration. */
function useNarrow(): boolean {
  const [matches, setMatches] = useState(false);
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  useEffect(() => {
    const media = window.matchMedia(narrowQuery);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mounted && matches;
}

/**
 * The deadline calendar's client half: the view switch, the filter row, the
 * three views and the dialog. The rows arrive from the page's server fetch
 * for the window the URL names; every change of view, anchor or filter is
 * written to the URL and the page re-renders — the same pattern as every
 * register, so a filtered month is a link that can be sent to a colleague.
 *
 * On a phone with no `view` in the address the week is shown rather than
 * the month: the month's rows cover the week (whole weeks are fetched), so
 * no second request is needed.
 */
export function DeadlinesCalendar({
  rows,
  total,
  state,
  viewExplicit,
  today,
}: {
  rows: Deadline[];
  /** The server's count for the window — more than `rows` once the page cap is hit. */
  total: number;
  state: DeadlineCalendarState;
  /** Whether the URL named the view, or the default was assumed. */
  viewExplicit: boolean;
  today: string;
}) {
  const { apply, pending } = useFilterUrl();
  const narrow = useNarrow();
  const view: CalendarView = !viewExplicit && narrow ? "week" : state.view;

  // The rows, locally patched after a move so the calendar redraws at once.
  const [local, setLocal] = useState(rows);
  const [seen, setSeen] = useState(rows);
  if (seen !== rows) {
    setSeen(rows);
    setLocal(rows);
  }

  const groups = useMemo(() => groupByDay(local), [local]);
  const { start, end } = calendarRange(view, state.from);
  const days = useMemo(() => daysBetween(start, end), [start, end]);
  const monthDays = useMemo(() => monthGridDays(state.from), [state.from]);

  const [open, setOpen] = useState<Deadline | null>(null);

  // Names for the ids the URL carries.
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let stale = false;
    if (state.partnerId && !names[`partner:${state.partnerId}`]) {
      const id = state.partnerId;
      getPartnerClient(id)
        .then((partner) => {
          if (!stale) setNames((current) => ({ ...current, [`partner:${id}`]: partner.name }));
        })
        .catch(() => undefined);
    }
    if (state.managerId && !names[`user:${state.managerId}`]) {
      const id = state.managerId;
      getUserClient("staff", id)
        .then((user) => {
          if (!stale) setNames((current) => ({ ...current, [`user:${id}`]: user.fullName }));
        })
        .catch(() => undefined);
    }
    return () => {
      stale = true;
    };
    // Keyed on the ids alone: `names` changing is the effect's own doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.partnerId, state.managerId]);

  const partnerName = state.partnerId ? (names[`partner:${state.partnerId}`] ?? null) : null;
  const managerName = state.managerId ? (names[`user:${state.managerId}`] ?? null) : null;
  const chips = describeCalendarFilters(state, { partnerName, managerName });
  const filtered = hasCalendarFilters(state);

  const setView = (next: CalendarView, from = state.from) => apply({ view: next, from: from === today ? null : from });
  const step = (direction: -1 | 1) => apply({ from: stepAnchor(view, state.from, direction), view: viewExplicit ? state.view : view });
  const clearFilters = () => apply({ kind: null, status: null, product: null, partnerId: null, managerId: null });
  const replaceState = (next: DeadlineCalendarState) => {
    const params = calendarStateToParams(next, today);
    apply({ kind: null, status: null, product: null, partnerId: null, managerId: null, ...params });
  };

  const onMoved = (outcome: MoveOutcome) => {
    if (outcome.kind !== "moved") return;
    const moved = outcome.deadline;
    setLocal((current) => current.map((row) => (row.id === moved.id ? { ...row, ...moved, history: undefined } : row)));
  };

  const searchPartners = async (term: string): Promise<PickerOption[]> => {
    const found = await listPartnersClient({ q: term || undefined, status: "APPROVED", pageSize: 10 });
    return found.data.map((partner) => ({ id: partner.id, label: partner.name, meta: partner.reference }));
  };

  const searchStaff = async (term: string): Promise<PickerOption[]> => {
    const found = await listUsersClient("staff", { q: term || undefined, pageSize: 10 });
    return found.data.map((user) => ({ id: user.id, label: user.fullName, meta: user.email }));
  };

  const inWindow = local.length;
  const capped = total > rows.length;

  return (
    <div className={cn("flex flex-col gap-5", pending && "opacity-70 transition-opacity")} aria-busy={pending || undefined}>
      {/* The toolbar: where we are, how to move, which view. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={`Previous ${view}`}
            className="inline-flex size-9 items-center justify-center rounded-sm border border-line text-ink transition-colors hover:border-ink hover:bg-surface-soft"
          >
            <ChevronLeft size={16} className="rtl:-scale-x-100" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={`Next ${view}`}
            className="inline-flex size-9 items-center justify-center rounded-sm border border-line text-ink transition-colors hover:border-ink hover:bg-surface-soft"
          >
            <ChevronRight size={16} className="rtl:-scale-x-100" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => apply({ from: null })}
            disabled={state.from === today}
            className="inline-flex h-9 items-center rounded-sm border border-line px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:border-ink hover:bg-surface-soft disabled:opacity-50"
          >
            Today
          </button>
          <h2 className="ms-2 text-[1.0625rem] font-semibold text-ink" aria-live="polite">
            {rangeTitle(view, state.from)}
          </h2>
        </div>

        <div role="group" aria-label="View" className="inline-flex rounded-sm border border-line p-0.5">
          {CALENDAR_VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                "h-8 rounded-sm px-3 text-[0.8125rem] font-medium transition-colors",
                view === option ? "bg-ink text-white" : "text-muted hover:bg-surface-soft hover:text-ink",
              )}
            >
              {viewLabels[option]}
            </button>
          ))}
        </div>
      </div>

      <FilterBar
        count={chips.length}
        primary={
          <div className="flex flex-col gap-1.5">
            <span className={filterLabelClass}>Kind</span>
            <ChipGroup
              label="Deadline kind"
              options={DEADLINE_KINDS.map((kind) => ({ value: kind, label: deadlineKindLabels[kind] }))}
              value={state.kind}
              onChange={(next) => apply({ kind: next })}
            />
          </div>
        }
        secondary={
          <>
            <div className="flex flex-col gap-1.5">
              <span className={filterLabelClass}>Status</span>
              <ChipGroup
                label="Deadline status"
                options={DEADLINE_STATUSES.map((status) => ({ value: status, label: deadlineStatusLabels[status] }))}
                value={state.status}
                onChange={(next) => apply({ status: next })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={filterLabelClass}>Product</span>
              <ChipGroup
                label="Product"
                options={DEADLINE_PRODUCTS.map((product) => ({ value: product, label: deadlineProductLabels[product] }))}
                value={state.product}
                onChange={(next) => apply({ product: next })}
              />
            </div>
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
          </>
        }
      />

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => replaceState(withoutCalendarFilter(state, chip.clear))}
              aria-label={`Remove filter ${chip.label}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft ps-3 pe-2 text-[0.75rem] font-medium text-brand-text transition-colors hover:border-brand"
            >
              {chip.label}
              <X size={12} aria-hidden />
            </button>
          ))}
          <button type="button" onClick={clearFilters} className="h-8 px-2 text-[0.75rem] font-medium text-muted underline-offset-4 hover:text-ink hover:underline">
            Clear filters
          </button>
        </div>
      )}

      {capped && (
        <p role="status" className="rounded-sm border border-warning/40 bg-warning/8 px-4 py-2.5 text-[0.8125rem] text-warning-text">
          Showing the first {rows.length} of {total} deadlines in this window. Narrow the filters or switch to a shorter view to see them all.
        </p>
      )}

      {inWindow === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-dashed border-line bg-surface-soft/40 px-4 py-3">
          <p className="text-[0.875rem] text-muted">
            {filtered ? "No deadline matches these filters in this window." : `Nothing is due this ${view}.`}
          </p>
          {filtered && (
            <button type="button" onClick={clearFilters} className="text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline">
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="rounded-sm border border-line bg-surface">
        {view === "month" ? (
          <MonthGrid days={monthDays} groups={groups} today={today} onSelectDay={(day) => setView("day", day)} onOpen={setOpen} />
        ) : (
          <DeadlineAgenda days={days} groups={groups} today={today} detailed={view === "day"} onOpen={setOpen} className="p-5" />
        )}
      </div>

      <DeadlineModal deadline={open} today={today} onClose={() => setOpen(null)} onMoved={onMoved} />
    </div>
  );
}
