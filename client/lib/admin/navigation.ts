import {
  BedDouble,
  Boxes,
  Bus,
  CalendarCheck,
  CalendarRange,
  Car,
  CarFront,
  Coins,
  Compass,
  ConciergeBell,
  ClipboardCheck,
  Globe2,
  Handshake,
  LayoutDashboard,
  Map,
  MapPin,
  PackageCheck,
  Route,
  Radio,
  Star,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * Admin navigation.
 *
 * Four levels, and each one earns its place. **Groups** split the operator's
 * day into things that need a decision (bookings, partner applications) and
 * things that are catalogue maintenance. **Sections** collect the screens of a
 * single vertical that is too big to sit flat — transfers alone owns eight
 * screens, and left unnested they crowded out every other kind of inventory
 * in the sidebar. **Sub-groups** split a long section along a line the reader
 * already knows (the catalogue versus the fleet), each run captioned and set
 * off by a divider so eight rows read as two short lists rather than one long
 * one. **Items** are the screens themselves.
 *
 * A vertical stays flat until it has more than one catalogue screen: hotels,
 * destinations and tours each have exactly one way in, and wrapping a single
 * link in a disclosure would be a control that hides one thing.
 */

export type AdminBadgeKey =
  | "pendingBookings"
  | "pendingPartners"
  | "unassignedLegs"
  | "pendingTourRequests"
  | "pendingOrders";

export type AdminBadges = Record<AdminBadgeKey, number>;

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown as a count pill — the number of records awaiting a decision. */
  badgeKey?: AdminBadgeKey;
  /** Reachable by transfer operations staff (a dispatcher), not only admins. */
  ops?: boolean;
}

/**
 * A labelled run of items inside a section, separated from its neighbours by
 * a divider. The split is by what the screens are *about*: the catalogue a
 * traveller sees versus the fleet that fulfils it. A section with one
 * sub-group renders no caption — a divider with nothing on the other side of
 * it is a line for its own sake.
 */
export interface AdminNavSubgroup {
  label: string;
  items: AdminNavItem[];
}

/** A collapsible run of sub-groups belonging to one vertical. */
export interface AdminNavSection {
  label: string;
  icon: LucideIcon;
  groups: AdminNavSubgroup[];
}

/** Every screen a section holds, in reading order, sub-group boundaries dropped. */
export function adminSectionItems(section: AdminNavSection): AdminNavItem[] {
  return section.groups.flatMap((group) => group.items);
}

/**
 * The navigation as one role sees it. Admins see everything; a dispatcher
 * sees the transfer operations screens and nothing that would answer 403.
 * The server enforces the same split on every endpoint — this only keeps
 * the sidebar honest.
 */
export function navigationFor(role: string): AdminNavGroup[] {
  if (role !== "DISPATCHER") return adminNavigation;

  return adminNavigation
    .map((group) => ({
      ...group,
      entries: group.entries
        .map((entry) =>
          isAdminNavSection(entry)
            ? {
                ...entry,
                // A sub-group that loses every item goes with them, so no
                // caption is left standing over an empty run.
                groups: entry.groups
                  .map((sub) => ({ ...sub, items: sub.items.filter((item) => item.ops) }))
                  .filter((sub) => sub.items.length > 0),
              }
            : entry,
        )
        .filter((entry) => (isAdminNavSection(entry) ? entry.groups.length > 0 : entry.ops)),
    }))
    .filter((group) => group.entries.length > 0);
}

export type AdminNavEntry = AdminNavItem | AdminNavSection;

export interface AdminNavGroup {
  title: string;
  entries: AdminNavEntry[];
}

export function isAdminNavSection(entry: AdminNavEntry): entry is AdminNavSection {
  return "groups" in entry;
}

