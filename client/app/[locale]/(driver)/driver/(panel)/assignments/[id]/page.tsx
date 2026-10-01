import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Baby, Briefcase, Car, Clock, MapPin, Navigation, Phone, Plane, Users } from "lucide-react";

import { TransferLegStatusBadge } from "@/components/admin/DispatchBadges";
import { AssignmentControls } from "@/components/driver/AssignmentControls";
import { ApiError } from "@/lib/api/client";
import { getDriverAssignment } from "@/lib/api/driverPanel";
import { driverLegStatusLabels, formatPickup } from "@/lib/admin/dispatch";
import { mapsDirectionsUrl } from "@/lib/geo/place";
import { getI18n } from "@/lib/i18n/server";
import type { DriverAssignment } from "@/types/driver";
import type { PlacedLocation } from "@/types/geo";

export const metadata: Metadata = { title: "Transfer" };

/**
 * One job, everything the driver needs and nothing they do not: where, when,
 * who, how many, what they asked for — and the one button that moves it on.
 */
export default async function DriverAssignmentPage({
  params,
}: PageProps<"/[locale]/driver/assignments/[id]">) {
  const { id } = await params;
  const { path } = await getI18n();

  let assignment: DriverAssignment;

  try {
    assignment = await getDriverAssignment(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { leg, booking, vehicle } = assignment;
  const withdrawn = ["DECLINED", "REVOKED"].includes(assignment.status);

  /**
   * The address, with a directions link when the traveller picked a real
   * door at checkout. A phone opens it in whichever maps app it has; a
   * booking made before place search existed simply has no link.
   */
  const withNavigation = (text: string, place: PlacedLocation | null) =>
    place ? (
      <>
        {text}
        <a
          href={mapsDirectionsUrl(place.latitude, place.longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
        >
          <Navigation size={13} aria-hidden />
          Navigate
        </a>
      </>
    ) : (
      text
    );

  const row = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 shrink-0 text-subtle">{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.75rem] text-muted">{label}</p>
        <div className="text-[0.9375rem] text-ink">{value}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href={path("/driver")} className="inline-flex items-center gap-2 text-[0.8125rem] text-muted hover:text-ink">
        <ArrowLeft size={15} className="rtl:-scale-x-100" aria-hidden />
        Back
      </Link>

      <header>
        <p className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{booking.reference}</p>
        <h1 className="mt-1 text-[1.375rem] leading-tight font-semibold text-ink">
          {leg.from} → {leg.to}
        </h1>
        <p className="mt-2 text-[1.0625rem] text-ink tabular-nums">{formatPickup(leg.pickupAt, leg.timezone)}</p>
        <div className="mt-3">
          {withdrawn ? (
            <span className="rounded-full bg-surface-soft px-2.5 py-1 text-[0.75rem] font-medium text-muted">
              {assignment.status === "DECLINED" ? "You declined this job" : "This job was reassigned"}
            </span>
          ) : (
            <TransferLegStatusBadge status={leg.status} label={driverLegStatusLabels[leg.status]} />
          )}
        </div>
      </header>

      {!withdrawn && <AssignmentControls assignment={assignment} />}

      <section className="divide-y divide-line rounded-sm border border-line bg-surface px-4" aria-label="Pick-up details">
        {row(<MapPin size={16} aria-hidden />, "Pick up at", withNavigation(booking.pickupAddress ?? leg.from, booking.pickupPlace))}
        {row(<MapPin size={16} aria-hidden />, "Drop off at", withNavigation(booking.dropoffAddress ?? leg.to, booking.dropoffPlace))}
        {row(<Clock size={16} aria-hidden />, "Journey", `${leg.distanceKm} km · about ${leg.durationMinutes} min`)}
        {booking.flightNumber && row(<Plane size={16} aria-hidden />, "Flight", booking.flightNumber)}
      </section>

      <section className="divide-y divide-line rounded-sm border border-line bg-surface px-4" aria-label="Passengers">
        {row(
          <Users size={16} aria-hidden />,
          "Passengers",
          `${booking.adults} adults${booking.children > 0 ? `, ${booking.children} children` : ""}`,
        )}
        {booking.childAges.length > 0 && row(<Baby size={16} aria-hidden />, "Child ages", booking.childAges.join(", "))}
        {row(<Briefcase size={16} aria-hidden />, "Luggage", `${booking.luggage} large, ${booking.cabinBags} cabin`)}
        {row(
          <Phone size={16} aria-hidden />,
          "Lead passenger",
          <>
            {booking.leadPassengerName}
            {booking.leadPassengerPhone && (
              <a href={`tel:${booking.leadPassengerPhone}`} className="mt-1 block font-medium text-brand-text underline-offset-4 hover:underline">
                {booking.leadPassengerPhone}
              </a>
            )}
          </>,
        )}
        {booking.specialRequests && row(<Users size={16} aria-hidden />, "Requests", booking.specialRequests)}
        {booking.extras.length > 0 &&
          row(<Users size={16} aria-hidden />, "Extras", booking.extras.map((extra) => `${extra.name}${extra.quantity > 1 ? ` × ${extra.quantity}` : ""}`).join(", "))}
      </section>

      <section className="divide-y divide-line rounded-sm border border-line bg-surface px-4" aria-label="Car">
        {row(
          <Car size={16} aria-hidden />,
          "Car",
          vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.plateNumber}` : `${booking.vehicleClassName ?? "Any"} — dispatch will confirm the car`,
        )}
        {assignment.dispatcherNotes && row(<Users size={16} aria-hidden />, "From dispatch", assignment.dispatcherNotes)}
      </section>
    </div>
  );
}
