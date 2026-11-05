"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, CheckCircle2, EyeOff, Loader2, Trash2 } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { archiveHotel, deleteHotel, publishHotel, unpublishHotel, updateHotel } from "@/lib/api/hotels";
import { ApiError, describeError } from "@/lib/api/client";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { HotelWithChecklist } from "@/types/catalogue";

/**
 * Lifecycle transitions for one property.
 *
 * Which buttons appear is derived from a client-side mirror of the server's
 * rules — a courtesy, not a control. The server enforces the transitions
 * regardless and answers 409 or 422 when a stale page tries one that no longer
 * applies, and those errors are surfaced rather than swallowed.
 *
 * Every transition is a catalogue write, so a viewer without that capability
 * sees the checklist above and one line here instead of five buttons that
 * would each answer 403.
 */
export function HotelActions({ hotel }: { hotel: HotelWithChecklist }) {
  const router = useRouter();
  const path = useLocalePath();
  const can = useCan();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!can("catalogue.write")) {
    return <ReadOnlyNote needs="catalogue.write" what="Publishing, archiving or deleting this property" />;
  }

  const run = async (action: string, call: () => Promise<unknown>, note: string) => {
    setBusy(action);
    setError(null);
    setMessage(null);

    try {
      await call();
      setMessage(note);
      // The page is a Server Component; refreshing re-reads the record rather
      // than patching a local copy that could drift from the server's.
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        // The publish checklist, as the server sees it right now — which may
        // be newer than the one this page rendered with.
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

  const base =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
  const canPublish = hotel.status === "DRAFT" || hotel.status === "INACTIVE";
  const canUnpublish = hotel.status === "ACTIVE";
  const canArchive = hotel.status !== "ARCHIVED";
  const editable = hotel.status !== "ARCHIVED";
  const checklistClear = hotel.publishChecklist.length === 0;
  const b2c = hotel.b2cEnabled ?? false;

  return (
    <div className="flex flex-col gap-2">
      {/* The sales channel, separate from the lifecycle: everything is B2B by
          default, and this is the one control that puts a property in front of
          anonymous visitors. Off, it exists only for signed-in partners. */}
      {editable && (
        <button
          type="button"
          role="switch"
          aria-checked={b2c}
          disabled={busy !== null}
          onClick={() =>
            run(
              "channel",
              () => updateHotel(hotel.id, { b2cEnabled: !b2c }),
              b2c
                ? "Off the public site. Partners still see it."
                : "On the public site for everyone.",
            )
          }
          className="flex w-full items-center justify-between gap-3 rounded-sm border border-line px-4 py-2.5 text-start transition-colors hover:border-ink disabled:pointer-events-none disabled:opacity-50"
        >
          <span>
            <span className="block text-[0.8125rem] font-semibold text-ink">Public sale (B2C)</span>
            <span className="block text-[0.75rem] text-muted">
              {b2c ? "Shown to everyone" : "Partners only"}
            </span>
          </span>
          {busy === "channel" ? (
            <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden />
          ) : (
            <span
              aria-hidden
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                b2c ? "bg-brand" : "bg-ink/20",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white transition-[inset-inline-start]",
                  b2c ? "inset-s-4.5" : "inset-s-0.5",
                )}
              />
            </span>
          )}
        </button>
      )}
      {canPublish && (
        <button
          type="button"
          disabled={busy !== null || !checklistClear}
          onClick={() =>
            run("publish", () => publishHotel(hotel.id), "Published. The property is now on sale.")
          }
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
            run(
              "unpublish",
              () => unpublishHotel(hotel.id),
              "Taken off sale. Existing bookings are unaffected.",
            )
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
            // Terminal, so it gets a confirm even though nothing is deleted.
            if (window.confirm(`Archive ${hotel.name}? This is permanent.`)) {
              run("archive", () => archiveHotel(hotel.id), "Archived.");
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

      {/* Hard delete, for properties that were never sold. The server refuses
          with a 409 the moment any booking exists — archiving is the path for
          those — so this can be offered without knowing the booking count. */}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => {
          if (
            window.confirm(
              `Delete ${hotel.name} and its images for good? This cannot be undone.`,
            )
          ) {
            setBusy("delete");
            setError(null);
            deleteHotel(hotel.id)
              .then(() => router.push(path("/admin/hotels")))
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
          message && <span className="text-muted">{message}</span>
        )}
      </p>
    </div>
  );
}
