import { Ban, CheckCircle2, CircleDashed, Clock, MinusCircle, type LucideIcon } from "lucide-react";

import { settlementStatusLabels, settlementStatusTone } from "@/lib/admin/finance";
import { cn } from "@/lib/utils";
import type { SettlementStatus } from "@/types/finance";

/**
 * A payable's or an instalment's settlement pill.
 *
 * Same shape and tones as the pills in `StatusBadge.tsx` — an icon and a word,
 * never colour alone — kept beside the finance screens because that module
 * does not export its `Pill`. The tone per status comes from
 * `settlementStatusTone`, so every finance screen colours a status alike.
 */
const toneClasses: Record<(typeof settlementStatusTone)[SettlementStatus], string> = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
};

const icons: Record<SettlementStatus, LucideIcon> = {
  OPEN: Clock,
  PARTIAL: CircleDashed,
  PAID: CheckCircle2,
  VOID: MinusCircle,
  WAIVED: Ban,
};

export function PayableStatusBadge({
  status,
  className,
}: {
  status: SettlementStatus;
  className?: string;
}) {
  const Icon = icons[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        toneClasses[settlementStatusTone[status]],
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {settlementStatusLabels[status]}
    </span>
  );
}
