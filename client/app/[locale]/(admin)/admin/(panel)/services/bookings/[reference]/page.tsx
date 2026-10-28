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
import { Cell, DataTable, Row } from "@/components/admin/DataTable";
import { ServiceBookingActions } from "@/components/admin/ServiceBookingActions";
import { ServiceBookingStatusBadge } from "@/components/admin/StatusBadge";
import { getAdminServiceBooking, getAdminServiceCancellationQuote } from "@/lib/api/services";
import { ApiError } from "@/lib/api/client";
import { bookingSourceLabel, formatInstant } from "@/lib/admin/bookings";
import {
  confirmationModeLabels,
  formatServiceDates,
  serviceBasisLabels,
  serviceCategoryLabels,
} from "@/lib/admin/services";
import { formatBps, formatMoney } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import type { CancellationQuote } from "@/types/booking";

export const metadata: Metadata = { title: "Service booking" };

/**
 * One service booking, read from the snapshot taken at confirmation. The
 * only live things on the page are the status, the answers beside it, and
 * the desk's own fields.
 */
export default async function AdminServiceBookingPage({ params }: PageProps<"/[locale]/admin/services/bookings/[reference]">) {
  await requireScreen();
  const { reference } = await params;
  const { path } = await getI18n();

  let booking;

  try {
    booking = await getAdminServiceBooking(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  let quote: CancellationQuote | null = null;

  if (booking.status === "CONFIRMED" || booking.status === "PENDING") {
    try {
      quote = await getAdminServiceCancellationQuote(booking.reference);
    } catch {
      quote = null;
    }
  }

  const snapshot = booking.serviceSnapshot ?? {};
  const name = booking.service.name ?? snapshot.name ?? "Service";
  const net = booking.netTotalCents !== undefined;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Service bookings", href: path("/admin/services/bookings") }, { label: booking.reference }]}
      />

      <AdminPageHeader
        title={booking.reference}
        description={`${name} · ${formatServiceDates(booking.date, booking.endDate, booking.days)}`}
        actions={<ServiceBookingStatusBadge status={booking.status} />}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-6 lg:col-span-2">
          <AdminPanel title="Service">
            <AdminDefinitionList
              items={[
                {
                  label: "Service",
                  value: (
                    <Link href={path(`/admin/services/${booking.service.id}`)} className="underline-offset-4 hover:underline">
                      {name}
                    </Link>
                  ),
                },
                ...(booking.service.category ? [{ label: "Category", value: serviceCategoryLabels[booking.service.category] }] : []),
                ...(snapshot.basis ? [{ label: "Priced", value: serviceBasisLabels[snapshot.basis] }] : []),
                { label: "Date", value: formatServiceDates(booking.date, booking.endDate, booking.days) },
                { label: "Starts", value: booking.startAt ? formatInstant(booking.startAt) : "Time not set" },
                { label: "People", value: String(booking.pax) },
                { label: "Quantity", value: String(booking.quantity) },
                { label: "Days", value: String(booking.days) },
                ...(snapshot.supplierName ? [{ label: "Supplier", value: snapshot.supplierName }] : []),
                { label: "Confirmation", value: confirmationModeLabels[booking.confirmationMode] },
                ...(booking.requestDeadlineAt ? [{ label: "Answer due", value: formatInstant(booking.requestDeadlineAt) }] : []),
                ...(booking.declineReason ? [{ label: "Declined because", value: booking.declineReason }] : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Price" description="Frozen at confirmation; the supplier's sheet may have moved since.">
            <AdminDefinitionList
              items={[
                { label: "Total", value: formatMoney(booking.totalCents, booking.currency) },
                ...(net
                  ? [
                      { label: "Cost", value: formatMoney(booking.netTotalCents!, booking.currency) },
                      ...(booking.marginCents !== undefined
                        ? [
                            {
                              label: "Margin",
                              value: `${formatMoney(booking.marginCents, booking.currency)}${
                                booking.markupBps !== undefined ? ` (${formatBps(booking.markupBps)})` : ""
                              }`,
                            },
                          ]
                        : []),
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

            {booking.cancellation.windows.length > 0 && (
              <div className="mt-5 rounded-sm border border-line">
                <DataTable
                  columns={[{ label: "From" }, { label: "Until" }, { label: "Charge", align: "end" }]}
                  caption="Cancellation windows"
                >
                  {booking.cancellation.windows.map((window, index) => (
                    <Row key={index}>
                      <Cell>{window.fromAt ? formatInstant(window.fromAt) : "Booking made"}</Cell>
                      <Cell>{window.toAt ? formatInstant(window.toAt) : "After the service"}</Cell>
                      <Cell align="end" className="tabular-nums">
                        {formatMoney(window.chargeCents, booking.currency)}
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              </div>
            )}
          </AdminPanel>

          <AdminPanel title="Lead">
            <AdminDefinitionList
              items={[
                { label: "Name", value: booking.leadName },
                {
                  label: "Email",
                  value: (
                    <a href={`mailto:${booking.leadEmail}`} className="text-ink underline-offset-4 hover:underline">
                      {booking.leadEmail}
                    </a>
                  ),
                },
                { label: "Phone", value: booking.leadPhone ?? "—" },
                { label: "Notes", value: booking.notes ?? "None" },
                { label: "Source", value: bookingSourceLabel(booking.source) },
                ...(booking.partner
                  ? [
                      {
                        label: "Partner",
                        value: (
                          <Link href={path(`/admin/partners/${booking.partner.id}`)} className="underline-offset-4 hover:underline">
                            {booking.partner.name} ({booking.partner.reference})
                          </Link>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </AdminPanel>
        </div>

        <div className="flex flex-col gap-6">
          {/* The platform's own gate, before the supplier is asked. Renders
              nothing on a booking that never needed it. */}
          <BookingApprovalPanel
            product="SERVICE"
            reference={booking.reference}
            approval={booking.approval}
            partnerName={booking.partner?.name ?? null}
          />

          <BookingPaymentPanel payment={booking.payment} currency={booking.currency} />

          <BookingDeadlinesPanel
            product="SERVICE"
            reference={booking.reference}
            lastDate={booking.endDate}
          />

          {/* The desk's fields: staff who may see the buyer only. */}
          <BookingDeskPanel product="SERVICE" reference={booking.reference} desk={booking.desk} currency={booking.currency} />

          <AdminPanel title="Actions">
            <ServiceBookingActions booking={booking} quote={quote} />
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
