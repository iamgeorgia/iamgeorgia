import {
  Bell,
  CalendarCheck,
  LayoutDashboard,
  Settings,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { can, type Session } from "@/types/auth";

/**
 * The partner platform's navigation, in one place.
 *
 * The shell's sidebar, its mobile drawer, the top bar's section title and the
 * loading skeletons all read this list, so a screen is called the same thing
 * everywhere it is named. Visibility is by capability only — never by role
 * name or partner type — because the server decides what each account may
 * open and a custom role must behave exactly like a built-in one. Every gate
 * here is the same one the page itself applies before redirecting.
 */

export interface PortalNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown only to accounts holding this capability. */
  capability?: string;
  /** Other paths that belong to this item, for the active state. */
  matches?: string[];
  /** The bell's number rides on this item. */
  unread?: boolean;
}

export interface PortalNavGroup {
  title: string;
  items: PortalNavItem[];
}

const GROUPS: PortalNavGroup[] = [
  {
    title: "Workspace",
    items: [
      { label: "Dashboard", href: "/portal/dashboard", icon: LayoutDashboard },
      // A driver's profile is only ever reached from one of the company's
      // own transfers, so it lights the bookings it came from.
      { label: "Bookings", href: "/portal/bookings", icon: CalendarCheck, matches: ["/portal/drivers"] },
      { label: "Notifications", href: "/portal/notifications", icon: Bell, capability: "notifications.read", unread: true },
    ],
  },
  {
    title: "Company",
    items: [
      // What the company owes us and, for a supplier, what we owe it.
      { label: "Finance", href: "/portal/finance", icon: Wallet, capability: "partner.statement.read" },
      // Owners and partner admins only; the server answers 403 to anyone else.
      { label: "Team", href: "/portal/team", icon: UsersRound, capability: "partner.team.manage" },
      { label: "Settings", href: "/portal/settings", icon: Settings },
    ],
  },
];

/** The groups this account may open, with empty groups dropped. */
export function portalNavigationFor(session: Session | null): PortalNavGroup[] {
  return GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.capability || can(session, item.capability)),
  })).filter((group) => group.items.length > 0);
}

const within = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Whether a locale-stripped path is this item's screen or one beneath it. */
export function isPortalItemActive(path: string, item: PortalNavItem): boolean {
  return within(path, item.href) || (item.matches ?? []).some((base) => within(path, base));
}

/** Screens outside the sidebar that still have a name worth showing. */
const EXTRA_LABELS: Record<string, string> = {
  "/portal/terms": "Platform terms",
};

/**
 * What the screen at a locale-stripped path is called, for the mobile top bar
 * and the loading skeleton. Null when the path is nothing the portal names.
 */
export function portalScreenLabel(path: string): string | null {
  for (const group of GROUPS) {
    for (const item of group.items) {
      if (isPortalItemActive(path, item)) return item.label;
    }
  }
  return EXTRA_LABELS[path] ?? null;
}
