"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, CheckCircle2, EyeOff, Loader2, Star, Trash2 } from "lucide-react";

import {
  archivePackage,
  deletePackage,
  publishPackage,
  unpublishPackage,
  updatePackage,
} from "@/lib/api/packages";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { PackageWithChecklist } from "@/types/package";

/**
 * Lifecycle transitions and the two switches for one package.
 *
 * Which buttons appear mirrors the server's rules as a courtesy; the server
 * enforces them regardless and answers 409 or 422 when a stale page tries a
 * transition that no longer applies.
 */
export function PackageActions({ pkg }: { pkg: PackageWithChecklist }) {
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

  const remove = async () => {
    setBusy("delete");
    setError(null);

    try {
      await deletePackage(pkg.id);
      router.push(path("/admin/packages"));
    } catch (caught) {
      // Two different refusals with two different fixes: an order exists
      // (nothing to be done, archive instead), or the package is still
      // referenced. Only the first can happen to a package today, but the
      // server's wording is the honest one either way.
      setError(describeError(caught));
      setBusy(null);
    }
  };

  // Every transition here is a write behind `catalogue.write`; a viewer
  // without it gets the checklist above and this line.
  if (!can("catalogue.write")) {
    return <ReadOnlyNote needs="catalogue.write" what="Publishing or changing this package" />;
  }

  const base =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm px-4 text-[0.8125rem] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
  const status = pkg.status ?? "DRAFT";
  const canPublish = status === "DRAFT" || status === "INACTIVE";
  const canUnpublish = status === "ACTIVE";
  const canArchive = status !== "ARCHIVED";
  const editable = status !== "ARCHIVED";
  const checklistClear = pkg.publishChecklist.length === 0;
  const b2c = pkg.b2cEnabled ?? false;

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
      disabled={busy !== null || !editable}
      onClick={() => void run(key, call, note)}
      className="flex w-full items-start justify-between gap-3 rounded-sm border border-line px-3 py-2.5 text-start transition-colors hover:border-ink disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block text-[0.8125rem] font-medium text-ink">{label}</span>
        <span className="block text-[0.75rem] text-muted">{hint}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          on ? "bg-brand" : "bg-line",
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full bg-white transition-transform",
            on && "translate-x-4 rtl:-translate-x-4",
          )}
        />
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {toggle(
          "b2c",
          b2c,
          "Sell to the public",
          b2c ? "Visible to anonymous visitors" : "Trade only",
          () => updatePackage(pkg.id, { b2cEnabled: !b2c }),
          b2c ? "Now trade only." : "Now on the public site.",
        )}
        {toggle(
          "featured",
          pkg.featured,
          "Feature",
          "Shown first on the packages page",
          () => updatePackage(pkg.id, { featured: !pkg.featured }),
          pkg.featured ? "No longer featured." : "Featured.",
        )}
      </div>

      {canPublish && (
        <button
          type="button"
          disabled={busy !== null || !checklistClear}
          onClick={() => void run("publish", () => publishPackage(pkg.id), "Published.")}
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
          onClick={() => void run("unpublish", () => unpublishPackage(pkg.id), "Taken off sale.")}
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
          onClick={() => void run("archive", () => archivePackage(pkg.id), "Archived.")}
          className={cn(base, "border border-line text-muted hover:border-ink hover:text-ink")}
        >
          {busy === "archive" ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <Archive size={15} aria-hidden />
          )}
          Archive
        </button>
      )}

      {/* Deleting is only ever right for a template nobody has bought; the
          server refuses the rest with 409 HAS_ORDERS. */}
      {status === "DRAFT" && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void remove()}
          className={cn(base, "border border-error/40 text-error-text hover:bg-error/5")}
        >
          {busy === "delete" ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <Trash2 size={15} aria-hidden />
          )}
          Delete
        </button>
      )}

      {!checklistClear && canPublish && (
        <p className="text-[0.75rem] text-muted">
          Publishing unlocks once the checklist above is clear.
        </p>
      )}
      {message && <p className="text-[0.8125rem] text-success">{message}</p>}
      {error && (
        <p role="alert" className="text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}
      {pkg.featured && status !== "ACTIVE" && (
        <p className="flex items-start gap-1.5 text-[0.75rem] text-muted">
          <Star size={12} className="mt-0.5 shrink-0" aria-hidden />
          Featured, but not on sale — nothing will show it until it is published.
        </p>
      )}
    </div>
  );
}
