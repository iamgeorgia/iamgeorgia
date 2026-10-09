import { Ban, CheckCircle2, MailPlus, type LucideIcon } from "lucide-react";

import { userStatusLabels } from "@/lib/admin/users";
import { cn } from "@/lib/utils";
import type { UserStatus } from "@/types/user";

/**
 * A staff account's status pill.
 *
 * Same shape and tones as the pills in `StatusBadge.tsx` — an icon and a word,
 * never colour alone — kept beside the Staff screens because that module does
 * not export its `Pill`.
 */
const tones: Record<UserStatus, { className: string; icon: LucideIcon }> = {
  INVITED: { className: "bg-info/12 text-info", icon: MailPlus },
  ACTIVE: { className: "bg-success/12 text-success", icon: CheckCircle2 },
  DEACTIVATED: { className: "bg-surface-soft text-muted", icon: Ban },
};

export function UserStatusBadge({
  status,
  className,
}: {
  status: UserStatus;
  className?: string;
}) {
  const { className: tone, icon: Icon } = tones[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon size={13} className="shrink-0" aria-hidden />
      {userStatusLabels[status]}
    </span>
  );
}
