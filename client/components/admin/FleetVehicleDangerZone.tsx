"use client";

import { useRouter } from "next/navigation";
import { Archive, CarFront, Loader2, PauseCircle, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import {
  activateFleetVehicle,
  archiveFleetVehicle,
  deleteFleetVehicle,
  updateFleetVehicle,
} from "@/lib/api/fleet";
import type { FleetVehicleAdmin } from "@/types/driver";

/**
 * Whether a car can be dispatched — and, for an admin, whether it exists.
 *
 * Three positions. On the road: dispatch offers it. Off the road: a service,
 * a repair — kept, not offered. Archived: sold or written off — never
 * offered again, and the plate is free for its replacement. The server
 * refuses to archive a car with a job still ahead of it, and lists the jobs;
 * they are shown here rather than summarised, because "reassign these first"
 * is only useful with the references in hand.
 *
 * Deleting is a fourth thing, and an admin's alone: for a car added by
 * mistake, and only while it has never been on a job. The plate has to be
 * typed back, the same guard the partner delete uses — a misclick on the
 * wrong car should fail, not destroy it.
 */
export function FleetVehicleDangerZone({
  vehicle,
  canDelete = false,
  listHref,
}: {
  vehicle: FleetVehicleAdmin;
  /** Admins only; the server refuses everyone else regardless. */
  canDelete?: boolean;
  /** Where to go once the car is gone. */
  listHref?: string;
}) {
  const router = useRouter();
  const can = useCan();
  // On and off the road, and archiving, are dispatch's; deleting is the
  // admin's, decided by the page.
  const canDispatch = can("dispatch.write");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<Array<{ bookingReference: string; windowStart: string }>>([]);

  const run = async (
    action: () => Promise<unknown>,
    { then = "refresh" }: { then?: "refresh" | "list" } = {},
  ) => {
    setBusy(true);
    setError(null);
    setBlocking([]);

    try {
      await action();
      setConfirming(false);
      setDeleting(false);

      if (then === "list" && listHref) {
        router.push(listHref);
      }

      router.refresh();
    } catch (caught) {
      const details =
        caught instanceof ApiError
          ? (caught.details as { reason?: string; assignments?: typeof blocking } | undefined)
          : undefined;
      if (details?.reason === "ACTIVE_ASSIGNMENTS") {
        setBlocking(details.assignments ?? []);
      }
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const secondary =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60";
  const destructive =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40";
  const outlined =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8";

  const plateMatches = typed.trim().toUpperCase() === vehicle.plateNumber.trim().toUpperCase();

  const deleteSection = canDelete && (
    <div className="mt-6 border-t border-line pt-5">
      <p className="text-[0.8125rem] font-semibold text-ink">Delete this car</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
        For a car added by mistake. Only possible while it has never been on a job — after that,
        archive it. Its photographs and documents go with it.
      </p>

      {!deleting ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setDeleting(true)}
          className={`${outlined} mt-3`}
        >
          <Trash2 size={15} aria-hidden />
          Delete car…
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <TextInput
            label={`Type ${vehicle.plateNumber} to confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !plateMatches}
              onClick={() => run(() => deleteFleetVehicle(vehicle.id), { then: "list" })}
              className={destructive}
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <Trash2 size={15} aria-hidden />
              )}
              Delete for good
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDeleting(false);
                setTyped("");
              }}
              className={secondary}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (vehicle.status === "ARCHIVED") {
    return (
      <AdminPanel title="This car is archived">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          It is never offered to dispatch. Its past assignments still name it. Bringing it back
          needs its plate to be free.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">
            {error}
          </p>
        )}
        {canDispatch ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => activateFleetVehicle(vehicle.id))}
            className={`${secondary} mt-4`}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <CarFront size={15} aria-hidden />
            )}
            Put back on the road
          </button>
        ) : (
          <ReadOnlyNote needs="dispatch.write" what="Putting this car back on the road" className="mt-4" />
        )}
        {deleteSection}
      </AdminPanel>
    );
  }

  if (!canDispatch) {
    return (
      <AdminPanel title="Availability">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          {vehicle.status === "ACTIVE" ? "Dispatch offers this car." : "Not offered to dispatch right now."}
        </p>
        <ReadOnlyNote needs="dispatch.write" what="Taking this car on or off the road, or archiving it" className="mt-4" />
        {deleteSection}
      </AdminPanel>
    );
  }

  return (
    <AdminPanel title="Availability" className="border-error/30">
      {vehicle.status === "ACTIVE" ? (
        <>
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            Dispatch offers this car. Take it off the road for a service without losing anything;
            archive it when it leaves the fleet for good.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => updateFleetVehicle(vehicle.id, { status: "INACTIVE" }))}
            className={`${secondary} mt-4`}
          >
            <PauseCircle size={15} aria-hidden />
            Take off the road
          </button>
        </>
      ) : (
        <>
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            Not offered to dispatch right now.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => activateFleetVehicle(vehicle.id))}
            className={`${secondary} mt-4`}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <CarFront size={15} aria-hidden />
            )}
            Put on the road
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}

      {blocking.length > 0 && (
        <ul className="mt-2 space-y-1 text-[0.75rem] text-muted">
          {blocking.map((row) => (
            <li key={row.bookingReference}>
              {row.bookingReference} · {new Date(row.windowStart).toLocaleString("en-GB")}
            </li>
          ))}
        </ul>
      )}

      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className={`${outlined} mt-3`}>
          <Archive size={15} aria-hidden />
          Archive car
        </button>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => archiveFleetVehicle(vehicle.id))}
            className={destructive}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Archive size={15} aria-hidden />
            )}
            Archive {vehicle.plateNumber}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className={secondary}
          >
            Cancel
          </button>
        </div>
      )}

      {deleteSection}
    </AdminPanel>
  );
}
