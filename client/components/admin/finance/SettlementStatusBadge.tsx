import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, MinusCircle, type LucideIcon } from "lucide-react";

import { settlementStatusLabels, settlementStatusTone } from "@/lib/admin/finance";
import { cn } from "@/lib/utils";
import type { SettlementStatus } from "@/types/finance";

/**
 * A receivable's or a payable's settlement pill.
 *
 * Same shape and tones as the pills in `StatusBadge.tsx` — an icon and a word,
 * never colour alone. The tone comes from `settlementStatusTone`, so every
 * finance screen colours a status the same way. `overdue` turns an open item
 * red and says so in words, since "Open" alone hides the one fact that matters.
 */
const tones = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
} as const;

const icons: Record<SettlementStatus, LucideIcon> = {
  OPEN: Circle,
  PARTIAL: Clock,
  PAID: CheckCircle2,
  VOID: MinusCircle,
  WAIVED: Ban,
};

export function SettlementStatusBadge({
  status,
  overdue,
  className,
}: {
  status: SettlementStatus;
  overdue?: boolean;
  className?: string;
}) {
  const late = overdue && (status === "OPEN" || status === "PARTIAL");
  const Icon = late ? AlertTriangle : icons[status];
  const tone = late ? tones.critical : tones[settlementStatusTone[status]];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {settlementStatusLabels[status]}
      {late && " · overdue"}
    </span>
  );
}
