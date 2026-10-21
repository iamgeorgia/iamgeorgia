"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Star, Trash2, Upload } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { attachHotelImage, attachRoomImage, detachHotelImage, updateHotelImage } from "@/lib/api/hotels";
import { uploadMedia } from "@/lib/api/media";
import { describeError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { HotelWithChecklist, ImageCategory } from "@/types/catalogue";

/**
 * The gallery editor.
 *
 * Upload chains two API calls — the file into the media library, the asset
 * onto this hotel — and shows one action, because that is what it is to the
 * operator. A rejected file (an executable in a .jpg coat, an SVG, an
 * oversized photo) is refused by the server with a reason, and the reason is
 * shown verbatim: the server's message is better than anything invented here.
 */

const CATEGORIES: ImageCategory[] = [
  "Exterior",
  "Lobby",
  "Restaurant",
  "Pool",
  "Spa",
  "Room",
  "Bathroom",
  "View",
  "Facilities",
];

export function GalleryManager({ hotel }: { hotel: HotelWithChecklist }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const can = useCan();
  // Uploading, attaching, re-covering and detaching are all catalogue writes;
  // a reader gets the pictures and the cover mark, and none of the controls.
  const canEdit = can("catalogue.write");
  const [category, setCategory] = useState<ImageCategory>("Exterior");
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

    // Sequential on purpose: image processing is synchronous server-side, and
    // a burst of parallel uploads would just queue behind one another anyway.
    for (const file of Array.from(files)) {
      // eslint-disable-next-line no-await-in-loop
      await run(`upload-${file.name}`, async () => {
        const asset = await uploadMedia(file, "HOTEL_IMAGE", `${hotel.name} — ${category}`);
        await attachHotelImage(hotel.id, { fileAssetId: asset.id, category });
      });
    }

    if (fileInput.current) fileInput.current.value = "";
  };

  const cardUrl = (image: HotelWithChecklist["images"][number]) =>
    image.variants.find((variant) => variant.variant === "card")?.url ?? image.url;

  return (
    <div>
      {!canEdit ? (
        <ReadOnlyNote needs="catalogue.write" what="Uploading, reordering or removing images" />
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-surface p-4">
          <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink">
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as ImageCategory)}
              className="h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink"
            >
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            onChange={(event) => void upload(event.target.files)}
            className="sr-only"
            id="gallery-upload"
          />
          <label
            htmlFor="gallery-upload"
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

          <p aria-live="polite" className="text-[0.75rem]">
            {error && <span className="text-error-text">{error}</span>}
          </p>
        </div>
      )}

      {hotel.images.length === 0 ? (
        <p className="mt-6 rounded-sm border border-line bg-surface p-10 text-center text-muted">
          Nothing yet. A property needs at least one image before it can be published.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {hotel.images.map((image) => (
            <li key={image.hotelImageId} className="group relative overflow-hidden rounded-sm border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- API-served */}
              <img
                src={cardUrl(image)}
                alt={image.altText ?? ""}
                className="aspect-4/3 w-full object-cover"
              />
              <div className="flex items-center justify-between gap-2 bg-surface px-3 py-2">
                {!canEdit ? (
                  <span className="text-[0.75rem] text-muted">{image.category}</span>
                ) : hotel.roomTypes.length > 0 ? (
                  // Attaching copies the reference, not the file: the same
                  // asset then also hangs in that room's own gallery below.
                  <select
                    value=""
                    disabled={busy !== null}
                    onChange={(event) => {
                      const roomTypeId = event.target.value;
                      if (!roomTypeId) return;
                      void run(`to-room-${image.hotelImageId}`, () =>
                        attachRoomImage(hotel.id, roomTypeId, { fileAssetId: image.id }),
                      );
                    }}
                    aria-label="Add this image to a room"
                    className="h-7 max-w-32 rounded-sm border border-line bg-surface text-[0.6875rem] text-muted outline-none focus:border-ink"
                  >
                    <option value="">Add to room…</option>
                    {hotel.roomTypes.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[0.75rem] text-muted">{image.category}</span>
                )}
                {canEdit && (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy !== null || image.isCover}
                      onClick={() =>
                        void run(`cover-${image.hotelImageId}`, () =>
                          updateHotelImage(hotel.id, image.hotelImageId, { isCover: true }),
                        )
                      }
                      aria-label={image.isCover ? "Cover image" : "Make cover image"}
                      aria-pressed={image.isCover}
                      className={cn(
                        "transition-colors",
                        image.isCover ? "text-warning" : "text-subtle hover:text-ink",
                      )}
                    >
                      <Star size={15} aria-hidden fill={image.isCover ? "currentColor" : "none"} />
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        if (window.confirm("Remove this image from the gallery?")) {
                          void run(`detach-${image.hotelImageId}`, () =>
                            detachHotelImage(hotel.id, image.hotelImageId),
                          );
                        }
                      }}
                      aria-label="Remove from gallery"
                      className="text-subtle transition-colors hover:text-error-text"
                    >
                      {busy === `detach-${image.hotelImageId}` ? (
                        <Loader2 size={15} className="animate-spin" aria-hidden />
                      ) : (
                        <Trash2 size={15} aria-hidden />
                      )}
                    </button>
                  </span>
                )}
              </div>
              {image.isCover && (
                <span className="absolute start-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[0.6875rem] font-medium text-white">
                  Cover
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
