"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { archiveTransferVehicle, updateTransferVehicle } from "@/lib/api/transfers";
import type { TransferVehicle } from "@/types/transfer";

/**
 * Taking a vehicle class off sale.
 *
 * Archiving, not deleting, and the button says archive. Bookings hold this row
 * — a voucher issued last spring still has to be able to name the car it was
 * sold — so the API offers no delete and inventing one in the panel would
 * only mean a failed request with a worse message.
 *
 * Archiving clears the public channel as a side effect, which is the point:
 * a class that is off sale should not be quietly still on the website because
 * somebody forgot a second switch. Restoring brings it back trade-only, so
 * re-opening it to the public stays a deliberate act.
 */
export function TransferVehicleDangerZone({ vehicle }: { vehicle: TransferVehicle }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archived = vehicle.status === "ARCHIVED";

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
      <AdminPanel title="This class is archived">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          It is out of search entirely and cannot be quoted. Its fares on every route are still on
          file and come back with it. Restoring returns it trade-only — opening it to the public
          again is a separate switch.
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
            onClick={() => run(() => updateTransferVehicle(vehicle.id, { status: "ACTIVE" }))}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <RotateCcw size={15} aria-hidden />
            )}
            Restore this class
          </button>
        ) : (
          <ReadOnlyNote className="mt-4" needs="catalogue.write" what="Restoring this class" />
        )}
      </AdminPanel>
    );
  }

  return (
    <AdminPanel title="Archive this class" className="border-error/30">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Takes it out of search for everybody — public, partners and staff alike — and closes the
        public channel. Nothing is deleted: its fares stay on file and every booking that chose it
        keeps resolving. You can restore it from this panel.
      </p>

      {vehicle.b2cEnabled && (
        <p className="mt-3 flex items-start gap-2 rounded-sm bg-warning/12 p-3 text-[0.8125rem] leading-relaxed text-warning-text">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          This class is on sale to the public right now. If you only want it off the website,
          switch the channel to trade-only instead — that leaves partners able to book it.
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
          Archive class
        </button>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => archiveTransferVehicle(vehicle.id))}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Archive size={15} aria-hidden />
            )}
            Archive {vehicle.name}
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
