"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut, Menu, Search } from "lucide-react";
import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";

import { AdminSidebar } from "./AdminSidebar";
import { AdminViewerProvider } from "./AdminViewerContext";
import { NavigationProgressBar, NavigationProgressProvider } from "./NavigationProgress";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { signOut } from "@/lib/api/partners";
import { NO_BADGES } from "@/lib/api/admin";
import { forgetViewer } from "@/lib/auth/useViewer";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { AdminBadges } from "@/lib/admin/navigation";
import type { SessionUser } from "@/types/auth";

interface AdminShellProps {
  /**
   * A promise, not a value: the layout starts the request and hands it over
   * without waiting, so the shell paints before the counts are known. The
   * pieces that show a number read it through `use()` under Suspense and
   * show zeros until it lands.
   */
  badges: Promise<AdminBadges>;
  user: SessionUser;
  children: React.ReactNode;
}

/** Renders its children with the resolved counts; suspends until they arrive. */
function WithBadges({
  badges,
  children,
}: {
  badges: Promise<AdminBadges>;
  children: (badges: AdminBadges) => React.ReactNode;
}) {
  return children(use(badges));
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Administrator",
  MANAGEMENT: "Management",
  TOUR_OPERATOR: "Tour operator",
  ACCOUNTANT: "Accountant",
  FINANCE_OPERATOR: "Finance operator",
  DISPATCHER: "Dispatcher",
  DRIVER: "Driver",
};

/** "Tamar Gelashvili" -> "TG". Falls back to the email for a one-word name. */
const initialsOf = (user: SessionUser) =>
  [user.firstName, user.lastName]
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || user.email.slice(0, 2).toUpperCase();

/**
 * The chrome every admin screen sits inside: fixed sidebar on desktop, drawer
 * on mobile, and a top bar carrying search and the operator's account.
 *
 * A client component because the drawer and account menu are interactive, but
 * it takes its content as `children`, so each page underneath still renders on
 * the server.
 */
export function AdminShell({ badges, user, children }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const path = useLocalePath();
  const accountRef = useRef<HTMLDivElement>(null);

  /**
   * Both overlays are stamped with the route they were opened on, so a
   * navigation closes them without an effect having to reach in and reset
   * anything — the drawer must never survive the page it was opened from.
   */
  const [overlay, setOverlay] = useState({
    route: pathname,
    nav: false,
    account: false,
  });
  const current = overlay.route === pathname ? overlay : { nav: false, account: false };
  const navOpen = current.nav;
  const accountOpen = current.account;

  // Stable across renders so the effects below can depend on them honestly.
  const setNavOpen = useCallback(
    (open: boolean) => setOverlay({ route: pathname, nav: open, account: false }),
    [pathname],
  );
  const setAccountOpen = useCallback(
    (open: boolean) => setOverlay({ route: pathname, nav: false, account: open }),
    [pathname],
  );

  useEffect(() => {
    if (!navOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [navOpen]);

  /**
   * Sign-out has to reach the server: the session is a row in the database and
   * the cookie is httpOnly, so navigating to the sign-in page would leave a
   * perfectly usable session behind.
   */
  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      forgetViewer();
      router.replace(path("/admin/sign-in"));
      router.refresh();
    }
  };

  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen, setAccountOpen]);

  return (
    <NavigationProgressProvider>
      <div className="flex min-h-svh w-full bg-background">
        <Suspense
          fallback={
            <AdminSidebar capabilities={user.capabilities ?? []} badges={NO_BADGES} open={navOpen} onClose={() => setNavOpen(false)} />
          }
        >
          <WithBadges badges={badges}>
            {(resolved) => (
              <AdminSidebar capabilities={user.capabilities ?? []} badges={resolved} open={navOpen} onClose={() => setNavOpen(false)} />
            )}
          </WithBadges>
        </Suspense>

        <div className="flex min-w-0 flex-1 flex-col lg:ps-64">
          <header className="sticky top-0 z-60 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-background/90 px-4 backdrop-blur-md sm:px-6">
            {/* Runs along the header's bottom edge while a section is being fetched. */}
            <NavigationProgressBar />

            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              className="flex size-10 shrink-0 items-center justify-center rounded-sm text-ink transition-colors hover:bg-surface-soft lg:hidden"
            >
              <Menu size={20} aria-hidden />
            </button>

            {/* Presentational only — the panel has no search index yet. */}
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <input
                type="search"
                placeholder="Search bookings, partners…"
                aria-label="Search the admin panel"
                className="h-10 w-full rounded-sm border border-line bg-surface ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
              />
            </div>

            <div className="ms-auto flex shrink-0 items-center gap-1">
              {/* The unread count rides on the badges request; the list is fetched when the bell opens. */}
              <Suspense fallback={<NotificationBell scope="admin" unreadCount={NO_BADGES.unreadNotifications} />}>
                <WithBadges badges={badges}>
                  {(resolved) => <NotificationBell scope="admin" unreadCount={resolved.unreadNotifications} />}
                </WithBadges>
              </Suspense>

              <div ref={accountRef} className="relative">
                <button
                  type="button"
                  onClick={() => setAccountOpen(!accountOpen)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-sm py-1.5 ps-1.5 pe-2 transition-colors hover:bg-surface-soft"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[0.6875rem] font-semibold text-on-dark">
                    {initialsOf(user)}
                  </span>
                  <span className="hidden text-start sm:block">
                    <span className="block text-[0.8125rem] font-medium text-ink">
                      {user.fullName}
                    </span>
                    <span className="block text-[0.6875rem] text-muted">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </span>
                  </span>
                  <ChevronDown
                    size={15}
                    className={cn(
                      "shrink-0 text-subtle transition-transform duration-200",
                      accountOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>

                {accountOpen && (
                  <div
                    role="menu"
                    className="absolute top-full end-0 z-70 mt-2 w-56 rounded-sm border border-line bg-surface p-1.5 shadow-lift"
                  >
                    <p className="px-3 py-2">
                      <span className="block text-[0.8125rem] font-medium text-ink">
                        {user.fullName}
                      </span>
                      <span className="block truncate text-[0.75rem] text-muted">
                        {user.email}
                      </span>
                    </p>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-start text-[0.8125rem] text-body transition-colors hover:bg-surface-soft hover:text-ink"
                    >
                      <LogOut size={15} className="text-subtle rtl:-scale-x-100" aria-hidden />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main id="admin-main" className="min-w-0 flex-1">
            <AdminViewerProvider user={user}>{children}</AdminViewerProvider>
          </main>
        </div>
      </div>
    </NavigationProgressProvider>
  );
}
