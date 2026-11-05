"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { AssignDriverModal } from "./AssignDriverModal";
import { describeError } from "@/lib/api/client";
import { cancelLeg, setLegStatus, unassignLeg } from "@/lib/api/dispatch";
import { legStatusLabels } from "@/lib/admin/dispatch";
import type { DispatchLeg } from "@/types/driver";
import type { TransferLegStatus } from "@/types/transfer";

/**
 * What a dispatcher can do to one leg, from the board or the booking page.
 *
 * The status menu lists only what the server says is allowed from here —
 * `allowedTransitions` comes from the same table the API enforces — minus the
 * three moves that have their own buttons.
 *
 * Renders nothing for a viewer without `dispatch.write`: every control here
 * would answer 403, and the leg's status and driver are shown beside it anyway.
 */
export function LegActions({ leg, compact = false }: { leg: DispatchLeg; compact?: boolean }) {
  const router = useRouter();
  const can = useCan();
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!can("dispatch.write")) return null;

  const run = async (key: string, call: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);

    try {
      await call();
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const moves = leg.allowedTransitions.filter(
    (state) => !["ASSIGNED", "UNASSIGNED", "CANCELLED"].includes(state),
  ) as TransferLegStatus[];
  const terminal = ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(leg.status);
  const held = leg.assignment !== null;

  const button =
    "inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-2.5 text-[0.75rem] font-medium text-body transition-colors hover:border-ink hover:text-ink disabled:opacity-50";

  return (
    <div className={compact ? "flex flex-wrap items-center gap-1.5" : "space-y-2"}>
      {!terminal && (
        <button type="button" onClick={() => setAssigning(true)} className={held ? button : `${button} border-brand text-brand-text`}>
          {held ? "Reassign" : "Assign"}
        </button>
      )}

      {held && leg.allowedTransitions.includes("UNASSIGNED") && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            const reason = window.prompt("Why is the driver being taken off?");
            if (reason) void run("unassign", () => unassignLeg(leg.id, reason));
          }}
          className={button}
        >
          {busy === "unassign" ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
          Unassign
        </button>
      )}

      {moves.length > 0 && (
        <select
          aria-label="Move this leg to"
          value=""
          disabled={busy !== null}
          onChange={(event) => {
            const to = event.target.value as TransferLegStatus;
            if (!to) return;
            void run("status", () => setLegStatus(leg.id, { to, expectedFrom: leg.status }));
          }}
          className="h-8 rounded-sm border border-line bg-surface px-2 text-[0.75rem] text-body focus:border-ink focus:outline-none"
        >
          <option value="">Mark as…</option>
          {moves.map((state) => (
            <option key={state} value={state}>
              {legStatusLabels[state]}
            </option>
          ))}
        </select>
      )}

      {leg.allowedTransitions.includes("CANCELLED") && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm("Cancel this leg only? The booking stays until every leg is done.")) {
              void run("cancel", () => cancelLeg(leg.id, "Cancelled by operations"));
            }
          }}
          className={`${button} hover:border-error/50 hover:text-error-text`}
        >
          Cancel leg
        </button>
      )}

      {error && (
        <p role="alert" className="w-full text-[0.75rem] text-error-text">
          {error}
        </p>
      )}

      <AssignDriverModal leg={leg} open={assigning} onClose={() => setAssigning(false)} onDone={() => router.refresh()} />
    </div>
  );
}
