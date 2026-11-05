"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import {
  CheckboxField,
  FormError,
  SelectInput,
  SubmitButton,
  TextInput,
} from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { GoogleMapsProvider } from "@/components/geo/GoogleMapsProvider";
import { LocationField } from "@/components/geo/LocationField";
import { ApiError, describeError } from "@/lib/api/client";
import {
  createTransferPoint,
  updateTransferPoint,
  type TransferPointInput,
} from "@/lib/api/transfers";
import { isPlaced, locationOf, suggestPointKind } from "@/lib/geo/place";
import { pointKindOptions, slugify, timezoneOptions } from "@/lib/admin/transfers";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { EMPTY_LOCATION, type LocationValue } from "@/types/geo";
import type { TransferPoint, TransferPointKind } from "@/types/transfer";

/**
 * Adding or editing a pick-up point.
 *
 * One component for both, because the two differ in exactly two ways — where
 * the values start and which endpoint the button calls — and a separate
 * create form would be the same twelve fields maintained twice.
 *
 * The slug is the exception to that symmetry. On a new point it is derived
 * from the name as it is typed and stays editable; on an existing one it is
 * left alone entirely. It is part of a URL that has already been linked to,
 * and quietly renaming it from a form that looks like a copy editor is how a
 * live page turns into a 404.
 *
 * The position comes from the place search, and a searched place fills in
 * what it can — the name, the region, whether it is an airport — but only
 * into fields still standing empty. An operator who has typed "TBS Arrivals"
 * did not ask to have it replaced with what Google calls the terminal.
 */

/** The form's own shape: every text field a string, as the inputs hold them. */
interface Values {
  slug: string;
  name: string;
  kind: TransferPointKind;
  iataCode: string;
  regionLabel: string;
  location: LocationValue;
  timezone: string;
  popular: boolean;
}

const initial = (point?: TransferPoint): Values => ({
  slug: point?.slug ?? "",
  name: point?.name ?? "",
  kind: point?.kind ?? "CITY",
  iataCode: point?.code ?? "",
  regionLabel: point?.region ?? "",
  location: point ? locationOf(point) : EMPTY_LOCATION,
  timezone: point?.timezone ?? "Asia/Tbilisi",
  popular: point?.popular ?? false,
});

export function TransferPointForm({ point }: { point?: TransferPoint }) {
  return (
    <GoogleMapsProvider>
      <PointForm point={point} />
    </GoogleMapsProvider>
  );
}

