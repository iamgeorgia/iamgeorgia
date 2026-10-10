import type { PartnerLink, Role } from "./partner";
import type { SessionUser } from "./auth";

/**
 * Staff and team accounts as the management screens list them.
 *
 * Mirrors `toUserSummary` in `server/serializers/user.js`: the account plus
 * its lifecycle. `status` is derived on the server from two columns — no
 * password yet is INVITED, switched off is DEACTIVATED — so the client never
 * has to work it out and cannot disagree with it.
 */
export type UserStatus = "INVITED" | "ACTIVE" | "DEACTIVATED";

/** Who did something to an account: enough to name them, nothing more. */
export interface UserActorRef {
  id: string;
  email: string;
  fullName: string;
}

export interface ManagedUser extends Omit<SessionUser, "capabilities"> {
  status: UserStatus;
  invitedAt: string | null;
  invitedBy: UserActorRef | null;
  deactivatedAt: string | null;
  deactivatedBy: UserActorRef | null;
}

/** What an invitation or a resend answers: the account, and the link to pass on. */
export interface IssuedActivation {
  user: ManagedUser;
  link: PartnerLink;
  email: string;
  emailSent: boolean;
}

export interface UserQuery {
  role?: Role | Role[];
  status?: UserStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface InviteUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  position?: string;
  phone?: string;
}

/** Platform roles a super admin may invite. SUPER_ADMIN itself is a role change, never an invitation. */
export const STAFF_INVITE_ROLES = ["ADMIN", "MANAGEMENT", "TOUR_OPERATOR", "ACCOUNTANT", "DISPATCHER"] as const;

/** Platform roles a staff account may be moved between. */
export const STAFF_ROLES = ["SUPER_ADMIN", ...STAFF_INVITE_ROLES] as const;

/** Partner roles an owner or partner admin may invite. A second owner is a role change. */
export const TEAM_INVITE_ROLES = ["PARTNER_ADMIN", "PARTNER_AGENT", "PARTNER_FINANCE"] as const;

export const TEAM_ROLES = ["PARTNER_OWNER", ...TEAM_INVITE_ROLES] as const;
