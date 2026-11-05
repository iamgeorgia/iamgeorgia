"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { FormError, SubmitButton } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import {
  TransferVehicleFields,
  vehicleValuesError,
  vehicleValuesFrom,
  vehicleValuesToBody,
  type VehicleValues,
} from "./TransferVehicleFields";
import { ApiError, describeError } from "@/lib/api/client";
import { updateTransferVehicle } from "@/lib/api/transfers";
import type { TransferVehicle } from "@/types/transfer";

/**
 * One vehicle class.
 *
 * The same fields the create form offers, minus the four that are effectively
 * fixed once the class exists — its class, body, sold-as kind and supplier.
 * Those decide which searches offer it and who gets paid; changing one is a
 * different product rather than an edit, and the API would happily do it, so
 * the restraint lives here where the decision is.
 *
 * The fields themselves and the reasoning behind each group are in
 * `TransferVehicleFields`, shared with the create form so that a field cannot
 * exist on one screen and not the other.
 */
export function TransferVehicleEditor({ vehicle }: { vehicle: TransferVehicle }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [values, setValues] = useState<VehicleValues>(() => vehicleValuesFrom(vehicle));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof VehicleValues>(key: K, value: VehicleValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    const fareProblem = vehicleValuesError(values);

    if (fareProblem) {
      setError(fareProblem);
      return;
    }

    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      // No `b2cEnabled`: the sidebar toggle owns that field and writes it
      // live, so this form's copy would be stale the moment somebody flips
      // the switch. `vehicleValuesToBody` leaves it out.
      await updateTransferVehicle(vehicle.id, vehicleValuesToBody(values));

      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save the vehicle class."));
    } finally {
      setBusy(false);
    }
  };

  return (
    // A disabled fieldset switches off every field at once for a read-only
    // viewer; the Save button is replaced rather than greyed.
    <fieldset disabled={!canEdit} className="min-w-0">
      <TransferVehicleFields
        values={values}
        onChange={set}
        fieldErrors={fieldErrors}
        showChannel={false}
      />

      <FormError message={error} />

      {canEdit ? (
        <SubmitButton className="mt-6" busy={busy} saved={saved} onClick={save}>
          {busy ? "Saving…" : saved ? "Saved" : "Save vehicle class"}
        </SubmitButton>
      ) : (
        <ReadOnlyNote className="mt-6" needs="catalogue.write" what="Editing this vehicle class" />
      )}
    </fieldset>
  );
}
