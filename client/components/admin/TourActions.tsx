"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, CheckCircle2, EyeOff, Loader2, Star, Trash2 } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { archiveTour, deleteTour, publishTour, unpublishTour, updateTour } from "@/lib/api/tours";
import { ApiError, describeError } from "@/lib/api/client";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { TourWithChecklist } from "@/types/tour";

/**
 * Lifecycle transitions and the two switches for one tour.
 *
 * Which buttons appear mirrors the server's rules as a courtesy; the server
 * enforces them regardless and answers 409 or 422 when a stale page tries a
 * transition that no longer applies.
 */
export function TourActions({ tour }: { tour: TourWithChecklist }) {
  const router = useRouter();
  const path = useLocalePath();
  const can = useCan();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: string, call: () => Promise<unknown>, note: string) => {
    setBusy(action);
    setError(null);
    setMessage(null);

    try {
      await call();
      setMessage(note);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        const missing = (caught.details as { missing?: { message: string }[] } | undefined)?.missing;
        setError(
          missing?.length
            ? `Not ready to publish: ${missing.map((item) => item.message.toLowerCase()).join("; ")}.`
            : caught.message,
        );
      } else {
        setError(describeError(caught));
      }
    } finally {
      setBusy(null);
    }
  };

  // Every transition here is a write the tours router gates on either
  // capability; a viewer without one gets the checklist above and this line.
  if (!can("catalogue.write", "tours.write")) {
    return <ReadOnlyNote needs={["catalogue.write", "tours.write"]} what="Publishing or changing this tour" />;
  }

  const base =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
  const status = tour.status ?? "DRAFT";
  const canPublish = status === "DRAFT" || status === "INACTIVE";
  const canUnpublish = status === "ACTIVE";
  const canArchive = status !== "ARCHIVED";
  const editable = status !== "ARCHIVED";
  const checklistClear = tour.publishChecklist.length === 0;
  const b2c = tour.b2cEnabled ?? false;

  const toggle = (
    key: string,
    on: boolean,
    label: string,
    hint: string,
    call: () => Promise<unknown>,
    note: string,
  ) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy !== null}
      onClick={() => run(key, call, note)}
      className="flex w-full items-center justify-between gap-3 rounded-sm border border-line px-4 py-2.5 text-start transition-colors hover:border-ink disabled:pointer-events-none disabled:opacity-50"
    >
      <span>
        <span className="block text-[0.8125rem] font-semibold text-ink">{label}</span>
        <span className="block text-[0.75rem] text-muted">{hint}</span>
      </span>
      {busy === key ? (
        <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            on ? "bg-brand" : "bg-ink/20",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-4 rounded-full bg-white transition-[inset-inline-start]",
              on ? "inset-s-4.5" : "inset-s-0.5",
            )}
          />
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      {editable &&
        toggle(
          "channel",
          b2c,
          "Public sale (B2C)",
          b2c ? "Shown to everyone" : "Partners only",
          () => updateTour(tour.id, { b2cEnabled: !b2c }),
          b2c ? "Off the public site. Partners still see it." : "On the public site for everyone.",
        )}
      {editable &&
        toggle(
          "featured",
          tour.featured,
          "Featured",
          tour.featured ? "On the homepage rail" : "Not featured",
          () => updateTour(tour.id, { featured: !tour.featured }),
          tour.featured ? "No longer featured." : "Featured on the homepage.",
        )}

      {canPublish && (
        <button
          type="button"
          disabled={busy !== null || !checklistClear}
          onClick={() => run("publish", () => publishTour(tour.id), "Published. The tour is now on sale.")}
          className={cn(base, "bg-brand text-white hover:bg-brand-hover")}
        >
          {busy === "publish" ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 size={15} aria-hidden />
          )}
          Publish
        </button>
      )}

      {canUnpublish && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run("unpublish", () => unpublishTour(tour.id), "Taken off sale. Existing bookings are unaffected.")
          }
          className={cn(base, "border border-ink/20 text-ink hover:border-ink hover:bg-surface-soft")}
        >
          {busy === "unpublish" ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <EyeOff size={15} aria-hidden />
          )}
          Take off sale
        </button>
      )}

      {canArchive && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm(`Archive ${tour.title}? This is permanent.`)) {
              run("archive", () => archiveTour(tour.id), "Archived.");
            }
          }}
          className={cn(base, "border border-error/40 text-error-text hover:bg-error/8")}
        >
          {busy === "archive" ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <Archive size={15} aria-hidden />
          )}
          Archive
        </button>
      )}

      {/* Hard delete, for tours never sold. The server answers 409 the moment
          a booking exists, so this can be offered without knowing the count. */}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => {
          if (window.confirm(`Delete ${tour.title} and its images for good? This cannot be undone.`)) {
            setBusy("delete");
            setError(null);
            deleteTour(tour.id)
              .then(() => router.push(path("/admin/tours")))
              .catch((caught: unknown) => {
                setBusy(null);
                setError(describeError(caught));
              });
          }
        }}
        className={cn(base, "border border-error/40 text-error-text hover:bg-error/8")}
      >
        {busy === "delete" ? (
          <Loader2 size={15} className="animate-spin" aria-hidden />
        ) : (
          <Trash2 size={15} aria-hidden />
        )}
        Delete
      </button>

      <p aria-live="polite" className="min-h-5 text-[0.75rem]">
        {error ? (
          <span className="text-error-text">{error}</span>
        ) : (
          message && (
            <span className="flex items-center gap-1 text-muted">
              {message.includes("Featured") && <Star size={11} aria-hidden />}
              {message}
            </span>
          )
        )}
      </p>
    </div>
  );
}
