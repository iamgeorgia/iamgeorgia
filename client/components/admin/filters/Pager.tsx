"use client";

import { cn } from "@/lib/utils";

/**
 * Previous / Next and "Page x of y" — the one pager every register uses.
 * Renders nothing for a single page: a pager with nowhere to go is a row of
 * disabled buttons.
 */
export function Pager({
  page,
  totalPages,
  onPage,
  className,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const button =
    "inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft disabled:pointer-events-none disabled:opacity-40";

  return (
    <nav className={cn("mt-6 flex items-center justify-between", className)} aria-label="Pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={button}>
        Previous
      </button>
      <span className="text-[0.8125rem] text-muted tabular-nums">
        Page {page} of {totalPages}
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className={button}>
        Next
      </button>
    </nav>
  );
}
