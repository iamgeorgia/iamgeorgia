"use client";

import { useCallback, useState, type ImgHTMLAttributes, type ReactNode } from "react";

import { ImageFallback } from "./ImageFallback";

type MediaImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  /** A URL from the API's media store; missing means "no photo". */
  src: string | null | undefined;
  alt: string;
  /**
   * What to show when there is no photo or it fails to load — usually the
   * placeholder the screen already uses for "no photo", so a dead link looks
   * exactly like an empty slot. Defaults to `ImageFallback` at the image's size;
   * pass `null` to render nothing at all.
   */
  fallback?: ReactNode;
};

/**
 * A plain `<img>` for photographs the API serves: admin galleries, list
 * thumbnails, driver and car photos — places `next/image` is not used because
 * the server already hands over a sized rendition (`thumb`, `card`).
 *
 * Three things every one of those sites was missing:
 *
 * - `loading="lazy"` and `decoding="async"` by default. A gallery manager or a
 *   fleet list rendered every photo eagerly, competing with the page's own
 *   requests for bandwidth. Pass `loading="eager"` for one that is on the first
 *   screen and matters.
 * - A fallback. A failed load used to leave the broken-image glyph.
 * - Catching a failure that happened before hydration. React does not replay
 *   `error` events that fired before it attached its listener, so on mount the
 *   ref checks whether the browser has already given up (`complete` with no
 *   pixels). A lazy image that has not started yet is not `complete`, so it is
 *   left alone.
 */
export function MediaImg({ src, alt, fallback, loading = "lazy", decoding = "async", ...rest }: MediaImgProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && src && img.complete && img.naturalWidth === 0) setFailedSrc(src);
    },
    [src],
  );

  if (!src || failedSrc === src) {
    // `=== undefined`, not `??`: an explicit `null` means "nothing", not "default".
    return <>{fallback === undefined ? <ImageFallback className={rest.className} label={alt} /> : fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a sized rendition from the media store
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onError={() => setFailedSrc(src)}
      {...rest}
    />
  );
}
