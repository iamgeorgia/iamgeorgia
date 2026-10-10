import type { PartnerQuery } from "@/lib/api/partners";
import type { PartnerKind, PartnerStatus } from "@/types/partner";

/**
 * Display vocabulary for partner records.
 *
 * The server speaks in enum members (`PENDING_APPROVAL`, `TOUR_OPERATOR`)
 * because those are stable identifiers; the panel speaks in words. Keeping the
 * mapping in one module means a new status is a compile error here rather than
 * a raw `SCREAMING_SNAKE` string appearing in a table cell.
 */

export const partnerStatusLabels: Record<PartnerStatus, string> = {
  INVITED: "Invited",
  REGISTRATION_IN_PROGRESS: "Registering",
  PENDING_APPROVAL: "Awaiting review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  BLOCKED: "Blocked",
  TERMINATED: "Terminated",
};

/** What each status means for the partner, for a tooltip or an empty state. */
export const partnerStatusHints: Record<PartnerStatus, string> = {
  INVITED: "A registration link has been sent but not opened.",
  REGISTRATION_IN_PROGRESS: "The invitee has opened the link and is filling in their details.",
  PENDING_APPROVAL: "The application is complete and waiting for a decision.",
  APPROVED: "Full access to the B2B platform.",
  REJECTED: "Declined. No platform access.",
  SUSPENDED: "Access withdrawn. Sessions ended immediately.",
  BLOCKED: "Sign-in and booking are refused. Nothing is deleted, and an admin can unblock the company.",
  TERMINATED: "The relationship has ended. Records are kept for the books; this cannot be undone.",
};

export const partnerKindLabels: Record<PartnerKind, string> = {
  HOTEL: "Hotel",
  TOUR_OPERATOR: "Tour operator",
  TRANSPORT: "Transport",
  EXPERIENCE: "Experience",
};

/** The two states an admin is being asked to act on. */
export const APPLICATION_STATUSES: PartnerStatus[] = [
  "PENDING_APPROVAL",
  "REGISTRATION_IN_PROGRESS",
];

export const PARTNER_STATUSES = Object.keys(partnerStatusLabels) as PartnerStatus[];
export const PARTNER_KINDS = Object.keys(partnerKindLabels) as PartnerKind[];

/** Basis points to the percentage a human reads: 1000 → "10%". */
export function formatCommission(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/**
 * "12 Aug 2026" from either a plain date or a full timestamp.
 *
 * The catalogue fixtures store `2026-08-12`, the API returns
 * `2026-08-12T09:41:33.221Z`; one formatter has to read both or the panel ends
 * up with two date styles side by side.
 */
export function formatPartnerDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function formatPartnerDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

/** Plain-language description of what an audit row records. */
export const auditActionLabels: Record<string, string> = {
  PARTNER_INVITED: "Invitation sent",
  PARTNER_CREATED: "Partner created",
  PARTNER_UPDATED: "Details edited",
  PARTNER_REGISTRATION_SUBMITTED: "Application submitted",
  PARTNER_APPROVED: "Approved",
  PARTNER_REJECTED: "Rejected",
  PARTNER_SUSPENDED: "Suspended",
  PARTNER_REACTIVATED: "Reinstated",
  PARTNER_BLOCKED: "Blocked",
  PARTNER_UNBLOCKED: "Unblocked",
  PARTNER_TERMINATED: "Terminated",
  PARTNER_CONTRACT_UPLOADED: "Contract filed",
  PARTNER_CONTRACT_VIEWED: "Contract opened",
  PARTNER_CONTRACT_REQUIREMENT_CHANGED: "Contract requirement changed",
  PARTNER_PRODUCT_ACCESS_CHANGED: "Product access changed",
  PARTNER_TERMS_ACCEPTED: "Platform terms accepted",
  PARTNER_CREDIT_LIMIT_CHANGED: "Credit limit changed",
  PARTNER_CREDIT_WARNING: "Credit limit warning",
  PENALTY_OVERRIDDEN: "Cancellation charge overridden",
  PARTNER_FINANCIAL_VIEWED: "Bank details viewed",
  PARTNER_FINANCIAL_UPDATED: "Bank details updated",
  INVITATION_RESENT: "Invitation resent",
  INVITATION_REVOKED: "Invitation withdrawn",
  USER_ACTIVATED: "Account activated",
  USER_LOGIN_FAILED: "Failed sign-in",
};

export const invitationStatusLabels: Record<string, string> = {
  PENDING: "Live",
  ACCEPTED: "Used",
  REVOKED: "Withdrawn",
  EXPIRED: "Expired",
};

/**
 * Reads filter state out of a URL search-params object.
 *
 * Anything unrecognised is dropped rather than forwarded. The server validates
 * these too and would answer 400, but a stale bookmark or a hand-edited URL
 * should show an unfiltered list rather than an error page.
 */
export function partnerQueryFromParams(
  params: Record<string, string | string[] | undefined>,
  options: { statuses?: PartnerStatus[]; lockedStatuses?: PartnerStatus[] } = {},
): PartnerQuery {
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const allowedStatuses = options.statuses ?? PARTNER_STATUSES;
  const status = single(params.status);
  const kind = single(params.kind);
  const page = Number(single(params.page));

  const chosen = allowedStatuses.includes(status as PartnerStatus)
    ? (status as PartnerStatus)
    : undefined;

  return {
    q: single(params.q)?.trim() || undefined,
    // A screen scoped to a set of statuses falls back to that whole set rather
    // than to "everything" when no single status is chosen.
    status: chosen ?? options.lockedStatuses,
    kind: PARTNER_KINDS.includes(kind as PartnerKind) ? (kind as PartnerKind) : undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: 20,
  };
}
