"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { CheckboxField, NumberInput, SelectInput, TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import {
  archiveTourOption,
  createTourOption,
  createTourSeason,
  deleteTourSeason,
  updateTourOption,
  updateTourSeason,
  type TourSeasonInput,
} from "@/lib/api/tours";
import { describeError } from "@/lib/api/client";
import {
  confirmationModeLabels,
  optionKindLabels,
  pricingBasisLabels,
  scheduleKindLabels,
} from "@/lib/admin/tours";
import { formatMoney, toMajorUnits, toMinorUnits } from "@/lib/money";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { CancellationPolicy } from "@/types/catalogue";
import type {
  ConfirmationMode,
  Tour,
  TourOption,
  TourOptionKind,
  TourPricingBasis,
  TourScheduleKind,
  TourSeason,
  TourVisibility,
} from "@/types/tour";

/**
 * Options and their price sheets, edited in place.
 *
 * An option is *what* is sold — a shared seat or a private car, per person or
 * per group, confirmed instantly or by the operator. A season is *what it
 * costs* over a date range, in tiers by party size. Departures (how many can
 * be sold on a date) live on the calendar screen.
 *
 * Every mutation calls the API and then `router.refresh()`; the page above is
 * a Server Component and re-reading beats patching a local copy.
 */

const field =
  "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";
const button =
  "inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TourOptionsManager({
  tour,
  policies,
}: {
  tour: Tour;
  policies: CancellationPolicy[];
}) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write", "tours.write");
  const [error, setError] = useState<string | null>(null);

  const useAction = () => {
    const [busy, setBusy] = useState(false);

    const run = async (call: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await call();
        router.refresh();
        return true;
      } catch (caught) {
        setError(describeError(caught));
        return false;
      } finally {
        setBusy(false);
      }
    };

    return { busy, run };
  };

  const live = tour.options.filter((option) => option.status !== "ARCHIVED");

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="rounded-sm border border-error/40 bg-error/8 px-4 py-3 text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}

      {live.map((option) => (
        <OptionCard
          key={option.id}
          tour={tour}
          option={option}
          policies={policies}
          useAction={useAction}
          canEdit={canEdit}
        />
      ))}

      {canEdit ? (
        <OptionForm tour={tour} policies={policies} useAction={useAction} />
      ) : (
        <ReadOnlyNote
          needs={["catalogue.write", "tours.write"]}
          what="Editing options and price sheets"
        />
      )}
    </div>
  );
}

type ActionHook = () => { busy: boolean; run: (call: () => Promise<unknown>) => Promise<boolean> };

