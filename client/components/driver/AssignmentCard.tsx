import Link from "next/link";
import { Briefcase, ChevronRight, Plane, Users } from "lucide-react";

import { TransferLegStatusBadge } from "@/components/admin/DispatchBadges";
import { JobNeeds } from "@/components/driver/JobBits";
import { RouteName } from "@/components/ui/RouteName";
import { driverLegStatusLabels, formatTime } from "@/lib/admin/dispatch";
import { isWithdrawn, untilLabel, zoneOf } from "@/lib/driver/assignment";
import { localePath, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { DriverAssignment } from "@/types/driver";

const dayPart = (iso: string, timeZone: string, options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(iso));
  }
};

/**
 * One job in a list, the whole card a tap target.
 *
 * The pick-up time leads, large, in a column of its own: it is what a driver
 * scans a list for. The route wraps rather than truncating — "Kutaisi → Kutaisi
 * International Airport" cut short at the arrow is the one thing the card
 * must never do. An offer is outlined in the brand colour; the status pill is
 * left off where the section heading already says it ("Waiting for your
 * answer").
 */
export function AssignmentCard({
  assignment,
  locale,
  showDate = true,
  showStatus = true,
}: {
  assignment: DriverAssignment;
  locale: Locale;
  /** Off under a day heading, where the date is already said. */
  showDate?: boolean;
  showStatus?: boolean;
}) {
  const { leg, booking } = assignment;
  const offered = assignment.status === "OFFERED";
  // Declined or reassigned: the leg has moved on without this driver, so its
  // status ("Accepted", by someone else) is not theirs to read.
  const withdrawn = isWithdrawn(assignment);
  const zone = zoneOf(assignment);
  // Dispatch waits on an offer: how long it has waited is worth a glance.
  const offeredAgo = offered ? untilLabel(assignment.assignedAt, new Date().getTime()).label : null;

  return (
    <Link
      href={localePath(locale, `/driver/assignments/${assignment.id}`)}
      className={cn(
        "group flex items-stretch gap-4 rounded-md border bg-surface p-4 transition-[border-color,box-shadow] hover:shadow-card sm:p-5",
        offered ? "border-brand/70 hover:border-brand" : "border-line hover:border-ink/30",
      )}
    >
      <div className="w-16 shrink-0 sm:w-20">
        <p className="text-[1.375rem] leading-none font-semibold tracking-[-0.01em] text-ink tabular-nums">
          {formatTime(leg.pickupAt, zone)}
        </p>
        {/* Weekday over date in the narrow phone column, one line from sm:
            left to wrap, "Wed 11 Nov" strands the month on a line alone. */}
        {showDate && (
          <p className="mt-1.5 text-[0.75rem] leading-snug text-muted">
            <span className="block sm:inline">{dayPart(leg.pickupAt, zone, { weekday: "short" })}</span>{" "}
            {/* Isolated: led by a number, "11 Nov" reads "Nov 11" on an RTL page. */}
            <bdi className="whitespace-nowrap">{dayPart(leg.pickupAt, zone, { day: "numeric", month: "short" })}</bdi>
          </p>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[1rem] leading-snug font-medium text-ink wrap-break-word">
          <RouteName from={leg.from} to={leg.to} arrowClassName="text-muted" />
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Users size={14} aria-hidden />
            {booking.passengers}
            <span className="sr-only">{booking.passengers === 1 ? "passenger" : "passengers"}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Briefcase size={14} aria-hidden />
            <bdi>
              {booking.luggage} {booking.luggage === 1 ? "bag" : "bags"}
            </bdi>
          </span>
          {booking.flightNumber && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[0.8125rem]">
              <Plane size={14} aria-hidden />
              {booking.flightNumber}
            </span>
          )}
        </p>
        <p className="mt-1 truncate text-[0.875rem] text-body">{booking.leadPassengerName}</p>
        {!withdrawn && <JobNeeds booking={booking} size="sm" className="mt-2" />}
        {offeredAgo && !showStatus && (
          <p className="mt-2 text-[0.8125rem] text-muted">
            <bdi>Offered {offeredAgo === "now" ? "just now" : offeredAgo}</bdi>
          </p>
        )}
        {showStatus && (
          <div className="mt-2.5">
            {withdrawn ? (
              <span className="inline-flex items-center rounded-full bg-surface-soft px-2.5 py-1 text-[0.75rem] font-medium text-muted">
                {assignment.status === "DECLINED" ? "You declined this job" : "Reassigned"}
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <TransferLegStatusBadge status={leg.status} label={driverLegStatusLabels[leg.status]} />
                {offeredAgo && (
                  <span className="text-[0.8125rem] text-muted">
                    <bdi>Offered {offeredAgo === "now" ? "just now" : offeredAgo}</bdi>
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      <ChevronRight
        size={20}
        className="shrink-0 self-center text-subtle transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
