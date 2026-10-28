"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
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
import { updateTour } from "@/lib/api/tours";
import { ApiError, describeError } from "@/lib/api/client";
import { TOUR_CATEGORIES, categoryLabel } from "@/lib/admin/tours";
import type { Difficulty, ItineraryDay, MealKey, Tour, TourCategory } from "@/types/tour";

/**
 * Everything about a tour that is words, numbers and the day-by-day.
 *
 * One save, one PATCH. The itinerary is sent whole — the server replaces it —
 * so removing a day here removes it there, and the day numbers are renumbered
 * on the way out so a gap can never be saved. Prices are deliberately absent:
 * they belong to options and price sheets, and the "from" price is derived.
 */

const DIFFICULTIES: Difficulty[] = ["Easy", "Moderate", "Challenging"];
const MEALS: MealKey[] = ["breakfast", "lunch", "dinner"];

type DayDraft = Omit<ItineraryDay, "day">;

export function TourDetailsEditor({ tour }: { tour: Tour }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write", "tours.write");

  const [title, setTitle] = useState(tour.title);
  const [location, setLocation] = useState(tour.location);
  const [category, setCategory] = useState<TourCategory>(tour.category);
  const [difficulty, setDifficulty] = useState<Difficulty>(tour.difficulty);
  const [summary, setSummary] = useState(tour.summary);
  const [description, setDescription] = useState(tour.description.join("\n\n"));
  const [durationDays, setDurationDays] = useState(tour.durationDays);
  const [durationLabel, setDurationLabel] = useState(tour.durationLabel);
  const [groupSize, setGroupSize] = useState(tour.groupSize);
  const [meetingPoint, setMeetingPoint] = useState(tour.meetingPoint);
  const [meetingTime, setMeetingTime] = useState(tour.meetingTime ?? "");
  const [minAge, setMinAge] = useState(tour.minAge === null ? "" : String(tour.minAge));
  const [infantMaxAge, setInfantMaxAge] = useState(tour.ages.infantMaxAge);
  const [childMaxAge, setChildMaxAge] = useState(tour.ages.childMaxAge);
  const [image, setImage] = useState(tour.image ?? "");
  const [highlights, setHighlights] = useState(tour.highlights);
  const [included, setIncluded] = useState(tour.included);
  const [excluded, setExcluded] = useState(tour.excluded);
  const [importantInfo, setImportantInfo] = useState(tour.importantInfo);
  const [days, setDays] = useState<DayDraft[]>(
    tour.itinerary.map(({ title, description, meals, accommodation }) => ({
      title,
      description,
      meals,
      accommodation,
    })),
  );

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const touch = () => setSaved(false);

  const setDay = (index: number, patch: Partial<DayDraft>) => {
    touch();
    setDays((current) => current.map((day, at) => (at === index ? { ...day, ...patch } : day)));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await updateTour(tour.id, {
        title: title.trim(),
        location: location.trim(),
        category,
        difficulty,
        summary: summary.trim(),
        description: description
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean),
        durationDays,
        durationLabel: durationLabel.trim(),
        groupSize: groupSize.trim(),
        meetingPoint: meetingPoint.trim(),
        meetingTime: meetingTime.trim() || null,
        minAge: minAge === "" ? null : Number(minAge),
        infantMaxAge,
        childMaxAge,
        image: image.trim(),
        highlights,
        included,
        excluded,
        importantInfo,
        itinerary: days.map((day, index) => ({
          day: index + 1,
          title: day.title.trim(),
          description: day.description.trim(),
          meals: day.meals,
          accommodation: day.accommodation?.trim() || null,
        })),
      });

      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {/* One disabled fieldset covers every control; the add and remove
          buttons are hidden instead, so nothing looks broken. */}
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-6">
      <AdminPanel title="Listing" description="How the journey appears across the site.">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput
            className="sm:col-span-2"
            label="Title"
            required
            value={title}
            onChange={(event) => {
              touch();
              setTitle(event.target.value);
            }}
            error={fieldErrors.title}
          />
          <TextInput
            label="Region"
            required
            value={location}
            onChange={(event) => {
              touch();
              setLocation(event.target.value);
            }}
            error={fieldErrors.location}
          />
          <SelectInput
            label="Category"
            value={category}
            onChange={(event) => {
              touch();
              setCategory(event.target.value as TourCategory);
            }}
            options={TOUR_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
          />
          <SelectInput
            label="Difficulty"
            value={difficulty}
            onChange={(event) => {
              touch();
              setDifficulty(event.target.value as Difficulty);
            }}
            options={DIFFICULTIES.map((value) => ({ value, label: value }))}
          />
          <TextInput
            label="Group size"
            required
            value={groupSize}
            onChange={(event) => {
              touch();
              setGroupSize(event.target.value);
            }}
            hint="Prose for the card. Capacity is set per option."
            error={fieldErrors.groupSize}
          />
          <NumberInput
            label="Length in days"
            min={1}
            max={60}
            required
            value={durationDays}
            onChange={(event) => {
              touch();
              setDurationDays(Number(event.target.value) || 1);
            }}
            hint="A multi-day tour claims its departure date only; the length decides the end date."
            error={fieldErrors.durationDays}
          />
          <TextInput
            label="Length as a traveller reads it"
            required
            value={durationLabel}
            onChange={(event) => {
              touch();
              setDurationLabel(event.target.value);
            }}
            error={fieldErrors.durationLabel}
          />
          <TextArea
            className="sm:col-span-2"
            label="Summary"
            required
            rows={2}
            value={summary}
            onChange={(event) => {
              touch();
              setSummary(event.target.value);
            }}
            hint="One or two sentences. Shown on cards and search results."
            error={fieldErrors.summary}
          />
          <TextArea
            className="sm:col-span-2"
            label="Description"
            rows={8}
            value={description}
            onChange={(event) => {
              touch();
              setDescription(event.target.value);
            }}
            hint="A blank line starts a new paragraph."
            error={fieldErrors.description}
          />
          <TextInput
            className="sm:col-span-2"
            label="Editorial image path"
            mono
            value={image}
            onChange={(event) => {
              touch();
              setImage(event.target.value);
            }}
            hint="A path under /public, e.g. /images/tours/kazbegi.jpg. Uploaded gallery images take precedence once there are any."
            error={fieldErrors.image}
          />
        </div>
      </AdminPanel>

      <AdminPanel title="Practicalities" description="Where to meet, and who may come.">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput
            className="sm:col-span-2"
            label="Meeting point"
            required
            value={meetingPoint}
            onChange={(event) => {
              touch();
              setMeetingPoint(event.target.value);
            }}
            error={fieldErrors.meetingPoint}
          />
          <TextInput
            label="Meeting time"
            type="time"
            value={meetingTime}
            onChange={(event) => {
              touch();
              setMeetingTime(event.target.value);
            }}
            hint="Wall-clock time in the tour's zone. Options may override it with their own start time."
            error={fieldErrors.meetingTime}
          />
          <NumberInput
            label="Minimum age"
            min={0}
            max={99}
            value={minAge}
            onChange={(event) => {
              touch();
              setMinAge(event.target.value);
            }}
            hint="Leave blank for no floor."
            error={fieldErrors.minAge}
          />
          <NumberInput
            label="Infants up to (age)"
            min={0}
            max={17}
            value={infantMaxAge}
            onChange={(event) => {
              touch();
              setInfantMaxAge(Number(event.target.value) || 0);
            }}
            hint="Infants take no seat and are priced at the infant rate, usually nothing."
            error={fieldErrors.infantMaxAge}
          />
          <NumberInput
            label="Children up to (age)"
            min={0}
            max={17}
            value={childMaxAge}
            onChange={(event) => {
              touch();
              setChildMaxAge(Number(event.target.value) || 0);
            }}
            hint="Older travellers are adults."
            error={fieldErrors.childMaxAge}
          />
        </div>
      </AdminPanel>

      <AdminPanel title="Lists" description="One entry per line.">
        <div className="grid gap-5 sm:grid-cols-2">
          <LineListInput
            label="Highlights"
            value={highlights}
            onChange={(next) => {
              touch();
              setHighlights(next);
            }}
            rows={6}
          />
          <LineListInput
            label="Important information"
            value={importantInfo}
            onChange={(next) => {
              touch();
              setImportantInfo(next);
            }}
            rows={6}
          />
          <LineListInput
            label="Included"
            value={included}
            onChange={(next) => {
              touch();
              setIncluded(next);
            }}
            rows={6}
          />
          <LineListInput
            label="Not included"
            value={excluded}
            onChange={(next) => {
              touch();
              setExcluded(next);
            }}
            rows={6}
          />
        </div>
      </AdminPanel>

      <AdminPanel
        title="Itinerary"
        description="Day by day. A day trip has one entry; the publish checklist wants at least one."
        action={
          canEdit ? (
            <button
              type="button"
              onClick={() => {
                touch();
                setDays((current) => [...current, { title: "", description: "", meals: [], accommodation: null }]);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-ink/20 px-3 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft"
            >
              <Plus size={14} aria-hidden />
              Day
            </button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {days.length === 0 && (
          <p className="px-5 py-4 text-[0.8125rem] text-muted">No days yet.</p>
        )}
        <ol className="divide-y divide-line">
          {days.map((day, index) => (
            <li key={index} className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="flex items-center justify-between sm:col-span-2">
                <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-muted uppercase">
                  Day {index + 1}
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      touch();
                      setDays((current) => current.filter((_, at) => at !== index));
                    }}
                    aria-label={`Remove day ${index + 1}`}
                    className="text-subtle hover:text-error-text"
                  >
                    <X size={15} aria-hidden />
                  </button>
                )}
              </div>
              <TextInput
                className="sm:col-span-2"
                label="Title"
                required
                value={day.title}
                onChange={(event) => setDay(index, { title: event.target.value })}
                error={fieldErrors[`itinerary.${index}.title`]}
              />
              <TextArea
                className="sm:col-span-2"
                label="What happens"
                required
                rows={3}
                value={day.description}
                onChange={(event) => setDay(index, { description: event.target.value })}
                error={fieldErrors[`itinerary.${index}.description`]}
              />
              <fieldset>
                <legend className="block text-[0.75rem] font-semibold text-muted">Meals included</legend>
                <div className="mt-2 flex flex-wrap gap-4">
                  {MEALS.map((meal) => (
                    <CheckboxField
                      key={meal}
                      label={meal.charAt(0).toUpperCase() + meal.slice(1)}
                      checked={day.meals.includes(meal)}
                      onChange={(checked) =>
                        setDay(index, {
                          meals: checked
                            ? [...day.meals, meal]
                            : day.meals.filter((value) => value !== meal),
                        })
                      }
                    />
                  ))}
                </div>
              </fieldset>
              <TextInput
                label="Overnight"
                value={day.accommodation ?? ""}
                onChange={(event) => setDay(index, { accommodation: event.target.value })}
                hint="Leave blank on a day with no night."
              />
            </li>
          ))}
        </ol>
      </AdminPanel>
      </fieldset>

      <FormError message={error} />

      {canEdit ? (
        <div className="flex justify-end">
          <SubmitButton type="submit" busy={busy} saved={saved}>
            {saved ? "Saved" : "Save changes"}
          </SubmitButton>
        </div>
      ) : (
        <ReadOnlyNote needs={["catalogue.write", "tours.write"]} what="Editing this tour" />
      )}
    </form>
  );
}
