"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "./AdminViewerContext";
import { updateTransferVehicle } from "@/lib/api/transfers";

/**
 * Whether a class is sold to the public.
 *
 * Everything is B2B by default, exactly as hotels are, so this is the switch
 * that opens a class to the website. A toggle rather than a form because it is
 * one boolean and an operator flipping it should not have to find a save button.
 *
 * Archived classes are shown as such and cannot be toggled: reopening one is a
 * decision with more to it than a checkbox, and the API would refuse anyway.
 *
 * Without `catalogue.write` the same badge is shown as plain text: the state
 * is worth reading, the switch would only answer 403.
 */
export function TransferVehicleChannel({
  id,
  b2cEnabled,
  archived,
}: {
  id: string;
  b2cEnabled: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const can = useCan();
  const [enabled, setEnabled] = useState(b2cEnabled);
  const [saving, setSaving] = useState(false);

  if (archived) {
    return <span className="text-[0.8125rem] text-subtle">Archived</span>;
  }

  if (!can("catalogue.write")) {
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-sm border px-2.5 py-1 text-[0.75rem] font-semibold ${
          enabled
            ? "border-success/40 bg-success/10 text-success"
            : "border-line bg-surface-soft text-muted"
        }`}
      >
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${enabled ? "bg-success" : "bg-subtle"}`}
        />
        {enabled ? "Public" : "Trade only"}
      </span>
    );
  }

  const toggle = async () => {
    const next = !enabled;

    // Moved optimistically: the switch is the feedback, and a spinner on a
    // boolean reads as hesitation.
    setEnabled(next);
    setSaving(true);

    try {
      await updateTransferVehicle(id, { b2cEnabled: next });
      router.refresh();
    } catch {
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={toggle}
      disabled={saving}
      className={`inline-flex items-center gap-2 rounded-sm border px-2.5 py-1 text-[0.75rem] font-semibold transition-colors disabled:opacity-60 ${
        enabled
          ? "border-success/40 bg-success/10 text-success"
          : "border-line bg-surface-soft text-muted"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${enabled ? "bg-success" : "bg-subtle"}`}
      />
      {enabled ? "Public" : "Trade only"}
    </button>
  );
}
