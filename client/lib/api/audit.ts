import { serverFetch } from "./client";
import { toQueryString } from "./query";
import type { AuditEntry, Paginated } from "@/types/partner";

/**
 * The whole audit trail (`GET /api/admin/audit`), for the roles holding
 * `audit.read`. Read-only by construction: the trail is only ever appended to.
 */
export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  q?: string;
  /** ISO instants. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** An entry read across the whole trail also says what it was about. */
export interface GlobalAuditEntry extends AuditEntry {
  entityType: string;
  entityId: string;
}

export const listAudit = (query: AuditQuery = {}) =>
  serverFetch<Paginated<GlobalAuditEntry>>(`/api/admin/audit${toQueryString(query)}`);
