import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell, CalendarCheck2 } from "lucide-react";

import { AssignmentCard } from "@/components/driver/AssignmentCard";
import { DriverEmpty, DriverPageHeader, DriverSection, longDay } from "@/components/driver/DriverPage";
import { DriverFreshness } from "@/components/driver/DriverFreshness";
import { DayOverview, NextJobCard } from "@/components/driver/TodayPanels";
import { listDriverAssignments, listDriverNotifications } from "@/lib/api/driverPanel";
import { getSession } from "@/lib/auth/session";
import { dayKeyIn } from "@/lib/admin/deadlines";
import { DRIVER_FALLBACK_TIME_ZONE, greetingFor, isLive, isWithdrawn, zoneOf } from "@/lib/driver/assignment";
import { getI18n } from "@/lib/i18n/server";
import type { DriverAssignment } from "@/types/driver";

export const metadata: Metadata = { title: "Today" };

/** Under way first — a job already started outranks one still to come. */
const UNDER_WAY = new Set(["EN_ROUTE", "ARRIVED", "ON_BOARD"]);

/**
 * Today, in the order a driver needs it: the job that matters now, offers
 * waiting for an answer, then the rest of the day with its numbers.
 */
export default async function DriverTodayPage() {
  // The "today" scope holds only open jobs (offered or accepted); a job driven
  // this morning has moved to history, so that is where "Done today" is read.
  const [{ locale, path }, session, today, upcoming, history, notices] = await Promise.all([
    getI18n(),
    getSession(),
    listDriverAssignments({ scope: "today", pageSize: 50 }),
    listDriverAssignments({ scope: "upcoming", pageSize: 50 }),
    listDriverAssignments({ scope: "history", pageSize: 25 }),
    listDriverNotifications({ unread: "true", pageSize: 1 }),
  ]);
  const now = new Date().getTime();
  const renderedAt = new Date(now).toISOString();

  const offers = upcoming.data.filter((assignment) => assignment.status === "OFFERED");
  const todays = today.data.filter((assignment) => assignment.status === "ACCEPTED");
  const left = todays.filter(isLive);
  const done = history.data.filter(
    (assignment) =>
      !isWithdrawn(assignment) &&
      ["COMPLETED", "NO_SHOW_REPORTED", "NO_SHOW"].includes(assignment.leg.status) &&
      dayKeyIn(assignment.leg.pickupAt, zoneOf(assignment)) === dayKeyIn(renderedAt, zoneOf(assignment)),
  ).length;

  // The next job may be today's or a later day's: every accepted job not yet
  // finished, once each, soonest first, with one already started ahead.
  const pool = new Map<string, DriverAssignment>();
  for (const assignment of [...todays, ...upcoming.data]) {
    if (isLive(assignment)) pool.set(assignment.id, assignment);
  }
  const live = [...pool.values()].sort((a, b) => Date.parse(a.leg.pickupAt) - Date.parse(b.leg.pickupAt));
  const next = live.find((assignment) => UNDER_WAY.has(assignment.leg.status)) ?? live[0];

  // The date is the jobs' own day where there are jobs; otherwise the zone the
  // platform operates in.
  const zone = next?.leg.timezone || offers[0]?.leg.timezone || DRIVER_FALLBACK_TIME_ZONE;
  const firstName = session?.driver?.firstName ?? session?.user.fullName.split(" ")[0];
  const greeting = greetingFor(now, zone);

  return (
    <>
      <DriverPageHeader
        eyebrow={firstName ? `${greeting}, ${firstName}` : greeting}
        title="Today"
        meta={longDay(renderedAt, zone)}
        aside={<DriverFreshness renderedAt={renderedAt} timeZone={zone} />}
      />

      <div className="space-y-8">
        {notices.unreadCount > 0 && (
          <Link
            href={path("/driver/notifications")}
            className="flex min-h-12 items-center gap-3 rounded-md border border-brand/40 bg-brand-soft px-4 py-3 text-[0.9375rem] font-medium text-ink transition-colors hover:border-brand"
          >
            <Bell size={18} className="shrink-0 text-brand-text" aria-hidden />
            <span className="min-w-0 flex-1">
              <bdi>{notices.unreadCount === 1 ? "1 new notification" : `${notices.unreadCount} new notifications`}</bdi>
            </span>
            <ArrowRight size={16} className="shrink-0 text-brand-text rtl:-scale-x-100" aria-hidden />
          </Link>
        )}

        {next && <NextJobCard assignment={next} href={path(`/driver/assignments/${next.id}`)} now={now} />}

        {offers.length > 0 && (
          <DriverSection id="driver-offers" title="Waiting for your answer" count={offers.length}>
            <ul className="space-y-3">
              {offers.map((assignment) => (
                <li key={assignment.id}>
                  <AssignmentCard assignment={assignment} locale={locale} showStatus={false} />
                </li>
              ))}
            </ul>
          </DriverSection>
        )}

        <DriverSection id="driver-today" title="Today's jobs" count={todays.length}>
          {todays.length === 0 && done === 0 ? (
            <DriverEmpty icon={CalendarCheck2} title="No jobs today">
              <Link
                href={path("/driver/upcoming")}
                className="inline-flex min-h-11 items-center gap-1.5 font-medium text-brand-text underline-offset-4 hover:underline"
              >
                See what is coming up
                <ArrowRight size={15} className="rtl:-scale-x-100" aria-hidden />
              </Link>
            </DriverEmpty>
          ) : (
            <div className="space-y-3">
              <DayOverview left={left} done={done} />
              {todays.length > 0 && (
                <ul className="space-y-3">
                  {todays.map((assignment) => (
                    <li key={assignment.id}>
                      <AssignmentCard assignment={assignment} locale={locale} showDate={false} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </DriverSection>
      </div>
    </>
  );
}
