import { apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { Paginated, Role } from "@/types/partner";
import type { InviteUserInput, IssuedActivation, ManagedUser, UserQuery } from "@/types/user";

/**
 * Staff accounts (`/api/admin/users`, super admins only) and a partner's own
 * team (`/api/partner/team`, owners and partner admins).
 *
 * The two share one shape and one set of verbs, so they share one set of
 * functions here, told apart by `scope`. Reads run in a Server Component
 * during the render; the mutations run from a button in the browser.
 */
export type UserScope = "staff" | "team";

const base = (scope: UserScope) => (scope === "staff" ? "/api/admin/users" : "/api/partner/team");

// --- Server-side reads ----------------------------------------------------------

export const listUsers = (scope: UserScope, query: UserQuery = {}) =>
  serverFetch<Paginated<ManagedUser>>(`${base(scope)}${toQueryString(query)}`);

export const getUser = (scope: UserScope, id: string) => serverFetch<ManagedUser>(`${base(scope)}/${id}`);

// --- Browser-side mutations -------------------------------------------------------

export const inviteUser = (scope: UserScope, body: InviteUserInput) =>
  apiFetch<IssuedActivation>(base(scope), { method: "POST", body });

export const resendUserActivation = (scope: UserScope, id: string) =>
  apiFetch<IssuedActivation>(`${base(scope)}/${id}/activation/resend`, { method: "POST" });

export const changeUserRole = (scope: UserScope, id: string, role: Role) =>
  apiFetch<ManagedUser>(`${base(scope)}/${id}/role`, { method: "PATCH", body: { role } });

export const deactivateUser = (scope: UserScope, id: string, reason?: string) =>
  apiFetch<ManagedUser>(`${base(scope)}/${id}/deactivate`, {
    method: "POST",
    body: reason ? { reason } : {},
  });

export const reactivateUser = (scope: UserScope, id: string) =>
  apiFetch<ManagedUser>(`${base(scope)}/${id}/reactivate`, { method: "POST" });

export const revokeUserSessions = (scope: UserScope, id: string) =>
  apiFetch<{ user: ManagedUser; revoked: number }>(`${base(scope)}/${id}/sessions/revoke`, {
    method: "POST",
  });

/** A real delete. `confirm` is the account's email address, typed back. */
export const deleteUser = (scope: UserScope, id: string, confirm: string) =>
  apiFetch<void>(`${base(scope)}/${id}`, { method: "DELETE", body: { confirm } });

/** Team only: moves the partner's one primary contact to this member. */
export const setPrimaryContact = (id: string) =>
  apiFetch<ManagedUser>(`/api/partner/team/${id}/primary-contact`, { method: "PATCH" });
