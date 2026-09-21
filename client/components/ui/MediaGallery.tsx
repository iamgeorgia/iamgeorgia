"use client";

import Image from "next/image";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { GalleryImage } from "@/types";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Desktop mosaic by number of supporting photographs (0–4). Literal class
 * strings so Tailwind can see them.
 */
const MOSAIC = {
  0: { grid: "lg:grid-cols-1", lead: "aspect-21/9", first: "" },
  1: { grid: "lg:grid-cols-2", lead: "aspect-4/3", first: "" },
  2: { grid: "lg:grid-cols-3 lg:grid-rows-2", lead: "col-span-2 row-span-2 aspect-4/3", first: "" },
  3: { grid: "lg:grid-cols-4 lg:grid-rows-2", lead: "col-span-2 row-span-2 aspect-4/3", first: "col-span-2" },
  4: { grid: "lg:grid-cols-4 lg:grid-rows-2", lead: "col-span-2 row-span-2 aspect-4/3", first: "" },
} as const;

interface MediaGalleryProps {
  images: GalleryImage[];
  /** Used for the "show all" label and the lightbox announcement. */
  label: string;
  className?: string;
  priority?: boolean;
}

/**
 * Mosaic on desktop, swipeable rail on mobile, fullscreen lightbox on both.
 * Shared by tours, hotels, destinations and experiences so the gallery
 * interaction is identical everywhere it appears.
 */
export function MediaGallery({ images, label, className, priority }: MediaGalleryProps) {
  const { t } = useI18n();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const isOpen = lightboxIndex !== null;

  const close = useCallback(() => setLightboxIndex(null), []);
  const step = useCallback(
    (direction: 1 | -1) =>
      setLightboxIndex((current) =>
        current === null ? current : (current + direction + images.length) % images.length,
      ),
    [images.length],
  );

  useEffect(() => {
    if (!isOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // In a right-to-left page "next" lies to the left, as the buttons do.
    const forward = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === forward) step(1);
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") step(-1);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, close, step]);

  const [lead, ...supporting] = images;
  const shown = supporting.slice(0, 4);
  const mosaic = MOSAIC[shown.length as keyof typeof MOSAIC];

  /*
   * The rail and the mosaic are two DOM trees for the same photographs, one
   * hidden at each breakpoint — and `display: none` does not stop an image
   * loading. It only stops a lazy one, because a hidden element never
   * intersects the viewport. The lead is not lazy: with `priority` it is
   * eager and preloaded in *both* trees, so a mismatched `sizes` had the
   * browser fetch two different widths of the same file on every detail page —
   * on a desktop viewport the wasted one was the 1600px variant, competing
   * with the LCP image for bandwidth. One `sizes` for both leads means both
   * preloads resolve to the same URL and the second is a cache hit.
   */
  const leadSizes = "(min-width: 1024px) 50vw, 85vw";

  return (
    <div className={className}>
      {/* Mobile: horizontal swipe rail. */}
      <div className="scrollbar-none -mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 sm:-mx-8 sm:px-8 lg:hidden">
        {images.map((image, index) => (
          <button
            key={image.src}
            type="button"
            onClick={() => setLightboxIndex(index)}
            className="relative aspect-4/3 w-[85%] shrink-0 snap-start overflow-hidden rounded-sm bg-line"
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              priority={priority && index === 0}
              sizes={index === 0 ? leadSizes : "85vw"}
              className="object-cover"
            />
          </button>
        ))}
      </div>

      {/* Desktop: one lead image with a supporting grid, shaped by how many
          photographs there are — a fixed four-by-two mosaic left empty cells
          beside a property with two or three. The corners are rounded once, on
          the frame, so they stay right whichever cell ends up at an edge and
          in either reading direction. */}
      <div className={cn("relative hidden gap-2 overflow-hidden rounded-sm lg:grid", mosaic.grid)}>
        <button
          type="button"
          onClick={() => setLightboxIndex(0)}
          aria-label={`Open ${label} gallery`}
          className={cn("group relative overflow-hidden bg-line", mosaic.lead)}
        >
          <Image
            src={lead.src}
            alt={lead.alt}
            fill
            priority={priority}
            sizes={leadSizes}
            className="object-cover transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-[1.03]"
          />
        </button>

        {shown.map((image, index) => (
          <button
            key={image.src}
            type="button"
            onClick={() => setLightboxIndex(index + 1)}
            aria-label={`Open ${label} gallery at image ${index + 2}`}
            className={cn("group relative overflow-hidden bg-line", index === 0 && mosaic.first)}
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="25vw"
              className="object-cover transition-transform duration-700 ease-(--ease-out-soft) group-hover:scale-[1.04]"
            />
          </button>
        ))}

        <button
          type="button"
          onClick={() => setLightboxIndex(0)}
          className="absolute end-4 bottom-4 inline-flex items-center gap-2 rounded-sm bg-background/95 px-4 py-2.5 text-[0.8125rem] font-medium text-ink backdrop-blur-sm transition-colors hover:bg-background"
        >
          <Expand size={15} aria-hidden />
          Show all {images.length} photos
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <m.div
            role="dialog"
            aria-modal="true"
            aria-label={`${label} gallery`}
            className="fixed inset-0 z-100 flex flex-col bg-ink"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex shrink-0 items-center justify-between px-5 py-4 sm:px-8">
              <p className="type-caption text-on-dark/70 tabular-nums">
                {lightboxIndex + 1} / {images.length}
              </p>
              <button
                type="button"
                onClick={close}
                autoFocus
                aria-label={t.a11y.closeGallery}
                className="flex size-10 items-center justify-center rounded-full text-on-dark transition-colors hover:bg-on-dark/12"
              >
                <X size={20} aria-hidden />
              </button>
            </div>

            <div className="relative min-h-0 flex-1">
              <AnimatePresence mode="wait" initial={false}>
                <m.div
                  key={lightboxIndex}
                  className="absolute inset-0 m-4 sm:m-8"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Image
                    src={images[lightboxIndex].src}
                    alt={images[lightboxIndex].alt}
                    fill
                    sizes="100vw"
                    className="object-contain"
                  />
                </m.div>
              </AnimatePresence>

              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t.a11y.previousImage}
                className="absolute start-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-on-dark transition-colors hover:bg-ink/85 sm:start-4"
              >
                <ChevronLeft size={22} className="rtl:-scale-x-100" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t.a11y.nextImage}
                className="absolute end-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-on-dark transition-colors hover:bg-ink/85 sm:end-4"
              >
                <ChevronRight size={22} className="rtl:-scale-x-100" aria-hidden />
              </button>
            </div>

            <p className="type-caption shrink-0 px-5 py-5 text-center text-on-dark/60 sm:px-8">
              {images[lightboxIndex].alt}
            </p>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
