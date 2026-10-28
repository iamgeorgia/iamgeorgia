import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  HandCoins,
  MinusCircle,
  type LucideIcon,
} from "lucide-react";

import { formatInstant } from "@/lib/admin/bookings";
import { paymentStatusLabels, paymentStatusTones, type PaymentTone } from "@/lib/admin/bookingApprovals";
import { cn } from "@/lib/utils";
import type { BookingPayment, BookingPaymentStatus } from "@/types/booking";

/**
 * What the buyer owes on a booking, as a pill. Icon and word, never colour
 * alone, like every other status pill in the panel. Readable by anyone who
 * reads bookings: the figure behind it is finance's, the fact of it is not.
 */

const tones: Record<PaymentTone, string> = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
};

const icons: Record<BookingPaymentStatus, LucideIcon> = {
  NONE: CircleDashed,
  UNPAID: Clock,
  PARTIAL: MinusCircle,
  OVERDUE: AlertTriangle,
  PAID: CheckCircle2,
  WAIVED: HandCoins,
  VOID: Ban,
};

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: BookingPaymentStatus;
  className?: string;
}) {
  const Icon = icons[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        tones[paymentStatusTones[status]],
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {paymentStatusLabels[status]}
    </span>
  );
}

/**
 * The badge with the due date beneath it — the Payment column of every
 * register. The date is shown while money is still owed; a paid, waived or
 * void bill has no date worth the row's height.
 */
export function PaymentCell({ payment, className }: { payment: BookingPayment; className?: string }) {
  const owed = payment.status === "UNPAID" || payment.status === "PARTIAL" || payment.status === "OVERDUE";

  return (
    <span className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      <PaymentStatusBadge status={payment.status} />
      {owed && payment.dueAt && (
        <span
          className={cn(
            "text-[0.75rem]",
            payment.status === "OVERDUE" ? "font-medium text-error-text" : "text-muted",
          )}
        >
          {payment.status === "OVERDUE" ? "was due " : "due "}
          {formatInstant(payment.dueAt)}
        </span>
      )}
    </span>
  );
}
