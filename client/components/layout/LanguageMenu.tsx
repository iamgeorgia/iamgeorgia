"use client";

import { AnimatePresence, m } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { locales, localeMeta, localePath, stripLocale } from "@/lib/i18n/config";
import { rememberLocale } from "@/lib/i18n/cookie";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Language selector.
 *
 * Each option is a real `<Link>` to the same page in another locale, so the
 * choice is a navigation rather than client state — it survives a refresh, can
 * be opened in a new tab, and is crawlable. Selecting one also writes a cookie
 * that `proxy.ts` reads, so a later visit to the bare root lands in the same
 * language.
 */
export function LanguageMenu({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { locale, t } = useI18n();

  // The current page with its locale segment removed, so we can re-prefix it.
  const canonicalPath = stripLocale(pathname);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-[0.8125rem] font-medium transition-colors",
          tone === "light"
            ? "text-on-dark/85 hover:bg-on-dark/15 hover:text-on-dark"
            : "text-body hover:bg-surface-soft",
        )}
      >
        <Globe size={15} aria-hidden />
        <span aria-hidden>{locale.toUpperCase()}</span>
        <span className="sr-only">{t.a11y.changeLanguage}</span>
      </button>

      <AnimatePresence>
        {open && (
          <m.ul
            role="menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute end-0 top-full z-10 mt-2 w-44 overflow-hidden rounded-sm border border-line bg-background py-1 shadow-card"
          >
            {locales.map((code) => {
              const meta = localeMeta[code];
              const active = code === locale;
              return (
                <li key={code} role="none">
                  <Link
                    href={localePath(code, canonicalPath)}
                    hrefLang={meta.htmlLang}
                    lang={meta.htmlLang}
                    dir={meta.dir}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      // Only read on the bare root, so a shared in-language
                      // link always wins over a stored preference.
                      rememberLocale(code);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3.5 py-2 text-start text-sm text-body transition-colors hover:bg-surface-soft hover:text-ink"
                  >
                    {meta.label}
                    {active && <Check size={14} className="text-brand-text" aria-hidden />}
                  </Link>
                </li>
              );
            })}
          </m.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The same choice as a row of links, for the mobile menu.
 *
 * The header dropdown only appears from `sm` up — below that there is no room
 * beside the wordmark and the burger — so without this a phone reader would
 * be locked into whichever language they arrived in. Every option is visible
 * at once: four endonyms fit on a 320px row, and a menu inside a menu is one
 * tap too many on a phone.
 */
export function LanguageMenuRow({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { locale, t } = useI18n();
  const canonicalPath = stripLocale(pathname);

  return (
    <nav aria-label={t.a11y.changeLanguage} className="flex items-start gap-3">
      <Globe size={18} className="mt-2 shrink-0 text-on-dark/60" aria-hidden />
      <ul className="flex min-w-0 flex-wrap gap-2">
        {locales.map((code) => {
          const meta = localeMeta[code];
          const active = code === locale;
          return (
            <li key={code}>
              <Link
                href={localePath(code, canonicalPath)}
                hrefLang={meta.htmlLang}
                lang={meta.htmlLang}
                dir={meta.dir}
                aria-current={active ? "true" : undefined}
                onClick={() => {
                  rememberLocale(code);
                  onNavigate?.();
                }}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-medium transition-colors",
                  active
                    ? "border-on-dark bg-on-dark text-ink"
                    : "border-on-dark/25 text-on-dark/80 hover:border-on-dark/60 hover:text-on-dark",
                )}
              >
                {active && <Check size={13} aria-hidden />}
                {meta.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
