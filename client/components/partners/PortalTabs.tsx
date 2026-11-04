"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Underline tabs that are links — each tab is an address, so a reload, the
 * back button and a shared link all land on the same register.
 *
 * On a phone the row scrolls sideways inside its own box rather than
 * wrapping (a second row of tabs reads as a second set) or squeezing labels
 * into ellipses. The edge fade says there is more, and the open tab is
 * scrolled into view on arrival, so "All" opened from a link is never the
 * one tab hiding past the edge.
 */
export function PortalTabs({
  label,
  tabs,
  active,
  className,
}: {
  label: string;
  tabs: readonly { key: string; label: string; href: string }[];
  active: string;
  className?: string;
}) {
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const tab = activeRef.current;
    const rail = tab?.parentElement;
    if (!tab || !rail || rail.scrollWidth <= rail.clientWidth) return;
    // Horizontal only — `scrollIntoView` would also move the page — and in
    // viewport terms, which read the same in Hebrew as in English.
    const railBox = rail.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const margin = 24;
    if (tabBox.right > railBox.right - margin) rail.scrollBy({ left: tabBox.right - railBox.right + margin });
    else if (tabBox.left < railBox.left + margin) rail.scrollBy({ left: tabBox.left - railBox.left - margin });
  }, [active]);

  return (
    <nav
      aria-label={label}
      className={cn(
        "-mx-4 sm:mx-0",
        // Fades the trailing edge only on the narrow screens that scroll.
        "max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] rtl:max-sm:[mask-image:linear-gradient(to_left,black_calc(100%-2rem),transparent)]",
        className,
      )}
    >
      {/* The baseline is an inset shadow, not a border the tabs overlap with
          a negative margin: inside a scroll box that overlap is clipped. */}
      <div className="scrollbar-none flex gap-1 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--color-line)] sm:px-0">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <Link
              key={tab.key}
              ref={current ? activeRef : undefined}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[0.875rem] font-medium whitespace-nowrap transition-colors sm:px-4",
                current ? "border-brand text-ink" : "border-transparent text-muted hover:border-line hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
        {/* Room past the last tab so the fade never sits over a label. */}
        <span aria-hidden className="w-4 shrink-0 sm:hidden" />
      </div>
    </nav>
  );
}
