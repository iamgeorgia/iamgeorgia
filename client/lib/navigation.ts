/**
 * Single source of truth for site navigation — header, mobile menu and footer.
 *
 * Items carry a dictionary *key* rather than a label: the words come from the
 * active locale at render time. `href` is always the canonical, unprefixed
 * path — components run it through `localePath` to add the locale segment.
 */

import { CarFront, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { stripLocale } from "@/lib/i18n/config";
import type { UiDictionary } from "@/lib/i18n/ui/en";

export type NavKey = "tours" | "hotels" | "transfers" | "packages";

export interface NavItem {
  key: NavKey;
  href: string;
  /**
   * Optional glyph. The nav is otherwise deliberately text-only — an icon here
   * marks an item as a different *kind* of thing rather than another editorial
   * section. Transfers is a point-to-point transport service sitting among
   * inspiration-led sections, and the car reads that distinction instantly.
   * The label always accompanies it; the icon never carries meaning alone.
   */
  icon?: LucideIcon;
}

export const primaryNavigation: NavItem[] = [
  // The platform sells four things: stays, journeys, transfers, and the three
  // of them arranged as one trip. Nothing else earns a place here — a buyer
  // comes to book, not to browse a magazine. About and Contact stay reachable
  // from the footer.
  { key: "hotels", href: "/hotels" },
  { key: "tours", href: "/tours" },
  { key: "packages", href: "/packages", icon: Package },
  { key: "transfers", href: "/transfers", icon: CarFront },
];

export function navLabel(t: Pick<UiDictionary, "nav">, key: NavKey): string {
  return t.nav[key];
}

export function navDescription(t: Pick<UiDictionary, "nav">, key: NavKey): string {
  return t.nav.descriptions[key];
}

export interface FooterGroup {
  title: string;
  items: { label: string; href: string }[];
}

/** Built per-locale because both the group titles and the labels are translated. */
export function footerNavigation(t: Pick<UiDictionary, "nav" | "booking">): FooterGroup[] {
  return [
    {
      title: t.nav.groups.explore,
      items: [
        { label: t.nav.hotels, href: "/hotels" },
        { label: t.nav.tours, href: "/tours" },
        { label: t.nav.packages, href: "/packages" },
        { label: t.nav.transfers, href: "/transfers" },
      ],
    },
    {
      title: t.nav.groups.company,
      items: [
        { label: t.nav.about, href: "/about" },
        { label: t.nav.contact, href: "/contact" },
        { label: t.nav.planTrip, href: "/contact" },
        // Guests book without an account, so the only way back to a booking is
        // a link that is always on screen.
        { label: t.booking.nav.manage, href: "/booking/manage" },
        // `/portal` sorts out where a visitor actually belongs — admin panel,
        // partner dashboard or sign-in — so the footer needs one entry rather
        // than one per audience.
        { label: t.nav.account.portal, href: "/portal" },
      ],
    },
    {
      title: t.nav.groups.legal,
      items: [
        { label: t.nav.privacy, href: "/privacy" },
        { label: t.nav.terms, href: "/terms" },
        { label: t.nav.cookies, href: "/cookies" },
      ],
    },
  ];
}

/**
 * Marks a nav item active for the current pathname, including its detail pages
 * (`/tours/kazbegi-…` keeps "Tours" highlighted). "/" only matches exactly.
 *
 * The pathname arrives locale-prefixed (`/ka/tours`), so it is normalised back
 * to the canonical path before comparing — otherwise nothing would ever match
 * outside English.
 */
export function isActivePath(pathname: string, href: string): boolean {
  const path = stripLocale(pathname);
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}
