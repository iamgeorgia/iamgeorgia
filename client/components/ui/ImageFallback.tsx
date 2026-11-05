import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What stands in for a photograph that is missing or failed to load.
 *
 * A quiet tile in the surface tone with one centred icon — not the browser's
 * broken-image glyph, and not the alt text spilling over whatever badge sits
 * on the photo. Sized by whoever places it: `fill` covers a positioned parent
 * the way `next/image`'s `fill` does; otherwise `className` carries the same
 * dimensions the image would have had.
 *
 * With a `label` (the image's alt text) it is announced as an image of that
 * name, so a screen reader hears the same thing either way; decorative images
 * (empty alt) stay out of the accessibility tree.
 */
export function ImageFallback({
  className,
  label,
  fill,
}: {
  className?: string;
  label?: string;
  fill?: boolean;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn(
        "flex items-center justify-center overflow-hidden bg-surface-soft text-subtle",
        fill && "absolute inset-0",
        className,
      )}
    >
      <ImageOff aria-hidden className="h-auto w-[30%] max-w-7 min-w-3.5" strokeWidth={1.5} />
    </span>
  );
}
