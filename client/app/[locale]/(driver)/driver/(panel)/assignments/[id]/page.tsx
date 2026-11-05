import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Baby,
  Briefcase,
  CalendarClock,
  Car,
  Clock,
  ExternalLink,
  Headset,
  MapPin,
  MessageSquareText,
  Navigation,
  PackagePlus,
  Phone,
  Plane,
  UserRound,
  Users,
} from "lucide-react";

import { TransferLegStatusBadge } from "@/components/admin/DispatchBadges";
import { AssignmentControls } from "@/components/driver/AssignmentControls";
import { CopyButton } from "@/components/driver/CopyButton";
import { Countdown } from "@/components/driver/Countdown";
import { DriverBackLink, longDay } from "@/components/driver/DriverPage";
import { DriverFreshness } from "@/components/driver/DriverFreshness";
import { JobNeeds, JobProgressMeter, JobTimeline } from "@/components/driver/JobBits";
import { NameSign } from "@/components/driver/NameSign";
import { RouteName } from "@/components/ui/RouteName";
import { dayKeyIn } from "@/lib/admin/deadlines";
import { ApiError } from "@/lib/api/client";
import { getDriverAssignment } from "@/lib/api/driverPanel";
import { driverLegStatusLabels, formatTime } from "@/lib/admin/dispatch";
import { formatDuration, hasAssignmentControls, isFinished, isWithdrawn, zoneOf } from "@/lib/driver/assignment";
import { mapsDirectionsUrl } from "@/lib/geo/place";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import type { DriverAssignment } from "@/types/driver";
import type { PlacedLocation } from "@/types/geo";

export const metadata: Metadata = { title: "Transfer" };

/** A public flight tracker, for an airport pick-up's arrival time. */
const flightTrackerUrl = (flight: string) =>
  `https://www.flightradar24.com/data/flights/${encodeURIComponent(flight.replace(/\s+/g, "").toLowerCase())}`;

const SECONDARY_LINK =
  "inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-line px-3 text-[0.875rem] font-medium transition-colors";

/**
 * One job, everything the driver needs and nothing they do not: where, when,
 * who, how many, what to bring — and the one button that moves it on.
 *
 * The header answers "what, when, how far along": the route, the time with a
 * countdown, the status with a five-step meter, and the things the car must
 * carry. On a phone the buttons come straight after it, before any detail;
 * on a wide screen they move, with the timeline, to a column that stays in
 * view.
 */
