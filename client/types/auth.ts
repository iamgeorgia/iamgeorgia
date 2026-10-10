import type { DriverSelf } from "./driver";
import type { Partner, Role } from "./partner";

/** The signed-in account. Mirrors `server/serializers/user.js`. */
export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  fullName: string;
  position: string | null;
  phone: string | null;
  isPrimaryContact: boolean;
  isActive: boolean;
  partnerId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  /** Every role the account holds; the first is its primary role, which `role` names. */
  roles: { key: string; name: string; isSystem: boolean }[];
  /**
   * What this account may do, as the server's capability names
   * (`catalogue.write`, `bookings.cancel`, `partner.team.manage`, …): its
   * roles' capabilities plus or minus any granted or denied to it by name.
   * The client reads this rather than keeping its own copy of the role
   * table, so a capability granted or withdrawn on the server reaches the
   * menus on the next request. Sorted. See `server/lib/permissions.js`.
   */
  capabilities: string[];
}

/**
 * What `GET /api/auth/me` returns, and the single source of truth for who the
 * viewer is. `partner` is null for admins and present for everyone attached to
 * a company, in *any* status — the portal decides what to render from
 * `partner.status`, and the server enforces the same rule independently.
 */
export interface Session {
  user: SessionUser;
  partner: Partner | null;
  /**
   * The driver profile behind a DRIVER account. Null for every other role, and
   * null for a driver whose account has not been linked to a profile yet.
   */
  driver: DriverSelf | null;
}

export const ADMIN_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN"];

/**
 * Whether an account holds any of the given capabilities.
 *
 * Takes a session, a bare user, or nothing — nobody holds anything — so a
 * component can ask without checking first. "Any of", like the server's
 * `requireCapability`. The server enforces every one of these on its own;
 * this only keeps the screens from offering what would answer 403.
 */
export const can = (
  viewer: Session | SessionUser | null | undefined,
  ...anyOf: string[]
): boolean => {
  if (!viewer) return false;
  const held = "user" in viewer ? viewer.user.capabilities : viewer.capabilities;
  return Array.isArray(held) && anyOf.some((capability) => held.includes(capability));
};

export const isAdmin = (session: Session | null): boolean =>
  Boolean(session) && ADMIN_ROLES.includes(session!.user.role);

/**
 * Whether an account sits in the admin panel: every platform role except a
 * driver. Read off the catalogue capability, which every staff role holds.
 */
export const isStaff = (viewer: Session | SessionUser | null | undefined): boolean =>
  can(viewer, "catalogue.read");

export const isDriver = (session: Session | null): boolean =>
  session?.user.role === "DRIVER";

/** Where a signed-in account belongs, for redirects between the panels. */
export const homePathFor = (session: Session): string => {
  if (isStaff(session)) return "/admin";
  if (session.user.role === "DRIVER") return "/driver";
  if (session.partner) return "/portal";
  return "/";
};
