"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BedDouble, Loader2, Star, Trash2, Upload } from "lucide-react";

import { useCan } from "./AdminViewerContext";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { attachRoomImage, detachRoomImage, updateRoomImage } from "@/lib/api/hotels";
import { uploadMedia } from "@/lib/api/media";
import { describeError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { HotelWithChecklist, RoomType } from "@/types/catalogue";

/**
 * Each room's own gallery.
 *
 * A room photograph is not a hotel photograph: it hangs off the room type, is
 * what search shows on the room card, and survives the hotel gallery being
 * rearranged. The same underlying asset can sit in both — attaching never
 * copies the file, only the reference — which is why the hotel gallery offers
 * "add to room" and this screen offers uploading straight into a room.
 *
 * The first image a room receives becomes its cover; the star moves it.
 */
export function RoomGalleries({ hotel }: { hotel: HotelWithChecklist }) {
  const router = useRouter();
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

  if (hotel.roomTypes.length === 0) {
    return (
      <p className="rounded-sm border border-line bg-surface p-6 text-[0.875rem] text-muted">
        No room types yet — add rooms first, then give each its photographs here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {canEdit ? (
        <p aria-live="polite" className="min-h-4 text-[0.75rem]">
          {error && <span className="text-error-text">{error}</span>}
        </p>
      ) : (
        <ReadOnlyNote needs="catalogue.write" what="Uploading, re-covering or removing room images" />
      )}

      {hotel.roomTypes.map((room) => (
        <RoomSection key={room.id} hotel={hotel} room={room} busy={busy} run={run} canEdit={canEdit} />
      ))}
    </div>
  );
}

function RoomSection({
  hotel,
  room,
  busy,
  run,
  canEdit,
}: {
  hotel: HotelWithChecklist;
  room: RoomType;
  busy: string | null;
  run: (key: string, call: () => Promise<unknown>) => Promise<void>;
  canEdit: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Sequential: server-side image processing is synchronous, and parallel
    // uploads would only queue behind one another.
    for (const file of Array.from(files)) {
      // eslint-disable-next-line no-await-in-loop
      await run(`room-upload-${room.id}-${file.name}`, async () => {
        const asset = await uploadMedia(file, "ROOM_IMAGE", `${hotel.name} — ${room.name}`);
        await attachRoomImage(hotel.id, room.id, { fileAssetId: asset.id });
      });
    }

    if (fileInput.current) fileInput.current.value = "";
  };

  const cardUrl = (image: RoomType["images"][number]) =>
    image.variants.find((variant) => variant.variant === "card")?.url ?? image.url;

  const uploading = busy?.startsWith(`room-upload-${room.id}`);
  const inputId = `room-upload-${room.id}`;

  return (
    <section className="rounded-sm border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <BedDouble size={16} className="text-brand-text" aria-hidden />
          <h3 className="font-medium text-ink">{room.name}</h3>
          <span className="text-[0.75rem] text-muted">
            {room.images.length === 0
              ? "no images"
              : `${room.images.length} ${room.images.length === 1 ? "image" : "images"}`}
          </span>
        </div>

        {canEdit && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              onChange={(event) => void upload(event.target.files)}
              className="sr-only"
              id={inputId}
            />
            <label
              htmlFor={inputId}
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-ink/20 px-3 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft",
                uploading && "pointer-events-none opacity-50",
              )}
            >
              {uploading ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <Upload size={14} aria-hidden />
              )}
              Upload to this room
            </label>
          </>
        )}
      </header>

      {room.images.length === 0 ? (
        <p className="px-4 py-6 text-[0.8125rem] text-muted">
          {canEdit
            ? "Nothing yet. Upload here, or use “Add to room” on a gallery image above."
            : "No images for this room yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-5">
          {room.images.map((image) => (
            <li key={image.roomImageId} className="group relative overflow-hidden rounded-sm border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- API-served */}
              <img src={cardUrl(image)} alt={image.altText ?? ""} className="aspect-4/3 w-full object-cover" />
              {canEdit && (
                <div className="flex items-center justify-end gap-2 bg-surface px-2 py-1.5">
                  <button
                    type="button"
                    disabled={busy !== null || image.isCover}
                    onClick={() =>
                      void run(`room-cover-${image.roomImageId}`, () =>
                        updateRoomImage(hotel.id, room.id, image.roomImageId, { isCover: true }),
                      )
                    }
                    aria-label={image.isCover ? "Cover image" : "Make cover image"}
                    aria-pressed={image.isCover}
                    className={cn(
                      "transition-colors",
                      image.isCover ? "text-warning" : "text-subtle hover:text-ink",
                    )}
                  >
                    <Star size={14} aria-hidden fill={image.isCover ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(`Remove this image from ${room.name}?`)) {
                        void run(`room-detach-${image.roomImageId}`, () =>
                          detachRoomImage(hotel.id, room.id, image.roomImageId),
                        );
                      }
                    }}
                    aria-label="Remove from this room"
                    className="text-subtle transition-colors hover:text-error-text"
                  >
                    {busy === `room-detach-${image.roomImageId}` ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <Trash2 size={14} aria-hidden />
                    )}
                  </button>
                </div>
              )}
              {image.isCover && (
                <span className="absolute start-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[0.6875rem] font-medium text-white">
                  Cover
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
