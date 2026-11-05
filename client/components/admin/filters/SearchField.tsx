"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** The field class every control in a filter row shares, so they sit level. */
export const filterControlClass =
  "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";

/** The small caption above a filter control. */
export const filterLabelClass = "block text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The search box of a register.
 *
 * Owns its own text and commits it after a pause, so typing a reference does
 * not fire a request per keystroke. `value` is what the URL says; when the
 * URL changes under the field (a preset, "Clear filters", the back button)
 * the text follows it.
 */
export function SearchField({
  value,
  onCommit,
  placeholder,
  label,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
  /** For assistive technology; the placeholder is not a label. */
  label: string;
  className?: string;
}) {
  const [text, setText] = useState(value);

  // The URL moved without the field (a preset, "Clear filters", the back
  // button): follow it. Adjusted during render rather than in an effect, so
  // the stale text is never painted.
  const [followed, setFollowed] = useState(value);
  if (followed !== value) {
    setFollowed(value);
    // Not when the URL merely caught up with what was typed: a trailing
    // space mid-sentence would otherwise be snatched away.
    if (text.trim() !== value) setText(value);
  }

  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onCommit(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `onCommit` is a closure the caller rebuilds every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={cn("relative min-w-[14rem] flex-1", className)}>
      <Search size={15} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-subtle" />
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cn(filterControlClass, "w-full ps-9")}
      />
    </div>
  );
}
