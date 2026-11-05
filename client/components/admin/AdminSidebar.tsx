"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronDown, X } from "lucide-react";
import { useId, useState } from "react";

import { useReportPendingNavigation } from "@/components/admin/NavigationProgress";
import { Logo } from "@/components/layout/Logo";
import { stripLocale } from "@/lib/i18n/config";
import { useLocalePath } from "@/lib/i18n/provider";
import {
  navigationFor,
  adminSectionBadgeCount,
  isAdminNavSection,
  isAdminPathActive,
  isAdminSectionActive,
  type AdminBadges,
  type AdminNavEntry,
  type AdminNavItem,
  type AdminNavSection,
} from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  /** Counts for the queue pills, resolved by the shell. */
  badges: AdminBadges;
  /** The signed-in account's capabilities; the sidebar offers what they open. */
  capabilities: readonly string[];
  /** Mobile drawer state. On `lg` the sidebar is always shown. */
  open: boolean;
  onClose: () => void;
}

/** A queue count. Never the only signal — the number is read out too. */
function NavBadge({ count }: { count: number }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5",
        "bg-brand text-[0.6875rem] font-semibold text-white tabular-nums",
      )}
    >
      {count}
      <span className="sr-only"> awaiting review</span>
    </span>
  );
}

/**
 * The visible row of a destination.
 *
 * Split from the link so it can read the link's pending state: the row
 * lights up the moment it is clicked, not when the router has finished the
 * transition. With the panel's loading boundary prefetched those are the same
 * frame; when they are not — a cold dev server, a slow connection, a click
 * before the prefetch landed — the operator still sees at once that the
 * click registered and where they are going.
 */
function NavRow({
  item,
  active,
  count,
  nested,
}: {
  item: AdminNavItem;
  active: boolean;
  count: number;
  nested?: boolean;
}) {
  const { pending } = useLinkStatus();
  useReportPendingNavigation(pending);
  const lit = active || pending;

  return (
    <span
      data-pending={pending || undefined}
      className={cn(
        "flex items-center rounded-sm transition-colors",
        nested
          ? "gap-2.5 px-2.5 py-2 text-[0.8125rem]"
          : "gap-3 px-3 py-2.5 text-sm font-medium",
        lit
          ? "bg-on-dark/12 text-on-dark"
          : "text-on-dark/65 group-hover:bg-on-dark/6 group-hover:text-on-dark",
      )}
    >
      <item.icon
        size={nested ? 15 : 17}
        className={cn("shrink-0", lit ? "text-brand" : "text-on-dark/45")}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count > 0 && <NavBadge count={count} />}
    </span>
  );
}

/**
 * One destination. `nested` only changes the weight — a sub-item is quieter
 * and slightly smaller than a top-level one, but it is the same control.
 *
 * `aria-current` follows the real pathname, never the pending state: what is
 * announced as the current page must be the page that is actually open.
 */
