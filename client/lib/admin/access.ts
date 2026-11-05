/**
 * Which capability opens which panel screen.
 *
 * One table for the whole panel, read by three things that must agree:
 * `requireScreen()` (every page's entry check), the help registry (an
 * article is readable when the screen it explains is), and the role editor's
 * preview of what a role sees. Patterns use the page tree's own bracket
 * form — `/admin/hotels/[slug]/rooms` — so the table reads like the folder
 * listing under `app/[locale]/(admin)/admin/(panel)/`.
 *
 * The capability named is the one that *opens* the screen: the read side.
 * That is deliberately the same capability the server asks for on the
 * screen's reads, so a screen this table opens never answers a page of 403s,
 * and a screen it denies is one the server would have refused anyway. What
 * the viewer may *do* once inside is decided on the screen, control by
 * control, with `can()`. The sidebar is narrower still — it offers a screen
 * on the capability that makes it useful (`lib/admin/navigation.ts`) — so a
 * read-only role reaches a maintenance screen by link, in read-only mode,
 * but is not invited to it.
 *
 * A path this table does not know is denied. That is the point: a screen
 * added tomorrow is closed until somebody says who may open it, and
 * `test/access-screens.test.ts` fails the build until they do.
 *
 * Kept free of React, of `@/` aliases and of component imports so the tests
 * can load it under plain Node.
 */

export type ScreenCapability = string | string[];

export interface ScreenRule {
  /** Bracket-form pattern, locale stripped: `/admin/tours/[slug]/departures`. */
  pattern: string;
  /**
   * Any one of these opens the screen. Absent means every staff account:
   * the overview, the manual, the bell, and the denied page itself.
   */
  capability?: ScreenCapability;
}

// --- Capability shorthands ---------------------------------------------------

const CATALOGUE = "catalogue.read";
const BOOKINGS = "bookings.read";
const DISPATCH = "dispatch.read";
const PARTNERS = "partners.read";

/** The capabilities that let a staff account *change* the catalogue, by product. */
export const CATALOGUE_WRITE = ["catalogue.write"];
export const TOURS_WRITE = ["catalogue.write", "tours.write"];
export const PRICING_WRITE = ["pricing.write"];

/** Who the approvals screen is for: anyone who asks or anyone who decides. */
export const APPROVAL_SCREEN = [
  "finance.refunds.request",
  "finance.adjustments.request",
  "finance.refunds.approve",
  "finance.adjustments.approve",
];

const rule = (pattern: string, capability?: ScreenCapability): ScreenRule => ({ pattern, capability });

/** A list screen, its "new" form, and a detail page with the given sub-screens. */
const vertical = (
  base: string,
  param: string,
  { open, create, subs = [] }: { open: ScreenCapability; create: ScreenCapability; subs?: string[] },
): ScreenRule[] => [
  rule(base, open),
  rule(`${base}/new`, create),
  rule(`${base}/[${param}]`, open),
  ...subs.map((sub) => rule(`${base}/[${param}]/${sub}`, open)),
];