function PointForm({ point }: { point?: TransferPoint }) {
  const router = useRouter();
  const path = useLocalePath();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const editing = Boolean(point);

  const [values, setValues] = useState<Values>(() => initial(point));
  const [slugTouched, setSlugTouched] = useState(editing);
  // Until it is edited by hand, the kind may follow what a searched place
  // says it is. Once chosen it stays chosen.
  const [kindTouched, setKindTouched] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const placed = isPlaced(values.location);
  const isAirport = values.kind === "AIRPORT";

  const ready =
    values.name.trim().length > 0 &&
    values.slug.trim().length > 0 &&
    values.regionLabel.trim().length > 0 &&
    placed;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isPlaced(values.location)) return;

    setBusy(true);
    setError(null);
    setFieldErrors({});

    // A three-letter code is required by the server when it is sent at all, so
    // an airport half-typed is caught here rather than as a field error on a
    // form the operator has already scrolled away from.
    const code = values.iataCode.trim().toUpperCase();

    if (code && code.length !== 3) {
      setFieldErrors({ iataCode: "An IATA code is exactly three letters." });
      setBusy(false);
      return;
    }

    const body: TransferPointInput = {
      slug: values.slug.trim(),
      name: values.name.trim(),
      kind: values.kind,
      regionLabel: values.regionLabel.trim(),
      latitude: values.location.latitude,
      longitude: values.location.longitude,
      place: values.location.place,
      timezone: values.timezone,
      popular: values.popular,
      // Only airports carry one, and the field is `.optional()` rather than
      // nullable on create — an empty string would be a validation failure.
      ...(isAirport && code ? { iataCode: code } : {}),
    };

    try {
      if (point) {
        // A point that has stopped being an airport has to lose its code, and
        // an omitted key means "leave it alone" — so this branch sends an
        // explicit null. The update schema accepts one; the create schema does
        // not, which is why the two bodies differ here and nowhere else.
        await updateTransferPoint(point.id, {
          ...body,
          iataCode: isAirport && code ? code : null,
        });
        setSaved(true);
        router.refresh();
      } else {
        const created = await createTransferPoint(body);
        router.push(path(`/admin/transfers/points/${created.id}`));
        router.refresh();
        // Deliberately left busy: the push is in flight and re-enabling the
        // button invites a second point with the same slug.
        return;
      }
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught));
    }

    setBusy(false);
  };

  return (
    <form onSubmit={submit}>
      {/* A disabled fieldset switches off every control at once for a
          read-only viewer; the submit row below is replaced, not greyed. */}
      <fieldset disabled={!canEdit} className="min-w-0">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <TextInput
              id="point-name"
              label="Name"
              required
              value={values.name}
              onChange={(event) => {
                set("name", event.target.value);
                if (!slugTouched) set("slug", slugify(event.target.value));
              }}
              placeholder="Tbilisi International Airport"
              error={fieldErrors.name}
              hint="What the traveller sees in the pick-up picker."
            />

            <TextInput
              id="point-slug"
              label="Slug"
              required
              mono
              readOnly={editing}
              value={values.slug}
              onChange={(event) => {
                setSlugTouched(true);
                set("slug", slugify(event.target.value));
              }}
              error={fieldErrors.slug}
              hint={
                editing
                  ? "Fixed once the point exists — it is part of URLs that are already linked to."
                  : "Lowercase letters, numbers and hyphens. Derived from the name until you edit it."
              }
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <SelectInput
                id="point-kind"
                label="Kind"
                value={values.kind}
                onChange={(event) => {
                  setKindTouched(true);
                  set("kind", event.target.value as TransferPointKind);
                }}
                options={pointKindOptions}
                error={fieldErrors.kind}
              />

              <TextInput
                id="point-iata"
                label="IATA code"
                mono
                maxLength={3}
                disabled={!isAirport}
                value={isAirport ? values.iataCode : ""}
                onChange={(event) => set("iataCode", event.target.value.toUpperCase())}
                placeholder="TBS"
                error={fieldErrors.iataCode}
                hint={isAirport ? "Shown as a chip beside the name." : "Airports only."}
              />
            </div>

            <TextInput
              id="point-region"
              label="Region"
              required
              value={values.regionLabel}
              onChange={(event) => set("regionLabel", event.target.value)}
              placeholder="Tbilisi"
              error={fieldErrors.regionLabel}
              hint="The second line of every option row, so two places with the same name stay apart."
            />

            <SelectInput
              id="point-timezone"
              label="Time zone"
              value={values.timezone}
              onChange={(event) => set("timezone", event.target.value)}
              options={timezoneOptions.map((zone) => ({ value: zone, label: zone }))}
              error={fieldErrors.timezone}
              hint="A pick-up time is a wall clock reading here, not a UTC instant."
            />

            <CheckboxField
              label="Show first in the picker"
              hint="Surfaced before the traveller types anything. Worth it for a handful of places, not for fifty."
              checked={values.popular}
              onChange={(next) => set("popular", next)}
            />
          </div>

          <div className={cn("space-y-5", !canEdit && "pointer-events-none")} aria-disabled={!canEdit || undefined}>
            <LocationField
              label="Where it is"
              required
              ids={{ search: "point-place", latitude: "point-latitude", longitude: "point-longitude" }}
              value={values.location}
              error={fieldErrors.place ?? fieldErrors.latitude ?? fieldErrors.longitude}
              hint="The position prices every route through here that has no fare of its own, so it is worth checking the pin."
              onChange={(next, meta) => {
                setValues((current) => {
                  const place = meta.source === "search" ? next.place : null;
                  const kind = place ? suggestPointKind(place.types) : null;

                  return {
                    ...current,
                    location: next,
                    // A searched place fills in what is still empty, and no more.
                    ...(place?.name && !current.name.trim()
                      ? { name: place.name, ...(slugTouched ? {} : { slug: slugify(place.name) }) }
                      : {}),
                    ...(place && !current.regionLabel.trim() && (place.region ?? place.city)
                      ? { regionLabel: (place.region ?? place.city)! }
                      : {}),
                    ...(kind && !kindTouched ? { kind } : {}),
                  };
                });
                setSaved(false);
              }}
            />
          </div>
        </div>

      </fieldset>

      <FormError message={error} />

      {canEdit ? (
        <div className="mt-6 flex items-center gap-3">
          <SubmitButton type="submit" busy={busy} saved={saved} disabled={!ready}>
            {editing
              ? busy
                ? "Saving…"
                : saved
                  ? "Saved"
                  : "Save point"
              : busy
                ? "Creating…"
                : "Create point"}
          </SubmitButton>

          {!ready && (
            <p className="text-[0.75rem] text-subtle">
              A name, a slug, a region and a place on the map are the minimum.
            </p>
          )}
        </div>
      ) : (
        <ReadOnlyNote
          className="mt-6"
          needs="catalogue.write"
          what={editing ? "Editing this pick-up point" : "Creating a pick-up point"}
        />
      )}
    </form>
  );
}
