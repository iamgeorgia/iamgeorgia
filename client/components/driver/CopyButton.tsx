"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Copies a line — an address to paste into a taxi or maps app that the
 * directions link does not cover. Says "Copied" for two seconds, in a live
 * region, so the confirmation reaches a screen reader too. Where the
 * browser refuses the clipboard (an old WebView, no permission) it says so
 * rather than pretending.
 */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-line px-3 text-[0.875rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink",
        className,
      )}
    >
      {state === "copied" ? <Check size={15} className="text-success" aria-hidden /> : <Copy size={15} aria-hidden />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : "Copy"}</span>
      <span className="sr-only"> {label}</span>
    </button>
  );
}
