import type { Role } from "@/types/partner";
import { TEAM_ROLES, type UserStatus } from "@/types/user";

/**
 * Wording and rules for a partner's own team screen.
 *
 * Which roles the viewer may hand out is not decided here: the page asks the
 * server (`GET /api/partner/team/grantable`) and offers exactly that list, so
 * the screen cannot drift from the rule the server enforces.
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
