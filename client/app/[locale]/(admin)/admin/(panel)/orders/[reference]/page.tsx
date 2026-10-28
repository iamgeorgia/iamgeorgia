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
import { OrderActions } from "@/components/admin/OrderActions";
import { OrderParts } from "@/components/admin/OrderParts";
import { OrderStatusBadge } from "@/components/admin/StatusBadge";
import { getAdminOrder, getAdminOrderCancellationQuote } from "@/lib/api/orders";
import { ApiError } from "@/lib/api/client";
import { bookingSourceLabel, formatInstant } from "@/lib/admin/bookings";
import {
  componentTypeLabels,
  formatOrderDates,
  formatOrderParty,
  orderItemStatusLabels,
  orderKindLabels,
} from "@/lib/admin/orders";
import { formatMoney } from "@/lib/money";
import { getI18n } from "@/lib/i18n/server";
import type { OrderCancellationQuote } from "@/types/order";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Order" };

/**
 * One order, whole.
 *
 * Deliberately not `components/packages/OrderDetail`. That component is the
 * buyer's view of the same record — it renders the customer dictionary in the
 * reader's language, links each part to the guest's manage page, and hides
 * the cost figures — where this panel is English-only, links into the admin
 * registers and exists mainly to show margin and to act on the parts. The
 * parts list itself is the shared `OrderItems`, through `OrderParts`, so the
 * references an operator reads out over the phone are the ones the buyer is
 * looking at.
 */
