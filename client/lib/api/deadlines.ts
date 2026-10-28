import { apiFetch, serverFetch } from "./client";
import { toQueryString } from "./query";
import type { Deadline, DeadlineQuery, MoveDeadlineInput, ReminderPolicy, ReminderPolicyInput } from "@/types/deadline";
import type { Paginated } from "@/types/partner";

/**
 * The deadline calendar and the reminder schedule
 * (`server/routes/admin.deadlines.routes.js`).
 *
 * Server variants for pages, `…Client` variants for the panels that refetch
 * after a move. `moveDeadline` is browser-only: it is always the answer to a
 * form, never part of a render.
 */

const admin = "/api/admin/deadlines";
const policies = "/api/admin/settings/reminder-policies";

export const listDeadlines = (query: DeadlineQuery = {}) =>
  serverFetch<Paginated<Deadline>>(`${admin}${toQueryString(query)}`);

export const listDeadlinesClient = (query: DeadlineQuery = {}) =>
  apiFetch<Paginated<Deadline>>(`${admin}${toQueryString(query)}`);

/** One deadline with its history. */
export const getDeadlineClient = (id: string) => apiFetch<Deadline>(`${admin}/${id}`);

/**
 * Moves a deadline. The server decides by kind: a PAYMENT row goes through
 * the receivable and answers 403 `APPROVAL_REQUIRED` to anyone without
 * `finance.adjustments.execute`; the other two need `bookings.deadlines.write`.
 */
export const moveDeadline = (id: string, body: MoveDeadlineInput) =>
  apiFetch<Deadline>(`${admin}/${id}`, { method: "PATCH", body });

export const listReminderPolicies = (partnerId?: string) =>
  serverFetch<{ data: ReminderPolicy[] }>(`${policies}${toQueryString({ partnerId })}`);

export const listReminderPoliciesClient = (partnerId?: string) =>
  apiFetch<{ data: ReminderPolicy[] }>(`${policies}${toQueryString({ partnerId })}`);

/** Writes one policy row; `{ removed: true }` comes back for a removed override. */
export const putReminderPolicy = (body: ReminderPolicyInput) =>
  apiFetch<ReminderPolicy | { removed: true }>(policies, { method: "PUT", body });

/** The partner's own deadlines, scoped on the session; `href` points into the portal. */
export const listPartnerDeadlines = (query: DeadlineQuery = {}) =>
  serverFetch<Paginated<Deadline>>(`/api/partner/deadlines${toQueryString(query)}`);
