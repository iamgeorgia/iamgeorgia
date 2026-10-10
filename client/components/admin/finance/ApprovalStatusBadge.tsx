import { Ban, CheckCircle2, Clock, XCircle, type LucideIcon } from "lucide-react";

import { approvalStatusLabels, approvalStatusTone } from "@/lib/admin/approvals";
import { cn } from "@/lib/utils";
import type { ApprovalStatus } from "@/types/approval";

const toneClasses = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
} as const;

const icons: Record<ApprovalStatus, LucideIcon> = {
  PENDING: Clock,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
  CANCELLED: Ban,
};

/** An approval request's status pill — an icon and a word, never colour alone. */
export function ApprovalStatusBadge({ status, className }: { status: ApprovalStatus; className?: string }) {
  const Icon = icons[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        toneClasses[approvalStatusTone[status]],
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {approvalStatusLabels[status]}
    </span>
  );
}
