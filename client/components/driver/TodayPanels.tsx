import Link from "next/link";
import { ArrowRight, Navigation, Phone } from "lucide-react";

import { Countdown } from "@/components/driver/Countdown";
import { JobNeeds } from "@/components/driver/JobBits";
import { RouteName } from "@/components/ui/RouteName";
import { formatTime } from "@/lib/admin/dispatch";
import { dayKeyIn } from "@/lib/admin/deadlines";
import { formatDuration, zoneOf } from "@/lib/driver/assignment";
import { mapsDirectionsUrl } from "@/lib/geo/place";
import { cn } from "@/lib/utils";
import type { DriverAssignment } from "@/types/driver";

const shortDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone }).format(new Date(iso));

const ACTION =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-sm px-4 text-[0.9375rem] font-semibold transition-colors";

/**
 * The one job that matters now, on the ink panel at the top of Today.
 *
 * What it says follows where the job is: before setting off, the pick-up
 * time and a countdown to it; on the way, the same with "On your way"; at
 * the kerb, how long the driver has been waiting; with the passenger aboard,
 * roughly when the drop-off is due — and the navigation button points at
 * whichever address comes next. The buttons are the three things a driver
 * reaches for from here: directions, the passenger's phone, the job itself.
 */
export function NextJobCard({
  assignment,
  href,
  now,
}: {
  assignment: DriverAssignment;
  href: string;
  /** The server's clock at render, so the countdown hydrates as it rendered. */
  now: number;
}) {
  const { leg, booking, milestones } = assignment;
  const zone = zoneOf(assignment);
  const onBoard = leg.status === "ON_BOARD";
  const atPickup = leg.status === "ARRIVED";
  const isToday = dayKeyIn(leg.pickupAt, zone) === dayKeyIn(new Date(now).toISOString(), zone);

  const eyebrow =
    leg.status === "EN_ROUTE" ? "On your way" : atPickup ? "At the pick-up" : onBoard ? "Passenger on board" : "Up next";
  const target = onBoard ? booking.dropoffPlace : booking.pickupPlace;
  const dropoffDue = milestones.pickedUpAt
    ? new Date(Date.parse(milestones.pickedUpAt) + leg.durationMinutes * 60_000).toISOString()
    : null;
  const phone = booking.leadPassengerPhone;
  const party = [
    booking.passengers === 1 ? "1 passenger" : `${booking.passengers} passengers`,
    booking.luggage === 1 ? "1 bag" : `${booking.luggage} bags`,
  ].join(" · ");

  return (
    <section aria-labelledby="up-next" className="rounded-md bg-ink p-5 text-on-dark shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="up-next" className="text-[0.75rem] font-semibold tracking-[0.14em] text-on-dark-muted uppercase">
          {eyebrow}
        </h2>
        {!onBoard && !atPickup && (
          <Countdown
            at={leg.pickupAt}
            initialNow={now}
            className="rounded-full bg-on-dark/10 px-2.5 py-1 text-[0.8125rem] font-semibold whitespace-nowrap tabular-nums"
            soonClassName="bg-brand text-white"
            pastClassName="bg-warning text-ink"
          />
        )}
        {atPickup && milestones.arrivedAt && (
          <p className="rounded-full bg-on-dark/10 px-2.5 py-1 text-[0.8125rem] font-semibold whitespace-nowrap">
            <bdi>Waiting since {formatTime(milestones.arrivedAt, zone)}</bdi>
          </p>
        )}
        {onBoard && dropoffDue && (
          <p className="rounded-full bg-on-dark/10 px-2.5 py-1 text-[0.8125rem] font-semibold whitespace-nowrap">
            <bdi>Drop-off around {formatTime(dropoffDue, zone)}</bdi>
          </p>
        )}
      </div>

      <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[2.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {formatTime(leg.pickupAt, zone)}
        </span>
        <span className="text-[0.9375rem] text-on-dark-muted">{isToday ? "Pick-up today" : shortDay(leg.pickupAt, zone)}</span>
      </p>

      <p className="mt-3 text-[1.125rem] leading-snug font-medium wrap-break-word">
        <RouteName from={leg.from} to={leg.to} arrowClassName="text-on-dark-muted" />
      </p>
      {/* One left-to-right run: on an RTL page the "·" between isolated parts
          otherwise takes the page's direction and the flight's separator is
          left dangling at the line's end. The name keeps its own isolate, so
          a name written in Hebrew still reads right. */}
      <p className="mt-1 text-[0.875rem] text-on-dark-muted">
        <bdi dir="ltr">
          <bdi>{booking.leadPassengerName}</bdi> · {party}
          {booking.flightNumber && (
            <>
              {" "}
              · <span className="font-mono">{booking.flightNumber}</span>
            </>
          )}
        </bdi>
      </p>
      <JobNeeds booking={booking} size="sm" tone="dark" className="mt-3" />

      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Link href={href} className={cn(ACTION, "col-span-2 bg-brand text-white hover:bg-brand-hover sm:order-last sm:ms-auto")}>
          Open job
          <ArrowRight size={17} className="rtl:-scale-x-100" aria-hidden />
        </Link>
        {target && (
          <a
            href={mapsDirectionsUrl(target.latitude, target.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(ACTION, "bg-on-dark text-ink hover:bg-white", !phone && "col-span-2")}
          >
            <Navigation size={16} aria-hidden />
            {onBoard ? "To drop-off" : "To pick-up"}
            <span className="sr-only"> (opens your maps app)</span>
          </a>
        )}
        {phone && (
          <a
            href={`tel:${phone}`}
            className={cn(ACTION, "border border-on-dark/25 text-on-dark hover:border-on-dark/60", !target && "col-span-2")}
          >
            <Phone size={16} aria-hidden />
            Call
            <span className="sr-only"> {booking.leadPassengerName}</span>
          </a>
        )}
      </div>
    </section>
  );
}

/**
 * The day in four numbers: what is left, what is done, and the driving and
 * distance still ahead. Counted from the jobs on screen, not estimated.
 */
export function DayOverview({ left, done }: { left: DriverAssignment[]; done: number }) {
  const minutes = left.reduce((sum, job) => sum + job.leg.durationMinutes, 0);
  const km = left.reduce((sum, job) => sum + job.leg.distanceKm, 0);
  const items = [
    { label: "Left today", value: String(left.length) },
    { label: "Done today", value: String(done) },
    { label: "Driving ahead", value: left.length ? formatDuration(minutes) : "—" },
    { label: "Distance ahead", value: left.length ? `${Math.round(km)} km` : "—" },
  ];

  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-4">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "px-4 py-3",
            index % 2 === 1 && "border-s border-line",
            index >= 2 && "border-t border-line sm:border-t-0",
            index === 2 && "sm:border-s",
          )}
        >
          <dt className="text-[0.8125rem] text-muted">{item.label}</dt>
          <dd className="mt-0.5 text-[1.25rem] leading-tight font-semibold text-ink tabular-nums">
            <bdi>{item.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
