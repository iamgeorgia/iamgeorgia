"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, History, Sun, UserRound } from "lucide-react";

import { DriverOffline } from "@/components/driver/DriverOffline";
import { DriverSignOutButton } from "@/components/driver/DriverSignOut";
import { Logo } from "@/components/layout/Logo";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useLocalePath } from "@/lib/i18n/provider";
import { stripLocale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/auth";

/**
 * The driver panel's chrome.
 *
 * Built for a phone in one hand at a kerb: a slim top bar with the bell and
 * the way out, and a fixed bottom tab bar of four big targets, padded clear
 * of the home indicator. From `md` the same four tabs move into the top bar
 * and the bottom bar goes away. A job page counts as the tab it was reached
 * from; the four tabs are the whole map, so there is no menu to hunt through.
 */
const TABS = [
  { label: "Today", href: "/driver", icon: Sun, exact: true },
  { label: "Upcoming", href: "/driver/upcoming", icon: CalendarDays },
  { label: "History", href: "/driver/history", icon: History },
  { label: "Me", href: "/driver/me", icon: UserRound },
] as const;

export function DriverShell({
  session,
  unreadCount = 0,
  children,
}: {
  session: Session;
  /** The bell's number, read by the layout with the page. */
  unreadCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const path = useLocalePath();
  const current = stripLocale(pathname);
  const linked = Boolean(session.driver);

  const isActive = (tab: (typeof TABS)[number]) =>
    "exact" in tab && tab.exact ? current === tab.href : current === tab.href || current.startsWith(`${tab.href}/`);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#driver-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-200 focus:rounded-sm focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-2 px-4 md:h-16 md:gap-4 md:px-6">
          <Link
            href={path("/driver")}
            className="flex shrink-0 items-center gap-2.5 rounded-xs focus-visible:outline-offset-4"
          >
            <Logo className="size-7" />
            <span>
              <span className="block font-display text-[0.9375rem] leading-none tracking-[0.06em] text-ink">
                I&apos;AM GEORGIA
              </span>
              <span className="mt-1 block text-[0.6875rem] leading-none tracking-[0.14em] text-muted uppercase">
                Drivers
              </span>
            </span>
          </Link>

          {linked && (
            <nav aria-label="Driver panel" className="ms-2 hidden items-center gap-1 md:flex lg:ms-4">
              {TABS.map((tab) => {
                const active = isActive(tab);
                return (
                  <Link
                    key={tab.href}
                    href={path(tab.href)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-sm px-3 text-[0.875rem] whitespace-nowrap transition-colors",
                      active ? "bg-surface-soft font-semibold text-ink" : "text-muted hover:bg-surface-soft/70 hover:text-ink",
                    )}
                  >
                    <tab.icon size={16} className={cn(active && "text-brand-text")} aria-hidden />
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          )}

          <div className="ms-auto flex shrink-0 items-center gap-1 lg:gap-3">
            {linked && <NotificationBell scope="driver" unreadCount={unreadCount} />}

            {/* Who is signed in lives on the Me tab; the bar keeps to what
                fits at every width. Visibility on wrappers: the button sets
                its own display. */}
            <span className="lg:hidden">
              <DriverSignOutButton variant="icon" />
            </span>
            <span className="hidden lg:block">
              <DriverSignOutButton variant="inline" />
            </span>
          </div>
        </div>
      </header>
      <DriverOffline />

      {/* Clear of the bottom bar and of the home indicator beneath it. */}
      <main
        id="driver-main"
        className={cn(
          "mx-auto w-full max-w-4xl flex-1 px-4 pt-5 md:px-6 md:pt-8 md:pb-12",
          linked ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))]" : "pb-10",
        )}
      >
        {children}
      </main>

      {linked && (
        <nav
          aria-label="Driver panel"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
        >
          <ul className="mx-auto grid max-w-md grid-cols-4">
            {TABS.map((tab) => {
              const active = isActive(tab);
              return (
                <li key={tab.href}>
                  <Link
                    href={path(tab.href)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-16 flex-col items-center justify-center gap-1 text-[0.75rem] font-medium transition-colors",
                      active ? "text-brand-text" : "text-muted active:text-ink",
                    )}
                  >
                    {/* The active tab's icon sits in a pill: colour alone is
                        a weak signal in sunlight. */}
                    <span
                      className={cn(
                        "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                        active && "bg-brand-soft",
                      )}
                      aria-hidden
                    >
                      <tab.icon size={20} />
                    </span>
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
