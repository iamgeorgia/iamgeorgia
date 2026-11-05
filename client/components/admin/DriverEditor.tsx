"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { DriverFields, driverValuesFrom, driverValuesToBody, type DriverValues } from "./DriverFields";
import { FormError, SelectInput, SubmitButton } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import { updateDriver } from "@/lib/api/drivers";
import type { DriverAdmin } from "@/types/driver";
import type { TransferProvider } from "@/types/transfer";

export function DriverEditor({ driver, providers }: { driver: DriverAdmin; providers: TransferProvider[] }) {
  const router = useRouter();
  const can = useCan();
  // Read-only for anyone without the right: every control is disabled through
  // the fieldset and the Save button gives way to one line saying why.
  const canEdit = can("dispatch.write");

  const [values, setValues] = useState<DriverValues>(() => driverValuesFrom(driver));
  const [providerId, setProviderId] = useState(driver.provider?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof DriverValues>(key: K, value: DriverValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await updateDriver(driver.id, { ...driverValuesToBody(values), providerId });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save the driver."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <fieldset disabled={!canEdit} className="min-w-0">
        <SelectInput
          id="driver-provider"
          label="Works for"
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value);
            setSaved(false);
          }}
          options={providers.map((provider) => ({ value: provider.id, label: provider.name }))}
          error={fieldErrors.providerId}
          hint="The supplier who pays them. The platform's own drivers belong to the house provider."
        />

        <div className="mt-8 border-t border-line pt-6">
          <DriverFields values={values} onChange={set} fieldErrors={fieldErrors} />
        </div>
      </fieldset>

      {canEdit ? (
        <>
          <FormError message={error} />

          <SubmitButton className="mt-6" busy={busy} saved={saved} onClick={save}>
            {busy ? "Saving…" : saved ? "Saved" : "Save driver"}
          </SubmitButton>
        </>
      ) : (
        <ReadOnlyNote needs="dispatch.write" what="Editing this driver" className="mt-6" />
      )}
    </div>
  );
}
