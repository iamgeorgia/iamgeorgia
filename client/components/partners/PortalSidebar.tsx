"use client";

import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";

import { Logo } from "@/components/layout/Logo";
import { partnerKindLabels } from "@/lib/admin/partners";
import { useLocalePath } from "@/lib/i18n/provider";
import { isPortalItemActive, type PortalNavGroup } from "@/lib/partners/navigation";
import { cn } from "@/lib/utils";
import type { Partner } from "@/types";

/**
 * The partner platform's primary navigation: a fixed column from `lg`, a
 * drawer below it.
 *
 * Charcoal, like the admin panel's, so the two working surfaces read as one
 * system and the content area stays the only bright surface on screen. What
 * differs is what it carries: a partner has a handful of destinations, not a
 * catalogue, so there are no collapsible sections — every screen the account
 * may open is one click away and always in view.
 *
 * Closed below `lg` it is `invisible`, not merely translated off screen: a
 * drawer that is out of sight but still in the tab order sends a keyboard
 * user through six links they cannot see. `visibility` is in the transition,
 * so it flips only once the slide out has finished.
 */
export function PortalSidebar({
  groups,
  current,
  partner,
  unread,
  open,
  onClose,
  closeRef,
}: {
  groups: PortalNavGroup[];
  /** Locale-stripped current path. */
  current: string;
  partner: Partner;
  unread: number;
  open: boolean;
  onClose: () => void;
  /** The drawer's close button, which takes focus when the drawer opens. */
  closeRef: React.Ref<HTMLButtonElement>;
}) {
  const path = useLocalePath();

  return (
    <>
      {/* Scrim for the drawer. A click outside closes it, as Escape does. */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-70 bg-ink/60 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        id="portal-navigation"
        aria-label="Partner platform"
        className={cn(
          "fixed inset-y-0 start-0 z-80 flex w-[min(18rem,calc(100vw-3rem))] flex-col bg-ink text-on-dark lg:w-64",
          "duration-300 ease-(--ease-out-soft)",
          "lg:visible lg:translate-x-0 lg:rtl:translate-x-0",
          // Visibility is transitioned on the way out only, so the drawer
          // stays visible while it slides off. On the way in it flips at once:
          // a 300ms transition from hidden holds the drawer hidden for its
          // first frame, too long for the shell to move focus into it.
          open
            ? "visible translate-x-0 transition-[translate]"
            : "invisible -translate-x-full transition-[translate,visibility] rtl:translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-on-dark/10 ps-5 pe-3">
          <Link
            href={path("/portal/dashboard")}
            onClick={onClose}
            className="flex min-w-0 items-center gap-2.5 rounded-xs focus-visible:outline-offset-4"
          >
            <Logo className="size-7" />
            <span className="min-w-0">
              <span className="block truncate font-display text-[0.9375rem] leading-none tracking-[0.06em]">
                I&apos;AM GEORGIA
              </span>
              <span className="mt-1 block text-[0.6875rem] leading-none tracking-[0.14em] text-on-dark/50 uppercase">
                Partners
              </span>
            </span>
          </Link>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex size-11 shrink-0 items-center justify-center rounded-sm text-on-dark/70 transition-colors hover:bg-on-dark/10 hover:text-on-dark lg:hidden"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Which company this session acts for. On a desktop the top bar
            says it; in the drawer it is the only place it appears. */}
        <div className="border-b border-on-dark/10 px-5 py-4 lg:hidden">
          <p className="line-clamp-2 text-[0.9375rem] leading-snug font-medium wrap-anywhere">{partner.name}</p>
          <p className="mt-1 text-[0.75rem] text-on-dark/55">
            <span className="font-mono">{partner.reference}</span> · {partnerKindLabels[partner.kind]}
          </p>
        </div>

        <nav aria-label="Partner sections" className="scrollbar-dark flex-1 overflow-y-auto overscroll-contain px-3 py-5">
          {groups.map((group) => (
            <div key={group.title} className="mb-6 last:mb-0">
              <h2
                id={`portal-nav-${group.title}`}
                className="px-3 pb-2 text-[0.6875rem] font-semibold tracking-[0.16em] text-on-dark/45 uppercase"
              >
                {group.title}
              </h2>
              <ul aria-labelledby={`portal-nav-${group.title}`} className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isPortalItemActive(current, item);
                  const count = item.unread ? unread : 0;

                  return (
                    <li key={item.href}>
                      <Link
                        href={path(item.href)}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-on-dark/12 text-on-dark"
                            : "text-on-dark/70 hover:bg-on-dark/6 hover:text-on-dark",
                        )}
                      >
                        <item.icon
                          size={17}
                          className={cn("shrink-0", active ? "text-brand" : "text-on-dark/45 group-hover:text-on-dark/70")}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {count > 0 && (
                          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[0.6875rem] font-semibold text-white tabular-nums">
                            {count > 99 ? "99+" : count}
                            <span className="sr-only"> unread</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-3 border-t border-on-dark/10 p-3">
          {/* Partners book on the public site while signed in, and what they
              book lands in the registers here — so the way there is part of
              the platform, not a footer link. */}
          <Link
            href={path("/")}
            className="group flex min-h-11 items-center justify-between gap-3 rounded-sm px-3 py-2 text-sm text-on-dark/75 transition-colors hover:bg-on-dark/6 hover:text-on-dark"
          >
            Book on the site
            <ArrowUpRight
              size={15}
              className="shrink-0 text-on-dark/45 transition-transform duration-200 ease-(--ease-out-soft) group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
              aria-hidden
            />
          </Link>
          <p className="px-3 pb-1 text-[0.75rem] leading-relaxed text-on-dark/50">
            Questions about your account? Reply to any email from us and it reaches the partnerships team.
          </p>
        </div>
      </aside>
    </>
  );
}
