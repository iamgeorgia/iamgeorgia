"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { retireTransferPoint, updateTransferPoint } from "@/lib/api/transfers";
import type { TransferPoint } from "@/types/transfer";

/**
 * Taking a pick-up point out of service, and putting it back.
 *
 * "Retire", not "delete", and the copy says so plainly rather than using the
 * softer word over a button that destroys things. Routes hold this row with
 * `Restrict` and booking legs reference it for reporting, so the server turns
 * a `DELETE` into a status change — which means the honest label is the one
 * describing what happens, and the action is reversible from the same panel.
 *
 * What retiring actually does: the point stops appearing in the traveller's
 * picker and in the public catalogue. Routes that run through it keep existing
 * and keep their fares — a retired *point* is not a cancelled *route*, and an
 * operator who wants the journey off sale wants the route archived instead.
 * That distinction is the reason this panel has three sentences on it.
 */
export function TransferPointDangerZone({ point }: { point: TransferPoint }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retired = point.status === "INACTIVE" || point.status === "ARCHIVED";

  // The retire panel is nothing but the action; the retired panel also
  // explains the state, which a reader still needs.
  if (!canEdit && !retired) return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);

    try {
      await action();
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (retired) {
    return (
      <AdminPanel title="This point is retired">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          It is hidden from the pick-up picker and from the public catalogue. Any route through it
          still exists and still carries its fares — bringing the point back makes those journeys
          bookable again exactly as they were.
        </p>

        {error && (
          <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">
            {error}
          </p>
        )}

        {canEdit ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => updateTransferPoint(point.id, { status: "ACTIVE" }))}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <RotateCcw size={15} aria-hidden />
            )}
            Put back in service
          </button>
        ) : (
          <ReadOnlyNote className="mt-4" needs="catalogue.write" what="Putting this point back in service" />
        )}
      </AdminPanel>
    );
  }

  return (
    <AdminPanel title="Retire this point" className="border-error/30">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Removes it from the pick-up picker and the public catalogue. Nothing is deleted: routes
        through this point keep their fares, past bookings keep resolving, and you can put it back
        from this panel.
      </p>

      <p className="mt-3 flex items-start gap-2 rounded-sm bg-warning/12 p-3 text-[0.8125rem] leading-relaxed text-warning-text">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
        Routes through here stay on sale. If a journey should stop being sold, archive the route
        rather than retiring one end of it.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8"
        >
          <Trash2 size={15} aria-hidden />
          Retire point
        </button>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => retireTransferPoint(point.id))}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Trash2 size={15} aria-hidden />
            )}
            Retire {point.name}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="inline-flex h-10 w-full items-center justify-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      )}
    </AdminPanel>
  );
}
