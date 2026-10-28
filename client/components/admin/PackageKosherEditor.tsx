"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Loader2, ShieldOff } from "lucide-react";

import {
  CheckboxField,
  FormError,
  NumberInput,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "./FormControls";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import { overridePackageKosher, removePackageKosher, setPackageKosher } from "@/lib/api/packages";
import { shabbatModeLabels } from "@/lib/admin/packages";
import { cn } from "@/lib/utils";
import type {
  KosherCertificationScope,
  KosherServiceLevel,
} from "@/types/catalogue";
import type { KosherFinding, PackageWithChecklist, ShabbatMode } from "@/types/package";

const LEVELS: KosherServiceLevel[] = [
  "NONE",
  "ON_REQUEST",
  "KOSHER_FRIENDLY",
  "PARTIAL",
  "FULL",
];
const SCOPES: KosherCertificationScope[] = ["PROPERTY", "KITCHEN", "RESTAURANT", "PASSOVER"];
const MEAL_CODES = ["RO", "BB", "HB", "HB_PLUS", "FB", "FB_PLUS", "AI", "UAI"];
const MODES: ShabbatMode[] = ["SOLAR", "FIXED_HOURS", "NONE"];

/**
 * The kosher profile, and the override that sells past a blocker.
 *
 * Creating the profile is the switch: a package without one shows no kosher
 * anything, matches no kosher filter and is judged by no kosher rule. That is
 * the same convention the hotel module uses, and it is why "remove" is a real
 * action here rather than a checkbox that leaves a dormant record behind.
 *
 * Saving re-validates against live hotel data, so a template naming a hotel
 * whose certificate lapsed answers 422 with the slots at fault. The override
 * exists for the case an operator has checked by hand and accepts — it is
 * dated and audited, never silent.
 */
export function PackageKosherEditor({ pkg }: { pkg: PackageWithChecklist }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");
  const profile = pkg.kosherProfile;

  const [minServiceLevel, setMinServiceLevel] = useState<KosherServiceLevel>(
    profile?.minServiceLevel ?? "FULL",
  );
  const [certifiedRequired, setCertifiedRequired] = useState(profile?.certifiedRequired ?? true);
  const [scopes, setScopes] = useState<KosherCertificationScope[]>(
    profile?.certificationScopes ?? ["PROPERTY", "KITCHEN"],
  );
  const [requireThroughStay, setRequireThroughStay] = useState(
    profile?.requireCertValidThroughStay ?? true,
  );
  const [mealCodes, setMealCodes] = useState<string[]>(profile?.requiredMealPlanCodes ?? []);
  const [requestCodes, setRequestCodes] = useState((profile?.hotelRequestCodes ?? []).join(", "));
  const [shabbatMode, setShabbatMode] = useState<ShabbatMode>(profile?.shabbatMode ?? "SOLAR");
  const [fixedStart, setFixedStart] = useState(profile?.shabbatFixedStart ?? "");
  const [fixedEnd, setFixedEnd] = useState(profile?.shabbatFixedEnd ?? "");
  const [candle, setCandle] = useState(profile?.candleLightingOffsetMin ?? 18);
  const [havdalah, setHavdalah] = useState(profile?.havdalahOffsetMin ?? 42);
  const [noTransfers, setNoTransfers] = useState(profile?.noTransfersInShabbat ?? true);
  const [noTours, setNoTours] = useState(profile?.noToursOnShabbat ?? true);
  const [authority, setAuthority] = useState(profile?.supervisionAuthority ?? "");
  const [notes, setNotes] = useState(profile?.notes ?? "");

  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<KosherFinding[]>([]);

  const [overrideUntil, setOverrideUntil] = useState(pkg.kosherOverrideUntil ?? "");
  const [overrideReason, setOverrideReason] = useState("");

  const dirty = () => {
    setSaved(false);
    setBlockers([]);
  };

  const toggleIn = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  const save = async () => {
    setBusy("save");
    setError(null);
    setBlockers([]);

    try {
      await setPackageKosher(pkg.id, {
        minServiceLevel,
        certifiedRequired,
        certificationScopes: scopes,
        requireCertValidThroughStay: requireThroughStay,
        requiredMealPlanCodes: mealCodes as never,
        hotelRequestCodes: requestCodes
          .split(/[,\s]+/)
          .map((code) => code.trim())
          .filter(Boolean),
        shabbatMode,
        shabbatFixedStart: shabbatMode === "FIXED_HOURS" ? fixedStart || null : null,
        shabbatFixedEnd: shabbatMode === "FIXED_HOURS" ? fixedEnd || null : null,
        candleLightingOffsetMin: candle,
        havdalahOffsetMin: havdalah,
        noTransfersInShabbat: noTransfers,
        noToursOnShabbat: noTours,
        supervisionAuthority: authority.trim() || null,
        notes: notes.trim() || null,
      });

      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        const details = caught.details as { blockers?: KosherFinding[] } | undefined;

        if (details?.blockers?.length) {
          setBlockers(details.blockers);
          setError("The template cannot meet these requirements as it stands.");
          return;
        }
      }

      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);

    try {
      await removePackageKosher(pkg.id);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const override = async () => {
    setBusy("override");
    setError(null);

    try {
      await overridePackageKosher(pkg.id, {
        until: overrideUntil,
        reason: overrideReason.trim(),
      });
      setOverrideReason("");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const chip = (active: boolean) =>
    cn(
      "h-8 rounded-sm border px-2.5 text-[0.75rem] font-medium transition-colors",
      active
        ? "border-brand bg-brand-soft text-brand-text"
        : "border-line text-muted hover:border-ink hover:text-ink",
    );

  return (
    <div className="flex flex-col gap-8">
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectInput
          label="Minimum hotel standard"
          hint="A hotel below this cannot fill a stay slot."
          value={minServiceLevel}
          options={LEVELS.map((level) => ({ value: level, label: level }))}
          onChange={(event) => {
            dirty();
            setMinServiceLevel(event.target.value as KosherServiceLevel);
          }}
        />
        <TextInput
          label="Supervision"
          hint="The authority named on the voucher, if there is one."
          value={authority}
          onChange={(event) => {
            dirty();
            setAuthority(event.target.value);
          }}
        />
        <TextInput
          label="Hotel request codes"
          hint="Attached to every stay in this package, e.g. shabbatKeyAccess."
          mono
          value={requestCodes}
          onChange={(event) => {
            dirty();
            setRequestCodes(event.target.value);
          }}
        />
      </div>

      <fieldset>
        <legend className="text-[0.8125rem] font-semibold text-ink">Certification</legend>
        <div className="mt-3 flex flex-col gap-3">
          <CheckboxField
            label="A certified kitchen is required"
            hint="Unverified or lapsed certificates do not count."
            checked={certifiedRequired}
            onChange={(next) => {
              dirty();
              setCertifiedRequired(next);
            }}
          />
          <CheckboxField
            label="The certificate must stay valid through the whole stay"
            hint="Otherwise a certificate expiring mid-stay is only a warning."
            checked={requireThroughStay}
            onChange={(next) => {
              dirty();
              setRequireThroughStay(next);
            }}
          />
          {certifiedRequired && (
            <div>
              <span className="block text-[0.75rem] font-semibold text-muted">Scopes</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={chip(scopes.includes(scope))}
                    onClick={() => {
                      dirty();
                      setScopes(toggleIn(scopes, scope));
                    }}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <span className="block text-[0.75rem] font-semibold text-muted">Required board</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MEAL_CODES.map((code) => (
                <button
                  key={code}
                  type="button"
                  className={chip(mealCodes.includes(code))}
                  onClick={() => {
                    dirty();
                    setMealCodes(toggleIn(mealCodes, code));
                  }}
                >
                  {code}
                </button>
              ))}
            </div>
            <span className="mt-1.5 block text-[0.75rem] text-subtle">
              None selected allows any board the hotel offers.
            </span>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[0.8125rem] font-semibold text-ink">Shabbat</legend>
        <p className="mt-1 text-[0.75rem] text-subtle">
          Solar is the default because fixed hours are wrong by up to two hours across the year at
          Georgia&rsquo;s latitude. Times are computed from the hotel&rsquo;s own coordinates.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <SelectInput
            label="Mode"
            value={shabbatMode}
            options={MODES.map((mode) => ({ value: mode, label: shabbatModeLabels[mode] }))}
            onChange={(event) => {
              dirty();
              setShabbatMode(event.target.value as ShabbatMode);
            }}
          />
          {shabbatMode === "SOLAR" && (
            <>
              <NumberInput
                label="Candle lighting (min before sunset)"
                min={0}
                max={120}
                value={candle}
                onChange={(event) => {
                  dirty();
                  setCandle(Number(event.target.value));
                }}
              />
              <NumberInput
                label="Havdalah (min after sunset)"
                min={0}
                max={180}
                value={havdalah}
                onChange={(event) => {
                  dirty();
                  setHavdalah(Number(event.target.value));
                }}
              />
            </>
          )}
          {shabbatMode === "FIXED_HOURS" && (
            <>
              <TextInput
                label="Starts"
                placeholder="18:30"
                value={fixedStart}
                onChange={(event) => {
                  dirty();
                  setFixedStart(event.target.value);
                }}
              />
              <TextInput
                label="Ends"
                placeholder="20:15"
                value={fixedEnd}
                onChange={(event) => {
                  dirty();
                  setFixedEnd(event.target.value);
                }}
              />
            </>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <CheckboxField
            label="No transfers during Shabbat"
            checked={noTransfers}
            onChange={(next) => {
              dirty();
              setNoTransfers(next);
            }}
          />
          <CheckboxField
            label="No tours on Shabbat or a festival"
            hint="A tour whose own profile says it operates on Shabbat is still allowed."
            checked={noTours}
            onChange={(next) => {
              dirty();
              setNoTours(next);
            }}
          />
        </div>
      </fieldset>

      <TextArea
        label="Notes"
        hint="Internal. Not shown to a buyer."
        rows={3}
        value={notes}
        onChange={(event) => {
          dirty();
          setNotes(event.target.value);
        }}
      />
      </fieldset>

      {blockers.length > 0 && (
        <div className="rounded-sm border border-error/40 bg-error/5 p-4">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-error-text">
            <AlertTriangle size={14} aria-hidden />
            The template cannot meet these requirements
          </p>
          <ul className="mt-2 space-y-1.5">
            {blockers.map((finding, index) => (
              // A code repeats across slots, so it is not a key on its own.
              <li
                key={`${finding.code}-${finding.slotIndex ?? index}`}
                className="text-[0.8125rem] text-body"
              >
                · {finding.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <FormError message={error} />

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton busy={busy === "save"} saved={saved} onClick={() => void save()}>
            {profile ? "Save kosher profile" : "Make this a kosher package"}
          </SubmitButton>

          {profile && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void remove()}
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-line px-4 text-[0.8125rem] font-semibold text-muted transition-colors hover:border-error hover:text-error-text disabled:opacity-50"
            >
              {busy === "remove" ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <ShieldOff size={15} aria-hidden />
              )}
              Remove kosher profile
            </button>
          )}
        </div>
      ) : (
        <ReadOnlyNote needs="catalogue.write" what="Changing the kosher profile or its override" />
      )}

      {profile && (
        <fieldset className="border-t border-line pt-6">
          <legend className="sr-only">Override</legend>
          <p className="text-[0.8125rem] font-semibold text-ink">Override</p>
          <p className="mt-1 text-[0.75rem] text-subtle">
            Sells past a blocker until a date, for a case checked by hand. Recorded in the audit
            log with the reason, and shown to the buyer as an approved exception.
            {pkg.kosherOverrideUntil && (
              <>
                {" "}
                Currently overridden until <strong>{pkg.kosherOverrideUntil}</strong>.
              </>
            )}
          </p>
          {/* The current override reads above for everyone; recording one is
              a write and goes with the capability. */}
          {canEdit && (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <TextInput
                  label="Until"
                  type="date"
                  value={overrideUntil}
                  onChange={(event) => setOverrideUntil(event.target.value)}
                />
                <TextInput
                  label="Reason"
                  className="sm:col-span-2"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={busy !== null || !overrideUntil || overrideReason.trim().length === 0}
                onClick={() => void override()}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft disabled:opacity-50"
              >
                {busy === "override" && <Loader2 size={15} className="animate-spin" aria-hidden />}
                Record override
              </button>
            </>
          )}
        </fieldset>
      )}
    </div>
  );
}
