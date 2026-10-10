import type { Role } from "@/types/partner";
import { STAFF_ROLES, type UserQuery, type UserStatus } from "@/types/user";

/**
 * Display vocabulary for the Staff screens.
 *
 * The server speaks in role and status enum members; the panel speaks in
 * words. One module, so a role added on the server is a compile error here
 * rather than `SCREAMING_SNAKE` in a table cell.
 */

export type StaffRole = (typeof STAFF_ROLES)[number];

export const staffRoleLabels: Record<StaffRole, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Administrator",
  MANAGEMENT: "Management",
  TOUR_OPERATOR: "Tour operator",
  ACCOUNTANT: "Accountant",
  DISPATCHER: "Dispatcher",
};

/** One line per role, for the invite form and the role picker. */
export const staffRoleDescriptions: Record<StaffRole, string> = {
  SUPER_ADMIN: "Everything, including the staff accounts and the audit log.",
  ADMIN: "Runs everything except the staff accounts and the books: reads every figure, records no payments.",
  MANAGEMENT: "Reads everything, margins included, and changes nothing.",
  TOUR_OPERATOR: "Works the bookings — confirm, decline, cancel — without seeing margins.",
  ACCOUNTANT: "Keeps the books: payments, refunds, write-offs and terms; reads bookings, partners, bank details and margins.",
  DISPATCHER: "Fleet, drivers and dispatch only.",
};

/** A role the list may name that is not a staff role still gets a word. */
export const roleLabel = (role: Role): string =>
  role in staffRoleLabels ? staffRoleLabels[role as StaffRole] : role;

export const userStatusLabels: Record<UserStatus, string> = {
  INVITED: "Invited",
  ACTIVE: "Active",
  DEACTIVATED: "Deactivated",
};

export const userStatusHints: Record<UserStatus, string> = {
  INVITED: "Invited, but no password has been set yet. The account cannot sign in until it is.",
  ACTIVE: "Can sign in to the panel with the permissions of their role.",
  DEACTIVATED: "Switched off. Cannot sign in, and every session has ended.",
};

export const USER_STATUSES = Object.keys(userStatusLabels) as UserStatus[];

/**
 * Reads the Staff list's filter state out of the URL.
 *
 * Anything unrecognised is dropped rather than forwarded, so a stale bookmark
 * shows an unfiltered list instead of a 400.
 */
export function staffQueryFromParams(
  params: Record<string, string | string[] | undefined>,
): UserQuery {
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const role = single(params.role);
  const status = single(params.status);
  const page = Number(single(params.page));

  return {
    q: single(params.q)?.trim() || undefined,
    role: (STAFF_ROLES as readonly string[]).includes(role ?? "") ? (role as Role) : undefined,
    status: USER_STATUSES.includes(status as UserStatus) ? (status as UserStatus) : undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: 20,
  };
}
