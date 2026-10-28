import { PrintButton } from "@/components/booking/PrintButton";
import { CancelOrder } from "@/components/packages/CancelOrder";
import { OrderDetail } from "@/components/packages/OrderDetail";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { getOrderCancellationQuote } from "@/lib/api/orders";
import { getI18n } from "@/lib/i18n/server";
import type { Order, OrderCancellationQuote } from "@/types/order";

interface OrderManageViewProps {
  order: Order;
  /** A guest's proof. Omitted for a signed-in partner. */
  email?: string;
  /** The portal renders the same view under its own breadcrumb trail. */
  basePath?: string;
}

/**
 * A buyer's own trip: what they booked, and what they can still do to it.
 *
 * Two cancellations live here and they are different actions. Dropping one
 * optional part leaves the rest standing and forfeits that part's share of
 * the package discount; cancelling the trip releases everything. Both are
 * priced by the server off figures frozen at confirmation, so the number on
 * the screen is the number that will be charged.
 */
export async function OrderManageView({ order, email, basePath }: OrderManageViewProps) {
  const { t, path } = await getI18n();

  let quote: OrderCancellationQuote | null = null;
  const live =
    order.status === "PENDING_APPROVAL" ||
    order.status === "PENDING_CONFIRMATION" ||
    order.status === "CONFIRMED" ||
    order.status === "PARTIALLY_CANCELLED";

  if (live) {
    try {
      quote = await getOrderCancellationQuote(order.reference, email);
    } catch {
      // A trip with nothing left to cancel simply has no quote.
      quote = null;
    }
  }

  const crumbs = basePath
    ? [{ label: t.orders.nav.manage, href: path(basePath) }, { label: order.reference }]
    : [
        { label: t.common.home, href: path("/") },
        { label: t.booking.manage.crumb, href: path("/booking/manage") },
        { label: order.reference },
      ];

  return (
    <Container className="pt-8 pb-24 lg:pb-32">
      <Breadcrumbs items={crumbs} />

      <h1 className="type-h1 mt-6">{t.orders.nav.manage}</h1>

      <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-8">
          <OrderDetail order={order} cancel={live ? { quote, email } : null} />
        </div>

        <aside className="lg:col-span-4">
          <div className="flex flex-col gap-5 lg:sticky lg:top-36">
            <CancelOrder
              reference={order.reference}
              email={email}
              status={order.status}
              currency={order.currency}
              quote={quote}
            />
            <PrintButton label={t.booking.confirmation.print} />
          </div>
        </aside>
      </div>
    </Container>
  );
}
