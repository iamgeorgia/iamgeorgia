"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { FormError, SubmitButton, TextArea, TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { setPackageTranslation } from "@/lib/api/packages";
import { cn } from "@/lib/utils";
import type { PackageTranslation, PackageWithChecklist } from "@/types/package";

/**
 * The prose of a package in the other three languages.
 *
 * Every field is optional: a blank one falls back to English on the public
 * page rather than blanking it, so a half-translated package is still whole.
 * Facts — nights, dates, party limits, the adjustment — are not language and
 * are not here.
 */

const LOCALES = [
  { code: "ka", label: "ქართული" },
  { code: "ru", label: "Русский" },
  { code: "he", label: "עברית" },
] as const;

type LocaleCode = (typeof LOCALES)[number]["code"];

interface Draft {
  name: string;
  summary: string;
  description: string;
}

const draftFrom = (translation: PackageTranslation | undefined): Draft => ({
  name: translation?.name ?? "",
  summary: translation?.summary ?? "",
  description: (translation?.description ?? []).join("\n\n"),
});

export function PackageTranslationsEditor({
  pkg,
  translations,
}: {
  pkg: PackageWithChecklist;
  translations: PackageTranslation[];
}) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");
  const [locale, setLocale] = useState<LocaleCode>("ka");
  const [drafts, setDrafts] = useState<Record<LocaleCode, Draft>>(() =>
    Object.fromEntries(
      LOCALES.map(({ code }) => [
        code,
        draftFrom(translations.find((entry) => entry.locale === code)),
      ]),
    ) as Record<LocaleCode, Draft>,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<LocaleCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = drafts[locale];

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(null);
    setDrafts((current) => ({ ...current, [locale]: { ...current[locale], [key]: value } }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      await setPackageTranslation(pkg.id, locale, {
        name: draft.name.trim() || null,
        summary: draft.summary.trim() || null,
        // A blank line separates paragraphs, as it does in the English record.
        description: draft.description
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean),
      });

      setSaved(locale);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Locale" className="flex gap-1.5">
        {LOCALES.map(({ code, label }) => (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={locale === code}
            onClick={() => setLocale(code)}
            className={cn(
              "h-9 rounded-sm border px-3 text-[0.8125rem] font-medium transition-colors",
              locale === code
                ? "border-brand bg-brand-soft text-brand-text"
                : "border-line text-muted hover:border-ink hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The locale tabs above stay live for a reader; only the fields lock. */}
      <fieldset
        disabled={!canEdit}
        className="mt-5 flex min-w-0 flex-col gap-4"
        dir={locale === "he" ? "rtl" : "ltr"}
      >
        <TextInput
          label="Name"
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
        />
        <TextArea
          label="Summary"
          rows={3}
          value={draft.summary}
          onChange={(event) => set("summary", event.target.value)}
        />
        <TextArea
          label="Description"
          hint="A blank line starts a new paragraph."
          rows={8}
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </fieldset>

      <FormError message={error} />

      <div className="mt-5">
        {canEdit ? (
          <SubmitButton busy={busy} saved={saved === locale} onClick={() => void save()}>
            Save {LOCALES.find((entry) => entry.code === locale)?.label}
          </SubmitButton>
        ) : (
          <ReadOnlyNote needs="catalogue.write" what="Editing translations" />
        )}
      </div>
    </div>
  );
}
