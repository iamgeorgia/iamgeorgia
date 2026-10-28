"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { archiveTransferRoute, updateTransferRoute } from "@/lib/api/transfers";
import type { TransferRoute } from "@/types/transfer";

/**
 * Taking a route off sale for good.
 *
 * Archiving rather than deleting, for the usual reason — bookings reference
 * the route and a voucher has to keep describing the journey that was sold —
 * but with one distinction worth spelling out on the screen itself, because
 * the panel offers both and they look similar:
 *
 * **Unpublishing** is reversible and routine. The route drops out of the
 * public catalogue, keeps its fares, and goes back on sale with one click.
 * That is what an operator wants for a road closed until spring.
 *
 * **Archiving** is the end of the route. It is what you do when the journey
 * itself no longer exists as a product. Restoring is possible from here, but
 * it comes back as a draft that has to be published again — which is the right
 * amount of friction for something that was retired on purpose.
 */
export function TransferRouteDangerZone({ route }: { route: TransferRoute }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archived = route.status === "ARCHIVED";

  // The archive panel is nothing but the action; the archived panel also
  // explains the state, which a reader still needs.
  if (!canEdit && !archived) return null;

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

  if (archived) {
    return (
      <AdminPanel title="This route is archived">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          It cannot be searched or quoted. Its fares are still on file and come back with it.
          Restoring returns it as a draft — it has to be published again before anyone can book
          it.
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
            onClick={() => run(() => updateTransferRoute(route.id, { status: "DRAFT" }))}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <RotateCcw size={15} aria-hidden />
            )}
            Restore as a draft
          </button>
        ) : (
          <ReadOnlyNote className="mt-4" needs="catalogue.write" what="Restoring this route" />
        )}
      </AdminPanel>
    );
  }

  return (
    <AdminPanel title="Archive this route" className="border-error/30">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Ends the journey as a product. It stops being searchable or quotable, and its landing page
        goes with it. Fares stay on file and every booking that took this route keeps its own
        frozen copy of it.
      </p>

      {route.status === "ACTIVE" && (
        <p className="mt-3 flex items-start gap-2 rounded-sm bg-warning/12 p-3 text-[0.8125rem] leading-relaxed text-warning-text">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          This route is live and selling. If the road is closed for a season, unpublish it or add a
          closed-dates window instead — both are reversible in one click, and this is not.
        </p>
      )}

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
          <Archive size={15} aria-hidden />
          Archive route
        </button>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => archiveTransferRoute(route.id))}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Archive size={15} aria-hidden />
            )}
            Archive this route
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
