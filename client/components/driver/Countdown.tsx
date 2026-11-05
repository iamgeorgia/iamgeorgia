"use client";

import { useEffect, useState } from "react";

import { untilLabel } from "@/lib/driver/assignment";
import { cn } from "@/lib/utils";

/**
 * "in 1 h 20 min", kept current while the screen is open.
 *
 * The first render uses the server's clock (`initialNow`), so the HTML and
 * the hydrated text agree; after that the phone's clock takes over, ticking
 * every 20 seconds — often enough that "in 1 min" never lingers past the
 * minute. Not a live region: a screen reader announcing every tick would
 * drown out everything else.
 */
export function Countdown({
  at,
  initialNow,
  className,
  pastClassName,
  soonClassName,
}: {
  at: string;
  initialNow: number;
  className?: string;
  /** Applied once the moment has passed — "12 min ago". */
  pastClassName?: string;
  /** Applied within the last hour before it. */
  soonClassName?: string;
}) {
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    // The page may have come from the router's cache: catch up at once.
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 20_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const { label, past, soon } = untilLabel(at, now);

  return (
    <time dateTime={at} className={cn(className, past && pastClassName, !past && soon && soonClassName)}>
      <bdi>{label}</bdi>
    </time>
  );
}
