import {
  ArrowDownLeft,
  FileText,
  ArrowUpRight,
  Banknote,
  BedDouble,
  Bell,
  BellRing,
  Mail,
  Boxes,
  Bus,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  Car,
  CarFront,
  CircleHelp,
  Coins,
  Compass,
  ConciergeBell,
  Contact,
  ClipboardCheck,
  Gavel,
  Globe2,
  ChartColumn,
  Handshake,
  Landmark,
  LayoutDashboard,
  Layers,
  Map,
  MapPin,
  PackageCheck,
  Route,
  Radio,
  ScrollText,
  ShieldCheck,
  Star,
  UserRound,
  UsersRound,
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
 *
 * Every item names the capability that earns it a place, so the sidebar an
 * account sees is a function of what it holds and nothing else — a custom
 * role made in the Roles editor gets exactly the screens its capabilities
 * open, with no list here to update.
 */

export type AdminBadgeKey =
  /** Bookings and orders waiting for the platform's yes — Operations → Booking approvals. */
  | "pendingBookingApprovals"
  | "pendingBookings"
  | "pendingPartners"
  | "unassignedLegs"
  | "pendingTourRequests"
  | "pendingOrders"
  /** Supplier instalments overdue or due within the week — Finance → Payables. */
  | "paymentsDue"
  /** Money changes waiting for a second person to approve them — Finance → Approvals. */
  | "pendingApprovals"
  /** The viewer's own unread notices: the bell and the Notifications row. */
  | "unreadNotifications";

export type AdminBadges = Record<AdminBadgeKey, number>;

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown as a count pill — the number of records awaiting a decision. */
  badgeKey?: AdminBadgeKey;
  /**
   * The capabilities that earn the screen a place in the sidebar, any one of
   * them. Registers, queues, boards and reports are offered on their *read*
   * capability; maintenance screens (the catalogue editors, the fleet, the
   * applications queue) on the write capability that makes them useful, so a
   * read-only role is not invited to a screen it can only look at. The screen
   * table (`lib/admin/access.ts`) decides separately who may *open* a path,
   * which is wider: a read-only role still reaches an editor by link. Absent
   * means every staff account (the overview, the manual).
   */
  capability?: string | string[];
  /**
   * The capabilities that let the viewer *act* on the screen — change, record,
   * approve. Not a gate: used to order the sidebar's groups so the one the
   * viewer works in comes first (finance for an accountant, the queues for a
   * desk). Absent for a screen that is only ever read.
   */
  acts?: string | string[];
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

const anyOf = (needed: string | string[] | undefined, capabilities: readonly string[]): boolean => {
  if (!needed) return false;
  const list = Array.isArray(needed) ? needed : [needed];
  return list.some((capability) => capabilities.includes(capability));
};

/** Whether a set of held capabilities earns an item its place. */
export function canOpen(item: AdminNavItem, capabilities: readonly string[]): boolean {
  return !item.capability || anyOf(item.capability, capabilities);
}

/** Whether a set of held capabilities lets the viewer act on an item. */
export function canAct(item: AdminNavItem, capabilities: readonly string[]): boolean {
  return anyOf(item.acts, capabilities);
}

export type AdminNavEntry = AdminNavItem | AdminNavSection;

export interface AdminNavGroup {
  /** Empty for the untitled run at the top that holds the overview. */
  title: string;
  entries: AdminNavEntry[];
  /** Kept at the start or the end whatever the viewer holds. */
  pinned?: "start" | "end";
}

export function isAdminNavSection(entry: AdminNavEntry): entry is AdminNavSection {
  return "groups" in entry;
}

/** Every item in a group, sections flattened. */
export const adminGroupItems = (group: AdminNavGroup): AdminNavItem[] =>
  group.entries.flatMap((entry) => (isAdminNavSection(entry) ? adminSectionItems(entry) : [entry]));

/**
 * The navigation as one account sees it, from the capabilities its session
 * carries: a screen that would answer 403 is not offered, nor is one the
 * viewer could only look at. The server enforces the same split on every
 * endpoint — this only keeps the sidebar honest.
 *
 * Groups come back in the viewer's order: the ones holding a screen they can
 * *act* on first, in the table's order among themselves, then the ones they
 * only read. An accountant's sidebar therefore leads with Finance and a
 * desk's with the queues, from the same table. The overview is always first
 * and Support always last, whoever is looking.
 */
export function navigationFor(capabilities: readonly string[]): AdminNavGroup[] {
  const visible = adminNavigation
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
                  .map((sub) => ({ ...sub, items: sub.items.filter((item) => canOpen(item, capabilities)) }))
                  .filter((sub) => sub.items.length > 0),
              }
            : entry,
        )
        .filter((entry) => (isAdminNavSection(entry) ? entry.groups.length > 0 : canOpen(entry, capabilities))),
    }))
    .filter((group) => group.entries.length > 0);

  const rank = (group: AdminNavGroup): number => {
    if (group.pinned === "start") return 0;
    if (group.pinned === "end") return 3;
    return adminGroupItems(group).some((item) => canAct(item, capabilities)) ? 1 : 2;
  };

  // A stable sort: equal ranks keep the table's order.
  return visible
    .map((group, index) => ({ group, index, rank: rank(group) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ group }) => group);
}

