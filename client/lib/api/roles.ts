import { apiFetch, serverFetch } from "./client";
import type { CapabilityCatalogue, Role, RoleInput, RoleSide } from "@/types/rbac";

/**
 * Roles (`/api/admin/roles`, capability `roles.manage`).
 *
 * Reads run in a Server Component during the render; the mutations run from a
 * button in the browser.
 */

// --- Server-side reads ----------------------------------------------------------

export const listRoles = (side?: RoleSide) =>
  serverFetch<{ data: Role[] }>(`/api/admin/roles${side ? `?side=${side}` : ""}`).then((result) => result.data);

export const getRole = (key: string) => serverFetch<Role>(`/api/admin/roles/${encodeURIComponent(key)}`);

export const listCapabilities = () => serverFetch<CapabilityCatalogue>("/api/admin/roles/capabilities");

// --- Browser-side mutations -------------------------------------------------------

export const createRole = (body: RoleInput) => apiFetch<Role>("/api/admin/roles", { method: "POST", body });

export const updateRole = (
  key: string,
  body: { name?: string; description?: string; capabilities?: string[] },
) => apiFetch<Role>(`/api/admin/roles/${encodeURIComponent(key)}`, { method: "PATCH", body });

export const deleteRole = (key: string) =>
  apiFetch<void>(`/api/admin/roles/${encodeURIComponent(key)}`, { method: "DELETE" });
