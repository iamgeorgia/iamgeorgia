"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { ArrowUpRight, X } from "lucide-react";
import { useEffect } from "react";

import { AccountNavRow } from "./AccountNav";
import { LanguageMenuRow } from "./LanguageMenu";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/Button";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { site } from "@/constants/site";
import { navDescription, navLabel, primaryNavigation } from "@/lib/navigation";

interface MobileNavigationProps {
  open: boolean;
  onClose: () => void;
}

const EASE = [0.22, 1, 0.36, 1] as const;

export function MobileNavigation({ open, onClose }: MobileNavigationProps) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();
  const path = useLocalePath();

  // Close on navigation so the menu never survives a route change.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <m.div
          id="mobile-navigation"
          className="fixed inset-0 z-90 flex flex-col bg-ink text-on-dark lg:hidden"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, clipPath: "inset(0 0 0% 0)" }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          <div className="flex h-18 shrink-0 items-center justify-between px-5 sm:px-8">
            <span className="flex items-center gap-2.5">
              <Logo className="size-8" />
              <span className="font-display text-lg tracking-[0.06em]">{site.wordmark}</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.a11y.closeMenu}
              className="flex size-10 items-center justify-center rounded-sm text-on-dark transition-colors hover:bg-on-dark/10"
            >
              <X size={22} aria-hidden />
            </button>
          </div>

          <nav aria-label={t.a11y.mobileNav} className="flex-1 overflow-y-auto px-5 pt-6 sm:px-8">
            <ul>
              {primaryNavigation.map((item, index) => {
                const Icon = item.icon;
                return (
                  <m.li
                    key={item.key}
                    initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.12 + index * 0.06, ease: EASE }}
                    className="border-b border-on-dark/12"
                  >
                    <Link
                      href={path(item.href)}
                      onClick={onClose}
                      className="group flex items-baseline justify-between gap-4 py-5"
                    >
                      <span>
                        <span className="type-h2 flex items-center gap-3">
                          {Icon && (
                            <Icon size={24} className="shrink-0 text-on-dark/60" aria-hidden />
                          )}
                          {navLabel(t, item.key)}
                        </span>
                        <span className="type-body-sm mt-1.5 block text-on-dark/55">
                          {navDescription(t, item.key)}
                        </span>
                      </span>
                      <ArrowUpRight
                        size={20}
                        className="shrink-0 translate-y-1 text-on-dark/40 transition-transform duration-300 ease-(--ease-out-soft) group-hover:-translate-y-0 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1"
                        aria-hidden
                      />
                    </Link>
                  </m.li>
                );
              })}
            </ul>

            <m.div
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.45 }}
              className="py-10"
            >
              <Button href={path("/contact")} variant="light" size="lg" fullWidth onClick={onClose}>
                {t.actions.planYourTrip}
              </Button>

              {/* Set apart from the editorial sections above: this is the way
                  out of the marketing site and into the back office, not
                  another thing to browse. */}
              <div className="mt-6">
                <AccountNavRow onNavigate={onClose} />
              </div>
              {/* The header's language menu is `sm` and up only; this is the
                  way to change language on a phone. */}
              <div className="mt-6">
                <LanguageMenuRow onNavigate={onClose} />
              </div>
              <p className="type-caption mt-8 text-on-dark/50">{site.contact.address}</p>
              <a
                href={`mailto:${site.contact.email}`}
                className="type-body-sm mt-1 block text-on-dark/80 underline-offset-4 hover:underline"
              >
                {site.contact.email}
              </a>
            </m.div>
          </nav>
        </m.div>
      )}
    </AnimatePresence>
  );
}
