"use client";

import { useEffect, useId, useRef } from "react";
import { Presentation, X } from "lucide-react";

import { cn } from "@/lib/utils";

type WakeLock = { release: () => Promise<void> };

/**
 * The name board for an arrivals hall: the passenger's name across the whole
 * screen, black on white, to hold up at the barrier.
 *
 * A native modal `<dialog>`, so focus moves in and back and Escape closes it
 * without extra code. While it is up the screen is kept awake where the
 * browser allows (Screen Wake Lock) — a sign that dims mid-wait is no sign.
 * The type is sized by the viewport's width and height both, so a long
 * double-barrelled name still fits on a small phone held sideways.
 */
export function NameSign({ name, className }: { name: string; className?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wakeLock = useRef<WakeLock | null>(null);
  const titleId = useId();

  const release = () => {
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  };

  const open = async () => {
    dialogRef.current?.showModal();
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } };
      wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLock.current = null;
    }
  };

  useEffect(() => release, []);

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-sm border border-line bg-surface px-3.5 text-[0.9375rem] font-medium text-ink transition-colors hover:border-ink/40",
          className,
        )}
      >
        <Presentation size={16} aria-hidden />
        Show name sign
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={release}
        className="m-0 h-dvh max-h-none w-dvw max-w-none bg-white p-0 text-black backdrop:bg-black"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-4 px-5 pt-[max(1rem,env(safe-area-inset-top))]">
            <p className="font-display text-[0.9375rem] tracking-[0.08em] text-black/70">I&apos;AM GEORGIA</p>
            <button
              type="button"
              autoFocus
              onClick={() => dialogRef.current?.close()}
              className="inline-flex min-h-12 items-center gap-2 rounded-sm border border-black/20 px-4 text-[1rem] font-medium text-black"
            >
              <X size={18} aria-hidden />
              Close
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <h2
              id={titleId}
              dir="auto"
              className="text-center text-[clamp(2.5rem,min(15vw,22vh),9rem)] leading-[1.12] font-bold tracking-[-0.01em] text-balance wrap-break-word"
            >
              {name}
            </h2>
          </div>
        </div>
      </dialog>
    </>
  );
}
