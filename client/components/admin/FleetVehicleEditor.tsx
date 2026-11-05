"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { FormError, SelectInput, SubmitButton } from "./FormControls";
import {
  FleetVehicleFields,
  fleetValuesFrom,
  fleetValuesToBody,
  type FleetValues,
} from "./FleetVehicleFields";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import { updateFleetVehicle } from "@/lib/api/fleet";
import { vehicleBodyOptions, vehicleClassLabels } from "@/lib/admin/transfers";
import type { FleetVehicleAdmin } from "@/types/driver";
import type { TransferProvider, TransferVehicle, TransferVehicleBody } from "@/types/transfer";

/**
 * One car.
 *
 * Unlike a vehicle class, everything about a car may change: it can be sold
 * under a different class after a refit, or move to another supplier when a
 * subcontract ends. Its status is not here — the panel beside the editor owns
 * on-the-road / off-the-road / archived, because those are decisions with
 * consequences for the schedule, not fields.
 */
export function FleetVehicleEditor({
  vehicle,
  providers,
  classes,
}: {
  vehicle: FleetVehicleAdmin;
  providers: TransferProvider[];
  classes: TransferVehicle[];
}) {
  const router = useRouter();
  const can = useCan();
  // Read-only without the right: the fieldset disables every control and the
  // Save button gives way to one line saying why.
  const canEdit = can("dispatch.write");

  const [values, setValues] = useState<FleetValues>(() => fleetValuesFrom(vehicle));
  const [providerId, setProviderId] = useState(vehicle.provider?.id ?? "");
  const [vehicleClassId, setVehicleClassId] = useState(vehicle.vehicleClass?.id ?? "");
  const [body, setBody] = useState<TransferVehicleBody>(vehicle.body);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof FleetValues>(key: K, value: FleetValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await updateFleetVehicle(vehicle.id, {
        ...fleetValuesToBody(values),
        providerId,
        vehicleClassId,
        body,
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save the car."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <fieldset disabled={!canEdit} className="min-w-0">
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectInput
          id="fleet-class"
          label="Sold as"
          value={vehicleClassId}
          onChange={(event) => {
            setVehicleClassId(event.target.value);
            setSaved(false);
          }}
          options={classes.map((item) => ({
            value: item.id,
            label: `${item.name} (${vehicleClassLabels[item.vehicleClass] ?? item.vehicleClass})`,
          }))}
          error={fieldErrors.vehicleClassId}
          hint="Dispatch checks the booked class against this; an upgrade is an override."
        />
        <SelectInput
          id="fleet-body"
          label="Body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value as TransferVehicleBody);
            setSaved(false);
          }}
          options={vehicleBodyOptions}
          error={fieldErrors.body}
        />
        <SelectInput
          id="fleet-provider"
          label="Operated by"
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value);
            setSaved(false);
          }}
          options={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
          error={fieldErrors.providerId}
        />
      </div>

      <div className="mt-8 border-t border-line pt-6">
        <FleetVehicleFields values={values} onChange={set} fieldErrors={fieldErrors} />
      </div>
      </fieldset>

      {canEdit ? (
        <>
          <FormError message={error} />

          <SubmitButton className="mt-6" busy={busy} saved={saved} onClick={save}>
            {busy ? "Saving…" : saved ? "Saved" : "Save car"}
          </SubmitButton>
        </>
      ) : (
        <ReadOnlyNote needs="dispatch.write" what="Editing this car" className="mt-6" />
      )}
    </div>
  );
}