export default async function AdminOrderPage({
  params,
}: PageProps<"/[locale]/admin/orders/[reference]">) {
  await requireScreen();
  const { reference } = await params;
  const { path } = await getI18n();

  let order;

  try {
    order = await getAdminOrder(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // An order with nothing live left has nothing to price, and the server says
  // so with an error rather than a zero. That is not a reason to fail the page.
  let quote: OrderCancellationQuote | null = null;

  try {
    quote = await getAdminOrderCancellationQuote(order.reference);
  } catch {
    quote = null;
  }

  const net = order.items.some((item) => typeof item.netCents === "number");
  const live = order.items.filter(
    (item) => item.status !== "CANCELLED" && item.status !== "DECLINED",
  );

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Orders", href: path("/admin/orders") }, { label: order.reference }]}
      />

      <AdminPageHeader
        title={order.reference}
        description={`${order.package.name ?? "Built to order"} · ${formatOrderDates(order.startDate, order.endDate)}`}
        actions={<OrderStatusBadge status={order.status} />}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-6 lg:col-span-2">
          <AdminPanel title="Trip">
            <AdminDefinitionList
              items={[
                {
                  label: "Package",
                  value: order.package.slug ? (
                    <Link
                      href={path(`/admin/packages/${order.package.slug}`)}
                      className="underline-offset-4 hover:underline"
                    >
                      {order.package.name ?? order.package.slug}
                    </Link>
                  ) : (
                    (order.package.name ?? "—")
                  ),
                },
                { label: "Kind", value: orderKindLabels[order.kind] },
                { label: "Travelling", value: formatOrderDates(order.startDate, order.endDate) },
                {
                  label: "Party",
                  value: formatOrderParty(order.adults, order.childAges, order.rooms),
                },
                {
                  label: "Parts",
                  value: `${order.itemCount} booked · ${live.length} still live`,
                },
                ...(order.requestDeadlineAt
                  ? [{ label: "Answers due", value: formatInstant(order.requestDeadlineAt) }]
                  : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel
            title="Parts"
            description="Each part is its own booking with its own reference and its own terms."
          >
            <OrderParts order={order} quote={quote} />
          </AdminPanel>

          <AdminPanel
            title="Price"
            description="Frozen at confirmation; the suppliers' sheets may have moved since."
          >
            <div className="rounded-sm border border-line">
              <DataTable
                columns={[
                  { label: "Part" },
                  { label: "Status" },
                  ...(net ? [{ label: "Cost", align: "end" as const }] : []),
                  { label: "Price", align: "end" },
                ]}
                caption="Price lines"
              >
                {order.items.map((item) => (
                  <Row key={item.slotIndex}>
                    <Cell>
                      {item.label}
                      <span className="block text-[0.75rem] text-muted">
                        {componentTypeLabels[item.componentType]}
                        {!item.required && " · optional"}
                      </span>
                    </Cell>
                    <Cell className="text-[0.8125rem] text-muted">
                      {orderItemStatusLabels[item.status]}
                    </Cell>
                    {net && (
                      <Cell align="end" className="tabular-nums text-muted">
                        {typeof item.netCents === "number"
                          ? formatMoney(item.netCents, order.currency)
                          : "—"}
                      </Cell>
                    )}
                    <Cell align="end" className="tabular-nums">
                      {formatMoney(item.lineTotalCents, order.currency)}
                    </Cell>
                  </Row>
                ))}
              </DataTable>
            </div>
            <AdminDefinitionList
              className="mt-5"
              items={[
                ...(order.adjustmentCents !== 0
                  ? [
                      {
                        label: order.adjustmentCents < 0 ? "Package discount" : "Supplement",
                        value: formatMoney(order.adjustmentCents, order.currency),
                      },
                    ]
                  : []),
                { label: "Total", value: formatMoney(order.totalCents, order.currency) },
                ...(typeof order.componentsNetCents === "number"
                  ? [
                      {
                        label: "Cost",
                        value: formatMoney(order.componentsNetCents, order.currency),
                      },
                    ]
                  : []),
                ...(typeof order.marginCents === "number"
                  ? [{ label: "Margin", value: formatMoney(order.marginCents, order.currency) }]
                  : []),
                ...(order.cancellationChargeCents !== null
                  ? [
                      {
                        label: "Cancellation charge",
                        value: formatMoney(order.cancellationChargeCents, order.currency),
                      },
                    ]
                  : []),
              ]}
            />
          </AdminPanel>

          <AdminPanel title="Buyer">
            <AdminDefinitionList
              items={[
                { label: "Lead guest", value: order.leadName },
                { label: "Email", value: order.leadEmail },
                { label: "Phone", value: order.leadPhone ?? "—" },
                { label: "Requests", value: order.specialRequests ?? "None" },
                { label: "Source", value: bookingSourceLabel(order.source) },
                ...(order.partner
                  ? [
                      {
                        label: "Partner",
                        value: (
                          <Link
                            href={path(`/admin/partners/${order.partner.id}`)}
                            className="underline-offset-4 hover:underline"
                          >
                            {order.partner.name} ({order.partner.reference})
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
          {/* The platform's own gate on the whole order: its parts cannot be
              approved one at a time. Renders nothing when it never needed one. */}
          <BookingApprovalPanel
            product="ORDER"
            reference={order.reference}
            approval={order.approval}
            partnerName={order.partner?.name ?? null}
          />

          <BookingPaymentPanel payment={order.payment} currency={order.currency} />

          <BookingDeadlinesPanel
            product="ORDER"
            reference={order.reference}
            lastDate={order.endDate}
          />

          {/* The desk's fields: staff who may see the buyer only. */}
          <BookingDeskPanel product="ORDER" reference={order.reference} desk={order.desk} currency={order.currency} />

          <AdminPanel title="Actions">
            <OrderActions order={order} quote={quote} />
          </AdminPanel>

          <AdminPanel title="Timeline">
            <AdminDefinitionList
              items={[
                { label: "Booked", value: formatInstant(order.createdAt) },
                { label: "Confirmed", value: formatInstant(order.confirmedAt) },
                { label: "Cancelled", value: formatInstant(order.cancelledAt) },
                { label: "Completed", value: formatInstant(order.completedAt) },
                ...(order.cancellationReason
                  ? [{ label: "Cancelled because", value: order.cancellationReason }]
                  : []),
              ]}
            />
          </AdminPanel>
        </div>
      </div>
    </AdminContainer>
  );
}
