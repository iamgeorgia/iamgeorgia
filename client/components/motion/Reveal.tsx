import { cn } from "@/lib/utils";

type RevealVariant = "up" | "fade" | "scale";

/**
 * Scroll-triggered entrances, in CSS.
 *
 * These are Server Components that only mark up the DOM; the motion itself is
 * a scroll-driven animation in `globals.css` (`animation-timeline: view()`),
 * so nothing here waits for JavaScript. A browser without scroll timelines
 * simply shows the content, as does a reader who prefers reduced motion.
 * Content that is already in the viewport when the page paints is never
 * hidden: its entry range has passed, so the animation sits on its last frame.
 *
 * `delay` and `stagger` are kept in seconds for the callers' sake and turned
 * into an offset along the entry range, which is the nearest thing a scrubbed
 * animation has to a delay.
 */

/** Seconds of "delay" per percent of the element's entry into the viewport. */
const OFFSET_PER_SECOND = 60;

const offset = (seconds: number) => `${Math.round(seconds * OFFSET_PER_SECOND)}%`;

interface RevealProps {
  children: React.ReactNode;
  variant?: RevealVariant;
  delay?: number;
  className?: string;
}

export function Reveal({ children, variant = "up", delay = 0, className }: RevealProps) {
  return (
    <div
      data-reveal={variant}
      className={className}
      style={delay ? ({ "--reveal-base": offset(delay) } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

interface RevealGroupProps {
  children: React.ReactNode;
  /** Seconds between each child. */
  stagger?: number;
  delay?: number;
  className?: string;
}

/** Wrap a list and give each `RevealItem` child a staggered entrance. */
export function RevealGroup({ children, stagger = 0.08, delay = 0, className }: RevealGroupProps) {
  return (
    <div
      data-reveal-group=""
      className={className}
      style={
        {
          "--reveal-stagger": offset(stagger),
          ...(delay ? { "--reveal-base": offset(delay) } : {}),
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

export function RevealItem({
  children,
  variant = "up",
  className,
}: {
  children: React.ReactNode;
  variant?: RevealVariant;
  className?: string;
}) {
  return (
    <div data-reveal={variant} data-reveal-item="" className={cn(className)}>
      {children}
    </div>
  );
}
