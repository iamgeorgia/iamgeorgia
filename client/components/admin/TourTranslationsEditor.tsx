"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { FormError, LineListInput, SubmitButton, TextArea, TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { setTourTranslation } from "@/lib/api/tours";
import { ApiError, describeError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { Tour, TourTranslation } from "@/types/tour";

/**
 * The prose of a tour in the other three languages.
 *
 * Every field is optional: a blank one falls back to English on the public
 * page rather than blanking it, so a half-translated tour is still whole.
 * Facts — prices, ages, images, the day count — are not language and are not
 * here.
 */

const LOCALES = [
  { code: "ka", label: "ქართული" },
  { code: "ru", label: "Русский" },
  { code: "he", label: "עברית" },
] as const;

type LocaleCode = (typeof LOCALES)[number]["code"];

interface Draft {
  title: string;
  location: string;
  summary: string;
  description: string;
  highlights: string[];
  included: string[];
  excluded: string[];
  importantInfo: string[];
  meetingPoint: string;
  durationLabel: string;
  groupSize: string;
}

const draftFrom = (translation: TourTranslation | undefined): Draft => ({
  title: translation?.title ?? "",
  location: translation?.location ?? "",
  summary: translation?.summary ?? "",
  description: (translation?.description ?? []).join("\n\n"),
  highlights: translation?.highlights ?? [],
  included: translation?.included ?? [],
  excluded: translation?.excluded ?? [],
  importantInfo: translation?.importantInfo ?? [],
  meetingPoint: translation?.meetingPoint ?? "",
  durationLabel: translation?.durationLabel ?? "",
  groupSize: translation?.groupSize ?? "",
});

export function TourTranslationsEditor({
  tour,
  translations,
}: {
  tour: Tour;
  translations: TourTranslation[];
}) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write", "tours.write");
  const [locale, setLocale] = useState<LocaleCode>("ka");
  const [drafts, setDrafts] = useState<Record<LocaleCode, Draft>>(() =>
    Object.fromEntries(
      LOCALES.map(({ code }) => [code, draftFrom(translations.find((entry) => entry.locale === code))]),
    ) as Record<LocaleCode, Draft>,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const draft = drafts[locale];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDrafts((current) => ({ ...current, [locale]: { ...current[locale], [key]: value } }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const text = (value: string) => (value.trim() === "" ? null : value.trim());

    try {
      await setTourTranslation(tour.id, locale, {
        title: text(draft.title),
        location: text(draft.location),
        summary: text(draft.summary),
        description: draft.description
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean),
        highlights: draft.highlights,
        included: draft.included,
        excluded: draft.excluded,
        importantInfo: draft.importantInfo,
        meetingPoint: text(draft.meetingPoint),
        durationLabel: text(draft.durationLabel),
        groupSize: text(draft.groupSize),
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
      <div className="flex gap-1 border-b border-line" role="tablist" aria-label="Language">
        {LOCALES.map((entry) => {
          const filled = Boolean(drafts[entry.code].title);
          return (
            <button
              key={entry.code}
              type="button"
              role="tab"
              aria-selected={locale === entry.code}
              onClick={() => setLocale(entry.code)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 text-[0.8125rem] font-medium transition-colors",
                locale === entry.code ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {entry.label}
              <span className={cn("ms-2 text-[0.6875rem]", filled ? "text-success" : "text-subtle")}>
                {filled ? "●" : "○"}
              </span>
            </button>
          );
        })}
      </div>

      {/* The language tabs above stay live for a reader; only the fields lock. */}
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-6">
      <AdminPanel title="Listing" description={`English: “${tour.title}” — ${tour.summary}`}>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput className="sm:col-span-2" label="Title" value={draft.title} onChange={(e) => set("title", e.target.value)} error={fieldErrors.title} />
          <TextInput label="Region" value={draft.location} onChange={(e) => set("location", e.target.value)} placeholder={tour.location} />
          <TextInput label="Length as a traveller reads it" value={draft.durationLabel} onChange={(e) => set("durationLabel", e.target.value)} placeholder={tour.durationLabel} />
          <TextInput label="Group size" value={draft.groupSize} onChange={(e) => set("groupSize", e.target.value)} placeholder={tour.groupSize} />
          <TextInput label="Meeting point" value={draft.meetingPoint} onChange={(e) => set("meetingPoint", e.target.value)} placeholder={tour.meetingPoint} />
          <TextArea className="sm:col-span-2" label="Summary" rows={2} value={draft.summary} onChange={(e) => set("summary", e.target.value)} placeholder={tour.summary} />
          <TextArea className="sm:col-span-2" label="Description" rows={8} value={draft.description} onChange={(e) => set("description", e.target.value)} hint="A blank line starts a new paragraph. Leave empty to show the English." />
        </div>
      </AdminPanel>

      <AdminPanel title="Lists" description="One entry per line. An empty list shows the English one.">
        <div className="grid gap-5 sm:grid-cols-2">
          <LineListInput label="Highlights" value={draft.highlights} onChange={(next) => set("highlights", next)} rows={6} placeholder={tour.highlights.join("\n")} />
          <LineListInput label="Important information" value={draft.importantInfo} onChange={(next) => set("importantInfo", next)} rows={6} placeholder={tour.importantInfo.join("\n")} />
          <LineListInput label="Included" value={draft.included} onChange={(next) => set("included", next)} rows={6} placeholder={tour.included.join("\n")} />
          <LineListInput label="Not included" value={draft.excluded} onChange={(next) => set("excluded", next)} rows={6} placeholder={tour.excluded.join("\n")} />
        </div>
      </AdminPanel>
      </fieldset>

      <FormError message={error} />

      {canEdit ? (
        <div className="flex justify-end">
          <SubmitButton type="submit" busy={busy} saved={saved}>
            {saved ? "Saved" : `Save ${LOCALES.find((entry) => entry.code === locale)?.label}`}
          </SubmitButton>
        </div>
      ) : (
        <ReadOnlyNote needs={["catalogue.write", "tours.write"]} what="Editing translations" />
      )}
    </form>
  );
}
