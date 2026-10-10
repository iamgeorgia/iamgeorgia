import type { ManagedUser } from "./user";

/**
 * Roles and capabilities as `server/routes/admin.roles.routes.js` returns them.
 *
 * A role is data: a key, a name and a list of capability names. `key` is a
 * plain string because a custom role's key is whatever the owner typed
 * (lower-case); only the built-in ones are members of the `Role` union.
 */
export type RoleSide = "PLATFORM" | "PARTNER";

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  side: RoleSide;
  isSystem: boolean;
  sortOrder: number;
  capabilities: string[];
  /** Accounts holding the role. Null where the server did not count. */
  members: number | null;
  createdAt: string;
  updatedAt: string;
}

/** One area of the capability catalogue, as `GET /api/admin/roles/capabilities` groups it. */
export interface CapabilityGroup {
  area: string;
  capabilities: string[];
}

export interface CapabilityCatalogue {
  data: CapabilityGroup[];
  /** Capabilities that can never be handed out through a custom role or an override. */
  protected: string[];
}

export type OverrideEffect = "GRANT" | "DENY";

/** A capability granted to or withheld from one account by name, outside its roles. */
export interface Override {
  capability: string;
  effect: OverrideEffect;
  reason: string;
  expiresAt: string | null;
  grantedByUserId: string | null;
  createdAt: string;
}

export interface UserDetail extends ManagedUser {
  overrides: Override[];
  /** Effective capabilities: roles plus grants minus denials. */
  capabilities: string[];
}

/** What the caller may assign to an account, from `GET …/grantable`. */
export interface Grantable {
  roles: Role[];
  /** Platform scope only: the capabilities the caller may grant by name. */
  capabilities?: string[];
}

export interface RoleInput {
  key: string;
  name: string;
  description?: string;
  side: RoleSide;
  capabilities: string[];
}

export interface OverrideInput {
  capability: string;
  effect: OverrideEffect;
  reason: string;
  expiresAt?: string;
}
