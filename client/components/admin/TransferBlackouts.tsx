"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { createTransferBlackout, deleteTransferBlackout } from "@/lib/api/transfers";
import type { TransferBlackout } from "@/types/transfer";

/**
 * When a road is shut.
 *
 * This is the constraint that stands in for inventory. A private transfer has
 * no seat count to run out — a supplier subcontracts a second car and the
 * journey still happens — but a mountain road genuinely closes, and Georgia has
 * several that do: Tusheti from October, Shatili in winter, the Goderdzi pass in
 * snow. Selling a January transfer to Omalo is a promise nobody can keep.
 *
 * A closed window removes the route from search entirely for those dates, with
 * its own wording rather than "no vehicles available" — the traveller's next
 * move is a different date, not a smaller party.
 */
export function TransferBlackouts({
  routeId,
  blackouts,
}: {
  routeId: string;
  blackouts: TransferBlackout[];
}) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);

    try {
      await createTransferBlackout({ routeId, from, to, reason: reason.trim() || undefined });

      setFrom("");
      setTo("");
      setReason("");
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not close those dates."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);

    try {
      await deleteTransferBlackout(id);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not reopen those dates."));
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none";
  const labelClass = "mb-1.5 block text-[0.75rem] font-semibold text-muted";

  return (
    <div>
      {blackouts.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {blackouts.map((blackout) => (
            <li key={blackout.id} className="flex items-center justify-between gap-4 py-3">
              <span className="min-w-0">
                <span className="block text-[0.875rem] font-medium text-ink tabular-nums">
                  {blackout.from} to {blackout.to}
                </span>
                {blackout.reason && (
                  <span className="block text-[0.75rem] text-subtle">{blackout.reason}</span>
                )}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(blackout.id)}
                  disabled={busy}
                  aria-label={`Reopen ${blackout.from} to ${blackout.to}`}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-line px-2.5 text-[0.75rem] text-muted transition-colors hover:border-error/40 hover:text-error-text disabled:opacity-50"
                >
                  <Trash2 size={13} aria-hidden />
                  Reopen
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.875rem] text-muted">
          This route is open all year.{canEdit && " Close a window when the road is impassable."}
        </p>
      )}

      {!canEdit && (
        <ReadOnlyNote className="mt-5" needs="catalogue.write" what="Closing or reopening dates" />
      )}

      {canEdit && (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <label>
              <span className={labelClass}>Closed from</span>
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label>
              <span className={labelClass}>Closed until</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label>
              <span className={labelClass}>Reason (optional)</span>
              <input
                value={reason}
                placeholder="Snow on the pass"
                onChange={(event) => setReason(event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>

          <p className="mt-2 text-[0.75rem] text-subtle">Both dates are inclusive.</p>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-sm border border-error/40 bg-surface px-4 py-3 text-[0.875rem] text-error-text"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={add}
            disabled={busy || !from || !to}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-sm border border-ink/25 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft disabled:opacity-50"
          >
            <Plus size={15} aria-hidden />
            Close these dates
          </button>
        </>
      )}
    </div>
  );
}
