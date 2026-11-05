"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, Star, X } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { publishRating, rejectRating } from "@/lib/api/ratings";
import { useLocalePath } from "@/lib/i18n/provider";
import type { RatingAdmin, RatingStatus } from "@/types/driver";

/**
 * The ratings queue. Words wait here for a look; a score without words was
 * published on arrival and only appears under "published".
 */
export function RatingsQueue({ data, total, page, totalPages, status }: { data: RatingAdmin[]; total: number; page: number; totalPages: number; status: RatingStatus }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const path = useLocalePath();
  const can = useCan();
  const canModerate = can("dispatch.write");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    router.push(`${pathname}?${next}`);
  };

  const decide = async (rating: RatingAdmin, decision: "publish" | "reject") => {
    setBusy(`${decision}-${rating.id}`);
    setError(null);

    try {
      if (decision === "publish") await publishRating(rating.id);
      else await rejectRating(rating.id);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const stars = (score: number) => (
    <span className="inline-flex items-center gap-0.5" aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star key={value} size={14} className={value <= score ? "text-accent-gold" : "text-line"} fill={value <= score ? "currentColor" : "none"} aria-hidden />
      ))}
    </span>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Rating status">
        {(["PENDING", "PUBLISHED", "REJECTED"] as RatingStatus[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            onClick={() => setParam("status", value)}
            className={`h-9 rounded-sm border px-3 text-[0.8125rem] font-medium transition-colors ${
              status === value ? "border-ink bg-ink text-on-dark" : "border-line bg-surface text-body hover:border-ink/40"
            }`}
          >
            {value === "PENDING" ? "Waiting for a look" : value === "PUBLISHED" ? "Published" : "Rejected"}
          </button>
        ))}
        <p className="ms-auto text-[0.8125rem] text-muted" aria-live="polite">
          {total} {total === 1 ? "rating" : "ratings"}
        </p>
      </div>

      {error && <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">{error}</p>}

      {!canModerate && data.length > 0 && (
        <ReadOnlyNote needs="dispatch.write" what="Publishing or rejecting a rating" className="mt-6" />
      )}

      {data.length === 0 ? (
        <p className="mt-6 rounded-sm border border-dashed border-line p-8 text-center text-[0.875rem] text-muted">Nothing here.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {data.map((rating) => (
            <li key={rating.id} className="rounded-sm border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    {stars(rating.score)}
                    {rating.driver && (
                      <Link href={path(`/admin/transfers/drivers/${rating.driver.id}`)} className="text-[0.875rem] font-medium text-ink underline-offset-4 hover:underline">
                        {rating.driver.firstName} {rating.driver.lastName}
                      </Link>
                    )}
                    {rating.booking && (
                      <Link href={path(`/admin/transfers/bookings/${rating.booking.reference}`)} className="text-[0.8125rem] text-muted underline-offset-4 hover:underline">
                        {rating.booking.reference}
                      </Link>
                    )}
                  </div>
                  {rating.comment && <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">“{rating.comment}”</p>}
                  <p className="mt-2 text-[0.75rem] text-subtle">
                    {rating.source === "GUEST" ? `Passenger · ${rating.submittedByEmail ?? ""}` : rating.source === "PARTNER" ? `Partner · ${rating.submittedBy?.fullName ?? ""}` : `Operations · ${rating.submittedBy?.fullName ?? ""}`}
                    {" · "}
                    {new Date(rating.createdAt).toLocaleDateString("en-GB")}
                    {rating.moderatedBy && ` · ${rating.status.toLowerCase()} by ${rating.moderatedBy.fullName}`}
                    {rating.moderationNote && ` — ${rating.moderationNote}`}
                  </p>
                </div>

                {canModerate && (rating.status !== "PUBLISHED" || rating.comment) ? (
                  <div className="flex shrink-0 gap-2">
                    {rating.status !== "PUBLISHED" && (
                      <button type="button" disabled={busy !== null} onClick={() => void decide(rating, "publish")} className="inline-flex h-9 items-center gap-1.5 rounded-sm bg-brand px-3 text-[0.8125rem] font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
                        {busy === `publish-${rating.id}` ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
                        Publish
                      </button>
                    )}
                    {rating.status !== "REJECTED" && (
                      <button type="button" disabled={busy !== null} onClick={() => void decide(rating, "reject")} className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line px-3 text-[0.8125rem] font-medium text-body hover:border-error/50 hover:text-error-text disabled:opacity-50">
                        {busy === `reject-${rating.id}` ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <X size={14} aria-hidden />}
                        Reject
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Pagination" className="mt-4 flex items-center justify-end gap-2 text-[0.8125rem] text-muted">
        <button type="button" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))} className="h-8 rounded-sm border border-line px-3 disabled:opacity-40">
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button type="button" disabled={page >= totalPages} onClick={() => setParam("page", String(page + 1))} className="h-8 rounded-sm border border-line px-3 disabled:opacity-40">
          Next
        </button>
      </nav>
    </div>
  );
}
