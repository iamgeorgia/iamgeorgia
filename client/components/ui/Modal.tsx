"use client";

import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hide the visible title but keep it for screen readers. */
  hideTitle?: boolean;
  size?: "sm" | "md" | "lg" | "full";
  children: React.ReactNode;
  className?: string;
}

const sizes = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  full: "max-w-[min(96rem,100vw-2rem)]",
} as const;

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

const noSubscription = () => () => {};

/**
 * Accessible dialog: labelled, focus-trapped, Escape to dismiss, scroll-locked,
 * and it returns focus to whatever opened it.
 *
 * Rendered into `document.body` through a portal, not where the caller sits.
 * Inline, `z-100` only ranked the dialog inside whatever stacking context
 * held its opener: a map's panes and controls (the Google map's stack a few
 * hundred deep, as the Leaflet map's before it) sat above it, and a wheel
 * over the backdrop scrolled the nearest scrolling
 * ancestor instead of stopping at the scroll-locked body.
 */
export function Modal({
  open,
  onClose,
  title,
  hideTitle,
  size = "md",
  children,
  className,
}: ModalProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();
  // False during the server render and hydration, true after: the portal
  // needs `document`, and a dialog is never open on first paint anyway.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);

  // An effect event rather than a dependency: every caller passes an inline
  // `onClose`, and with it in the effect's dependencies the whole open/close
  // routine — scroll lock, focus move, and the focus *return* in the cleanup —
  // re-ran on every parent render while the dialog was open. Toggling a
  // filter inside the filters dialog sent focus back to the opener and then
  // into the dialog again on each click.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;

    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", handleKeyDown);

    // Move focus into the dialog once it has mounted.
    const frame = requestAnimationFrame(() => {
      const target =
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
      target?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = overflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-100 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <m.div
            className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={cn(
              "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-background shadow-modal sm:rounded-sm",
              sizes[size],
              className,
            )}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <div
              className={cn(
                "flex items-start justify-between gap-4 px-6 pt-6",
                hideTitle && "absolute end-0 top-0 z-20 pe-3 pt-3 sm:pe-5 sm:pt-4",
              )}
            >
              {!hideTitle && <h2 className="type-h3 pe-4">{title}</h2>}
              <button
                type="button"
                onClick={onClose}
                aria-label={t.a11y.closeDialog}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-soft hover:text-ink"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
