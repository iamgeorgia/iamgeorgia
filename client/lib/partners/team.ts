import type { Role } from "@/types/partner";
import { TEAM_INVITE_ROLES, TEAM_ROLES, type UserStatus } from "@/types/user";

/**
 * Wording and rules for a partner's own team screen.
 *
 * The ceilings mirror `withinCeiling` in `server/services/user.service.js`:
 * an owner (the top rank) manages everyone including other owners, a partner
 * admin manages only the ranks below it. That mirroring keeps the screen from
 * offering what would answer 403; the server enforces it regardless.
 */

export type TeamRole = (typeof TEAM_ROLES)[number];

/** The most members a company may have, invited and deactivated included. */
export const TEAM_MAX = 25;

export const teamRoleLabels: Record<TeamRole, string> = {
  PARTNER_OWNER: "Owner",
  PARTNER_ADMIN: "Admin",
  PARTNER_AGENT: "Agent",
  PARTNER_FINANCE: "Finance",
};

export const teamRoleDescriptions: Record<TeamRole, string> = {
  PARTNER_OWNER: "Everything, including the team and bank details.",
  PARTNER_ADMIN: "Bookings, company profile, hotel rates and the team (except owners and admins).",
  PARTNER_AGENT: "Makes and manages bookings.",
  PARTNER_FINANCE:
    "Reads bookings and handles bank details, statements and invoices, but does not book.",
};

export const teamStatusLabels: Record<UserStatus, string> = {
  INVITED: "Invited",
  ACTIVE: "Active",
  DEACTIVATED: "Deactivated",
};

export const isTeamRole = (role: Role): role is TeamRole =>
  (TEAM_ROLES as readonly string[]).includes(role);

export const teamRoleLabel = (role: Role): string => (isTeamRole(role) ? teamRoleLabels[role] : role);

const RANK: Record<TeamRole, number> = {
  PARTNER_OWNER: 3,
  PARTNER_ADMIN: 2,
  PARTNER_AGENT: 1,
  PARTNER_FINANCE: 1,
};

const TOP = 3;

/** Whether an account holding `actor` may manage an account holding (or be given) `role`. */
export const withinTeamCeiling = (actor: Role, role: Role): boolean => {
  const own = isTeamRole(actor) ? RANK[actor] : 0;
  const theirs = isTeamRole(role) ? RANK[role] : Infinity;
  return own === TOP ? theirs <= own : theirs < own;
};

/** Roles the viewer may invite someone into. A second owner is a role change, never an invitation. */
export const invitableRoles = (actor: Role): TeamRole[] =>
  TEAM_INVITE_ROLES.filter((role) => withinTeamCeiling(actor, role));

/** Roles the viewer may move a member into. */
export const assignableRoles = (actor: Role): TeamRole[] =>
  TEAM_ROLES.filter((role) => withinTeamCeiling(actor, role));
