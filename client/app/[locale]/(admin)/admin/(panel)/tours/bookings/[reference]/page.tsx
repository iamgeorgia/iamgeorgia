import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

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
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { TourBookingStatusBadge } from "@/components/admin/StatusBadge";
import { TourBookingActions } from "@/components/admin/TourBookingActions";
import { getAdminTourBooking, getTourCancellationQuote } from "@/lib/api/tours";
import { ApiError } from "@/lib/api/client";
import { bookingSourceLabel, formatInstant, guestTitleLabel } from "@/lib/admin/bookings";
import { confirmationModeLabels, formatDeparture, formatTourParty } from "@/lib/admin/tours";
import { formatBps, formatMoney } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";
import type { TourCancellationQuote } from "@/types/tour";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Tour booking" };

const LINE_LABELS = { ADULT: "Adult", CHILD: "Child", INFANT: "Infant" } as const;

/**
 * One tour booking, read from the snapshot taken at confirmation. The only
 * live thing on the page is the status, and the three answers beside it.
 */
export default async function AdminTourBookingPage({ params }: PageProps<"/[locale]/admin/tours/bookings/[reference]">) {
  await requireScreen();
  const { reference } = await params;
  const { path } = await getI18n();

  let booking;

  try {
    booking = await getAdminTourBooking(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  let quote: TourCancellationQuote | null = null;

  if (booking.status === "CONFIRMED" || booking.status === "PENDING") {
    try {
      quote = await getTourCancellationQuote(booking.reference);
    } catch {
      quote = null;
    }
  }

  const snapshot = booking.tourSnapshot;
  const net = booking.netTotalCents !== undefined;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Tour bookings", href: path("/admin/tours/bookings") }, { label: booking.reference }]}
      />

      <AdminPageHeader
        title={booking.reference}
        description={`${snapshot.title} · ${formatDeparture(booking.date, booking.endDate)}`}
        actions={<TourBookingStatusBadge status={booking.status} />}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-6 lg:col-span-2">
          <AdminPanel title="Departure">
            <AdminDefinitionList
              items={[
                {
                  label: "Tour",
                  value: (
                    <Link href={path(`/admin/tours/${booking.tour.id}`)} className="underline-offset-4 hover:underline">
                      {snapshot.title}
                    </Link>
                  ),
                },
                { label: "Option", value: booking.option ? `${booking.option.name} (${booking.option.code})` : "—" },
                { label: "Departs", value: formatDeparture(booking.date, booking.endDate) },
                { label: "Starts", value: `${formatInstant(booking.startAt)}${snapshot.timezone ? ` (${snapshot.timezone})` : ""}` },
                { label: "Party", value: formatTourParty(booking.adults, booking.childAges) },
                { label: "Units claimed", value: `${booking.units} ${snapshot.option?.unitKind === "GROUP" ? "group" : booking.units === 1 ? "seat" : "seats"}` },
                { label: "Meeting point", value: snapshot.meetingPoint ?? "—" },
                { label: "Confirmation", value: confirmationModeLabels[booking.confirmationMode] },
                ...(booking.requestDeadlineAt ? [{ label: "Answer due", value: formatInstant(booking.requestDeadlineAt) }] : []),
                ...(booking.declineReason ? [{ label: "Declined because", value: booking.declineReason }] : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Travellers" bodyClassName="p-0">
            <DataTable
              columns={[{ label: "Name" }, { label: "Type" }, { label: "Passport", hideBelow: "md" }, { label: "Dietary", hideBelow: "lg" }, { label: "Price", align: "end" }]}
              caption="Travellers on this booking"
            >
              {booking.travellers.length === 0 ? (
                <EmptyRow colSpan={5} message="No traveller names were given." />
              ) : (
                booking.travellers.map((traveller) => (
                  <Row key={traveller.id}>
                    <Cell>
                      {guestTitleLabel(traveller.title)}
                      {traveller.firstName} {traveller.lastName}
                      {traveller.isLead && <span className="ms-2 text-[0.75rem] text-muted">lead</span>}
                    </Cell>
                    <Cell>
                      {LINE_LABELS[traveller.type]}
                      {traveller.age !== null && ` · ${traveller.age}`}
                    </Cell>
                    <Cell hideBelow="md">
                      {traveller.passportNumber ?? "—"}
                      {traveller.nationality && ` (${traveller.nationality})`}
                    </Cell>
                    <Cell hideBelow="lg">{traveller.dietary ?? "—"}</Cell>
                    <Cell align="end" className="tabular-nums">{formatMoney(traveller.unitSellCents, booking.currency)}</Cell>
                  </Row>
                ))
              )}
            </DataTable>
          </AdminPanel>

          <AdminPanel title="Price" description="Frozen at confirmation; the operator's sheet may have moved since.">
            <div className="rounded-sm border border-line">
              <DataTable
                columns={[{ label: "Line" }, ...(net ? [{ label: "Cost", align: "end" as const }] : []), { label: "Price", align: "end" }]}
                caption="Price lines"
              >
                {booking.priceLines.map((line) => (
                  <Row key={line.travellerType}>
                    <Cell>
                      {snapshot.option?.pricingBasis === "PER_GROUP" ? "Group" : `${line.count} × ${LINE_LABELS[line.travellerType]}`}
                    </Cell>
                    {net && (
                      <Cell align="end" className="tabular-nums text-muted">
                        {line.netCents !== undefined ? formatMoney(line.netCents, booking.currency) : "—"}
                      </Cell>
                    )}
                    <Cell align="end" className="tabular-nums">{formatMoney(line.sellCents, booking.currency)}</Cell>
                  </Row>
                ))}
              </DataTable>
            </div>
            <AdminDefinitionList
              className="mt-5"
              items={[
                { label: "Total", value: formatMoney(booking.totalCents, booking.currency) },
                ...(net
                  ? [
                      { label: "Cost", value: formatMoney(booking.netTotalCents!, booking.currency) },
                      { label: "Margin", value: `${formatMoney(booking.marginCents!, booking.currency)} (${formatBps(booking.markupBps!)})` },
                    ]
                  : []),
                {
                  label: "Free cancellation until",
                  value: booking.cancellation.freeUntil ? formatInstant(booking.cancellation.freeUntil) : "Non-refundable",
                },
                ...(booking.cancellation.chargeCents !== null
                  ? [{ label: "Cancellation charge", value: formatMoney(booking.cancellation.chargeCents, booking.currency) }]
                  : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Lead traveller">
            <AdminDefinitionList
              items={[
                { label: "Name", value: booking.leadTravellerName },
                { label: "Email", value: booking.leadTravellerEmail },
                { label: "Phone", value: booking.leadTravellerPhone ?? "—" },
                { label: "Pick-up", value: booking.pickupNote ?? "—" },
                { label: "Requests", value: booking.specialRequests ?? "None" },
                { label: "Source", value: bookingSourceLabel(booking.source) },
                ...(booking.partner ? [{ label: "Partner", value: `${booking.partner.name} (${booking.partner.reference})` }] : []),
              ]}
            />
          </AdminPanel>
        </div>

        <div className="flex flex-col gap-6">
          {/* The platform's own gate, before the operator is asked. Renders
              nothing on a booking that never needed it. */}
          <BookingApprovalPanel
            product="TOUR"
            reference={booking.reference}
            approval={booking.approval}
            partnerName={booking.partner?.name ?? null}
          />

          <BookingPaymentPanel payment={booking.payment} currency={booking.currency} />

          <BookingDeadlinesPanel
            product="TOUR"
            reference={booking.reference}
            lastDate={booking.endDate}
          />

          {/* The desk's fields: staff who may see the buyer only. */}
          <BookingDeskPanel product="TOUR" reference={booking.reference} desk={booking.desk} currency={booking.currency} />

          <AdminPanel title="Actions">
            <TourBookingActions booking={booking} quote={quote} />
          </AdminPanel>

          <AdminPanel title="Timeline">
            <AdminDefinitionList
              items={[
                { label: "Booked", value: formatInstant(booking.createdAt) },
                { label: "Confirmed", value: formatInstant(booking.confirmedAt) },
                { label: "Declined", value: formatInstant(booking.declinedAt) },
                { label: "Cancelled", value: formatInstant(booking.cancelledAt) },
              ]}
            />
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
