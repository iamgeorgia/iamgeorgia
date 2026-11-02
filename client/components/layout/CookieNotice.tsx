"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/Button";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";

const STORAGE_KEY = "iag_cookie_notice";

/*
 * A one-key store over `localStorage`, so the notice can read "dismissed"
 * through `useSyncExternalStore`. That hook is what makes the first client
 * render agree with the server: the server snapshot says "dismissed" (render
 * nothing), the browser then reads the real answer and re-renders once. No
 * state set inside an effect, and no hydration mismatch on the visit where
 * the notice actually shows.
 *
 * Every storage access is guarded — private windows and blocked site data
 * throw, and in that case the notice simply returns next visit.
 */
const listeners = new Set<() => void>();

const readDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const dismiss = () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage unavailable — the notice will return next visit, which is fine.
  }
  listeners.forEach((listener) => listener());
};

/**
 * A one-line notice that the site sets only strictly necessary cookies.
 *
 * Informational rather than a consent gate: nothing here needs consent, since
 * no analytics or advertising cookie is ever set. It asks for one
 * acknowledgement and then stays away.
 */
export function CookieNotice() {
  const { t } = useI18n();
  const path = useLocalePath();
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);

  if (dismissed) return null;

  return (
    /*
     * `z-60`: above the header and the mobile booking bar (z-40), below the
     * mobile menu (z-90) and every dialog and lightbox (z-100). At z-100 and
     * later in the DOM it used to paint over an open dialog's action buttons.
     * `--booking-bar-offset` lifts it clear of that bar where a page has one.
     *
     * On a phone it is a slim sheet docked to the bottom edge (or onto the
     * booking bar), text beside the button. As a floating card with the button
     * under the text it stood ~150px tall, and with the booking bar under it
     * covered a quarter of an 844px screen. The bottom padding takes the home
     * indicator's inset only when nothing sits below the sheet: with the bar
     * there, the bar has already cleared it.
     */
    <div
      role="region"
      aria-label={t.cookieNotice.label}
      className="fixed inset-x-0 bottom-(--booking-bar-offset) z-60 transition-[bottom] duration-300 ease-(--ease-out-soft) sm:px-6 sm:pb-6"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 border-t border-line bg-surface px-4 pt-2.5 pb-[max(0.625rem,calc(env(safe-area-inset-bottom)-var(--booking-bar-offset)))] shadow-[0_-8px_24px_-16px_rgb(32_32_29/0.18)] sm:justify-between sm:gap-6 sm:rounded-sm sm:border sm:p-4 sm:ps-5 sm:shadow-card">
        <p className="type-caption min-w-0 flex-1 text-body sm:text-[0.9375rem]">
          {t.cookieNotice.body}{" "}
          <Link
            href={path("/cookies")}
            className="text-brand-text underline underline-offset-4 hover:text-brand-hover"
          >
            {t.cookieNotice.link}
          </Link>
        </p>
        <Button onClick={dismiss} variant="secondary" className="shrink-0">
          {t.cookieNotice.dismiss}
        </Button>
      </div>
    </div>
  );
}