export const adminNavigation: AdminNavGroup[] = [
  {
    title: "Operations",
    entries: [
      { label: "Overview", href: "/admin", icon: LayoutDashboard },
      // Two registers rather than one, because a TRF reference is not a BKG
      // one and the two lists share no identifier space. Both are named for
      // what they hold: "Bookings" on its own stopped being unambiguous the
      // moment the second register appeared in the sidebar.
      {
        label: "Hotel bookings",
        href: "/admin/bookings",
        icon: CalendarCheck,
        badgeKey: "pendingBookings",
      },
      { label: "Transfer bookings", href: "/admin/transfers/bookings", icon: CarFront, ops: true },
      // TUR references. Badged with on-request bookings the operator has yet
      // to answer — seats are already claimed, so a request left waiting is
      // capacity nobody else can buy.
      {
        label: "Tour bookings",
        href: "/admin/tours/bookings",
        icon: Compass,
        badgeKey: "pendingTourRequests",
      },
      // ORD references: a package booked as one thing, with a hotel, a
      // transfer, a tour and a service under it. Badged with the orders
      // holding a request nobody has answered — those hold real capacity.
      {
        label: "Orders",
        href: "/admin/orders",
        icon: PackageCheck,
        badgeKey: "pendingOrders",
      },
      // Legs, not bookings, and badged with the ones nobody is driving yet.
      {
        label: "Dispatch",
        href: "/admin/transfers/dispatch",
        icon: Radio,
        badgeKey: "unassignedLegs",
        ops: true,
      },
    ],
  },
  {
    title: "Inventory",
    entries: [
      // First in the group, because everything under it is filed inside one:
      // a property, a tour or a pick-up point cannot be created until the place
      // it belongs to exists.
      { label: "Destinations", href: "/admin/destinations", icon: Globe2 },
      { label: "Hotels", href: "/admin/hotels", icon: BedDouble },
      {
        // A section rather than an item at /admin/transfers: that path only
        // redirects, and a disclosure that is also a link is a control whose
        // click does two different things depending on where it lands.
        //
        // Its active state is computed from the children, never from the
        // /admin/transfers prefix — Transfer bookings lives under that prefix
        // too and must not light up the catalogue section.
        label: "Transfers",
        icon: CarFront,
        // Eight screens, split down the line the product itself draws: what a
        // traveller buys versus what turns up to drive them. The catalogue is
        // an admin's job and changes rarely; the fleet is worked every day and
        // is the half a dispatcher is allowed to see.
        groups: [
          {
            label: "Catalogue",
            items: [
              { label: "Routes", href: "/admin/transfers/routes", icon: Route },
              // Where a route starts and ends — filed right after the routes
              // that reference it.
              { label: "Pick-up points", href: "/admin/transfers/points", icon: MapPin },
              // The classes are what a traveller buys; the fleet is what turns
              // up. Two screens, because a class outlives any one car.
              { label: "Vehicle classes", href: "/admin/transfers/vehicles", icon: Bus },
              { label: "Extras", href: "/admin/transfers/extras", icon: Coins },
            ],
          },
          {
            label: "Fleet & drivers",
            items: [
              { label: "Fleet", href: "/admin/transfers/fleet", icon: Car, ops: true },
              { label: "Drivers", href: "/admin/transfers/drivers", icon: UserRound, ops: true },
              { label: "Schedule", href: "/admin/transfers/schedule", icon: CalendarRange, ops: true },
              // Ratings are about drivers, so they live beside them rather
              // than with the catalogue a traveller sees.
              { label: "Ratings", href: "/admin/transfers/ratings", icon: Star, ops: true },
            ],
          },
        ],
      },
      { label: "Tours", href: "/admin/tours", icon: Map },
      // Packages sit after the products they are assembled from: a slot can
      // only name a hotel, a route or a tour that already exists.
      { label: "Packages", href: "/admin/packages", icon: Boxes },
      { label: "Services", href: "/admin/services", icon: ConciergeBell },
    ],
  },
  {
    title: "Network",
    entries: [
      { label: "Partners", href: "/admin/partners", icon: Handshake },
      {
        // The review queue, badged with what is waiting. It sits beside the
        // register rather than inside it because it is the screen an operator
        // opens first, and a saved filter cannot carry a count in the sidebar.
        label: "Applications",
        href: "/admin/partners/applications",
        icon: ClipboardCheck,
        badgeKey: "pendingPartners",
      },
    ],
  },
];

/**
 * Marks a nav item active, including its detail pages, so opening one booking
 * keeps "Hotel bookings" highlighted. `/admin` only matches exactly — otherwise
 * the overview would stay lit on every screen.
 *
 * The pathname arrives locale-prefixed on non-English URLs, so callers pass the
 * canonical path.
 */
export function isAdminPathActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A section is active when one of its screens is — deliberately not a prefix
 * test on a shared parent path, which would light up Transfers whenever the
 * transfer *bookings* register was open.
 */
export function isAdminSectionActive(pathname: string, section: AdminNavSection): boolean {
  return adminSectionItems(section).some((item) => isAdminPathActive(pathname, item.href));
}

/**
 * What a collapsed section is hiding. A queue that needs attention must still
 * announce itself from a folded-away row, or collapsing the sidebar would be a
 * way to lose work.
 */
export function adminSectionBadgeCount(
  section: AdminNavSection,
  badges: AdminBadges,
): number {
  return adminSectionItems(section).reduce(
    (total, item) => total + (item.badgeKey ? badges[item.badgeKey] : 0),
    0,
  );
}

/**
 * The label of the screen a canonical admin path opens, or null when the path
 * is not a listed screen — a detail page, a "new" form, a redirect.
 *
 * Used by the panel's loading state, which paints the destination's title
 * from this table before the server has said anything about the page. Only an
 * exact match counts: a booking's detail page is not "Hotel bookings", and a
 * skeleton that says so would be a wrong heading for as long as it lasts.
 */
export function adminScreenLabel(pathname: string): string | null {
  for (const group of adminNavigation) {
    for (const entry of group.entries) {
      const items = isAdminNavSection(entry) ? adminSectionItems(entry) : [entry];
      const match = items.find((item) => item.href === pathname);
      if (match) return match.label;
    }
  }
  return null;
}
