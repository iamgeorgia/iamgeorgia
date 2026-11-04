"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { LiveRefreshProvider } from "@/components/admin/LiveBadgesContext";
import { Logo } from "@/components/layout/Logo";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { PortalAccountMenu } from "@/components/partners/PortalAccountMenu";
import { PortalSidebar } from "@/components/partners/PortalSidebar";
import { partnerKindLabels } from "@/lib/admin/partners";
import { fetchUnreadSummary } from "@/lib/api/notifications";
import { signOut } from "@/lib/api/partners";
import { forgetViewer } from "@/lib/auth/useViewer";
import { stripLocale } from "@/lib/i18n/config";
import { useLocalePath } from "@/lib/i18n/provider";
import { useLivePoll } from "@/lib/live/useLivePoll";
import { portalNavigationFor, portalScreenLabel } from "@/lib/partners/navigation";
import { can, type Session } from "@/types/auth";

/** The sidebar is a fixed column from here up; below it, a drawer. */
const DESKTOP = "(min-width: 64rem)";

/**
 * Chrome for the partner platform.
 *
 * Two shapes. A partner through the gate gets the working shell: a sidebar of
 * the screens their account may open, a top bar naming the company they act
 * for, the bell and their account. Anyone else — signed out, or waiting on a
 * decision — gets a plain bar with the wordmark and, if signed in, the way
 * out: offering navigation into rooms they cannot enter would be a worse
 * experience than offering none.
 *
 * Deliberately plainer than the public site: a partner signs in to do work,
 * not to be sold a holiday.
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
  const partner = session?.partner ?? null;
  const approved = partner?.status === "APPROVED";
  const hasBell = approved && can(session, "notifications.read");

  // The bell's number, re-read every minute while the tab is on screen and
  // after anything that marks a notice read. The layout's count paints first.
  const live = useLivePoll(() => fetchUnreadSummary("partner"), { intervalMs: 60_000, enabled: hasBell });
  const unread = live.value?.unreadCount ?? unreadCount;

  /**
   * The drawer is stamped with the route it was opened on, so a navigation
   * closes it without an effect reaching in to reset anything — the drawer
   * must never survive the page it was opened from.
   */
  const [drawer, setDrawer] = useState({ route: pathname, open: false });
  const navOpen = drawer.route === pathname && drawer.open;
  const setNavOpen = useCallback((open: boolean) => setDrawer({ route: pathname, open }), [pathname]);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // While the drawer is open it is modal: the page behind it is `inert` (set
  // below), the body does not scroll, Escape closes it, and focus moves in on
  // open and back to the menu button on close.
  useEffect(() => {
    if (navOpen) {
      wasOpen.current = true;
      // Tried now and, while refused, once a frame for a few frames. Under
      // reduced motion the global rule gives every element a 0.01ms
      // transition, and every element's transition-property defaults to
      // `all` — so the drawer's contents transition their inherited
      // visibility from hidden, and stay hidden (and unfocusable) until the
      // browser has started and finished those transitions a frame or two on.
      let frame = 0;
      let attempts = 0;
      const focusClose = () => {
        const button = closeButtonRef.current;
        if (!button) return;
        button.focus();
        if (document.activeElement !== button && ++attempts < 10) frame = requestAnimationFrame(focusClose);
      };
      focusClose();
      const { overflow } = document.body.style;
      document.body.style.overflow = "hidden";
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setNavOpen(false);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => {
        cancelAnimationFrame(frame);
        document.body.style.overflow = overflow;
        document.removeEventListener("keydown", onKeyDown);
      };
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      // Only when the menu button is still on screen: a link in the drawer
      // has already moved the reader to a new page, and that page's own
      // focus handling wins.
      if (menuButtonRef.current?.offsetParent) menuButtonRef.current.focus();
    }
  }, [navOpen, setNavOpen]);

  // Widening the window past the breakpoint turns the drawer into the fixed
  // sidebar; an "open" drawer left behind would keep the page inert.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const onChange = () => {
      if (query.matches) setNavOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [setNavOpen]);

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
      router.replace(path("/portal/sign-in"));
      router.refresh();
    }
  };

  // Inert with the page while the drawer is open: it sits before the drawer in
  // the tab order, so it would otherwise be where Tab escapes the drawer to.
  const skipLink = (
    <a
      href="#portal-main"
      inert={navOpen || undefined}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-200 focus:rounded-sm focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:text-white"
    >
      Skip to content
    </a>
  );

  if (!approved || !partner || !session) {
    return (
      <LiveRefreshProvider refresh={live.refresh}>
      <div className="flex min-h-svh flex-col bg-background">
        {skipLink}
        <header className="sticky top-0 z-60 border-b border-line bg-background/95 backdrop-blur-md">
          <div className="mx-auto flex h-16 w-full max-w-[84rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <Link
              href={path(session ? "/portal" : "/portal/sign-in")}
              className="flex min-w-0 items-center gap-2.5 rounded-xs focus-visible:outline-offset-4"
            >
              <Logo className="size-7" />
              <span className="min-w-0">
                <span className="block truncate font-display text-[0.9375rem] leading-none tracking-[0.06em] text-ink">
                  I&apos;AM GEORGIA
                </span>
                <span className="mt-1 block text-[0.6875rem] leading-none tracking-[0.14em] text-muted uppercase">
                  Partners
                </span>
              </span>
            </Link>

            {session && (
              <PortalAccountMenu
                user={session.user}
                companyName={partner?.name}
                links={false}
                onSignOut={handleSignOut}
              />
            )}
          </div>
        </header>

        <main id="portal-main" className="min-w-0 flex-1">
          {children}
        </main>

        <footer className="border-t border-line px-4 py-6 text-center text-[0.8125rem] leading-relaxed text-muted sm:px-6">
          Questions about your account? Reply to any email from us and it reaches the partnerships team.
        </footer>
      </div>
      </LiveRefreshProvider>
    );
  }

  const groups = portalNavigationFor(session);
  const screen = portalScreenLabel(current);

  return (
    <LiveRefreshProvider refresh={live.refresh}>
      <div className="min-h-svh bg-background">
        {skipLink}

        <PortalSidebar
          groups={groups}
          current={current}
          partner={partner}
          unread={hasBell ? unread : 0}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          closeRef={closeButtonRef}
        />

        <div inert={navOpen || undefined} className="flex min-h-svh min-w-0 flex-col lg:ps-64">
          <header className="sticky top-0 z-60 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-background/95 px-3 backdrop-blur-md sm:gap-3 sm:px-6 lg:px-8">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              aria-controls="portal-navigation"
              className="flex size-11 shrink-0 items-center justify-center rounded-sm text-ink transition-colors hover:bg-surface-soft lg:hidden"
            >
              <Menu size={20} aria-hidden />
            </button>

            {/* Below `lg`: where you are, since the sidebar that would say so
                is folded away. The company lives in the drawer. */}
            <p className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
              <Logo className="size-6" />
              <span className="truncate text-[0.9375rem] font-semibold text-ink">{screen ?? "Partners"}</span>
            </p>

            {/* From `lg`: which company this session acts for. The sidebar
                already says where you are. */}
            <div className="hidden min-w-0 flex-1 lg:block">
              <p className="truncate text-[0.875rem] leading-tight font-semibold text-ink" title={partner.name}>
                {partner.name}
              </p>
              <p className="mt-0.5 truncate text-[0.75rem] leading-tight text-muted">
                <span className="font-mono">{partner.reference}</span> · {partnerKindLabels[partner.kind]}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {hasBell && <NotificationBell scope="partner" unreadCount={unread} />}
              <PortalAccountMenu user={session.user} companyName={partner.name} onSignOut={handleSignOut} />
            </div>
          </header>

          <main id="portal-main" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </LiveRefreshProvider>
  );
}
