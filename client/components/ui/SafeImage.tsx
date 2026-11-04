"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

import { ImageFallback } from "./ImageFallback";

/**
 * `next/image` that degrades to `ImageFallback` when the photo cannot load.
 *
 * Catalogue photos come from the media bucket, so a deleted object, a stale
 * variant URL or an unreachable bucket is a real possibility, and without
 * this the reader got the browser's broken-image glyph with the alt text
 * printed across the card's badges. `next/image` re-triggers an error that
 * happened before hydration, so even a photo that failed during the first
 * paint lands here.
 *
 * The failure is remembered per `src`: a gallery or a lightbox that moves to
 * another photo tries that one afresh.
 *
 * Usable from server components — every prop it needs is serialisable, and the
 * handler lives here rather than being passed in.
 */
export function SafeImage({ onError, alt, ...props }: ImageProps) {
  const [failedSrc, setFailedSrc] = useState<ImageProps["src"] | null>(null);

  if (failedSrc !== null && failedSrc === props.src) {
    return (
      <ImageFallback
        fill={props.fill}
        className={props.fill ? undefined : props.className}
        label={alt}
      />
    );
  }

  return (
    <Image
      {...props}
      alt={alt}
      onError={(event) => {
        setFailedSrc(props.src);
        onError?.(event);
      }}
    />
  );
}
