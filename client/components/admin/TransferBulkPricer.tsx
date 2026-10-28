"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, Check, Coins } from "lucide-react";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { describeError } from "@/lib/api/client";
import { bulkPriceTransferRoutes } from "@/lib/api/transfers";
import { categoryOptions, tierOptions } from "@/lib/admin/transfers";
import { toMinorUnits } from "@/lib/money";
import type { TransferRouteCategory, TransferRouteTier, TransferVehicle } from "@/types/transfer";

/**
 * Repricing many routes at once.
 *
 * With three hundred and ninety-six routes and nine classes there are over
 * three thousand fares, and pricing them one cell at a time is not a workflow.
 * This applies either a per-kilometre rate or a flat fare across everything
 * matching a filter.
 *
 * Three things make it safe to put in a panel:
 *
 *   * **A filter is required.** There is no "everything" option, here or in the
 *     API, because a mis-clicked repricing of the whole catalogue is not
 *     recoverable from this screen.
 *   * **Gaps only, by default.** `overwrite` is off, so the ordinary use fills
 *     in unpriced routes and leaves every figure somebody has already set.
 *     Turning it on is a deliberate second action.
 *   * **It reports what it did.** Written and kept are both shown, so an
 *     operator can tell a no-op from a change.
 *
 * A write to the transfer catalogue, so `catalogue.write` on the server; the
 * whole panel is an action, and a viewer without it is shown nothing here.
 */
export function TransferBulkPricer({ vehicles }: { vehicles: TransferVehicle[] }) {
  const router = useRouter();
  const can = useCan();

  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<TransferRouteTier | "">("");
  const [category, setCategory] = useState<TransferRouteCategory | "">("");
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"perKm" | "flat">("perKm");
  const [amount, setAmount] = useState("");
  const [minimum, setMinimum] = useState("");
  const [overwrite, setOverwrite] = useState(false);

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ routes: number; written: number; kept: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const toggleVehicle = (id: string) =>
    setVehicleIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  const ready = Boolean((tier || category) && vehicleIds.length > 0 && amount.trim());

  if (!can("catalogue.write")) return null;

  const apply = async () => {
    setSaving(true);
    setError(null);
    setResult(null);

    const cents = toMinorUnits(amount);

    if (cents === null || cents <= 0) {
      setError("Enter an amount in lari.");
      setSaving(false);
      return;
    }

    try {
      const outcome = await bulkPriceTransferRoutes({
        ...(tier ? { tier } : {}),
        ...(category ? { category } : {}),
        vehicleIds,
        ...(mode === "perKm" ? { perKmCents: cents } : { flatCents: cents }),
        ...(minimum.trim() ? { minimumCents: toMinorUnits(minimum) ?? undefined } : {}),
        overwrite,
      });

      setResult(outcome);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not apply the prices."));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/25 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft"
      >
        <Coins size={15} aria-hidden />
        Reprice in bulk
      </button>
    );
  }

  const fieldClass =
    "h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none";
  const labelClass = "mb-1.5 block text-[0.75rem] font-semibold text-muted";

  return (
    <section className="rounded-sm border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[0.9375rem] font-semibold text-ink">Reprice in bulk</h2>
          <p className="mt-1 text-[0.8125rem] text-muted">
            Applies to every route matching the filter. Name at least a tier or a category.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[0.8125rem] text-muted underline-offset-4 hover:underline"
        >
          Close
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className={labelClass}>Tier</span>
          <select
            value={tier}
            onChange={(event) => setTier(event.target.value as TransferRouteTier | "")}
            className={fieldClass}
          >
            <option value="">Any tier</option>
            {tierOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={labelClass}>Category</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as TransferRouteCategory | "")}
            className={fieldClass}
          >
            <option value="">Any category</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={labelClass}>Charge</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "perKm" | "flat")}
            className={fieldClass}
          >
            <option value="perKm">Per kilometre</option>
            <option value="flat">Flat fare</option>
          </select>
        </label>

        <label>
          <span className={labelClass}>
            {mode === "perKm" ? "Rate per km (GEL)" : "Fare (GEL)"}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={`${fieldClass} text-end tabular-nums`}
          />
        </label>
      </div>

      {mode === "perKm" && (
        <label className="mt-4 block max-w-56">
          <span className={labelClass}>Floor (GEL, optional)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="No floor"
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
            className={`${fieldClass} text-end tabular-nums`}
          />
          <span className="mt-1.5 block text-[0.75rem] text-subtle">
            Stops a short route being priced at almost nothing.
          </span>
        </label>
      )}

      <fieldset className="mt-5">
        <legend className={labelClass}>Vehicle classes</legend>
        <div className="flex flex-wrap gap-2">
          {vehicles.map((vehicle) => {
            const selected = vehicleIds.includes(vehicle.id);

            return (
              <button
                key={vehicle.id}
                type="button"
                onClick={() => toggleVehicle(vehicle.id)}
                aria-pressed={selected}
                className={`rounded-sm border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                  selected
                    ? "border-brand bg-brand-soft font-semibold text-brand-text"
                    : "border-line text-body hover:border-subtle"
                }`}
              >
                {vehicle.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="mt-5 flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={overwrite}
          onChange={(event) => setOverwrite(event.target.checked)}
          className="mt-0.5 size-4 accent-brand"
        />
        <span className="text-[0.8125rem] text-body">
          Overwrite fares that are already set
          <span className="mt-0.5 block text-[0.75rem] text-subtle">
            Off by default: the ordinary use fills gaps and leaves existing prices alone.
          </span>
        </span>
      </label>

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-sm border border-error/40 bg-surface px-4 py-3 text-[0.875rem] text-error-text"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {result && (
        <p
          role="status"
          className="mt-4 flex items-start gap-2 rounded-sm border border-success/40 bg-success/5 px-4 py-3 text-[0.875rem] text-success"
        >
          <Check size={16} className="mt-0.5 shrink-0" aria-hidden />
          {result.written === 0
            ? `Nothing changed — all ${result.kept} fares across ${result.routes} routes were already set.`
            : `Wrote ${result.written} fares across ${result.routes} routes${
                result.kept > 0 ? `, leaving ${result.kept} already set` : ""
              }.`}
        </p>
      )}

      <button
        type="button"
        onClick={apply}
        disabled={saving || !ready}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {saving ? "Applying…" : "Apply"}
      </button>
    </section>
  );
}
