"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, CheckCircle2, EyeOff, Loader2 } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import { archiveService, publishService, unpublishService } from "@/lib/api/services";
import { cn } from "@/lib/utils";
import type { ServiceWithChecklist } from "@/types/service";

/**
 * Lifecycle transitions for one service.
 *
 * Which buttons appear mirrors the server's rules as a courtesy; the server
 * enforces them regardless and answers 409 or 422 when a stale page tries a
 * transition that no longer applies. A 422 carries `details.missing` — the
 * same checklist rendered above these buttons — so a publish refused by a
 * checklist that changed under the operator still says what is missing rather
 * than "not ready".
 */
export function ServiceActions({ service }: { service: ServiceWithChecklist }) {
  const router = useRouter();
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

  // Every transition here is a write behind `catalogue.write`; a viewer
  // without it gets the checklist above and this line.
  if (!can("catalogue.write")) {
    return <ReadOnlyNote needs="catalogue.write" what="Publishing or changing this service" />;
  }

  const base =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
  const status = service.status ?? "DRAFT";
  const archived = status === "ARCHIVED";
  const checklistClear = service.publishChecklist.length === 0;

  return (
    <div className="flex flex-col gap-2">
      {(status === "DRAFT" || status === "INACTIVE") && (
        <button
          type="button"
          disabled={busy !== null || !checklistClear}
          onClick={() =>
            run("publish", () => publishService(service.id), "Published. Packages can sell it.")
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

      {status === "ACTIVE" && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run(
              "unpublish",
              () => unpublishService(service.id),
              "Taken off sale. Bookings already made are unaffected.",
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

      {/* Archiving is the end of the service, and the server means it: there is
          no un-archive transition, and an archived record refuses every edit
          with a 409. Hence the confirmation, and hence no restore button
          offering something the API would not honour. */}
      {archived ? (
        <p className="rounded-sm bg-surface-soft/60 px-4 py-3 text-[0.8125rem] leading-relaxed text-muted">
          Archived, and archiving is final — the service cannot be edited or put back on sale.
          Deleting it is still possible while nothing has booked it and no package names it.
        </p>
      ) : (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm(`Archive ${service.name}? Packages that name it stop selling it.`)) {
              run("archive", () => archiveService(service.id), "Archived.");
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

      <p aria-live="polite" className="min-h-5 text-[0.75rem]">
        {error ? <span className="text-error-text">{error}</span> : <span className="text-muted">{message}</span>}
      </p>
    </div>
  );
}
