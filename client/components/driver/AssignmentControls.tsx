"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AlertTriangle, Check, Loader2, Undo2, X } from "lucide-react";

import { ApiError, describeError } from "@/lib/api/client";
import { acceptAssignment, declineAssignment, updateAssignmentStatus } from "@/lib/api/driverPanel";
import { driverActionLabels } from "@/lib/admin/dispatch";
import { canHandBack, driverMoves } from "@/lib/driver/assignment";
import { cn } from "@/lib/utils";
import type { DriverAssignment } from "@/types/driver";
import type { TransferLegStatus } from "@/types/transfer";

/** What is waiting on a second press, if anything. */
type Pending = null | "decline" | "handBack" | "noShow";

// Shape and size kept apart: `cn` joins classes without merging them, so a
// button takes exactly one height and one type size.
const BUTTON =
  "flex w-full items-center justify-center gap-2 rounded-sm px-4 text-center font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
const XL = "min-h-16 text-[1.0625rem]";
const LG = "min-h-14 text-[1rem]";
const MD = "min-h-12 text-[0.9375rem]";
const SECONDARY = "border border-line bg-surface text-body hover:border-ink/40 hover:text-ink";

/**
 * The buttons a driver presses.
 *
 * One big primary action — the next step the server says is legal — and the
 * alternatives underneath. Every press sends `expectedFrom`, so a tap that
 * lands twice on a bad connection cannot skip a step: the second one comes
 * back as a conflict and the screen simply refreshes.
 *
 * The presses that cannot be taken back — turning an offer down, handing an
 * accepted job back, reporting a no-show — ask once more, in place, with a
 * way out. A pocket tap must not cost a passenger their car.
 */
export function AssignmentControls({ assignment }: { assignment: DriverAssignment }) {
  const router = useRouter();
  const reasonId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");

  const run = async (key: string, call: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);

    try {
      await call();
      router.refresh();
    } catch (caught) {
      const details = caught instanceof ApiError ? (caught.details as { reason?: string } | undefined) : undefined;

      if (details?.reason === "STALE_STATE") {
        router.refresh();
        return;
      }

      setError(describeError(caught));
    } finally {
      setBusy(null);
      setPending(null);
    }
  };

  const moves = driverMoves(assignment);
  const [primary, ...rest] = moves;
  const handBack = canHandBack(assignment);

  const move = (to: TransferLegStatus) =>
    run(to, () => updateAssignmentStatus(assignment.id, { to, expectedFrom: assignment.leg.status }));

  const cancel = () => {
    setPending(null);
    setReason("");
  };

  const spinner = (key: string, icon: React.ReactNode = null) =>
    busy === key ? <Loader2 size={18} className="animate-spin" aria-hidden /> : icon;

  const errorLine = error && (
    <p role="alert" className="text-[0.9375rem] text-error-text">
      {error}
    </p>
  );

  /** Turning down an offer, or handing back an accepted job: same call, same question. */
  const declinePanel = (confirmLabel: string) => (
    <div className="space-y-3 rounded-md border border-error/30 bg-surface p-4">
      <div>
        <label htmlFor={reasonId} className="block text-[0.875rem] font-medium text-ink">
          <bdi>
            Why not? <span className="font-normal text-muted">(optional)</span>
          </bdi>
        </label>
        <p id={`${reasonId}-hint`} className="mt-0.5 text-[0.8125rem] text-muted">
          <bdi>Dispatch reads this when they find someone else.</bdi>
        </p>
        <input
          id={reasonId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          aria-describedby={`${reasonId}-hint`}
          dir="auto"
          autoFocus
          className="mt-2 h-12 w-full rounded-sm border border-line bg-surface px-3 text-[1rem] text-ink focus:border-ink focus:outline-none"
        />
      </div>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void run("decline", () => declineAssignment(assignment.id, reason.trim() || undefined))}
        className={cn(BUTTON, LG, "bg-error text-white hover:bg-error/90")}
      >
        {spinner("decline")}
        {confirmLabel}
      </button>
      <button type="button" disabled={busy !== null} onClick={cancel} className={cn(BUTTON, MD, SECONDARY)}>
        {pending === "decline" ? "Go back" : "Keep the job"}
      </button>
    </div>
  );

  if (assignment.canAccept) {
    return (
      <section aria-label="Answer the offer" className="space-y-3">
        {pending === "decline" ? (
          declinePanel("Decline the job")
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("accept", () => acceptAssignment(assignment.id))}
              className={cn(BUTTON, LG, "bg-brand text-white hover:bg-brand-hover")}
            >
              {spinner("accept", <Check size={18} aria-hidden />)}
              Accept this job
            </button>
            <button type="button" disabled={busy !== null} onClick={() => setPending("decline")} className={cn(BUTTON, LG, SECONDARY)}>
              <X size={18} aria-hidden />
              I can&apos;t take it
            </button>
          </>
        )}
        {errorLine}
      </section>
    );
  }

  if (!primary && !handBack) {
    return errorLine || null;
  }

  const noShowButton = (className: string) => (
    <button
      key="NO_SHOW_REPORTED"
      type="button"
      disabled={busy !== null}
      onClick={() => setPending("noShow")}
      className={cn(BUTTON, className)}
    >
      <AlertTriangle size={17} aria-hidden />
      {driverActionLabels.NO_SHOW_REPORTED}
    </button>
  );

  return (
    <section aria-label="Your next step" className="space-y-3">
      {pending === "noShow" ? (
        <div role="group" aria-labelledby={`${reasonId}-noshow`} className="space-y-3 rounded-md border border-warning/50 bg-surface p-4">
          <p id={`${reasonId}-noshow`} className="text-[0.9375rem] leading-relaxed text-ink">
            <bdi>Report that the passenger did not show? Dispatch is told at once and will try to reach them.</bdi>
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void move("NO_SHOW_REPORTED")}
            className={cn(BUTTON, LG, "bg-warning text-ink hover:bg-warning/90")}
          >
            {spinner("NO_SHOW_REPORTED", <AlertTriangle size={18} aria-hidden />)}
            Yes, report a no-show
          </button>
          <button type="button" disabled={busy !== null} onClick={cancel} className={cn(BUTTON, MD, SECONDARY)}>
            Go back
          </button>
        </div>
      ) : pending === "handBack" ? (
        declinePanel("Hand the job back")
      ) : (
        <>
          {primary &&
            (primary === "NO_SHOW_REPORTED" ? (
              noShowButton(cn(XL, "bg-warning text-ink hover:bg-warning/90"))
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void move(primary)}
                className={cn(BUTTON, XL, "bg-brand text-white hover:bg-brand-hover")}
              >
                {spinner(primary, <Check size={20} aria-hidden />)}
                {driverActionLabels[primary] ?? primary}
              </button>
            ))}

          {rest.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {rest.map((state) =>
                state === "NO_SHOW_REPORTED" ? (
                  noShowButton(cn(MD, "border border-warning/50 bg-surface text-warning-text hover:border-warning"))
                ) : (
                  <button
                    key={state}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void move(state)}
                    className={cn(BUTTON, MD, SECONDARY)}
                  >
                    {spinner(state)}
                    {driverActionLabels[state] ?? state}
                  </button>
                ),
              )}
            </div>
          )}

          {handBack && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setPending("handBack")}
              className="mx-auto flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-[0.875rem] text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
            >
              <Undo2 size={15} className="rtl:-scale-x-100" aria-hidden />
              I can no longer take this job
            </button>
          )}
        </>
      )}

      {errorLine}
    </section>
  );
}
