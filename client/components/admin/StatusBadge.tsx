import {
  AlertTriangle,
  Ban,
  CalendarX2,
  CheckCircle2,
  Circle,
  Clock,
  MinusCircle,
  PauseCircle,
  ShieldBan,
  ShieldQuestion,
  MailPlus,
  PenLine,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { bookingStatusLabels } from "@/lib/admin/bookings";
import {
  deadlineKindLabels,
  deadlineKindTones,
  deadlineStatusLabels,
  deadlineStatusTones,
  type DeadlineTone,
} from "@/lib/admin/deadlines";
import { orderStatusLabels } from "@/lib/admin/orders";
import { serviceBookingStatusLabels } from "@/lib/admin/services";
import { tourBookingStatusLabels } from "@/lib/admin/tours";
import { invitationStatusLabels, partnerStatusLabels } from "@/lib/admin/partners";
import { cn } from "@/lib/utils";
import type { InvitationStatus, PartnerStatus } from "@/types";
import type { HotelBookingStatus } from "@/types/booking";
import type { DeadlineKind, DeadlineStatus } from "@/types/deadline";
import type { OrderStatus } from "@/types/order";
import type { ServiceBookingStatus } from "@/types/service";
import type { TourBookingStatus } from "@/types/tour";

/**
 * Status pills.
 *
 * Every state ships an icon and a word, never colour alone — an operator
 * scanning two hundred rows for the ones that need attention cannot be asked
 * to distinguish amber from green, and roughly one man in twelve could not do
 * it anyway. The colours come from the reserved semantic tokens, which is why
 * chart series never borrow them.
 */

type Tone = "neutral" | "positive" | "attention" | "critical" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-soft text-muted",
  positive: "bg-success/12 text-success",
  attention: "bg-warning/15 text-warning-text",
  critical: "bg-error/12 text-error-text",
  info: "bg-info/12 text-info",
};

function Pill({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: Tone;
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
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

const bookingTones: Record<HotelBookingStatus, { tone: Tone; icon: LucideIcon }> = {
  // The platform's own gate, before any supplier is asked: a question mark,
  // not a clock, because the wait is for us rather than for them.
  PENDING_APPROVAL: { tone: "attention", icon: ShieldQuestion },
  PENDING: { tone: "attention", icon: Clock },
  CONFIRMED: { tone: "positive", icon: CheckCircle2 },
  COMPLETED: { tone: "neutral", icon: Circle },
  CANCELLED: { tone: "critical", icon: Ban },
  // A guest who never arrived is not the same as a cancellation: the rooms
  // were held all night and the charge usually stands.
  NO_SHOW: { tone: "critical", icon: AlertTriangle },
};

export function BookingStatusBadge({
  status,
  className,
}: {
  status: HotelBookingStatus;
  className?: string;
}) {
  const { tone, icon } = bookingTones[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {bookingStatusLabels[status]}
    </Pill>
  );
}

/**
 * Tour bookings share the hotel palette but not the words: PENDING here is
 * an on-request booking awaiting the operator, with seats already claimed.
 */
export function TourBookingStatusBadge({
  status,
  className,
}: {
  status: TourBookingStatus;
  className?: string;
}) {
  const { tone, icon } = bookingTones[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {tourBookingStatusLabels[status]}
    </Pill>
  );
}

/** Service bookings share the tour register's words: PENDING is a request the supplier has yet to answer. */
export function ServiceBookingStatusBadge({
  status,
  className,
}: {
  status: ServiceBookingStatus;
  className?: string;
}) {
  const { tone, icon } = bookingTones[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {serviceBookingStatusLabels[status]}
    </Pill>
  );
}

const orderTones: Record<OrderStatus, { tone: Tone; icon: LucideIcon }> = {
  PENDING_APPROVAL: { tone: "attention", icon: ShieldQuestion },
  PENDING_CONFIRMATION: { tone: "attention", icon: Clock },
  CONFIRMED: { tone: "positive", icon: CheckCircle2 },
  // Neither confirmed nor cancelled: part of the trip survives and still has
  // to be operated, so this cannot wear the cancellation colour.
  PARTIALLY_CANCELLED: { tone: "info", icon: MinusCircle },
  CANCELLED: { tone: "critical", icon: Ban },
  COMPLETED: { tone: "neutral", icon: Circle },
};

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const { tone, icon } = orderTones[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {orderStatusLabels[status]}
    </Pill>
  );
}

const partnerTones: Record<PartnerStatus, { tone: Tone; icon: LucideIcon }> = {
  INVITED: { tone: "info", icon: MailPlus },
  REGISTRATION_IN_PROGRESS: { tone: "info", icon: PenLine },
  PENDING_APPROVAL: { tone: "attention", icon: Clock },
  APPROVED: { tone: "positive", icon: CheckCircle2 },
  REJECTED: { tone: "critical", icon: Ban },
  SUSPENDED: { tone: "critical", icon: PauseCircle },
  BLOCKED: { tone: "critical", icon: ShieldBan },
  TERMINATED: { tone: "neutral", icon: Ban },
};

export function PartnerStatusBadge({
  status,
  className,
}: {
  status: PartnerStatus;
  className?: string;
}) {
  const { tone, icon } = partnerTones[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {partnerStatusLabels[status]}
    </Pill>
  );
}

const invitationTones: Record<InvitationStatus, { tone: Tone; icon: LucideIcon }> = {
  PENDING: { tone: "positive", icon: MailPlus },
  ACCEPTED: { tone: "neutral", icon: CheckCircle2 },
  REVOKED: { tone: "neutral", icon: Ban },
  EXPIRED: { tone: "attention", icon: Clock },
};

export function InvitationStatusBadge({
  status,
  className,
}: {
  status: InvitationStatus;
  className?: string;
}) {
  const { tone, icon } = invitationTones[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {invitationStatusLabels[status]}
    </Pill>
  );
}

// --- deadlines ---------------------------------------------------------------

/**
 * The calendar's five tones. `warning` (amber) and `attention` (the brand's
 * own orange) stay apart: a cancellation window and a confirmation often
 * fall on the same day, and one colour for both would hide which is which.
 */
export const deadlineToneClasses: Record<DeadlineTone, string> = {
  info: "bg-info/12 text-info",
  warning: "bg-warning/15 text-warning-text",
  attention: "bg-brand-soft text-brand-text",
  critical: "bg-error/12 text-error-text",
  positive: "bg-success/12 text-success",
  neutral: "bg-surface-soft text-muted",
};

const deadlineKindIcons: Record<DeadlineKind, LucideIcon> = {
  PAYMENT: Wallet,
  FREE_CANCELLATION: CalendarX2,
  CONFIRMATION: ShieldQuestion,
};

const deadlineStatusIcons: Record<DeadlineStatus, LucideIcon> = {
  OPEN: Clock,
  MET: CheckCircle2,
  MISSED: AlertTriangle,
  CANCELLED: Ban,
};

/** The kind of deadline, in its kind's colour — or red once it is late. */
export function DeadlineKindBadge({
  kind,
  overdue = false,
  className,
}: {
  kind: DeadlineKind;
  overdue?: boolean;
  className?: string;
}) {
  const Icon = deadlineKindIcons[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        deadlineToneClasses[overdue ? "critical" : deadlineKindTones[kind]],
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {deadlineKindLabels[kind]}
    </span>
  );
}

export function DeadlineStatusBadge({ status, className }: { status: DeadlineStatus; className?: string }) {
  const Icon = deadlineStatusIcons[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        deadlineToneClasses[deadlineStatusTones[status]],
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {deadlineStatusLabels[status]}
    </span>
  );
}
