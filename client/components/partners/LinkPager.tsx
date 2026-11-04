import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Previous / Next as links, for the server-rendered finance lists: each page
 * is an address, so it survives a reload and can be sent to a colleague.
 * Renders nothing for a single page.
 */
export function LinkPager({
  page,
  totalPages,
  hrefFor,
  label = "Pagination",
  className,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  /** Names the pager when a screen has more than one. */
  label?: string;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const button =
    "inline-flex min-h-10 items-center gap-1 rounded-sm border border-ink/20 px-3.5 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft";
  const disabled = "pointer-events-none opacity-40";
  const first = page <= 1;
  const last = page >= totalPages;

  return (
    <nav
      aria-label={label}
      className={cn("flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5", className)}
    >
      <Link
        href={hrefFor(Math.max(1, page - 1))}
        aria-disabled={first}
        tabIndex={first ? -1 : undefined}
        className={cn(button, first && disabled)}
      >
        <ChevronLeft size={15} aria-hidden className="rtl:-scale-x-100" />
        Previous
      </Link>
      <span className="text-[0.8125rem] text-muted tabular-nums">
        Page {page} of {totalPages}
      </span>
      <Link
        href={hrefFor(Math.min(totalPages, page + 1))}
        aria-disabled={last}
        tabIndex={last ? -1 : undefined}
        className={cn(button, last && disabled)}
      >
        Next
        <ChevronRight size={15} aria-hidden className="rtl:-scale-x-100" />
      </Link>
    </nav>
  );
}