export const SCREENS: ScreenRule[] = [
  // --- Always open to staff --------------------------------------------------
  rule("/admin"),
  rule("/admin/denied"),
  rule("/admin/notifications", "notifications.read"),
  rule("/admin/help"),
  rule("/admin/help/[category]"),
  rule("/admin/help/[category]/[article]"),

  // --- Bookings and orders ---------------------------------------------------
  rule("/admin/bookings", BOOKINGS),
  // More literal than `/admin/bookings/[id]`, so `screenFor` picks them first.
  rule("/admin/bookings/approvals", "bookings.approve"),
  // Every product in one list, from the booking index.
  rule("/admin/bookings/all", BOOKINGS),
  // The desk: a booking made by phone, by email, through another agency.
  rule("/admin/bookings/new", "bookings.write"),
  rule("/admin/bookings/[id]", BOOKINGS),
  rule("/admin/tours/bookings", BOOKINGS),
  rule("/admin/tours/bookings/[reference]", BOOKINGS),
  rule("/admin/transfers/bookings", [BOOKINGS, DISPATCH]),
  rule("/admin/transfers/bookings/[reference]", [BOOKINGS, DISPATCH]),
  rule("/admin/services/bookings", BOOKINGS),
  rule("/admin/services/bookings/[reference]", BOOKINGS),
  rule("/admin/orders", BOOKINGS),
  rule("/admin/orders/[reference]", BOOKINGS),
  // The people and companies the desk books for. Read with the bookings;
  // written (a modal on each screen) with `bookings.write`.
  rule("/admin/customers", BOOKINGS),
  rule("/admin/customers/[id]", BOOKINGS),
  rule("/admin/deadlines", BOOKINGS),

  // --- Dispatch, fleet, drivers -----------------------------------------------
  rule("/admin/transfers/dispatch", DISPATCH),
  rule("/admin/transfers/schedule", DISPATCH),
  rule("/admin/transfers/ratings", DISPATCH),
  ...vertical("/admin/transfers/fleet", "id", { open: DISPATCH, create: "dispatch.write" }),
  ...vertical("/admin/transfers/drivers", "id", { open: DISPATCH, create: "dispatch.write" }),

  // --- Catalogue -------------------------------------------------------------
  ...vertical("/admin/destinations", "id", { open: CATALOGUE, create: CATALOGUE_WRITE }),
  ...vertical("/admin/hotels", "slug", {
    open: CATALOGUE,
    create: CATALOGUE_WRITE,
    subs: ["rooms", "calendar", "images", "details", "location", "kosher"],
  }),
  ...vertical("/admin/tours", "slug", {
    open: CATALOGUE,
    create: TOURS_WRITE,
    subs: ["departures", "details", "images", "options", "translations"],
  }),
  ...vertical("/admin/packages", "slug", {
    open: CATALOGUE,
    create: CATALOGUE_WRITE,
    subs: ["components", "details", "images", "kosher", "preview", "translations"],
  }),
  rule("/admin/services", CATALOGUE),
  rule("/admin/services/[id]", CATALOGUE),
  // `/admin/transfers` only redirects to the routes register.
  rule("/admin/transfers", CATALOGUE),
  ...vertical("/admin/transfers/routes", "id", { open: CATALOGUE, create: CATALOGUE_WRITE }),
  ...vertical("/admin/transfers/points", "id", { open: CATALOGUE, create: CATALOGUE_WRITE }),
  ...vertical("/admin/transfers/vehicles", "id", { open: CATALOGUE, create: CATALOGUE_WRITE }),
  rule("/admin/transfers/extras", CATALOGUE),

  // --- Partners --------------------------------------------------------------
  rule("/admin/partners", PARTNERS),
  rule("/admin/partners/applications", PARTNERS),
  rule("/admin/partners/new", "partners.write"),
  rule("/admin/partners/[id]", PARTNERS),

  // --- Finance ---------------------------------------------------------------
  rule("/admin/finance", "finance.payables.read"),
  rule("/admin/finance/payables", "finance.payables.read"),
  rule("/admin/finance/payables/[id]", "finance.payables.read"),
  rule("/admin/finance/receivables", "finance.receivables.read"),
  rule("/admin/finance/receivables/[id]", "finance.receivables.read"),
  rule("/admin/finance/penalties", "finance.receivables.read"),
  rule("/admin/finance/payments", "finance.payments.read"),
  rule("/admin/finance/payments/[id]", "finance.payments.read"),
  rule("/admin/finance/invoices", "invoices.read"),
  rule("/admin/finance/invoices/sync-events", "invoices.read"),
  rule("/admin/finance/invoices/[id]", "invoices.read"),
  rule("/admin/finance/approvals", APPROVAL_SCREEN),
  rule("/admin/finance/approvals/[id]", APPROVAL_SCREEN),
  rule("/admin/finance/reports", "finance.reports.read"),
  rule("/admin/finance/terms/[kind]/[id]", ["finance.payables.read", "catalogue.write"]),

  // --- People ----------------------------------------------------------------
  rule("/admin/users", "users.staff.manage"),
  rule("/admin/users/[id]", "users.staff.manage"),
  rule("/admin/roles", "roles.manage"),
  rule("/admin/roles/new", "roles.manage"),
  rule("/admin/roles/[key]", "roles.manage"),
  rule("/admin/audit", "audit.read"),

  rule("/admin/settings/reminders", "settings.reminders.write"),
  // Any administrator sees whether mail is flowing; connecting the account takes settings.write.
  rule("/admin/settings/email", ["platform.admin", "settings.write"]),
];

// --- Matching ----------------------------------------------------------------

const segmentsOf = (path: string): string[] => path.split("/").filter(Boolean);

const isParam = (segment: string): boolean => segment.startsWith("[") && segment.endsWith("]");

/** The number of literal segments: how specific a pattern is. */
const literalCount = (pattern: string): number =>
  segmentsOf(pattern).filter((segment) => !isParam(segment)).length;

/**
 * `/admin/hotels/[slug]/rooms` matches `/admin/hotels/ckx…/rooms`: a bracketed
 * segment stands for exactly one non-empty segment and the two sides must be
 * the same length, so a pattern never claims a longer path.
 */
export function matchScreen(pattern: string, canonical: string): boolean {
  const expected = segmentsOf(pattern);
  const actual = segmentsOf(canonical);
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => isParam(segment) || segment === actual[index]);
}

/**
 * The rule for a canonical (locale-stripped) path, or null when no rule
 * claims it. When two fit, the more literal one wins — `/admin/tours/bookings`
 * over `/admin/tours/[slug]`.
 */
export function screenFor(canonical: string): ScreenRule | null {
  const clean = canonical.replace(/\/+$/, "") || "/";
  let best: { rule: ScreenRule; score: number } | null = null;

  for (const candidate of SCREENS) {
    if (!matchScreen(candidate.pattern, clean)) continue;
    const score = literalCount(candidate.pattern);
    if (best === null || score > best.score) best = { rule: candidate, score };
  }

  return best?.rule ?? null;
}

/** Whether a set of held capabilities satisfies a rule's requirement. */
export function satisfies(capabilities: readonly string[], capability?: ScreenCapability): boolean {
  if (!capability) return true;
  const needed = Array.isArray(capability) ? capability : [capability];
  return needed.some((name) => capabilities.includes(name));
}

/** The capabilities a rule asks for, as a list — empty for an open screen. */
export const requiredFor = (rule: ScreenRule | null): string[] =>
  !rule?.capability ? [] : Array.isArray(rule.capability) ? rule.capability : [rule.capability];

/**
 * Whether these capabilities open this path. An unknown path is closed: a
 * screen nobody has filed in the table is a screen nobody may open.
 */
export function canOpenPath(capabilities: readonly string[], canonical: string): boolean {
  const found = screenFor(canonical);
  return found !== null && satisfies(capabilities, found.capability);
}

/**
 * Whether these capabilities open a bracket-form pattern — what the help
 * registry asks, since an article names patterns rather than paths.
 */
export function canOpenPattern(capabilities: readonly string[], pattern: string): boolean {
  const found = SCREENS.find((candidate) => candidate.pattern === pattern) ?? screenFor(pattern);
  return found !== null && satisfies(capabilities, found.capability);
}