function OptionCard({
  tour,
  option,
  policies,
  useAction,
  canEdit,
}: {
  tour: Tour;
  option: TourOption;
  policies: CancellationPolicy[];
  useAction: ActionHook;
  /** Whether the viewer may change options and price sheets; a reader keeps the Departures link only. */
  canEdit: boolean;
}) {
  const localePath = useLocalePath();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [addingSeason, setAddingSeason] = useState(false);
  const [editingSeason, setEditingSeason] = useState<TourSeason | null>(null);
  const seasons = option.seasons ?? [];

  return (
    <AdminPanel
      title={`${option.name} · ${option.code}`}
      description={`${optionKindLabels[option.kind]} · ${pricingBasisLabels[option.pricingBasis]} · ${scheduleKindLabels[option.scheduleKind]} · ${confirmationModeLabels[option.confirmationMode]} · ${option.minPax}–${option.maxPax} pax · ${option.visibility === "PARTNER_ONLY" ? "partners only" : "public"} · ${option.status === "INACTIVE" ? "off sale" : "on sale"}`}
      action={
        <div className="flex items-center gap-3">
          <Link
            href={localePath(`/admin/tours/${tour.id}/departures?option=${option.id}`)}
            className="text-[0.8125rem] font-medium text-brand-text hover:text-brand-hover"
          >
            Departures
          </Link>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setEditing((open) => !open)}
                className="text-[0.8125rem] font-medium text-ink hover:underline"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Archive ${option.name}? Its bookings stay readable.`)) {
                    void run(() => archiveTourOption(tour.id, option.id));
                  }
                }}
                className="text-[0.8125rem] font-medium text-error-text hover:underline"
              >
                Archive
              </button>
            </>
          )}
        </div>
      }
      bodyClassName="p-0"
    >
      {editing && (
        <OptionForm
          tour={tour}
          option={option}
          policies={policies}
          useAction={useAction}
          onDone={() => setEditing(false)}
        />
      )}

      <ul className="divide-y divide-line">
        {seasons.length === 0 && (
          <li className="px-5 py-4 text-[0.8125rem] text-muted">
            Not priced yet — it needs at least one price sheet before a departure can be sold.
          </li>
        )}
        {seasons.map((season) => (
          <li key={season.id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[0.875rem] font-medium text-ink">
                  {season.name}
                  {!season.isActive && <span className="ms-2 text-[0.75rem] text-muted">(inactive)</span>}
                </p>
                <p className="text-[0.75rem] text-muted">
                  {season.validFrom} – {season.validUntil}
                  {season.weekdays.length > 0 && ` · ${season.weekdays.map((day) => WEEKDAYS[day - 1]).join(" ")}`}
                  {season.priority > 0 && ` · priority ${season.priority}`} · {season.currency}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingSeason(editingSeason?.id === season.id ? null : season)}
                    className="text-[0.8125rem] font-medium text-ink hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete the "${season.name}" price sheet?`)) {
                        void run(() => deleteTourSeason(tour.id, option.id, season.id));
                      }
                    }}
                    aria-label={`Delete ${season.name}`}
                    className="text-subtle hover:text-error-text"
                  >
                    <X size={15} aria-hidden />
                  </button>
                </div>
              )}
            </div>

            {/* Scrolls inside the panel on a narrow screen rather than widening the page. */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[0.75rem]">
                <thead>
                  <tr className="text-start text-muted">
                    <th scope="col" className="py-1 text-start font-medium">Party</th>
                    {option.pricingBasis === "PER_PERSON" ? (
                      <>
                        <th scope="col" className="py-1 text-end font-medium">Adult net</th>
                        <th scope="col" className="py-1 text-end font-medium">Child net</th>
                        <th scope="col" className="py-1 text-end font-medium">Infant net</th>
                      </>
                    ) : (
                      <th scope="col" className="py-1 text-end font-medium">Group net</th>
                    )}
                    <th scope="col" className="py-1 text-end font-medium">Fixed sell</th>
                  </tr>
                </thead>
                <tbody>
                  {season.tiers.map((tier) => (
                    <tr key={tier.id} className="border-t border-line tabular-nums">
                      <td className="py-1.5">
                        {tier.minPax}
                        {tier.maxPax === null ? "+" : tier.maxPax === tier.minPax ? "" : `–${tier.maxPax}`}
                      </td>
                      {option.pricingBasis === "PER_PERSON" ? (
                        <>
                          <td className="py-1.5 text-end">{money(tier.adultNetCents, season.currency)}</td>
                          <td className="py-1.5 text-end">{money(tier.childNetCents, season.currency)}</td>
                          <td className="py-1.5 text-end">{money(tier.infantNetCents ?? 0, season.currency)}</td>
                        </>
                      ) : (
                        <td className="py-1.5 text-end">{money(tier.groupNetCents, season.currency)}</td>
                      )}
                      <td className="py-1.5 text-end text-muted">
                        {option.pricingBasis === "PER_PERSON"
                          ? money(tier.adultSellCents, season.currency)
                          : money(tier.groupSellCents, season.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {editingSeason?.id === season.id && (
              <SeasonForm
                tour={tour}
                option={option}
                season={season}
                useAction={useAction}
                onDone={() => setEditingSeason(null)}
              />
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => setAddingSeason((open) => !open)}
            className={cn(button, "border border-ink/20 text-ink hover:border-ink hover:bg-surface-soft")}
          >
            <Plus size={14} aria-hidden />
            Price sheet
          </button>
        </div>
      )}

      {canEdit && addingSeason && (
        <SeasonForm tour={tour} option={option} useAction={useAction} onDone={() => setAddingSeason(false)} />
      )}
    </AdminPanel>
  );
}

const money = (cents: number | null | undefined, currency: string) =>
  cents === null || cents === undefined ? "—" : formatMoney(cents, currency, "en-GB", { maximumFractionDigits: 0 });

/** Creating an option, or editing one in place. */
function OptionForm({
  tour,
  option,
  policies,
  useAction,
  onDone,
}: {
  tour: Tour;
  option?: TourOption;
  policies: CancellationPolicy[];
  useAction: ActionHook;
  onDone?: () => void;
}) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(Boolean(option) || tour.options.length === 0);
  const [code, setCode] = useState(option?.code ?? "");
  const [name, setName] = useState(option?.name ?? "");
  const [kind, setKind] = useState<TourOptionKind>(option?.kind ?? "SHARED");
  const [pricingBasis, setPricingBasis] = useState<TourPricingBasis>(option?.pricingBasis ?? "PER_PERSON");
  const [scheduleKind, setScheduleKind] = useState<TourScheduleKind>(option?.scheduleKind ?? "ON_DEMAND");
  const [confirmationMode, setConfirmationMode] = useState<ConfirmationMode>(option?.confirmationMode ?? "INSTANT");
  const [visibility, setVisibility] = useState<TourVisibility>(option?.visibility ?? "PUBLIC");
  const [minPax, setMinPax] = useState(option?.minPax ?? 1);
  const [maxPax, setMaxPax] = useState(option?.maxPax ?? 8);
  const [startTime, setStartTime] = useState(option?.startTime ?? "");
  const [languages, setLanguages] = useState((option?.languages ?? ["en"]).join(", "));
  const [weekdays, setWeekdays] = useState<number[]>(option?.operatesOnWeekdays ?? []);
  const [noticeHours, setNoticeHours] = useState(option?.noticeHours ?? 24);
  const [horizonDays, setHorizonDays] = useState(option?.horizonDays ?? 365);
  const [policyId, setPolicyId] = useState(option?.cancellation?.id ?? policies[0]?.id ?? "");
  const [active, setActive] = useState(option ? option.status === "ACTIVE" : true);

  if (!open && !option) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(button, "self-start border border-dashed border-ink/30 text-ink hover:border-ink")}
      >
        <Plus size={14} aria-hidden />
        Add an option
      </button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const body = {
      code: code.trim(),
      name: name.trim(),
      kind,
      pricingBasis,
      unitKind: kind === "PRIVATE" ? "GROUP" : "SEAT",
      scheduleKind,
      confirmationMode,
      visibility,
      minPax,
      maxPax,
      startTime: startTime || null,
      languages: languages
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      operatesOnWeekdays: weekdays,
      noticeHours,
      horizonDays,
      cancellationPolicyId: policyId,
      ...(option ? { status: active ? "ACTIVE" : "INACTIVE" } : {}),
    };

    const ok = await run(() =>
      option ? updateTourOption(tour.id, option.id, body) : createTourOption(tour.id, body),
    );
    if (ok) {
      setOpen(false);
      onDone?.();
    }
  };

  return (
    <form onSubmit={submit} className="border-t border-line bg-surface-soft/40 p-5">
      <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-muted uppercase">
        {option ? "Edit option" : "New option"}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput
          label="Code"
          mono
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toLowerCase())}
          hint="Lower-case, stable — “shared”, “private”."
        />
        <SelectInput
          label="Kind"
          value={kind}
          onChange={(e) => {
            const next = e.target.value as TourOptionKind;
            setKind(next);
            setPricingBasis(next === "PRIVATE" ? "PER_GROUP" : "PER_PERSON");
          }}
          options={(["SHARED", "PRIVATE"] as TourOptionKind[]).map((value) => ({ value, label: optionKindLabels[value] }))}
          hint="A shared option sells seats; a private one sells the whole group."
        />
        <SelectInput
          label="Priced"
          value={pricingBasis}
          onChange={(e) => setPricingBasis(e.target.value as TourPricingBasis)}
          options={(["PER_PERSON", "PER_GROUP"] as TourPricingBasis[]).map((value) => ({ value, label: pricingBasisLabels[value] }))}
        />
        <SelectInput
          label="Runs"
          value={scheduleKind}
          onChange={(e) => setScheduleKind(e.target.value as TourScheduleKind)}
          options={(["SCHEDULED", "ON_DEMAND"] as TourScheduleKind[]).map((value) => ({ value, label: scheduleKindLabels[value] }))}
          hint="Only decides how departures are generated in bulk."
        />
        <SelectInput
          label="Confirmation"
          value={confirmationMode}
          onChange={(e) => setConfirmationMode(e.target.value as ConfirmationMode)}
          options={(["INSTANT", "ON_REQUEST"] as ConfirmationMode[]).map((value) => ({ value, label: confirmationModeLabels[value] }))}
          hint="On request: the booking waits for you, with its seats already claimed."
        />
        <SelectInput
          label="Visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as TourVisibility)}
          options={[
            { value: "PUBLIC", label: "Public" },
            { value: "PARTNER_ONLY", label: "Partners only" },
          ]}
        />
        <NumberInput label="Smallest party" min={1} max={500} value={minPax} onChange={(e) => setMinPax(Number(e.target.value) || 1)} />
        <NumberInput label="Largest party" min={1} max={500} value={maxPax} onChange={(e) => setMaxPax(Number(e.target.value) || 1)} />
        <TextInput label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <TextInput
          label="Languages"
          value={languages}
          onChange={(e) => setLanguages(e.target.value)}
          hint="ISO codes, comma-separated: en, ka, ru."
        />
        <SelectInput
          label="Cancellation terms"
          required
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          placeholder="Choose…"
          options={policies.map((policy) => ({ value: policy.id, label: policy.name }))}
          hint="Platform templates priced against the whole total."
        />
        <NumberInput label="Notice (hours)" min={0} max={1440} value={noticeHours} onChange={(e) => setNoticeHours(Number(e.target.value) || 0)} />
        <NumberInput label="Horizon (days)" min={1} max={730} value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value) || 1)} />
        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className="block text-[0.75rem] font-semibold text-muted">Operates on</legend>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {WEEKDAYS.map((label, index) => {
              const value = index + 1;
              const on = weekdays.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWeekdays((current) => (on ? current.filter((d) => d !== value) : [...current, value].sort()))}
                  className={cn(
                    "h-9 rounded-sm border px-2 text-[0.75rem] font-medium transition-colors",
                    on ? "border-brand bg-brand text-white" : "border-line text-muted hover:border-ink hover:text-ink",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[0.6875rem] text-muted">None selected means every day. The bulk departure editor defaults to these.</p>
        </fieldset>
        {option && (
          <CheckboxField label="On sale" checked={active} onChange={setActive} hint="Off sale keeps the option and its bookings but sells nothing." />
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy || !policyId} className={cn(button, "bg-brand text-white hover:bg-brand-hover")}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {option ? "Save option" : "Create option"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onDone?.();
          }}
          className={cn(button, "border border-ink/20 text-ink hover:border-ink")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface TierDraft {
  minPax: string;
  maxPax: string;
  adult: string;
  child: string;
  infant: string;
  group: string;
  sell: string;
}

const tierFromSeason = (tier: TourSeason["tiers"][number], currency: string): TierDraft => ({
  minPax: String(tier.minPax),
  maxPax: tier.maxPax === null ? "" : String(tier.maxPax),
  adult: toMajorUnits(tier.adultNetCents, currency),
  child: toMajorUnits(tier.childNetCents, currency),
  infant: toMajorUnits(tier.infantNetCents ?? 0, currency),
  group: toMajorUnits(tier.groupNetCents, currency),
  sell: toMajorUnits(tier.adultSellCents ?? tier.groupSellCents, currency),
});

/** A price sheet, written whole with its tiers. */
function SeasonForm({
  tour,
  option,
  season,
  useAction,
  onDone,
}: {
  tour: Tour;
  option: TourOption;
  season?: TourSeason;
  useAction: ActionHook;
  onDone: () => void;
}) {
  const { busy, run } = useAction();
  const currency = tour.currency;
  const perPerson = option.pricingBasis === "PER_PERSON";
  const [name, setName] = useState(season?.name ?? "Standard");
  const [validFrom, setValidFrom] = useState(season?.validFrom ?? new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(season?.validUntil ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(season?.weekdays ?? []);
  const [priority, setPriority] = useState(season?.priority ?? 0);
  const [isActive, setIsActive] = useState(season?.isActive ?? true);
  const [tiers, setTiers] = useState<TierDraft[]>(
    season && season.tiers.length > 0
      ? season.tiers.map((tier) => tierFromSeason(tier, currency))
      : [{ minPax: "1", maxPax: "", adult: "", child: "", infant: "0", group: "", sell: "" }],
  );
  const [problem, setProblem] = useState<string | null>(null);

  const setTier = (index: number, patch: Partial<TierDraft>) =>
    setTiers((current) => current.map((tier, at) => (at === index ? { ...tier, ...patch } : tier)));

  const cents = (value: string) => (value.trim() === "" ? null : toMinorUnits(value, currency));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);

    const body: TourSeasonInput = {
      name: name.trim(),
      validFrom,
      validUntil,
      weekdays,
      priority,
      currency,
      isActive,
      tiers: tiers.map((tier) => {
        const sell = cents(tier.sell);
        return {
          minPax: Number(tier.minPax) || 1,
          maxPax: tier.maxPax.trim() === "" ? null : Number(tier.maxPax),
          ...(perPerson
            ? {
                adultNetCents: cents(tier.adult),
                childNetCents: cents(tier.child),
                infantNetCents: cents(tier.infant) ?? 0,
                adultSellCents: sell,
              }
            : { groupNetCents: cents(tier.group), groupSellCents: sell }),
        };
      }),
    };

    if (body.tiers.some((tier) => (perPerson ? tier.adultNetCents === null : tier.groupNetCents === null))) {
      setProblem(perPerson ? "Every tier needs an adult net price." : "Every tier needs a group net price.");
      return;
    }

    const ok = await run(() =>
      season
        ? updateTourSeason(tour.id, option.id, season.id, body)
        : createTourSeason(tour.id, option.id, body),
    );
    if (ok) onDone();
  };

  return (
    <form onSubmit={submit} className="mt-4 rounded-sm border border-line bg-surface-soft/40 p-4">
      <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-muted uppercase">
        {season ? "Edit price sheet" : "New price sheet"} · net in {currency}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput label="From" type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        <TextInput label="Until" type="date" required value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        <NumberInput
          label="Priority"
          min={0}
          max={1000}
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value) || 0)}
          hint="Higher wins where sheets overlap — a festival week over the season."
        />
        <fieldset className="sm:col-span-2">
          <legend className="block text-[0.75rem] font-semibold text-muted">Days</legend>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {WEEKDAYS.map((label, index) => {
              const value = index + 1;
              const on = weekdays.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWeekdays((current) => (on ? current.filter((d) => d !== value) : [...current, value].sort()))}
                  className={cn(
                    "h-9 rounded-sm border px-2 text-[0.75rem] font-medium transition-colors",
                    on ? "border-brand bg-brand text-white" : "border-line text-muted hover:border-ink hover:text-ink",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[0.6875rem] text-muted">None selected means every day.</p>
        </fieldset>
        <CheckboxField label="Active" checked={isActive} onChange={setIsActive} className="self-end" />
      </div>

      {/* Six fixed-width inputs a row (~620px): scroll here, not the page. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[0.75rem]">
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 text-start font-medium">From pax</th>
              <th scope="col" className="py-1 text-start font-medium">To pax</th>
              {perPerson ? (
                <>
                  <th scope="col" className="py-1 text-start font-medium">Adult net</th>
                  <th scope="col" className="py-1 text-start font-medium">Child net</th>
                  <th scope="col" className="py-1 text-start font-medium">Infant net</th>
                </>
              ) : (
                <th scope="col" className="py-1 text-start font-medium">Group net</th>
              )}
              <th scope="col" className="py-1 text-start font-medium">Fixed sell</th>
              <th scope="col" className="py-1" />
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, index) => (
              <tr key={index} className="border-t border-line">
                <td className="py-1.5 pe-2">
                  <input type="number" min={1} max={500} required value={tier.minPax} onChange={(e) => setTier(index, { minPax: e.target.value })} className={cn(field, "w-20 text-end tabular-nums")} />
                </td>
                <td className="py-1.5 pe-2">
                  <input type="number" min={1} max={500} placeholder="∞" value={tier.maxPax} onChange={(e) => setTier(index, { maxPax: e.target.value })} className={cn(field, "w-20 text-end tabular-nums")} />
                </td>
                {perPerson ? (
                  <>
                    <td className="py-1.5 pe-2"><input inputMode="decimal" value={tier.adult} onChange={(e) => setTier(index, { adult: e.target.value })} className={cn(field, "w-24 text-end tabular-nums")} /></td>
                    <td className="py-1.5 pe-2"><input inputMode="decimal" value={tier.child} onChange={(e) => setTier(index, { child: e.target.value })} className={cn(field, "w-24 text-end tabular-nums")} /></td>
                    <td className="py-1.5 pe-2"><input inputMode="decimal" value={tier.infant} onChange={(e) => setTier(index, { infant: e.target.value })} className={cn(field, "w-24 text-end tabular-nums")} /></td>
                  </>
                ) : (
                  <td className="py-1.5 pe-2"><input inputMode="decimal" value={tier.group} onChange={(e) => setTier(index, { group: e.target.value })} className={cn(field, "w-28 text-end tabular-nums")} /></td>
                )}
                <td className="py-1.5 pe-2"><input inputMode="decimal" placeholder="markup" value={tier.sell} onChange={(e) => setTier(index, { sell: e.target.value })} className={cn(field, "w-24 text-end tabular-nums")} /></td>
                <td className="py-1.5">
                  <button
                    type="button"
                    disabled={tiers.length === 1}
                    onClick={() => setTiers((current) => current.filter((_, at) => at !== index))}
                    aria-label="Remove tier"
                    className="text-subtle hover:text-error-text disabled:opacity-30"
                  >
                    <X size={14} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[0.6875rem] text-muted">
        A blank “fixed sell” means the buyer’s markup applies. A child priced blank is charged the adult rate.
      </p>

      {problem && <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">{problem}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            setTiers((current) => [
              ...current,
              { minPax: String((Number(current.at(-1)?.maxPax) || Number(current.at(-1)?.minPax) || 0) + 1), maxPax: "", adult: "", child: "", infant: "0", group: "", sell: "" },
            ])
          }
          className={cn(button, "border border-ink/20 text-ink hover:border-ink")}
        >
          <Plus size={14} aria-hidden />
          Tier
        </button>
        <button type="submit" disabled={busy || !validUntil} className={cn(button, "bg-brand text-white hover:bg-brand-hover")}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {season ? "Save price sheet" : "Create price sheet"}
        </button>
        <button type="button" onClick={onDone} className={cn(button, "border border-ink/20 text-ink hover:border-ink")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
