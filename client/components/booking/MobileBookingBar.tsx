"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface MobileBookingBarProps {
  /** Small line above the figure — "From", "Total". */
  caption: string;
  /** The figure itself, already formatted for the reader's locale. */
  price: string;
  /** Qualifier after the figure — "/ night", "per person". */
  note?: string;
  href: string;
  action: string;
}

/**
 * The fixed price-and-action strip on property, tour and transfer pages below
 * `lg`, where the sidebar panel has dropped under the content.
 *
 * It publishes its own height as `--booking-bar-offset` so the cookie notice
 * can sit above it instead of covering the one button the page is built
 * around. Measured rather than assumed: a long price or a two-line label in
 * Georgian makes the bar taller, and at `lg` it is `display: none` and the
 * offset falls back to zero on its own.
 *
 * When the action is an in-page jump (`#tour-search`, `#rooms`) the bar steps
 * aside while that section is on screen. It used to sit over the bottom of the
 * very form it pointed to — on a 390×844 phone the tour page's "See
 * departures" button was hidden under it on first load — and repeating a
 * control the reader can already see is noise. An in-page bar whose target is
 * missing stays down (its button would jump nowhere), and so does one without
 * JavaScript, which costs nothing: the section it points to is on the page.
 *
 * The bottom padding clears the home indicator on devices that report a safe
 * area inset.
 */
export function MobileBookingBar({ caption, price, note, href, action }: MobileBookingBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const inPage = href.startsWith("#");
  // In-page jumps start hidden and slide in once the target is known to be
  // off screen: starting visible flashed the bar up and straight back down
  // on every page whose form is on the first screen.
  const [targetInView, setTargetInView] = useState(inPage);

  useEffect(() => {
    if (!inPage) return;
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    // No target, no bar: its only action would be a jump to nowhere.
    if (!target) return;

    // The top inset clears the fixed site header; the bottom one is the bar's
    // own band, so a form peeking out from under it still counts as covered.
    const observer = new IntersectionObserver(
      ([entry]) => setTargetInView(entry.isIntersecting),
      { rootMargin: "-80px 0px -96px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [href, inPage]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const root = document.documentElement;
    const sync = () =>
      root.style.setProperty("--booking-bar-offset", targetInView ? "0px" : `${bar.offsetHeight}px`);

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);

    return () => {
      observer.disconnect();
      root.style.removeProperty("--booking-bar-offset");
    };
  }, [targetInView]);

  return (
    <div
      ref={barRef}
      // `inert` takes the hidden bar's link out of the tab order and the
      // accessibility tree; the slide is skipped under reduced motion by the
      // global rule in globals.css.
      inert={targetInView}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-line bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md transition-[translate,opacity] duration-300 ease-(--ease-out-soft) lg:hidden",
        targetInView && "pointer-events-none translate-y-full opacity-0",
      )}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <p className="min-w-0">
          <span className="type-caption block text-muted">{caption}</span>
          <span className="type-h4 tabular-nums">
            {price}
            {note && <span className="type-caption font-normal text-muted"> {note}</span>}
          </span>
        </p>

        <Button href={href} className="shrink-0">
          {action}
        </Button>
      </div>
    </div>
  );
}
