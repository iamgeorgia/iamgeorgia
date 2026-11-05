"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ApiError, describeError } from "@/lib/api/client";
import { deleteDestination } from "@/lib/api/hotels";
import { useLocalePath } from "@/lib/i18n/provider";
import type { Destination } from "@/types/catalogue";

/**
 * Deleting a destination.
 *
 * A real delete, unlike the transfer catalogue's retire-in-place, and the copy
 * says so plainly. Nothing about a destination is historical — a booking
 * references a hotel, never the geography above it — so once nothing is filed
 * here the row can go.
 *
 * The interesting case is the refusal. Hotels, children, tours and experiences
 * hold this row with `Restrict`, and rather than let the constraint speak the
 * server answers 409 with `blockedBy` naming what is in the way. That object is
 * the whole reason this panel is not a plain confirm dialog: "3 hotels, 2
 * children" tells an operator where to go next, and "could not delete" does
 * not.
 */

/** The server's `blockedBy` map, when the refusal carried one. */
const blockersFrom = (error: unknown): [string, number][] => {
  if (!(error instanceof ApiError) || error.status !== 409) return [];

  const details = error.details as { blockedBy?: Record<string, number> } | null;
  return Object.entries(details?.blockedBy ?? {});
};

/** Both forms spelled out — "children" does not pluralise by suffix. */
const blockerLabels: Record<string, [singular: string, plural: string]> = {
  hotels: ["hotel", "hotels"],
  children: ["destination inside it", "destinations inside it"],
  tours: ["tour", "tours"],
  experiences: ["experience", "experiences"],
};

const describeBlocker = ([key, count]: [string, number]) => {
  const [singular, plural] = blockerLabels[key] ?? [key, key];
  return `${count} ${count === 1 ? singular : plural}`;
};

export function DestinationDangerZone({ destination }: { destination: Destination }) {
  const router = useRouter();
  const path = useLocalePath();
  const can = useCan();

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<[string, number][]>([]);

  // The panel is the action: without the capability there is nothing to show.
  if (!can("catalogue.write")) return null;

  // What the record already knows, before anyone presses anything. The counts
  // come from the detail read, so an obviously-occupied destination never gets
  // as far as a confirmation.
  const known =
    destination.children.length > 0
      ? [["children", destination.children.length] as [string, number]]
      : [];

  const remove = async () => {
    setBusy(true);
    setError(null);
    setBlockers([]);

    try {
      await deleteDestination(destination.id);
      router.push(path("/admin/destinations"));
      router.refresh();
      // Left busy on purpose: the navigation is in flight, and the record this
      // panel describes no longer exists.
      return;
    } catch (caught) {
      setBlockers(blockersFrom(caught));
      setError(describeError(caught, "Could not delete this destination."));
    }

    setBusy(false);
  };

  const inTheWay = blockers.length > 0 ? blockers : known;

  return (
    <AdminPanel title="Delete this destination" className="border-error/30">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Permanent, and only possible once nothing is filed here. Hotels, tours and the
        destinations inside this one all hold it, and the server refuses while any of them do
        rather than taking them with it.
      </p>

      {inTheWay.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-sm bg-warning/12 p-3 text-[0.8125rem] leading-relaxed text-warning-text">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Still attached: {inTheWay.map(describeBlocker).join(", ")}. Move or remove{" "}
            {inTheWay.length === 1 ? "it" : "them"} first.
          </span>
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
          <Trash2 size={15} aria-hidden />
          Delete destination
        </button>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Trash2 size={15} aria-hidden />
            )}
            Delete {destination.name}
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
