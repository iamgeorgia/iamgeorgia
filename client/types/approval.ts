/**
 * Second-person approvals. Mirrors `server/routes/admin.approvals.routes.js`.
 * A change that moves money or writes a debt off is asked for by one person
 * and decided by another; nothing happens until it is approved.
 */

export type ApprovalKind =
  | "REFUND"
  | "PAYABLE_OVERRIDE"
  | "PAYABLE_WAIVE"
  | "RECEIVABLE_DUE_DATE"
  | "RECEIVABLE_WAIVE";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface ApprovalPerson {
  id: string;
  email: string;
  fullName: string;
}

export interface Approval {
  id: string;
  /** "APR-000012". */
  reference: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  subjectType: string | null;
  subjectId: string | null;
  /** The body of the change as it will be applied; its shape depends on `kind`. */
  payload: Record<string, unknown>;
  amountCents: number | null;
  currency: string | null;
  summary: string;
  requestedBy: ApprovalPerson | null;
  requestNote: string | null;
  decidedBy: ApprovalPerson | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedEntityType: string | null;
  executedEntityId: string | null;
  /** Why the last attempt to apply an approved request failed; the request stays pending. */
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestApprovalInput {
  kind: ApprovalKind;
  subjectId?: string;
  payload: Record<string, unknown>;
  note?: string;
}
