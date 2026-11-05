"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { Cell, DataTable, Row } from "./DataTable";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import {
  publishTransferRoute,
  setTransferRoutePrices,
  unpublishTransferRoute,
} from "@/lib/api/transfers";
import { toMajorUnits, toMinorUnits } from "@/lib/money";
import type { TransferRouteWithChecklist, TransferVehicle } from "@/types/transfer";

/**
 * What one route costs in every vehicle class.
 *
 * Edited and saved as a whole grid rather than a row at a time, matching the
 * endpoint: one body means a half-applied set of prices cannot happen, and the
 * operator sees the classes side by side, which is how they are actually
 * decided — a minivan has to sit above a saloon and below a van.
 *
 * Amounts are typed in lari and converted on the way out. `toMinorUnits`
 * rounds rather than truncates, so 12.005 becomes 1201 and not 1200: a
 * truncation here is a tetri the operator did not mean to give away.
 *
 * Fares and the publish switch are both writes to the transfer catalogue,
 * which the server guards with `catalogue.write` (not `pricing.write` — the
 * transfer router has no separate pricing gate). A reader sees the grid
 * disabled and one line where the buttons were.
 */
export function TransferPriceGrid({
  route,
  vehicles,
}: {
  route: TransferRouteWithChecklist;
  vehicles: TransferVehicle[];
}) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [values, setValues] = useState<Record<string, { oneWay: string; return: string }>>(() =>
    Object.fromEntries(
      vehicles.map((vehicle) => {
        const price = route.prices?.find((entry) => entry.vehicleId === vehicle.id);

        return [
          vehicle.id,
          {
            oneWay: toMajorUnits(price?.oneWayCents),
            return: toMajorUnits(price?.returnCents),
          },
        ];
      }),
    ),
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (vehicleId: string, field: "oneWay" | "return", value: string) => {
    setValues((current) => ({
      ...current,
      [vehicleId]: { ...current[vehicleId], [field]: value },
    }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);

    // A blank one-way is how a class is taken off this route: the row is simply
    // not sent, and the grid endpoint replaces rather than merges.
    const prices = vehicles
      .map((vehicle) => {
        const entry = values[vehicle.id];
        const oneWayCents = entry.oneWay.trim() ? toMinorUnits(entry.oneWay) : null;

        if (oneWayCents === null || oneWayCents <= 0) return null;

        const returnCents = entry.return.trim() ? toMinorUnits(entry.return) : null;

        return {
          vehicleId: vehicle.id,
          oneWayCents,
          ...(returnCents && returnCents > 0 ? { returnCents } : {}),
        };
      })
      .filter((entry) => entry !== null);

    try {
      await setTransferRoutePrices(route.id, prices);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not save the prices."));
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async () => {
    setSaving(true);
    setError(null);

    try {
      if (route.status === "ACTIVE") await unpublishTransferRoute(route.id);
      else await publishTransferRoute(route.id);

      router.refresh();
    } catch (err) {
      // The publish checklist, when the server refused for a named reason —
      // otherwise whatever it (or the connection) had to say.
      const missing =
        err instanceof ApiError
          ? (err.details as { missing?: { message: string }[] } | undefined)?.missing
          : undefined;
      setError(missing?.[0]?.message ?? describeError(err, "Could not change the route's status."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset disabled={!canEdit} className="min-w-0">
      <div className="rounded-sm border border-line bg-surface">
        <DataTable
          caption="Fares by vehicle class"
          columns={[
            { label: "Vehicle class" },
            { label: "Seats", align: "end", hideBelow: "sm" },
            { label: "One way (GEL)", align: "end" },
            // Never hidden: this column holds an input, and hiding it on a phone
            // made the return fare impossible to edit there.
            { label: "Return (GEL)", align: "end" },
          ]}
        >
          {vehicles.map((vehicle) => (
            <Row key={vehicle.id}>
              <Cell>
                <span className="font-medium text-ink">{vehicle.name}</span>
                <span className="type-caption mt-0.5 block text-subtle">
                  {vehicle.vehicleClass.replace("_", " ").toLowerCase()}
                  {vehicle.kind === "SHARED" ? " · per seat" : ""}
                </span>
              </Cell>
              <Cell align="end" hideBelow="sm">
                {vehicle.maxPassengers}
              </Cell>
              <Cell align="end">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={values[vehicle.id]?.oneWay ?? ""}
                  onChange={(event) => set(vehicle.id, "oneWay", event.target.value)}
                  aria-label={`One-way fare for ${vehicle.name}`}
                  className="h-9 w-28 rounded-sm border border-line bg-surface px-2 text-end text-[0.875rem] text-ink tabular-nums focus:border-ink focus:outline-none"
                />
              </Cell>
              <Cell align="end">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="2 × one way"
                  value={values[vehicle.id]?.return ?? ""}
                  onChange={(event) => set(vehicle.id, "return", event.target.value)}
                  aria-label={`Return fare for ${vehicle.name}`}
                  className="h-9 w-28 rounded-sm border border-line bg-surface px-2 text-end text-[0.875rem] text-ink tabular-nums focus:border-ink focus:outline-none"
                />
              </Cell>
            </Row>
          ))}
        </DataTable>
      </div>

      <p className="type-caption mt-3 text-subtle">
        {canEdit
          ? "Leave a fare blank to take that class off this route — the distance estimate will price it instead. A blank return means twice the one-way."
          : "A blank fare means the distance estimate prices that class. A blank return means twice the one-way."}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-sm border border-error/40 bg-surface px-4 py-3 text-[0.875rem] text-error-text"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {canEdit ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {saved && <Check size={15} aria-hidden />}
            {saving ? "Saving…" : saved ? "Saved" : "Save fares"}
          </button>

          <button
            type="button"
            onClick={togglePublished}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-sm border border-ink/25 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft disabled:opacity-50"
          >
            {route.status === "ACTIVE" ? "Unpublish route" : "Publish route"}
          </button>
        </div>
      ) : (
        <ReadOnlyNote
          className="mt-5"
          needs="catalogue.write"
          what="Changing fares or publishing the route"
        />
      )}
    </fieldset>
  );
}
