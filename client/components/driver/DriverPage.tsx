import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";

import { AssignmentCard } from "@/components/driver/AssignmentCard";
import { dayKeyIn } from "@/lib/admin/deadlines";
import { DRIVER_FALLBACK_TIME_ZONE, zoneOf } from "@/lib/driver/assignment";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { DriverAssignment } from "@/types/driver";

/**
 * Page furniture for the driver panel.
 *
 * Larger than the partner portal's on purpose: this is read at arm's length,
 * often standing by a car, so titles are bigger, rows are taller and nothing
 * that matters is smaller than 15px.
 */

export { DRIVER_FALLBACK_TIME_ZONE };

export function DriverBackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="-ms-2 inline-flex min-h-11 items-center gap-2 rounded-sm px-2 text-[0.875rem] font-medium text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft size={16} className="shrink-0 rtl:-scale-x-100" aria-hidden />
      {children}
    </Link>
  );
}

export function DriverPageHeader({
  title,
  eyebrow,
  meta,
  back,
  aside,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  back?: React.ReactNode;
  /** Beside the title, at the end of the row: the freshness control. */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6", className)}>
      {back && <div className="mb-2">{back}</div>}
      {/* A grid, not a row: the freshness control sits beside the eyebrow and
          title only, and the meta line below runs the full width rather than
          wrapping around it on a narrow phone. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[0.875rem] font-medium text-muted">
              <bdi>{eyebrow}</bdi>
            </p>
          )}
          <h1 className="text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.01em] text-ink wrap-anywhere sm:text-[1.75rem]">
            {title}
          </h1>
        </div>
        {aside && <div className="-me-2">{aside}</div>}
        {/* Isolated: "1 job · 2 offers" starts with a number, which an RTL
            line would otherwise carry to the far end. */}
        {meta && (
          <div className="col-span-full mt-1.5 text-[0.9375rem] text-muted">
            <bdi>{meta}</bdi>
          </div>
        )}
      </div>
    </header>
  );
}

