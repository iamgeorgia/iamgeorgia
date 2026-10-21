"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Star, Trash2, Upload } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { attachPackageImage, detachPackageImage, updatePackageImage } from "@/lib/api/packages";
import { uploadMedia } from "@/lib/api/media";
import { describeError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { PackageWithChecklist } from "@/types/package";

/**
 * The package gallery.
 *
 * The tour manager's twin over the package endpoints: upload chains two calls
 * — the file into the media library, the asset onto this package — and shows
 * one action. Once a package has an uploaded image the site prefers it over
 * the editorial path on the record, and the cover is what cards show.
 */
export function PackageGalleryManager({ pkg }: { pkg: PackageWithChecklist }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const can = useCan();
  const canEdit = can("catalogue.write");
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

    // Sequential on purpose: image processing is synchronous server-side.
    for (const file of Array.from(files)) {
      await run(`upload-${file.name}`, async () => {
        const asset = await uploadMedia(file, "PACKAGE_IMAGE", pkg.name);
        await attachPackageImage(pkg.id, { fileAssetId: asset.id });
      });
    }

    if (fileInput.current) fileInput.current.value = "";
  };

  const cardUrl = (image: PackageWithChecklist["images"][number]) =>
    image.variants.find((variant) => variant.variant === "card")?.url ?? image.url;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-surface p-4">
        {canEdit ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              onChange={(event) => void upload(event.target.files)}
              className="sr-only"
              id="package-gallery-upload"
            />
            <label
              htmlFor="package-gallery-upload"
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
              Upload images
            </label>
          </>
        ) : (
          <ReadOnlyNote
            needs="catalogue.write"
            what="Adding, removing or re-covering images"
            className="w-full"
          />
        )}

        {pkg.image && pkg.images.length === 0 && (
          <p className="text-[0.8125rem] text-muted">
            Showing the editorial image <span className="font-mono text-[0.75rem]">{pkg.image}</span> until
            something is uploaded.
          </p>
        )}

        <p aria-live="polite" className="text-[0.75rem]">
          {error && <span className="text-error-text">{error}</span>}
        </p>
      </div>

      {pkg.images.length === 0 ? (
        <p className="mt-6 rounded-sm border border-dashed border-line p-10 text-center text-[0.875rem] text-muted">
          No images uploaded yet. The publish checklist wants a cover — either an editorial path on the
          details screen or an upload here.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pkg.images.map((image) => (
            <li key={image.packageImageId} className="overflow-hidden rounded-sm border border-line bg-surface">
              <div className="relative aspect-4/3 bg-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- API-served */}
                <img src={cardUrl(image)} alt={image.altText ?? ""} className="size-full object-cover" />
                {image.isCover && (
                  <span className="absolute top-2 start-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[0.6875rem] font-semibold text-ink">
                    <Star size={11} aria-hidden />
                    Cover
                  </span>
                )}
              </div>
              {canEdit && (
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  disabled={busy !== null || image.isCover}
                  onClick={() => run(`cover-${image.packageImageId}`, () => updatePackageImage(pkg.id, image.packageImageId, { isCover: true }))}
                  className="text-[0.75rem] font-medium text-ink hover:underline disabled:opacity-40"
                >
                  {busy === `cover-${image.packageImageId}` ? "Setting…" : "Make cover"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm("Remove this image from the package?")) {
                      void run(`remove-${image.packageImageId}`, () => detachPackageImage(pkg.id, image.packageImageId));
                    }
                  }}
                  aria-label="Remove image"
                  className="text-subtle hover:text-error-text disabled:opacity-40"
                >
                  {busy === `remove-${image.packageImageId}` ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Trash2 size={14} aria-hidden />
                  )}
                </button>
              </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
