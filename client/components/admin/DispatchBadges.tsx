import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  Flag,
  MapPin,
  Navigation,
  ShieldQuestion,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { legStatusLabels, transferBookingStatusLabels } from "@/lib/admin/dispatch";
import { cn } from "@/lib/utils";
import type { TransferBookingStatus, TransferLegStatus } from "@/types/transfer";

/** Status pills for legs and transfer bookings. Icon and word, never colour alone. */

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

const legTones: Record<TransferLegStatus, { tone: Tone; icon: LucideIcon }> = {
  UNASSIGNED: { tone: "attention", icon: UserPlus },
  ASSIGNED: { tone: "info", icon: Clock },
  ACCEPTED: { tone: "positive", icon: CheckCircle2 },
  EN_ROUTE: { tone: "info", icon: Navigation },
  ARRIVED: { tone: "info", icon: MapPin },
  ON_BOARD: { tone: "info", icon: Users },
  COMPLETED: { tone: "neutral", icon: Flag },
  NO_SHOW_REPORTED: { tone: "attention", icon: AlertTriangle },
  NO_SHOW: { tone: "critical", icon: AlertTriangle },
  CANCELLED: { tone: "critical", icon: Ban },
};

export function TransferLegStatusBadge({
  status,
  label,
  className,
}: {
  status: TransferLegStatus;
  /** Override the wording — the driver panel speaks in the second person. */
  label?: string;
  className?: string;
}) {
  const { tone, icon } = legTones[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {label ?? legStatusLabels[status]}
    </Pill>
  );
}

const bookingTones: Record<TransferBookingStatus, { tone: Tone; icon: LucideIcon }> = {
  PENDING_APPROVAL: { tone: "attention", icon: ShieldQuestion },
  PENDING: { tone: "attention", icon: Clock },
  CONFIRMED: { tone: "positive", icon: CheckCircle2 },
  COMPLETED: { tone: "neutral", icon: Circle },
  CANCELLED: { tone: "critical", icon: Ban },
  NO_SHOW: { tone: "critical", icon: AlertTriangle },
};

export function TransferBookingStatusBadge({
  status,
  className,
}: {
  status: TransferBookingStatus;
  className?: string;
}) {
  const { tone, icon } = bookingTones[status];
  return (
    <Pill tone={tone} icon={icon} className={className}>
      {transferBookingStatusLabels[status]}
    </Pill>
  );
}