/** A titled run of the page — "Waiting for your answer", "Today's jobs". */
export function DriverSection({
  id,
  title,
  count,
  children,
  className,
}: {
  id: string;
  title: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <h2 id={id} className="mb-3 flex items-center gap-2 text-[1.0625rem] font-semibold text-ink">
        {title}
        {count !== undefined && count > 0 && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-soft px-2 text-[0.75rem] font-semibold text-body tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

export function DriverEmpty({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-dashed border-line px-5 py-8 text-center", className)}>
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-surface-soft text-muted" aria-hidden>
        <Icon size={20} />
      </span>
      <p className="mt-3 text-[1rem] font-medium text-ink">{title}</p>
      {children && (
        <div className="mx-auto mt-1 max-w-sm text-[0.9375rem] leading-relaxed text-muted">
          {typeof children === "string" ? <bdi>{children}</bdi> : children}
        </div>
      )}
    </div>
  );
}

/** "Wednesday 4 November" in the zone the pick-up happens in. */
export const longDay = (iso: string, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(iso));
  }
};

const DAY_MS = 86_400_000;

/** Today / Tomorrow / Yesterday, else nothing: the date beside it says the rest. */
const relativeDay = (dayKey: string, todayKey: string): string | null => {
  const days = Math.round((Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return null;
};

/**
 * Jobs grouped under the day they happen, in the order the server sent them
 * (soonest first for what is coming, latest first for history). The day is
 * the pick-up's own, not the phone's: a 05:30 airport run is on the morning
 * it is driven wherever the driver's phone thinks it is.
 */
export function AssignmentDays({
  assignments,
  locale,
  label,
  jump = false,
}: {
  assignments: DriverAssignment[];
  locale: Locale;
  /** Names the list for assistive technology: "Upcoming jobs". */
  label: string;
  /** A strip of day tiles above the list, for jumping ahead a week. */
  jump?: boolean;
}) {
  const now = new Date().toISOString();
  const days: {
    key: string;
    first: DriverAssignment;
    items: DriverAssignment[];
  }[] = [];

  for (const assignment of assignments) {
    const key = dayKeyIn(assignment.leg.pickupAt, zoneOf(assignment));
    const last = days.at(-1);
    if (last && last.key === key) last.items.push(assignment);
    else days.push({ key, first: assignment, items: [assignment] });
  }

  return (
    <>
      {jump && days.length >= 3 && <DayJump days={days} now={now} />}
      <div aria-label={label} role="group" className="space-y-6">
        {days.map((day) => {
          const zone = zoneOf(day.first);
          const relative = relativeDay(day.key, dayKeyIn(now, zone));
          const headingId = `day-${day.key}`;

          return (
            // Clear of the sticky top bar when a day tile jumps here.
            <section key={day.key} id={`on-${day.key}`} aria-labelledby={headingId} className="scroll-mt-16 md:scroll-mt-20">
              {/* Sticky under the top bar, so a long day keeps its date in view. */}
              <h2
                id={headingId}
                className="sticky top-14 z-10 -mx-4 mb-2 flex items-baseline gap-2 bg-background/95 px-4 py-2 text-[0.9375rem] font-semibold text-ink backdrop-blur-sm md:top-16"
              >
                {relative && <span className="text-brand-text">{relative}</span>}
                <span className={cn(relative && "font-normal text-muted")}>{longDay(day.first.leg.pickupAt, zone)}</span>
                <span className="ms-auto text-[0.8125rem] font-normal text-muted tabular-nums">
                  <bdi>{day.items.length === 1 ? "1 job" : `${day.items.length} jobs`}</bdi>
                </span>
              </h2>
              <ul className="space-y-3">
                {day.items.map((assignment) => (
                  <li key={assignment.id}>
                    <AssignmentCard assignment={assignment} locale={locale} showDate={false} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

const tilePart = (iso: string, timeZone: string, part: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...part, timeZone }).format(new Date(iso));

/**
 * One tile per day with jobs — weekday, date, how many — scrolling sideways
 * on a phone. A tap jumps to that day's list. A day holding an offer carries
 * a brand dot: it has something waiting on the driver.
 */
function DayJump({ days, now }: { days: { key: string; first: DriverAssignment; items: DriverAssignment[] }[]; now: string }) {
  return (
    <nav aria-label="Jump to a day" className="-mx-4 mb-6 md:mx-0">
      <ul className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
        {days.map((day) => {
          const zone = zoneOf(day.first);
          const pickup = day.first.leg.pickupAt;
          const relative = relativeDay(day.key, dayKeyIn(now, zone));
          const offers = day.items.some((item) => item.status === "OFFERED");
          const count = day.items.length === 1 ? "1 job" : `${day.items.length} jobs`;

          return (
            <li key={day.key} className="shrink-0">
              <a
                href={`#on-${day.key}`}
                className="relative flex min-h-16 w-[4.5rem] flex-col items-center justify-center rounded-md border border-line bg-surface px-2 py-2 text-center transition-colors hover:border-ink/40"
              >
                <span className={cn("text-[0.75rem] font-medium", relative ? "text-brand-text" : "text-muted")}>
                  {relative ?? tilePart(pickup, zone, { weekday: "short" })}
                </span>
                {/* The month shows: a strip that runs into December otherwise
                    reads "Tue 1" after "Wed 11". */}
                <bdi className="leading-tight whitespace-nowrap">
                  <span className="text-[1.125rem] font-semibold text-ink tabular-nums">
                    {tilePart(pickup, zone, { day: "numeric" })}
                  </span>{" "}
                  <span className="text-[0.75rem] font-medium text-muted">{tilePart(pickup, zone, { month: "short" })}</span>
                </bdi>
                <span className="text-[0.6875rem] text-muted">
                  <bdi>{count}</bdi>
                </span>
                {offers && <span className="absolute top-1.5 end-1.5 size-2 rounded-full bg-brand" aria-hidden />}
                {offers && <span className="sr-only">, waiting for your answer</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
