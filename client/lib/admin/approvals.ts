import type { ApprovalKind, ApprovalStatus } from "@/types/approval";

export const approvalKindLabels: Record<ApprovalKind, string> = {
  REFUND: "Refund",
  PAYABLE_OVERRIDE: "Supplier amount override",
  PAYABLE_WAIVE: "Supplier write-off",
  RECEIVABLE_DUE_DATE: "Due date change",
  RECEIVABLE_WAIVE: "Write-off",
};

export const approvalKinds = Object.keys(approvalKindLabels) as ApprovalKind[];

export const approvalStatusLabels: Record<ApprovalStatus, string> = {
  PENDING: "Waiting",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Withdrawn",
};

export const approvalStatuses = Object.keys(approvalStatusLabels) as ApprovalStatus[];

export const approvalStatusTone: Record<ApprovalStatus, "attention" | "positive" | "critical" | "neutral"> = {
  PENDING: "attention",
  APPROVED: "positive",
  REJECTED: "critical",
  CANCELLED: "neutral",
};

/** Refunds and the adjustments each have their own pair of capabilities. */
export const approveCapability = (kind: ApprovalKind) =>
  kind === "REFUND" ? "finance.refunds.approve" : "finance.adjustments.approve";

export const requestCapability = (kind: ApprovalKind) =>
  kind === "REFUND" ? "finance.refunds.request" : "finance.adjustments.request";

export const executeCapability = (kind: ApprovalKind) =>
  kind === "REFUND" ? "finance.refunds.execute" : "finance.adjustments.execute";

/** Whoever may see the approvals screen: asks for, or decides, either family. */
export const APPROVAL_SCREEN_CAPABILITIES = [
  "finance.refunds.request",
  "finance.adjustments.request",
  "finance.refunds.approve",
  "finance.adjustments.approve",
];

/** The address a request lives at, before the locale prefix. */
export const approvalHref = (id: string) => `/admin/finance/approvals/${id}`;
