import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { BookingApprovalPanel } from "@/components/admin/BookingApprovalPanel";
import { BookingDeadlinesPanel } from "@/components/admin/BookingDeadlinesPanel";
import { BookingDeskPanel } from "@/components/admin/BookingDeskPanel";
import { BookingPaymentPanel } from "@/components/admin/BookingPaymentPanel";
import { Cell, DataTable, Row } from "@/components/admin/DataTable";
import { TransferBookingStatusBadge, TransferLegStatusBadge } from "@/components/admin/DispatchBadges";
import { LegActions } from "@/components/admin/LegActions";
import { ReadOnlyNote } from "@/components/admin/ReadOnlyNote";
import { listDispatchLegs } from "@/lib/api/dispatch";
import { formatPickup } from "@/lib/admin/dispatch";
import { ApiError } from "@/lib/api/client";
import { getAdminTransferBooking } from "@/lib/api/transfers";
import { getI18n } from "@/lib/i18n/server";
import { formatBps, formatMoney } from "@/lib/money";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Transfer booking" };

/**
 * One transfer booking, as it was sold.
 *
 * Everything here reads the snapshots rather than the live catalogue, which is
 * the point of taking them: a route renamed in March must not change what a
 * January voucher says. The net figures and the margin are visible because this
 * screen is admin-only and the API sends them only to staff.
 */
