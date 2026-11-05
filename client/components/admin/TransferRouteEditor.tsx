"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import {
  CheckboxField,
  FormError,
  LineListInput,
  NumberInput,
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import { updateTransferRoute } from "@/lib/api/transfers";
import { categoryOptions, tierOptions } from "@/lib/admin/transfers";
import type {
  TransferRouteCategory,
  TransferRouteTier,
  TransferRouteWithChecklist,
} from "@/types/transfer";

/**
 * Everything about a route except its fares and its stops.
 *
 * The catalogue was seeded with a generated title and summary for all three
 * hundred and ninety-six routes — enough for the page to exist, not enough for
 * it to be worth reading. This is where the Tier 1 routes get written
 * properly, which is the only reason those pages are worth indexing.
 *
 * Distance and journey time sit in the same form as the copy because they are
 * the same kind of correction: both were derived from coordinates when the
 * route was created, and both are the sort of thing somebody fixes after
 * driving the road. Distance is not decorative, though — it is what the
 * distance engine multiplies by the per-km rate wherever this route has no
 * curated fare, so the hint says so.
 *
 * `slug` is deliberately absent. The server accepts a change to it, but it is
 * a public URL that is already indexed and linked to, and renaming one from a
 * copy editor is how a live page becomes a 404 with nobody the wiser.
 *
 * English only. The translations live in their own tables and are edited
 * through `PUT /admin/transfers/routes/:id/translations/:locale` — putting four
 * languages in one form would make it a page nobody finishes.
 */
export function TransferRouteEditor({ route }: { route: TransferRouteWithChecklist }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [title, setTitle] = useState(route.title ?? "");
  const [summary, setSummary] = useState(route.summary ?? "");
  const [description, setDescription] = useState<string[]>(route.description);
  const [tier, setTier] = useState<TransferRouteTier>(route.tier);
  const [category, setCategory] = useState<TransferRouteCategory>(route.category);
  const [distanceKm, setDistanceKm] = useState(String(route.distanceKm));
  const [durationMinutes, setDurationMinutes] = useState(String(route.durationMinutes));
  const [heroImage, setHeroImage] = useState(route.heroImage ?? "");
  const [featured, setFeatured] = useState(route.featured);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const distance = Number.parseInt(distanceKm, 10);
  const duration = Number.parseInt(durationMinutes, 10);

  const dirty =
    title !== (route.title ?? "") ||
    summary !== (route.summary ?? "") ||
    description.join("\n") !== route.description.join("\n") ||
    tier !== route.tier ||
    category !== route.category ||
    distance !== route.distanceKm ||
    duration !== route.durationMinutes ||
    heroImage !== (route.heroImage ?? "") ||
    featured !== route.featured;

  /** Both are required columns, so a cleared field is a refusal, not a null. */
  const measurementsValid =
    Number.isFinite(distance) && distance > 0 && Number.isFinite(duration) && duration > 0;

  const touch = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setSaved(false);
  };

  const save = async () => {
    if (!measurementsValid) {
      setError("Distance and journey time both have to be positive whole numbers.");
      return;
    }

    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await updateTransferRoute(route.id, {
        // Empty means "no copy yet" rather than the empty string, so the
        // landing page falls back to the generated heading instead of
        // rendering a blank one.
        title: title.trim() || null,
        summary: summary.trim() || null,
        description,
        tier,
        category,
        distanceKm: distance,
        durationMinutes: duration,
        heroImage: heroImage.trim() || null,
        featured,
      });

      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save the route."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset disabled={!canEdit} className="min-w-0">
      <div className="space-y-5">
        <TextInput
          id="route-edit-title"
          label="Title"
          value={title}
          onChange={(event) => touch(setTitle)(event.target.value)}
          placeholder={`${route.from.name} to ${route.to.name}`}
          error={fieldErrors.title}
          hint="The page heading and the browser title. Write it the way somebody would search for it."
        />

        <TextArea
          id="route-edit-summary"
          label="Summary"
          rows={3}
          value={summary}
          onChange={(event) => touch(setSummary)(event.target.value)}
          error={fieldErrors.summary}
          hint="One or two sentences. Used as the meta description and under the heading."
        />

        <LineListInput
          label="Description"
          value={description}
          onChange={touch(setDescription)}
          rows={5}
          placeholder={"One paragraph per line.\nWhat the drive is actually like, what is worth stopping for."}
          error={fieldErrors.description}
          hint="Paragraphs, one per line. This is the body of the landing page."
        />

        <TextInput
          id="route-edit-hero"
          label="Hero image"
          value={heroImage}
          onChange={(event) => touch(setHeroImage)(event.target.value)}
          placeholder="/images/routes/tbilisi-kazbegi.jpg"
          error={fieldErrors.heroImage}
          hint="Leave blank and the page falls back to the category's default artwork."
        />
      </div>

      <fieldset className="mt-6 border-t border-line pt-5">
        <legend className="sr-only">How it sells</legend>

        <div className="grid gap-5 sm:grid-cols-2">
          <SelectInput
            id="route-edit-tier"
            label="Sales tier"
            value={tier}
            onChange={(event) => touch(setTier)(event.target.value as TransferRouteTier)}
            options={tierOptions}
            error={fieldErrors.tier}
          />

          <SelectInput
            id="route-edit-category"
            label="Category"
            value={category}
            onChange={(event) =>
              touch(setCategory)(event.target.value as TransferRouteCategory)
            }
            options={categoryOptions}
            error={fieldErrors.category}
          />
        </div>

        <CheckboxField
          className="mt-5"
          label="Show on the transfers landing page"
          hint="Only Tier 1 routes appear there."
          checked={featured}
          onChange={touch(setFeatured)}
        />
      </fieldset>

      <fieldset className="mt-6 border-t border-line pt-5">
        <legend className="sr-only">Distance and time</legend>
        <p className="text-[0.8125rem] font-semibold text-ink">Distance and time</p>
        <p className="mt-1 text-[0.75rem] leading-relaxed text-subtle">
          Seeded from the coordinates when the route was created. Distance is not just copy:
          wherever this route has no curated fare, it is what the per-km rate is multiplied by.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberInput
            id="route-edit-distance"
            label="Distance (km)"
            min={1}
            max={5000}
            step={1}
            value={distanceKm}
            onChange={(event) => touch(setDistanceKm)(event.target.value)}
            error={fieldErrors.distanceKm}
          />
          <NumberInput
            id="route-edit-duration"
            label="Journey time (minutes)"
            min={1}
            max={10000}
            step={1}
            value={durationMinutes}
            onChange={(event) => touch(setDurationMinutes)(event.target.value)}
            error={fieldErrors.durationMinutes}
          />
        </div>
      </fieldset>

      <FormError message={error} />

      {canEdit ? (
        <SubmitButton
          className="mt-6"
          busy={busy}
          saved={saved && !dirty}
          disabled={!dirty}
          onClick={save}
        >
          {busy ? "Saving…" : saved && !dirty ? "Saved" : "Save route"}
        </SubmitButton>
      ) : (
        <ReadOnlyNote className="mt-6" needs="catalogue.write" what="Editing this route" />
      )}
    </fieldset>
  );
}
