"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { ApiError, describeError } from "@/lib/api/client";
import { deleteService } from "@/lib/api/services";
import { useLocalePath } from "@/lib/i18n/provider";
import type { Service } from "@/types/service";

/**
 * Deleting a service, and the two reasons the server refuses.
 *
 * They are different problems with different fixes and so are worded
 * separately: `IN_PACKAGE` means a template still names this service and the
 * operator must edit that package first, which they can do; `HAS_BOOKINGS`
 * means somebody has bought it and the record has to survive for the voucher
 * and the audit trail, so archiving is the only honest option.
 *
 * Collapsing both into "could not delete" would send an operator hunting for
 * a booking that does not exist.
 */
export function ServiceDangerZone({ service }: { service: Service }) {
  const router = useRouter();
  const path = useLocalePath();
  const can = useCan();

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The panel is nothing but the delete action, so a viewer who cannot
  // delete (`catalogue.write`) sees no panel rather than a disabled one.
  if (!can("catalogue.write")) return null;

  const remove = async () => {
    setBusy(true);
    setError(null);

    try {
      await deleteService(service.id);
      router.push(path("/admin/services"));
    } catch (caught) {
      const reason =
        caught instanceof ApiError
          ? (caught.details as { reason?: string } | undefined)?.reason
          : undefined;

      setError(
        reason === "IN_PACKAGE"
          ? "A package still has a slot pointing at this service. Remove that slot first, then delete."
          : reason === "HAS_BOOKINGS"
            ? "This service has been booked, so its record has to stay for the vouchers and the audit trail. Archive it instead — that takes it off sale without destroying anything."
            : describeError(caught),
      );
      setBusy(false);
    }
  };

  return (
    <AdminPanel title="Delete this service" className="border-error/30">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        Only possible while nothing has been sold and no package names it. Once either is true,
        archiving is the way to take it off sale.
      </p>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-[0.8125rem] text-error-text">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
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
          Delete service
        </button>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Trash2 size={15} aria-hidden />
            )}
            Delete permanently
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
