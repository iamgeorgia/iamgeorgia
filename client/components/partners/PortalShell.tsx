"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarCheck, LayoutDashboard, LogOut, Settings, UsersRound, Wallet } from "lucide-react";

import { LiveRefreshProvider } from "@/components/admin/LiveBadgesContext";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { fetchUnreadSummary } from "@/lib/api/notifications";
import { signOut } from "@/lib/api/partners";
import { useLivePoll } from "@/lib/live/useLivePoll";
import { forgetViewer } from "@/lib/auth/useViewer";
import { useLocalePath } from "@/lib/i18n/provider";
import { stripLocale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { can, type Session } from "@/types/auth";

/**
 * Only shown to a partner who is through the gate. Someone still waiting on a
 * decision has one page, and offering them navigation into rooms they cannot
 * enter would be a worse experience than offering none.
 */
const NAV: { label: string; href: string; icon: typeof Settings; capability?: string }[] = [
  { label: "Dashboard", href: "/portal/dashboard", icon: LayoutDashboard },
  { label: "Bookings", href: "/portal/bookings", icon: CalendarCheck },
  // Owners and partner admins only; the server answers 403 to anyone else.
  { label: "Team", href: "/portal/team", icon: UsersRound, capability: "partner.team.manage" },
  // What the company owes us and, for a supplier, what we owe it.
  { label: "Finance", href: "/portal/finance", icon: Wallet, capability: "partner.statement.read" },
  { label: "Settings", href: "/portal/settings", icon: Settings },
];

/**
 * Chrome for the partner platform.
 *
 * Deliberately plainer than the public site's: a partner signs in to do work,
 * not to be sold a holiday, so there is no marketing navigation here — only who
 * you are, which company you are acting for, and the way out.
 */
export function PortalShell({
  session,
  unreadCount = 0,
  children,
}: {
  session: Session | null;
  /** The bell's number, read by the layout with the page. */
  unreadCount?: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const path = useLocalePath();
  const current = stripLocale(pathname);
  const approved = session?.partner?.status === "APPROVED";
  const nav = NAV.filter((item) => !item.capability || can(session, item.capability));
  const hasBell = approved && can(session, "notifications.read");

  // The bell's number, re-read every minute while the tab is on screen and
  // after anything that marks a notice read. The layout's count paints first.
  const live = useLivePoll(() => fetchUnreadSummary("partner"), { intervalMs: 60_000, enabled: hasBell });
  const unread = live.value?.unreadCount ?? unreadCount;

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      forgetViewer();
      router.replace(path("/portal/sign-in"));
      router.refresh();
    }
  };

  return (
    <LiveRefreshProvider refresh={live.refresh}>
      <div className="flex min-h-svh flex-col bg-background">
        <a
          href="#portal-main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:start-4 focus:z-200 focus:rounded-sm focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:text-on-dark"
        >
          Skip to content
        </a>

        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-(--container-page) items-center gap-4 px-5 py-4 sm:px-8 lg:px-12">
            <Link href={path("/portal")} className="min-w-0 font-display text-[1.125rem] text-ink">
              I am Georgia
              <span className="ms-2 text-[0.75rem] tracking-[0.12em] text-muted uppercase">
                Partners
              </span>
            </Link>

            {/* From `md`, not `sm`: wordmark, three links, the account name and
                sign-out need ~740px and overflowed a small tablet. The name
                waits for `lg`. */}
            {approved && (
              <nav aria-label="Partner platform" className="ms-6 hidden items-center gap-1 md:flex">
                {nav.map((item) => {
                  const active = current === item.href || current.startsWith(`${item.href}/`);

                  return (
                    <Link
                      key={item.href}
                      href={path(item.href)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-sm px-3 text-[0.8125rem] transition-colors",
                        active
                          ? "bg-surface-soft font-medium text-ink"
                          : "text-muted hover:bg-surface-soft hover:text-ink",
                      )}
                    >
                      <item.icon size={15} aria-hidden />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}

            {session && (
              <div className="ms-auto flex shrink-0 items-center gap-4">
                {hasBell && <NotificationBell scope="partner" unreadCount={unread} />}
                <span className="hidden text-end lg:block">
                  <span className="block text-[0.8125rem] font-medium text-ink">
                    {session.user.fullName}
                  </span>
                  {session.partner && (
                    <span className="block text-[0.6875rem] text-muted">{session.partner.name}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex h-9 items-center gap-2 rounded-sm border border-line px-3 text-[0.8125rem] whitespace-nowrap text-body transition-colors hover:border-ink/40 hover:text-ink"
                >
                  <LogOut size={14} className="rtl:-scale-x-100" aria-hidden />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {approved && (
          <nav
            aria-label="Partner platform"
            // Five entries do not fit a phone; the strip scrolls on its own
            // rather than widening the page.
            className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-5 pb-3 sm:px-8 md:hidden"
          >
            {nav.map((item) => {
              const active = current === item.href || current.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={path(item.href)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm px-2.5 text-[0.8125rem] transition-colors",
                    active ? "bg-surface-soft font-medium text-ink" : "text-muted",
                  )}
                >
                  <item.icon size={15} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        <main id="portal-main" className="flex-1">
          {children}
        </main>

        <footer className="border-t border-line px-5 py-6 text-center text-[0.8125rem] text-muted sm:px-8">
          Questions about your account? Reply to any email from us and it reaches the partnerships
          team.
        </footer>
      </div>
    </LiveRefreshProvider>
  );
}
