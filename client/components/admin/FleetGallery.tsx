"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Star, Trash2, Upload } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { describeError } from "@/lib/api/client";
import { attachFleetImage, detachFleetImage, updateFleetImage } from "@/lib/api/fleet";
import { uploadMedia } from "@/lib/api/media";
import { fleetVehicleLabel } from "@/lib/admin/fleet";
import { cn } from "@/lib/utils";
import type { FleetVehicleAdmin } from "@/types/driver";

/**
 * A car's photographs.
 *
 * The same two-step as the hotel gallery — upload to the media library, then
 * attach — shown as one action. The cover is the main image the partner and
 * the passenger see; the server keeps the two in step.
 */
export function FleetGallery({ vehicle }: { vehicle: FleetVehicleAdmin }) {
  const router = useRouter();
  const can = useCan();
  // Without the right the photographs are still shown; upload, star and remove go.
  const canEdit = can("dispatch.write");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      await run(`upload-${file.name}`, async () => {
        const asset = await uploadMedia(file, "FLEET_IMAGE", fleetVehicleLabel(vehicle));
        await attachFleetImage(vehicle.id, { fileAssetId: asset.id });
      });
    }

    if (fileInput.current) fileInput.current.value = "";
  };

  const cardUrl = (image: FleetVehicleAdmin["images"][number]) =>
    image.variants.find((variant) => variant.variant === "card")?.url ?? image.url;

  return (
    <AdminPanel
      title="Photographs"
      description="What the partner and the passenger see. The starred one is the main image."
    >
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            onChange={(event) => void upload(event.target.files)}
            className="sr-only"
            id="fleet-gallery-upload"
          />
          <label
            htmlFor="fleet-gallery-upload"
            className={cn(
              "inline-flex h-10 cursor-pointer items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover",
              busy?.startsWith("upload") && "pointer-events-none opacity-50",
            )}
          >
            {busy?.startsWith("upload") ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Upload size={15} aria-hidden />
            )}
            Upload photos
          </label>
          <p aria-live="polite" className="text-[0.75rem]">
            {error && <span className="text-error-text">{error}</span>}
          </p>
        </div>
      )}

      {vehicle.images.length === 0 ? (
        <p className={cn("rounded-sm border border-dashed border-line p-8 text-center text-[0.875rem] text-muted", canEdit && "mt-5")}>
          No photographs yet. A partner meeting a guest wants to know what to look for.
        </p>
      ) : (
        <ul className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3", canEdit && "mt-5")}>
          {vehicle.images.map((image) => (
            <li key={image.imageId} className="relative overflow-hidden rounded-sm border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- API-served */}
              <img src={cardUrl(image)} alt={image.altText ?? ""} className="aspect-4/3 w-full object-cover" />
              {canEdit && (
              <div className="flex items-center justify-end gap-2 bg-surface px-3 py-2">
                <button
                  type="button"
                  disabled={busy !== null || image.isCover}
                  onClick={() =>
                    void run(`cover-${image.imageId}`, () =>
                      updateFleetImage(vehicle.id, image.imageId, { isCover: true }),
                    )
                  }
                  aria-label={image.isCover ? "Main image" : "Make main image"}
                  aria-pressed={image.isCover}
                  className={cn("transition-colors", image.isCover ? "text-warning" : "text-subtle hover:text-ink")}
                >
                  <Star size={15} aria-hidden fill={image.isCover ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm("Remove this photograph?")) {
                      void run(`detach-${image.imageId}`, () => detachFleetImage(vehicle.id, image.imageId));
                    }
                  }}
                  aria-label="Remove photograph"
                  className="text-subtle transition-colors hover:text-error-text"
                >
                  {busy === `detach-${image.imageId}` ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                  ) : (
                    <Trash2 size={15} aria-hidden />
                  )}
                </button>
              </div>
              )}
              {image.isCover && (
                <span className="absolute start-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[0.6875rem] font-medium text-white">
                  Main
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}
