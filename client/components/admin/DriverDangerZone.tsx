"use client";

import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2, UserX } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { CheckboxField, TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import { deactivateDriver, deleteDriver, reactivateDriver } from "@/lib/api/drivers";
import type { DriverAdmin } from "@/types/driver";

/**
 * Taking a driver off the roster — and, for an admin, off the books.
 *
 * Deactivating ends their login and their sessions at once. With jobs still
 * ahead of them the server refuses and lists the bookings; the operator can
 * reassign those first or tick "force", which sends every one of them back to
 * the dispatch board unassigned.
 *
 * Deleting is for a profile created by mistake, and only while the driver
 * has never been on a job — the server keeps every assignment's driver. It
 * takes the login with the profile, so the email is free for whoever comes
 * next. The surname has to be typed back first.
 */
export function DriverDangerZone({
  driver,
  canDelete = false,
  listHref,
}: {
  driver: DriverAdmin;
  /** Admins only; the server refuses everyone else regardless. */
  canDelete?: boolean;
  /** Where to go once the driver is gone. */
  listHref?: string;
}) {
  const router = useRouter();
  const can = useCan();
  // Taking a driver off the roster and putting them back is dispatch's call;
  // deleting is the admin's, decided by the page.
  const canDispatch = can("dispatch.write");
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<Array<{ bookingReference: string; pickupAt: string }>>([]);

  const run = async (action: () => Promise<unknown>, { then = "refresh" }: { then?: "refresh" | "list" } = {}) => {
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
      const details = caught instanceof ApiError ? (caught.details as { reason?: string; assignments?: typeof blocking } | undefined) : undefined;
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

  const nameMatches = typed.trim().toLowerCase() === driver.lastName.trim().toLowerCase();

  const deleteSection = canDelete && (
    <div className="mt-6 border-t border-line pt-5">
      <p className="text-[0.8125rem] font-semibold text-ink">Delete this driver</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
        For a profile created by mistake. Only possible while they have never been on a job —
        after that, deactivate them. Their login, documents and photo go with the profile.
      </p>

      {!deleting ? (
        <button type="button" disabled={busy} onClick={() => setDeleting(true)} className={`${outlined} mt-3`}>
          <Trash2 size={15} aria-hidden />
          Delete driver…
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <TextInput
            label={`Type ${driver.lastName} to confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !nameMatches}
              onClick={() => run(() => deleteDriver(driver.id), { then: "list" })}
              className={destructive}
            >
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Trash2 size={15} aria-hidden />}
              Delete for good
            </button>
            <button type="button" disabled={busy} onClick={() => { setDeleting(false); setTyped(""); }} className={secondary}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (!driver.isActive) {
    return (
      <AdminPanel title="This driver is deactivated">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          {driver.deactivationReason ?? "No reason recorded."}
          {driver.deactivatedAt && ` · ${new Date(driver.deactivatedAt).toLocaleDateString("en-GB")}`}
        </p>
        {error && <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">{error}</p>}
        {canDispatch ? (
          <button type="button" disabled={busy} onClick={() => run(() => reactivateDriver(driver.id))} className={`${secondary} mt-4`}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RotateCcw size={15} aria-hidden />}
            Reactivate
          </button>
        ) : (
          <ReadOnlyNote needs="dispatch.write" what="Reactivating this driver" className="mt-4" />
        )}
        {deleteSection}
      </AdminPanel>
    );
  }

  return (
    <AdminPanel title="Deactivate" className="border-error/30">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Ends their login and signs them out everywhere. Refused while they still have jobs ahead,
        unless you send those back to dispatch.
      </p>

      {!canDispatch ? (
        <ReadOnlyNote needs="dispatch.write" what="Deactivating this driver" className="mt-4" />
      ) : !confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className={`${outlined} mt-4`}>
          <UserX size={15} aria-hidden />
          Deactivate driver
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <TextInput label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <CheckboxField
            label="Send any upcoming jobs back to dispatch"
            checked={force}
            onChange={setForce}
          />
          {blocking.length > 0 && (
            <ul className="space-y-1 text-[0.75rem] text-muted">
              {blocking.map((row) => (
                <li key={row.bookingReference}>
                  {row.bookingReference} · {new Date(row.pickupAt).toLocaleString("en-GB")}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => run(() => deactivateDriver(driver.id, { reason: reason.trim(), force }))}
              className={destructive}
            >
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <UserX size={15} aria-hidden />}
              Deactivate
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={secondary}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">{error}</p>}

      {deleteSection}
    </AdminPanel>
  );
}
