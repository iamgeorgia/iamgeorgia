import { AlertTriangle, CheckCircle2, Clock, FileText, MinusCircle, Send, type LucideIcon } from "lucide-react";

import { invoiceStatusLabels, invoiceStatusTone } from "@/lib/admin/finance";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/types/invoice";

/** A document's status pill: an icon and a word, never colour alone. Tones come from `invoiceStatusTone`. */
const tones = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
} as const;

const icons: Record<InvoiceStatus, LucideIcon> = {
  DRAFT: Clock,
  ISSUED: FileText,
  SENT: Send,
  PAID: CheckCircle2,
  PARTIAL: Clock,
  CANCELLED: MinusCircle,
  ERROR: AlertTriangle,
};

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const Icon = icons[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        tones[invoiceStatusTone[status]],
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {invoiceStatusLabels[status]}
    </span>
  );
}