export default async function DriverAssignmentPage({ params }: PageProps<"/[locale]/driver/assignments/[id]">) {
  const { id } = await params;
  const { path } = await getI18n();

  let assignment: DriverAssignment;

  try {
    assignment = await getDriverAssignment(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const now = new Date().getTime();
  const renderedAt = new Date(now).toISOString();
  const { leg, booking, vehicle } = assignment;
  const withdrawn = isWithdrawn(assignment);
  const finished = isFinished(assignment);
  const zone = zoneOf(assignment);
  const controls = !withdrawn && hasAssignmentControls(assignment);
  // The timeline belongs to a job this driver took on; an offer has none yet.
  const timeline = !withdrawn && assignment.milestones.acceptedAt !== null;
  const beforePickup = !finished && ["ASSIGNED", "ACCEPTED", "EN_ROUTE"].includes(leg.status);
  const legLabel =
    booking.tripType === "RETURN" ? (leg.direction === "RETURN" ? "Return journey" : "Outbound · return booked") : null;

  // Back to the list this job is on, not always to Today.
  const back = finished
    ? { href: "/driver/history", label: "History" }
    : dayKeyIn(leg.pickupAt, zone) === dayKeyIn(renderedAt, zone)
      ? { href: "/driver", label: "Today" }
      : { href: "/driver/upcoming", label: "Upcoming" };

  /**
   * The address, with directions when the traveller picked a real door at
   * checkout, and a copy button for pasting it into whatever app the driver
   * uses when there is no pin. A booking made before place search existed
   * simply has no directions button.
   */
  const address = (text: string, place: PlacedLocation | null, what: string, exact: boolean) => (
    <>
      <span className="block wrap-break-word">
        {/* "12 Rustaveli Ave" must not become "Rustaveli Ave 12" on an RTL line. */}
        <bdi>{text}</bdi>
      </span>
      {(place || exact) && (
        <span className="mt-2 flex flex-wrap gap-2">
          {place && (
            <a
              href={mapsDirectionsUrl(place.latitude, place.longitude)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(SECONDARY_LINK, "text-brand-text hover:border-brand/50")}
            >
              <Navigation size={15} aria-hidden />
              Navigate
              <span className="sr-only"> to the {what} (opens your maps app)</span>
            </a>
          )}
          {/* Only a real address is worth copying; a bare city name is not. */}
          {exact && <CopyButton text={text} label={`the ${what} address`} />}
        </span>
      )}
    </>
  );

  const row = (icon: React.ReactNode, label: string, value: React.ReactNode, id?: string) => (
    <div id={id} className="flex scroll-mt-24 items-start gap-3 py-3.5">
      <span className="mt-0.5 shrink-0 text-subtle" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-[0.8125rem] text-muted">{label}</dt>
        {/* Text values are isolated: "2 adults" or "15 km · about 25 min"
            begin with a number an RTL line would move to the end. */}
        <dd className="mt-0.5 text-[1rem] leading-snug text-ink">{typeof value === "string" ? <bdi>{value}</bdi> : value}</dd>
      </div>
    </div>
  );

  const card = (id: string, title: string, rows: React.ReactNode) => (
    <section aria-labelledby={id} className="rounded-md border border-line bg-surface">
      <h2 id={id} className="border-b border-line px-4 py-3 text-[0.9375rem] font-semibold text-ink sm:px-5">
        {title}
      </h2>
      <dl className="divide-y divide-line px-4 sm:px-5">{rows}</dl>
    </section>
  );

  // Placed twice — after the details on a phone, under the buttons on a wide
  // screen — with one copy hidden at each width, so each needs its own id.
  const timelineCard = (placement: "aside" | "end") => (
    <section aria-labelledby={`job-timeline-${placement}`} className="rounded-md border border-line bg-surface">
      <h2
        id={`job-timeline-${placement}`}
        className="border-b border-line px-4 py-3 text-[0.9375rem] font-semibold text-ink sm:px-5"
      >
        Timeline
      </h2>
      <div className="px-4 py-4 sm:px-5">
        <JobTimeline assignment={assignment} timeZone={zone} />
      </div>
    </section>
  );

  return (
    <>
      <header className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <DriverBackLink href={path(back.href)}>{back.label}</DriverBackLink>
          {!finished && <DriverFreshness renderedAt={renderedAt} timeZone={zone} className="-me-2" />}
        </div>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-mono text-[0.8125rem] text-muted">{booking.reference}</span>
          {legLabel && (
            <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[0.75rem] font-medium text-body">{legLabel}</span>
          )}
        </p>
        <h1 className="mt-1 text-[1.5rem] leading-[1.25] font-semibold tracking-[-0.01em] text-ink wrap-break-word sm:text-[1.75rem]">
          <RouteName from={leg.from} to={leg.to} arrowClassName="text-muted" />
        </h1>

        {/* The time large, with the day and the countdown stacked beside it:
            on one line the countdown would wrap to a row of its own on a phone. */}
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[2rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {formatTime(leg.pickupAt, zone)}
          </span>
          <span className="flex min-w-0 flex-col items-start gap-1">
            <span className="text-[0.9375rem] leading-tight text-muted">{longDay(leg.pickupAt, zone)}</span>
            {beforePickup && !withdrawn && (
              <Countdown
                at={leg.pickupAt}
                initialNow={now}
                className="rounded-full bg-surface-soft px-2.5 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap text-body tabular-nums"
                soonClassName="bg-brand-soft text-brand-text"
                pastClassName="bg-warning/15 text-warning-text"
              />
            )}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
          {withdrawn ? (
            <span className="rounded-full bg-surface-soft px-2.5 py-1 text-[0.75rem] font-medium text-muted">
              {assignment.status === "DECLINED" ? "You declined this job" : "This job was reassigned"}
            </span>
          ) : (
            <TransferLegStatusBadge status={leg.status} label={driverLegStatusLabels[leg.status]} />
          )}
          {timeline && <JobProgressMeter assignment={assignment} className="min-w-40 flex-1 sm:max-w-72" />}
        </div>

        {!withdrawn && <JobNeeds booking={booking} className="mt-4" />}
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
        {/* First in the source, so a phone and a keyboard reach the buttons
            first; on a wide screen they take the right-hand column, with the
            timeline under them. */}
        {(controls || timeline) && (
          <div className="mb-6 space-y-4 lg:sticky lg:top-24 lg:order-last lg:mb-0">
            {controls && <AssignmentControls assignment={assignment} />}
            {timeline && <div className="hidden lg:block">{timelineCard("aside")}</div>}
          </div>
        )}

        <div className="space-y-4">
          {card(
            "job-route",
            "Route",
            <>
              {row(
                <MapPin size={17} />,
                "Pick up at",
                address(booking.pickupAddress ?? leg.from, booking.pickupPlace, "pick-up", Boolean(booking.pickupAddress)),
              )}
              {row(
                <MapPin size={17} />,
                "Drop off at",
                address(booking.dropoffAddress ?? leg.to, booking.dropoffPlace, "drop-off", Boolean(booking.dropoffAddress)),
              )}
              {row(<Clock size={17} />, "Journey", `${leg.distanceKm} km · about ${formatDuration(leg.durationMinutes)}`)}
              {!withdrawn &&
                row(
                  <CalendarClock size={17} />,
                  "Blocked in your diary",
                  <>
                    <bdi>
                      {formatTime(assignment.windowStart, zone)} – {formatTime(assignment.windowEnd, zone)}
                    </bdi>
                    <span className="mt-0.5 block text-[0.8125rem] text-muted">
                      <bdi>Includes the time set aside before the pick-up and after the drop-off.</bdi>
                    </span>
                  </>,
                )}
              {booking.flightNumber &&
                row(
                  <Plane size={17} />,
                  "Flight",
                  <>
                    <span className="font-mono">{booking.flightNumber}</span>
                    {!finished && (
                      <span className="mt-2 flex">
                        <a
                          href={flightTrackerUrl(booking.flightNumber)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(SECONDARY_LINK, "text-body hover:border-ink/40 hover:text-ink")}
                        >
                          <ExternalLink size={15} className="rtl:-scale-x-100" aria-hidden />
                          Track the flight
                          <span className="sr-only"> (opens Flightradar24)</span>
                        </a>
                      </span>
                    )}
                  </>,
                )}
            </>,
          )}

          {card(
            "job-passengers",
            "Passengers",
            <>
              {row(
                <UserRound size={17} />,
                "Lead passenger",
                <>
                  <span className="block wrap-break-word">
                    <bdi>{booking.leadPassengerName}</bdi>
                  </span>
                  {!finished && (
                    <span className="mt-2 flex flex-wrap gap-2">
                      {booking.leadPassengerPhone && (
                        <a
                          href={`tel:${booking.leadPassengerPhone}`}
                          className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-brand-soft px-3.5 text-[0.9375rem] font-medium text-brand-text tabular-nums transition-colors hover:bg-brand/15"
                        >
                          <Phone size={16} aria-hidden />
                          <span className="sr-only">Call </span>
                          <span dir="ltr">{booking.leadPassengerPhone}</span>
                        </a>
                      )}
                      <NameSign name={booking.leadPassengerName} />
                    </span>
                  )}
                  {!finished && !booking.leadPassengerPhone && (
                    <span className="mt-2 block text-[0.8125rem] text-muted">
                      <bdi>The passenger&apos;s number appears here closer to the pick-up.</bdi>
                    </span>
                  )}
                </>,
              )}
              {row(
                <Users size={17} />,
                "Passengers",
                `${booking.adults} ${booking.adults === 1 ? "adult" : "adults"}${
                  booking.children > 0 ? `, ${booking.children} ${booking.children === 1 ? "child" : "children"}` : ""
                }`,
              )}
              {booking.childAges.length > 0 && row(<Baby size={17} />, "Child ages", booking.childAges.join(", "))}
              {row(<Briefcase size={17} />, "Luggage", `${booking.luggage} large, ${booking.cabinBags} cabin`)}
              {booking.specialRequests &&
                row(
                  <MessageSquareText size={17} />,
                  "Requests",
                  <span dir="auto" className="whitespace-pre-line wrap-break-word">
                    {booking.specialRequests}
                  </span>,
                  "job-requests",
                )}
              {booking.extras.length > 0 &&
                row(
                  <PackagePlus size={17} />,
                  "Extras",
                  booking.extras
                    .map((extra) => `${extra.name}${extra.quantity > 1 ? ` × ${extra.quantity}` : ""}`)
                    .join(", "),
                )}
            </>,
          )}

          {card(
            "job-car",
            "Car",
            <>
              {row(
                <Car size={17} />,
                "Car",
                vehicle ? (
                  <>
                    {vehicle.colour && <span className="text-body">{vehicle.colour} </span>}
                    {vehicle.make} {vehicle.model}{" "}
                    <span className="ms-1 inline-block rounded-xs border border-line px-1.5 py-0.5 font-mono text-[0.8125rem] whitespace-nowrap">
                      {vehicle.plateNumber}
                    </span>
                  </>
                ) : (
                  `${booking.vehicleClassName ?? "Any"} — dispatch will confirm the car`
                ),
              )}
              {assignment.dispatcherNotes &&
                row(
                  <Headset size={17} />,
                  "From dispatch",
                  <span dir="auto" className="whitespace-pre-line wrap-break-word">
                    {assignment.dispatcherNotes}
                  </span>,
                )}
            </>,
          )}

          {timeline && <div className="lg:hidden">{timelineCard("end")}</div>}
        </div>
      </div>
    </>
  );
}
