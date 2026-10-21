"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { DriverVerificationBadge } from "./FleetBadges";
import { FormError, SelectInput, SubmitButton, TextArea } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { describeError } from "@/lib/api/client";
import { verifyDriver } from "@/lib/api/drivers";
import { verificationOptions } from "@/lib/admin/fleet";
import type { DriverAdmin, DriverVerificationStatus } from "@/types/driver";

/**
 * Whether we have checked this person.
 *
 * VERIFIED is what the partner sees as a tick. It records who said so and
 * when, and moving away from it clears both — so the record never wears a
 * verifier's name for a status they did not give.
 */
export function DriverVerification({ driver }: { driver: DriverAdmin }) {
  const router = useRouter();
  const can = useCan();
  const canVerify = can("dispatch.write");
  const [status, setStatus] = useState<DriverVerificationStatus>(driver.verificationStatus);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      await verifyDriver(driver.id, { status, note: note.trim() || null });
      setNote("");
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPanel title="Verification">
      <div className="flex items-center justify-between gap-3">
        <DriverVerificationBadge status={driver.verificationStatus} />
        {driver.verifiedAt && (
          <span className="text-[0.75rem] text-subtle">
            {new Date(driver.verifiedAt).toLocaleDateString("en-GB")}
            {driver.verifiedBy ? ` · ${driver.verifiedBy.fullName}` : ""}
          </span>
        )}
      </div>

      {canVerify ? (
        <>
          <div className="mt-4 space-y-4">
            <SelectInput
              label="Set to"
              value={status}
              onChange={(event) => setStatus(event.target.value as DriverVerificationStatus)}
              options={verificationOptions}
            />
            <TextArea
              label="Note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              hint="What was checked. Kept in the audit trail, not on the profile."
            />
          </div>

          <FormError message={error} />

          <SubmitButton className="mt-4" busy={busy} disabled={status === driver.verificationStatus && !note.trim()} onClick={save}>
            {busy ? "Saving…" : "Record"}
          </SubmitButton>
        </>
      ) : (
        <ReadOnlyNote needs="dispatch.write" what="Recording a verification decision" className="mt-4" />
      )}
    </AdminPanel>
  );
}
