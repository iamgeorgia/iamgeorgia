"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { fill } from "@/lib/i18n/fill";

/** mm:ss, and never negative — an expired hold has its own panel. */
const countdown = (msLeft: number): string => {
  const total = Math.max(0, Math.floor(msLeft / 1000));

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

interface HoldCountdownProps {
  /** Epoch milliseconds at which the hold lapses. */
  expiresAt: number;
  /** A dictionary string with a `{time}` slot. */
  template: string;
  /** Called once, when the hold lapses. */
  onExpire: () => void;
}

/**
 * The "expires in 9:41" figure on a checkout.
 *
 * Its own component because it is the only thing on the page that changes
 * every second. Kept inside the form, the tick re-rendered every field, the
 * guest list and both summaries once a second while the traveller typed —
 * here it re-renders one text node. The form learns of the expiry through
 * `onExpire` and shows its own panel from then on.
 */
export function HoldCountdown({ expiresAt, template, onExpire }: HoldCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    if (expiresAt <= Date.now()) {
      expire();
      return;
    }

    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) {
        window.clearInterval(id);
        expire();
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [expiresAt]);

  return <>{fill(template, { time: countdown(expiresAt - now) })}</>;
}
