import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { PspPaymentStatus, PspRefundStatus, StaffPayment } from "@/types/payments";

/**
 * Pills and small formatters shared by the card payments list and detail.
 * Every state is an icon and a word, never colour alone.
 */

type Tone = "neutral" | "positive" | "attention" | "critical" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
};

export const cardPaymentStatusLabels: Record<PspPaymentStatus, string> = {
  CREATED: "Created",
  REDIRECT_READY: "Awaiting guest",
  PROCESSING: "Processing",
  APPROVED: "Approved",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  MISMATCH: "Mismatch",
  REVERSED: "Reversed",
};

const statusTone: Record<PspPaymentStatus, { tone: Tone; icon: LucideIcon }> = {
  CREATED: { tone: "info", icon: CircleDashed },
  REDIRECT_READY: { tone: "info", icon: Clock },
  PROCESSING: { tone: "info", icon: Loader2 },
  APPROVED: { tone: "positive", icon: CheckCircle2 },
  DECLINED: { tone: "neutral", icon: XCircle },
  EXPIRED: { tone: "neutral", icon: Clock },
  CANCELLED: { tone: "neutral", icon: Ban },
  FAILED: { tone: "neutral", icon: XCircle },
  MISMATCH: { tone: "attention", icon: AlertTriangle },
  REVERSED: { tone: "neutral", icon: Undo2 },
};

function Pill({ tone, icon: Icon, children, className }: { tone: Tone; icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {children}
    </span>
  );
}

export function CardPaymentStatusBadge({ status, className }: { status: PspPaymentStatus; className?: string }) {
  const { tone, icon } = statusTone[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {cardPaymentStatusLabels[status]}
    </Pill>
  );
}

/** TEST is amber so a test row is never mistaken for money; LIVE is plain. */
export function CardModeChip({ mode, className }: { mode: "TEST" | "LIVE"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide uppercase",
        mode === "TEST" ? "bg-warning/15 text-warning-text" : "bg-surface-soft text-muted",
        className,
      )}
    >
      {mode === "TEST" ? "Test" : "Live"}
    </span>
  );
}

const refundTones: Record<PspRefundStatus, { tone: Tone; icon: LucideIcon; label: string }> = {
  REQUESTED: { tone: "info", icon: Clock, label: "Requested" },
  SUBMITTED: { tone: "info", icon: Loader2, label: "Sent to gateway" },
  APPROVED: { tone: "positive", icon: CheckCircle2, label: "Refunded" },
  DECLINED: { tone: "neutral", icon: XCircle, label: "Declined" },
  FAILED: { tone: "critical", icon: AlertTriangle, label: "Failed" },
};

export function CardRefundStatusBadge({ status }: { status: PspRefundStatus }) {
  const { tone, icon, label } = refundTones[status];
  return (
    <Pill tone={tone} icon={icon}>
      {label}
    </Pill>
  );
}

/** "VISA ••1111", from the masked number's last four digits. */
export function cardLabel(payment: Pick<StaffPayment, "maskedCard" | "cardType" | "paymentSystem">): string | null {
  const digits = payment.maskedCard?.replace(/\D/g, "") ?? "";
  const last4 = digits.slice(-4);
  const brand = (payment.cardType || payment.paymentSystem || "").toUpperCase();
  if (!last4 && !brand) return null;
  return [brand, last4 ? `••${last4}` : ""].filter(Boolean).join(" ");
}

/** Whether a row needs a person to look at it (the same ones the nav badge counts). */
export function needsAttention(payment: Pick<StaffPayment, "status" | "refunds">): boolean {
  return payment.status === "MISMATCH" || (payment.refunds ?? []).some((refund) => refund.status === "FAILED");
}

/** Where a booking reference opens in the panel. */
export function bookingHref(payment: Pick<StaffPayment, "bookingType" | "bookingReference" | "receivableId">): string | null {
  const ref = payment.bookingReference;
  if (ref) {
    switch (payment.bookingType) {
      case "HOTEL":
        return `/admin/bookings/${ref}`;
      case "TOUR":
        return `/admin/tours/bookings/${ref}`;
      case "TRANSFER":
        return `/admin/transfers/bookings/${ref}`;
      case "SERVICE":
        return `/admin/services/bookings/${ref}`;
      default:
        return `/admin/orders/${ref}`;
    }
  }
  return payment.receivableId ? `/admin/finance/receivables/${payment.receivableId}` : null;
}
