import { TransferBookingStatusBadge, TransferLegStatusBadge } from "@/components/admin/DispatchBadges";
import Link from "next/link";

import { DriverCard } from "@/components/booking/DriverCard";
import { RateDriverForm } from "@/components/partners/RateDriverForm";
import { RouteName } from "@/components/ui/RouteName";
import { formatMoney } from "@/lib/money";
import type { AssignmentForPartner } from "@/types/driver";
import type { TransferBooking } from "@/types/transfer";

/**
 * A partner's transfer booking: the journey as it was sold, each leg's
 * progress, and — once a driver has accepted — who is coming.
 */
export function PortalTransferBooking({ booking, driverPath }: { booking: TransferBooking; driverPath: (id: string) => string }) {
  const instant = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: booking.route.fromTimezone }).format(
      new Date(iso),
    );

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TransferBookingStatusBadge status={booking.status} />
          <span className="text-[0.8125rem] text-muted">
            <bdi>
              {booking.passengers} passengers · {booking.luggage} bags · {booking.vehicle.name}
            </bdi>
          </span>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[0.875rem] sm:grid-cols-2">
          <div>
            <dt className="text-muted">Passenger</dt>
            <dd className="text-ink">{booking.leadPassengerName}</dd>
          </div>
          <div>
            <dt className="text-muted">Flight</dt>
            <dd className="text-ink">{booking.flightNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Pick-up address</dt>
            <dd className="text-ink">{booking.pickupAddress ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Total</dt>
            <dd className="text-ink">{formatMoney(booking.totalCents, booking.currency)}</dd>
          </div>
        </dl>
      </div>

      {booking.legs.map((leg) => (
        <article key={leg.id} className="rounded-md border border-line bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.75rem] font-semibold tracking-wide text-muted uppercase">
                {leg.direction === "RETURN" ? "Return" : "Outbound"}
              </p>
              <p className="mt-1 text-[1.0625rem] font-medium text-ink">
                <RouteName from={leg.from} to={leg.to} />
              </p>
              <p className="text-[0.8125rem] text-muted tabular-nums">
                <bdi>{instant(leg.pickupAt)}</bdi>
              </p>
            </div>
            <TransferLegStatusBadge status={leg.status} />
          </div>

          {leg.assignment ? (
            <div className="mt-4 space-y-4">
              {(leg.assignment as AssignmentForPartner).awaitingDriver && (
                <p className="text-[0.8125rem] text-muted">
                  You asked for this driver at booking. They have been offered the job and will
                  appear as confirmed once they accept; if they cannot take it, dispatch assigns
                  another.
                </p>
              )}
              <DriverCard
                assignment={leg.assignment as AssignmentForPartner}
                heading={(leg.assignment as AssignmentForPartner).awaitingDriver ? "Requested driver · awaiting confirmation" : undefined}
              />
              <Link
                href={driverPath((leg.assignment as AssignmentForPartner).driver.id)}
                className="inline-block text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
              >
                View the driver&apos;s profile and reviews
              </Link>
              {leg.status === "COMPLETED" &&
                (leg.rating ? (
                  <p className="text-[0.8125rem] text-muted">You rated this driver {leg.rating.score}/5.</p>
                ) : (
                  <div className="rounded-sm border border-line bg-background p-4">
                    <RateDriverForm reference={booking.reference} legIndex={leg.legIndex} />
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-4 text-[0.8125rem] text-muted">
              {leg.status === "CANCELLED"
                ? "This leg was cancelled."
                : "A driver will appear here once one has confirmed the job."}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
