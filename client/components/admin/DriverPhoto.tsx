"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Trash2, Upload, UserRound } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { describeError } from "@/lib/api/client";
import { updateDriver } from "@/lib/api/drivers";
import { uploadMedia } from "@/lib/api/media";
import { driverDisplayName } from "@/lib/admin/fleet";
import type { DriverAdmin } from "@/types/driver";

/** The face the passenger looks for in arrivals. Public, by design. */
export function DriverPhoto({ driver }: { driver: DriverAdmin }) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("dispatch.write");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);

    try {
      await call();
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const url = driver.photo?.variants.find((variant) => variant.variant === "card")?.url ?? driver.photo?.url;

  return (
    <AdminPanel title="Photo" description="Shown to partners and passengers. A clear, recent face.">
      <div className="flex items-center gap-4">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- API-served
          <img src={url} alt={driverDisplayName(driver)} className="h-24 w-24 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-surface-soft text-subtle">
            <UserRound size={32} aria-hidden />
          </span>
        )}

        {/* Without the right the face is still shown; only the controls go. */}
        {canEdit && (
        <div className="flex flex-col gap-2">
          <input
            ref={fileInput}
            id="driver-photo-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void run(async () => {
                const asset = await uploadMedia(file, "DRIVER_PHOTO", driverDisplayName(driver));
                await updateDriver(driver.id, { photoFileAssetId: asset.id });
              });
            }}
          />
          <label
            htmlFor="driver-photo-upload"
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-line px-3 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink hover:text-ink"
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}
            {driver.photo ? "Replace" : "Upload"}
          </label>
          {driver.photo && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => updateDriver(driver.id, { photoFileAssetId: null }))}
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-line px-3 text-[0.8125rem] font-medium text-body transition-colors hover:border-error/50 hover:text-error-text disabled:opacity-50"
            >
              <Trash2 size={14} aria-hidden />
              Remove
            </button>
          )}
        </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}
    </AdminPanel>
  );
}