function NavLink({
  item,
  active,
  count,
  nested,
  onNavigate,
}: {
  item: AdminNavItem;
  active: boolean;
  count: number;
  nested?: boolean;
  onNavigate: () => void;
}) {
  const path = useLocalePath();

  return (
    <Link
      href={path(item.href)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className="group block rounded-sm"
    >
      <NavRow item={item} active={active} count={count} nested={nested} />
    </Link>
  );
}

/**
 * A vertical that owns several screens, rendered as a disclosure.
 *
 * Expanded by default: this panel is worked by keyboard all day, and hiding
 * four screens behind a click to save four lines would be a bad trade. The
 * collapse is there for an operator who never touches transfers, and it
 * survives navigation because the shell holding this sidebar is not remounted
 * between panel screens.
 */
function NavSection({
  section,
  canonical,
  badges,
  onNavigate,
}: {
  section: AdminNavSection;
  canonical: string;
  badges: AdminBadges;
  onNavigate: () => void;
}) {
  const panelId = useId();
  const active = isAdminSectionActive(canonical, section);

  const [collapsed, setCollapsed] = useState(false);
  const [wasActive, setWasActive] = useState(active);

  // Walking into a collapsed section opens it, so the sidebar can never be in
  // the state of hiding the screen the operator is looking at. Adjusted during
  // render rather than in an effect: it has to be true on the first paint
  // after the navigation, not one frame later.
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setCollapsed(false);
  }

  // What folding the section away is hiding. A queue that needs attention has
  // to announce itself from a collapsed row, or the collapse becomes a way to
  // lose work.
  const hiddenCount = collapsed ? adminSectionBadgeCount(section, badges) : 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors",
          active ? "text-on-dark" : "text-on-dark/65 hover:bg-on-dark/6 hover:text-on-dark",
        )}
      >
        <section.icon
          size={17}
          className={cn("shrink-0", active ? "text-brand" : "text-on-dark/45")}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-start">{section.label}</span>
        {hiddenCount > 0 && <NavBadge count={hiddenCount} />}
        {/* Rotation, not a direction — this one must not flip in Hebrew. */}
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-on-dark/40 transition-transform duration-200",
            !collapsed && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {/*
        Indented against a rail aligned with the parent's icon, so the run
        reads as belonging to it. Logical inset — in Hebrew the rail and the
        indent move to the right along with everything else.

        Each sub-group is its own list under its own caption, with a hairline
        between neighbours, so a long section reads as a few short lists. The
        captions only appear when there is more than one sub-group to tell
        apart — a dispatcher, who sees just the fleet half, gets a plain run.
      */}
      <div
        id={panelId}
        hidden={collapsed}
        className="mt-0.5 ms-[1.3125rem] border-s border-on-dark/12 ps-2"
      >
        {section.groups.map((group, index) => {
          const captioned = section.groups.length > 1;
          const captionId = `${panelId}-${index}`;

          return (
            <div
              key={group.label}
              className={cn(index > 0 && "mt-2 border-t border-on-dark/10 pt-2")}
            >
              {captioned && (
                <p
                  id={captionId}
                  className="px-2.5 pt-1 pb-1.5 text-[0.625rem] font-semibold tracking-[0.14em] text-on-dark/35 uppercase"
                >
                  {group.label}
                </p>
              )}
              <ul aria-labelledby={captioned ? captionId : undefined} className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      nested
                      active={isAdminPathActive(canonical, item.href)}
                      count={item.badgeKey ? badges[item.badgeKey] : 0}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </li>
  );
}

/** One titled group, its heading naming the list beneath it. */
function NavGroup({
  title,
  entries,
  canonical,
  badges,
  onNavigate,
}: {
  title: string;
  entries: AdminNavEntry[];
  canonical: string;
  badges: AdminBadges;
  onNavigate: () => void;
}) {
  const headingId = useId();

  // The run holding the overview has no title: a heading over one link would
  // be a label for its own sake. It is still a named list for a screen reader.
  return (
    <div className={cn(title ? "mb-6" : "mb-4", "last:mb-0")}>
      {title ? (
        <h2
          id={headingId}
          className="px-3 pb-2 text-[0.6875rem] font-semibold tracking-[0.16em] text-on-dark/40 uppercase"
        >
          {title}
        </h2>
      ) : null}
      <ul aria-labelledby={title ? headingId : undefined} aria-label={title ? undefined : "Overview"} className="space-y-0.5">
        {entries.map((entry) =>
          isAdminNavSection(entry) ? (
            <NavSection
              key={entry.label}
              section={entry}
              canonical={canonical}
              badges={badges}
              onNavigate={onNavigate}
            />
          ) : (
            <li key={entry.href}>
              <NavLink
                item={entry}
                active={isAdminPathActive(canonical, entry.href)}
                count={entry.badgeKey ? badges[entry.badgeKey] : 0}
                onNavigate={onNavigate}
              />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/**
 * The panel's primary navigation.
 *
 * Charcoal rather than white: it borrows the footer and mobile-menu treatment
 * from the public site, which anchors the layout and leaves the working area
 * as the only bright surface on screen. Counts sit on the destinations that
 * can hold a queue, so an operator knows where the work is before clicking
 * anything.
 */
export function AdminSidebar({ badges, open, onClose, capabilities }: AdminSidebarProps) {
  const pathname = usePathname();
  const path = useLocalePath();
  const canonical = stripLocale(pathname);

  return (
    <>
      {/* Scrim for the mobile drawer. */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-70 bg-ink/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-80 flex w-64 flex-col bg-ink text-on-dark",
          "transition-transform duration-300 ease-(--ease-out-soft) lg:translate-x-0 lg:rtl:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-on-dark/10 px-5">
          <Link
            href={path("/admin")}
            className="flex min-w-0 items-center gap-2.5 focus-visible:outline-offset-4"
          >
            <Logo className="size-7 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate font-display text-[0.9375rem] leading-none tracking-[0.06em]">
                I&apos;AM GEORGIA
              </span>
              <span className="mt-1 block text-[0.6875rem] leading-none tracking-[0.14em] text-on-dark/45 uppercase">
                Admin
              </span>
            </span>
          </Link>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex size-9 shrink-0 items-center justify-center rounded-sm text-on-dark/70 transition-colors hover:bg-on-dark/10 hover:text-on-dark lg:hidden"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <nav
          aria-label="Admin sections"
          className="scrollbar-dark flex-1 overflow-y-auto overscroll-contain px-3 py-5"
        >
          {navigationFor(capabilities).map((group) => (
            <NavGroup
              key={group.title}
              title={group.title}
              entries={group.entries}
              canonical={canonical}
              badges={badges}
              onNavigate={onClose}
            />
          ))}
        </nav>

        <div className="shrink-0 border-t border-on-dark/10 p-3">
          <Link
            href={path("/")}
            className="group flex items-center justify-between gap-3 rounded-sm px-3 py-2.5 text-sm text-on-dark/65 transition-colors hover:bg-on-dark/6 hover:text-on-dark"
          >
            View public site
            <ArrowUpRight
              size={15}
              className="shrink-0 text-on-dark/40 transition-transform duration-200 ease-(--ease-out-soft) group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100"
              aria-hidden
            />
          </Link>
        </div>
      </aside>
    </>
  );
}
