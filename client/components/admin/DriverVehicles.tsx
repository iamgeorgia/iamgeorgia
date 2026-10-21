"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { FormError, SubmitButton } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { setDriverVehicles } from "@/lib/api/drivers";
import { fleetVehicleLabel } from "@/lib/admin/fleet";
import type { DriverAdmin, FleetVehicleAdmin } from "@/types/driver";

/**
 * Which cars this driver usually takes.
 *
 * Eligibility and a default, not a schedule: the dispatch screen pre-fills
 * the primary car and lists the rest, and the car for any one job is on the
 * assignment. Replaced as a whole, so a saved list is the list.
 */
export function DriverVehicles({ driver, fleet }: { driver: DriverAdmin; fleet: FleetVehicleAdmin[] }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("dispatch.write");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(driver.vehicles.map((car) => car.id)));
  const [primary, setPrimary] = useState<string | null>(
    () => driver.vehicles.find((car) => car.isPrimary)?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string, next: boolean) => {
    setSelected((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
    if (!next && primary === id) setPrimary(null);
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      await setDriverVehicles(
        driver.id,
        [...selected].map((fleetVehicleId) => ({ fleetVehicleId, isPrimary: fleetVehicleId === primary })),
      );
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const cars = fleet.filter((car) => car.status !== "ARCHIVED" || selected.has(car.id));

  return (
    <AdminPanel title="Cars" description="The ones this driver usually takes. Dispatch offers the primary first.">
      {cars.length === 0 ? (
        <p className="text-[0.875rem] text-muted">No cars in the fleet yet.</p>
      ) : (
        <fieldset disabled={!canEdit} className="min-w-0">
        <ul className="divide-y divide-line">
          {cars.map((car) => {
            const on = selected.has(car.id);
            return (
              <li key={car.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <label className="flex min-w-0 items-center gap-3 text-[0.875rem] text-ink">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) => toggle(car.id, event.target.checked)}
                    className="h-4 w-4 accent-brand"
                  />
                  <span className="truncate">{fleetVehicleLabel(car)}</span>
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-muted">
                  <input
                    type="radio"
                    name="primary-car"
                    disabled={!on}
                    checked={primary === car.id}
                    onChange={() => {
                      setPrimary(car.id);
                      setSaved(false);
                    }}
                    className="h-3.5 w-3.5 accent-brand"
                  />
                  Primary
                </label>
              </li>
            );
          })}
        </ul>
        </fieldset>
      )}

      {canEdit ? (
        <>
          <FormError message={error} />

          <SubmitButton className="mt-4" busy={busy} saved={saved} onClick={save}>
            {busy ? "Saving…" : saved ? "Saved" : "Save cars"}
          </SubmitButton>
        </>
      ) : (
        <ReadOnlyNote needs="dispatch.write" what="Changing which cars this driver takes" className="mt-4" />
      )}
    </AdminPanel>
  );
}