/**
 * The first screen the sidebar offers this account once its groups are in
 * order. The overview is offered to everyone, so today this is the overview
 * for every role; the rule lives here so that stays one decision.
 */
export function landingFor(capabilities: readonly string[]): string {
  for (const group of navigationFor(capabilities)) {
    const [first] = adminGroupItems(group);
    if (first) return first.href;
  }
  return "/admin";
}

/** The desk's capabilities: handling and cancelling bookings. */
const DESK = ["bookings.write", "bookings.cancel"];

/**
 * Anyone who edits a hotel's content or its prices. Transfer fares are not in
 * here: the server gates every transfer catalogue write, fares included, on
 * `catalogue.write` alone, so those screens are offered on that.
 */
const CATALOGUE_EDITORS = ["catalogue.write", "pricing.write"];

/** Who the Approvals screen is for: whoever asks for money changes and whoever decides them. */
const APPROVALS = [
  "finance.refunds.request",
  "finance.adjustments.request",
  "finance.refunds.approve",
  "finance.adjustments.approve",
];

export const adminNavigation: AdminNavGroup[] = [
  {
    // The overview is everybody's: it composes itself from what the viewer
    // holds, so the one address can be the landing page for every role.
    title: "",
    pinned: "start",
    entries: [
      { label: "Overview", href: "/admin", icon: LayoutDashboard },
      // Beside the overview rather than in a group: the notices are the
      // viewer's own, not a queue of anyone's, and every staff account holds
      // the capability. Badged with the same unread count as the bell.
      {
        label: "Notifications",
        href: "/admin/notifications",
        icon: Bell,
        badgeKey: "unreadNotifications",
        capability: "notifications.read",
      },
    ],
  },
  {
    title: "Operations",
    entries: [
      // First, because every booking passes through it (owner decision OD1):
      // nothing is confirmed, no supplier is told and no invoice issues until
      // somebody here says yes. Badged with everything still waiting.
      {
        label: "Booking approvals",
        href: "/admin/bookings/approvals",
        icon: ClipboardCheck,
        badgeKey: "pendingBookingApprovals",
        capability: "bookings.approve",
        acts: "bookings.approve",
      },
      // Every product in one list, for the desk that has a name or an email
      // and no idea which register the booking is on. Rows link out to the
      // product's own detail page; nothing is worked here.
      {
        label: "All bookings",
        href: "/admin/bookings/all",
        icon: Layers,
        capability: "bookings.read",
        acts: DESK,
      },
      // Then one register per product, because a TRF reference is not a BKG
      // one and the lists share no identifier space. Each is named for what
      // it holds: "Bookings" on its own stopped being unambiguous the moment
      // the second register appeared in the sidebar.
      {
        label: "Hotel bookings",
        href: "/admin/bookings",
        icon: CalendarCheck,
        badgeKey: "pendingBookings",
        capability: "bookings.read",
        acts: DESK,
      },
      {
        label: "Transfer bookings",
        href: "/admin/transfers/bookings",
        icon: CarFront,
        capability: ["bookings.read", "dispatch.read"],
        acts: [...DESK, "dispatch.write"],
      },
      // TUR references. Badged with on-request bookings the operator has yet
      // to answer — seats are already claimed, so a request left waiting is
      // capacity nobody else can buy.
      {
        label: "Tour bookings",
        href: "/admin/tours/bookings",
        icon: Compass,
        badgeKey: "pendingTourRequests",
        capability: "bookings.read",
        acts: DESK,
      },
      // SVC references: a kosher meal, a guide, a mashgiach booked on its
      // own, and the on-request ones the supplier has yet to answer.
      {
        label: "Service bookings",
        href: "/admin/services/bookings",
        icon: ConciergeBell,
        capability: "bookings.read",
        acts: DESK,
      },
      // ORD references: a package booked as one thing, with a hotel, a
      // transfer, a tour and a service under it. Badged with the orders
      // holding a request nobody has answered — those hold real capacity.
      {
        label: "Orders",
        href: "/admin/orders",
        icon: PackageCheck,
        badgeKey: "pendingOrders",
        capability: "bookings.read",
        acts: DESK,
      },
      // Legs, not bookings, and badged with the ones nobody is driving yet.
      {
        label: "Dispatch",
        href: "/admin/transfers/dispatch",
        icon: Radio,
        badgeKey: "unassignedLegs",
        capability: "dispatch.read",
        acts: "dispatch.write",
      },
      {
        label: "Deadlines",
        href: "/admin/deadlines",
        icon: CalendarClock,
        capability: "bookings.read",
        acts: "bookings.deadlines.write",
      },
    ],
  },
  {
    // Maintenance screens, offered to whoever edits them. A read-only role —
    // management, the finance desks — still reaches every one of these by
    // link, from a booking or a search, and sees it read-only; it is just not
    // invited to a screen whose every button it cannot press.
    title: "Inventory",
    entries: [
      // First in the group, because everything under it is filed inside one:
      // a property, a tour or a pick-up point cannot be created until the place
      // it belongs to exists.
      {
        label: "Destinations",
        href: "/admin/destinations",
        icon: Globe2,
        capability: "catalogue.write",
        acts: "catalogue.write",
      },
      // The desk keeps Hotels: it looks up rooms and availability to handle a
      // booking, even though it changes nothing there.
      {
        label: "Hotels",
        href: "/admin/hotels",
        icon: BedDouble,
        capability: [...CATALOGUE_EDITORS, "bookings.write"],
        acts: CATALOGUE_EDITORS,
      },
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
              {
                label: "Routes",
                href: "/admin/transfers/routes",
                icon: Route,
                capability: "catalogue.write",
                acts: "catalogue.write",
              },
              // Where a route starts and ends — filed right after the routes
              // that reference it.
              {
                label: "Pick-up points",
                href: "/admin/transfers/points",
                icon: MapPin,
                capability: "catalogue.write",
                acts: "catalogue.write",
              },
              // The classes are what a traveller buys; the fleet is what turns
              // up. Two screens, because a class outlives any one car.
              {
                label: "Vehicle classes",
                href: "/admin/transfers/vehicles",
                icon: Bus,
                capability: "catalogue.write",
                acts: "catalogue.write",
              },
              {
                label: "Extras",
                href: "/admin/transfers/extras",
                icon: Coins,
                capability: "catalogue.write",
                acts: "catalogue.write",
              },
            ],
          },
          {
            label: "Fleet & drivers",
            items: [
              { label: "Fleet", href: "/admin/transfers/fleet", icon: Car, capability: "dispatch.write", acts: "dispatch.write" },
              {
                label: "Drivers",
                href: "/admin/transfers/drivers",
                icon: UserRound,
                capability: "dispatch.write",
                acts: "dispatch.write",
              },
              // The diary and the ratings queue are read as much as worked, so
              // they stay on the read capability.
              {
                label: "Schedule",
                href: "/admin/transfers/schedule",
                icon: CalendarRange,
                capability: "dispatch.read",
                acts: "dispatch.write",
              },
              // Ratings are about drivers, so they live beside them rather
              // than with the catalogue a traveller sees.
              { label: "Ratings", href: "/admin/transfers/ratings", icon: Star, capability: "dispatch.read", acts: "dispatch.write" },
            ],
          },
        ],
      },
      // The tour operator edits tours and nothing else in the catalogue.
      {
        label: "Tours",
        href: "/admin/tours",
        icon: Map,
        capability: ["catalogue.write", "tours.write"],
        acts: ["catalogue.write", "tours.write"],
      },
      // Packages sit after the products they are assembled from: a slot can
      // only name a hotel, a route or a tour that already exists.
      { label: "Packages", href: "/admin/packages", icon: Boxes, capability: "catalogue.write", acts: "catalogue.write" },
      { label: "Services", href: "/admin/services", icon: ConciergeBell, capability: "catalogue.write", acts: "catalogue.write" },
    ],
  },
  {
    title: "Network",
    entries: [
      // The register is read by every desk that needs to know who booked;
      // acting on a partner is approving it, setting its commission or its
      // credit.
      {
        label: "Partners",
        href: "/admin/partners",
        icon: Handshake,
        capability: "partners.read",
        acts: ["partners.write", "finance.commission.write", "partners.credit.write"],
      },
      // The buyers with no partner account: the people and companies the
      // desk books for. Read with the bookings, written by the desk.
      {
        label: "Customers",
        href: "/admin/customers",
        icon: Contact,
        capability: "bookings.read",
        acts: "bookings.write",
      },
      {
        // The review queue, badged with what is waiting. It sits beside the
        // register rather than inside it because it is the screen an operator
        // opens first, and a saved filter cannot carry a count in the sidebar.
        // Offered to whoever decides an application; everyone else reads the
        // register, where applications are a filter.
        label: "Applications",
        href: "/admin/partners/applications",
        icon: ClipboardCheck,
        badgeKey: "pendingPartners",
        capability: "partners.write",
        acts: "partners.write",
      },
    ],
  },
  {
    // Who owes whom: what we owe suppliers, what buyers owe us, the money
    // that moved, and the reports over it. Management reads it all; the
    // finance desks also record payments; the booking desks and dispatch do
    // not see it.
    title: "Finance",
    entries: [
      {
        label: "Finance overview",
        href: "/admin/finance",
        icon: Landmark,
        capability: "finance.payables.read",
        acts: "finance.payments.write",
      },
      // Badged with instalments late or due this week: the queue the
      // payment reminders are about, and the one a finance desk opens first.
      {
        label: "Payables",
        href: "/admin/finance/payables",
        icon: ArrowUpRight,
        badgeKey: "paymentsDue",
        capability: "finance.payables.read",
        acts: ["finance.payments.write", "finance.adjustments.request"],
      },
      {
        label: "Receivables",
        href: "/admin/finance/receivables",
        icon: ArrowDownLeft,
        capability: "finance.receivables.read",
        acts: ["finance.payments.write", "finance.refunds.request", "finance.adjustments.request"],
      },
      {
        label: "Payments",
        href: "/admin/finance/payments",
        icon: Banknote,
        capability: "finance.payments.read",
        acts: "finance.payments.write",
      },
      // Proformas, VAT invoices and corrections issued through the invoicing provider.
      { label: "Invoices", href: "/admin/finance/invoices", icon: FileText, capability: "invoices.read", acts: "invoices.write" },
      // Refunds and write-offs that need a second person; badged with those still waiting.
      {
        label: "Approvals",
        href: "/admin/finance/approvals",
        icon: ClipboardCheck,
        badgeKey: "pendingApprovals",
        capability: APPROVALS,
        acts: APPROVALS,
      },
      // Cancellation charges as the policy set them and as finance changed them.
      {
        label: "Penalties",
        href: "/admin/finance/penalties",
        icon: Gavel,
        capability: "finance.receivables.read",
        acts: "finance.adjustments.request",
      },
      { label: "Reports", href: "/admin/finance/reports", icon: ChartColumn, capability: "finance.reports.read" },
    ],
  },
  {
    // Who has a seat in this panel, and what has been done in it. Staff is a
    // super admin's screen; the trail is for every role whose job includes
    // checking — management and finance as well as the admins.
    title: "People",
    entries: [
      { label: "Staff", href: "/admin/users", icon: UsersRound, capability: "users.staff.manage", acts: "users.staff.manage" },
      { label: "Roles", href: "/admin/roles", icon: ShieldCheck, capability: "roles.manage", acts: "roles.manage" },
      { label: "Audit log", href: "/admin/audit", icon: ScrollText, capability: "audit.read" },
    ],
  },
  {
    title: "Settings",
    entries: [
      {
        label: "Reminders",
        href: "/admin/settings/reminders",
        icon: BellRing,
        capability: "settings.reminders.write",
        acts: "settings.reminders.write",
      },
      {
        label: "Email",
        href: "/admin/settings/email",
        icon: Mail,
        capability: ["platform.admin", "settings.write"],
        acts: "settings.write",
      },
    ],
  },
  {
    // Last, and small: the manual is reached far less often than any queue,
    // but it must be reachable by everyone, so the item names no capability.
    title: "Support",
    pinned: "end",
    entries: [{ label: "Help & tutorials", href: "/admin/help", icon: CircleHelp }],
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
    const match = adminGroupItems(group).find((item) => item.href === pathname);
    if (match) return match.label;
  }
  return null;
}