export default async function AdminTransferBookingPage({
  params,
}: PageProps<"/[locale]/admin/transfers/bookings/[reference]">) {
  const session = await requireScreen();
  const { reference } = await params;
  const { path } = await getI18n();

  let booking;

  try {
    booking = await getAdminTransferBooking(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { route, vehicle } = booking;

  // The operational side of each leg, from the dispatch board's own endpoint,
  // so the actions here are exactly the ones the board offers.
  const dispatch = await listDispatchLegs({ search: booking.reference, pageSize: 10 });
  const legs = dispatch.data.filter((leg) => leg.booking.reference === booking.reference);

  const instant = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: route.fromTimezone,
    }).format(new Date(iso));

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Transfer bookings", href: path("/admin/transfers/bookings") },
          { label: booking.reference },
        ]}
      />

      <AdminPageHeader
        title={booking.reference}
        description={`${route.fromName} → ${route.toName}`}
        actions={<TransferBookingStatusBadge status={booking.status} />}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 space-y-8 lg:col-span-7">
          <AdminPanel title="Dispatch" description="Who is driving each leg, and where it stands.">
            {legs.length === 0 ? (
              <p className="text-[0.875rem] text-muted">No legs to dispatch.</p>
            ) : (
              <ul className="divide-y divide-line">
                {legs.map((leg) => (
                  <li key={leg.id} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-medium text-ink">
                        {leg.direction === "RETURN" ? "Return" : "Outbound"} · {formatPickup(leg.pickupAt, leg.timezone)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <TransferLegStatusBadge status={leg.status} />
                        {leg.assignment && (
                          <span className="text-[0.8125rem] text-muted">
                            {leg.assignment.driver.firstName} {leg.assignment.driver.lastName}
                            {leg.assignment.vehicle ? ` · ${leg.assignment.vehicle.plateNumber}` : ""}
                            {leg.assignment.overrides.length > 0 ? ` · overrides: ${leg.assignment.overrides.join(", ")}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <LegActions leg={leg} compact />
                  </li>
                ))}
              </ul>
            )}
            {/* The per-leg controls render nothing without the right; one line says why. */}
            {legs.length > 0 && !can(session, "dispatch.write") && (
              <ReadOnlyNote needs="dispatch.write" what="Assigning drivers and moving legs" className="mt-4" />
            )}
          </AdminPanel>

          <AdminPanel title="Legs" description="Each journey as it was priced.">
            <DataTable
              caption="Booking legs"
              columns={[
                { label: "Direction" },
                { label: "Journey" },
                { label: "Pick-up", hideBelow: "md" },
                { label: "Net", align: "end", hideBelow: "lg" },
                { label: "Sell", align: "end" },
              ]}
            >
              {booking.legs.map((leg) => (
                <Row key={leg.legIndex}>
                  <Cell>{leg.direction === "RETURN" ? "Return" : "Outbound"}</Cell>
                  <Cell>
                    {leg.from} → {leg.to}
                    <span className="type-caption mt-0.5 block text-subtle">
                      {leg.distanceKm} km · {Math.round(leg.durationMinutes / 5) * 5} min
                      {leg.flightNumber ? ` · flight ${leg.flightNumber}` : ""}
                    </span>
                  </Cell>
                  <Cell hideBelow="md" className="tabular-nums">
                    {instant(leg.pickupAt)}
                  </Cell>
                  <Cell align="end" hideBelow="lg" className="tabular-nums">
                    {leg.netCents === undefined
                      ? "—"
                      : formatMoney(leg.netCents, booking.currency)}
                  </Cell>
                  <Cell align="end" className="tabular-nums">
                    {formatMoney(leg.sellCents, booking.currency)}
                  </Cell>
                </Row>
              ))}
            </DataTable>
          </AdminPanel>

          {booking.extras.length > 0 && (
            <AdminPanel title="Extras" description="Frozen at the price quoted on the day.">
              <AdminDefinitionList
                items={booking.extras.map((extra) => ({
                  label: `${extra.name}${extra.quantity > 1 ? ` × ${extra.quantity}` : ""}`,
                  value: formatMoney(extra.totalCents, booking.currency),
                }))}
              />
            </AdminPanel>
          )}

          <AdminPanel title="Cancellation" description="The schedule frozen at confirmation.">
            <AdminDefinitionList
              items={[
                {
                  label: "Free until",
                  value: booking.cancellation.freeUntil
                    ? instant(booking.cancellation.freeUntil)
                    : "Not refundable",
                },
                ...(booking.cancellation.cancelledAt
                  ? [
                      {
                        label: "Cancelled",
                        value: instant(booking.cancellation.cancelledAt),
                      },
                      {
                        label: "Charged",
                        value: formatMoney(
                          booking.cancellation.chargeCents ?? 0,
                          booking.currency,
                        ),
                      },
                      { label: "Reason", value: booking.cancellation.reason ?? "—" },
                    ]
                  : []),
              ]}
            />
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-8 lg:col-span-5">
          {/* The platform's own gate, before any supplier is asked. Renders
              nothing on a booking that never needed it. */}
          <BookingApprovalPanel
            product="TRANSFER"
            reference={booking.reference}
            approval={booking.approval}
            partnerName={booking.partner?.name ?? null}
          />

          <BookingPaymentPanel payment={booking.payment} currency={booking.currency} />

          <BookingDeadlinesPanel
            product="TRANSFER"
            reference={booking.reference}
            lastDate={(booking.returnPickupAt ?? booking.pickupAt).slice(0, 10)}
          />

          {/* The desk's fields: staff who may see the buyer only. */}
          <BookingDeskPanel product="TRANSFER" reference={booking.reference} desk={booking.desk} currency={booking.currency} />

          <AdminPanel title="Passenger">
            <AdminDefinitionList
              items={[
                { label: "Name", value: booking.leadPassengerName },
                { label: "Email", value: booking.leadPassengerEmail },
                { label: "Phone", value: booking.leadPassengerPhone ?? "—" },
                { label: "Flight", value: booking.flightNumber ?? "—" },
                { label: "Party", value: `${booking.adults} adults, ${booking.children} children` },
                { label: "Luggage", value: `${booking.luggage} large, ${booking.cabinBags} cabin` },
                { label: "Pick-up address", value: booking.pickupAddress ?? "—" },
                { label: "Requests", value: booking.specialRequests ?? "—" },
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Vehicle, as sold">
            <AdminDefinitionList
              items={[
                { label: "Class", value: vehicle.name },
                { label: "Example", value: vehicle.vehicleExample },
                { label: "Supplier", value: vehicle.providerName ?? "—" },
                { label: "Kind", value: vehicle.kind === "SHARED" ? "Shared" : "Private" },
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Money">
            <AdminDefinitionList
              items={[
                {
                  label: "Net",
                  value:
                    booking.netTotalCents === undefined
                      ? "—"
                      : formatMoney(booking.netTotalCents, booking.currency),
                },
                { label: "Sell", value: formatMoney(booking.totalCents, booking.currency) },
                {
                  label: "Margin",
                  value:
                    booking.marginCents === undefined
                      ? "—"
                      : formatMoney(booking.marginCents, booking.currency),
                },
                {
                  label: "Markup",
                  value: booking.markupBps === undefined ? "—" : formatBps(booking.markupBps),
                },
                { label: "Partner", value: booking.partner?.name ?? booking.desk?.customer?.name ?? "Direct" },
              ]}
            />
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
