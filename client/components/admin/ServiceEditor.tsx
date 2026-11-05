"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { FormError, SubmitButton } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import {
  ServiceFields,
  serviceValuesError,
  serviceValuesFrom,
  serviceValuesToBody,
  type ServiceValues,
} from "./ServiceFields";
import { ApiError, describeError } from "@/lib/api/client";
import { updateService } from "@/lib/api/services";
import type { CancellationPolicy, DestinationNode } from "@/types/catalogue";
import type { PartnerSummary } from "@/types/partner";
import type { Service } from "@/types/service";

/**
 * One service, edited.
 *
 * Every field the create form offers, including the slug and the basis: a
 * service has no public URL yet and no inventory behind it, so nothing outside
 * the record depends on either, and locking them would only mean deleting and
 * re-creating a service to fix a typo.
 *
 * The one field with two writers is the status, and this form does not touch
 * it — the sidebar's publish, unpublish and archive own it. A form that also
 * sent a status would undo whoever last pressed one of those buttons.
 *
 * The fields themselves and the reasoning behind each group are in
 * `ServiceFields`, shared with the create form.
 */
export function ServiceEditor({
  service,
  destinations,
  suppliers,
  policies,
}: {
  service: Service;
  destinations: DestinationNode[];
  suppliers: PartnerSummary[];
  policies: CancellationPolicy[];
}) {
  const router = useRouter();
  // The services router asks for `catalogue.write` alone, prices included, so
  // one capability locks or unlocks the whole form.
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [values, setValues] = useState<ServiceValues>(() => serviceValuesFrom(service));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof ServiceValues>(key: K, value: ServiceValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    const problem = serviceValuesError(values);

    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await updateService(service.id, serviceValuesToBody(values));

      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save the service."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <fieldset disabled={!canEdit} className="min-w-0">
        <ServiceFields
          values={values}
          onChange={set}
          destinations={destinations}
          suppliers={suppliers}
          policies={policies}
          fieldErrors={fieldErrors}
        />
      </fieldset>

      <FormError message={error} />

      {canEdit ? (
        <SubmitButton className="mt-6" busy={busy} saved={saved} onClick={save}>
          {busy ? "Saving…" : saved ? "Saved" : "Save service"}
        </SubmitButton>
      ) : (
        <ReadOnlyNote className="mt-6" needs="catalogue.write" what="Editing this service" />
      )}
    </div>
  );
}
