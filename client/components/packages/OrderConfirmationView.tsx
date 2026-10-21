import { CircleCheck, Clock } from "lucide-react";

import { BookingSteps } from "@/components/booking/BookingSteps";
import { PrintButton } from "@/components/booking/PrintButton";
import { OrderDetail } from "@/components/packages/OrderDetail";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { formatStayDate } from "@/lib/booking/stay";
import { getI18n } from "@/lib/i18n/server";
import type { Order } from "@/types/order";

/**
 * An order, one step after it was made.
 *
 * Two headlines, because two things can have happened. Everything instant is
 * booked outright and will not change; anything on request is claimed and
 * awaiting an operator. Telling a buyer their trip is booked when a guide has
 * not yet said yes is the one thing this page must never do — but nor should
 * it call the whole trip provisional when three of its four parts are firm,
 * which is why the subtitle says where the uncertainty actually sits.
 */
export async function OrderConfirmationView({ order }: { order: Order }) {
  const { t, intlLocale, fill, path } = await getI18n();
  // Both are "not yet confirmed" to the buyer: waiting for the platform's yes
  // reads the same as waiting for a supplier's.
  const requested = order.status === "PENDING_APPROVAL" || order.status === "PENDING_CONFIRMATION";
  const steps = requested ? t.orders.confirmation.requestedSteps : t.orders.confirmation.whatNextSteps;

  const manageHref = path(
    `/booking/manage/${order.reference}?email=${encodeURIComponent(order.leadEmail)}`,
  );

  return (
    <Container className="pt-10 pb-24 lg:pb-32">
      <BookingSteps current="confirm" labels={t.orders.checkout.steps} />

      <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <span
          className={
            requested
              ? "flex size-14 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning-text"
              : "flex size-14 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
          }
        >
          {requested ? <Clock size={26} aria-hidden /> : <CircleCheck size={26} aria-hidden />}
        </span>
        <div className="min-w-0">
          <h1 className="type-h1">
            {requested ? t.orders.confirmation.requestedTitle : t.orders.confirmation.title}
          </h1>
          <p className="type-body-lg mt-2 text-muted">
            {requested
              ? fill(t.orders.confirmation.requestedSubtitle, {
                  package: order.package.name ?? "",
                  date: formatStayDate(order.startDate, intlLocale),
                })
              : fill(t.orders.confirmation.subtitle, {
                  package: order.package.name ?? "",
                  dates: `${formatStayDate(order.startDate, intlLocale)} – ${formatStayDate(order.endDate, intlLocale)}`,
                })}
          </p>
        </div>
      </div>

      <p className="type-body mt-6 text-body">
        {fill(t.orders.confirmation.emailedTo, { email: order.leadEmail })}
      </p>
      <p className="type-caption mt-1.5 text-subtle">{t.orders.confirmation.referenceHint}</p>

      <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="min-w-0 lg:col-span-8">
          <OrderDetail order={order} />
        </div>

        <aside className="lg:col-span-4">
          <div className="border border-line bg-surface p-6 shadow-card lg:sticky lg:top-36">
            <h2 className="type-h4">{t.orders.confirmation.whatNext}</h2>
            <ol className="mt-4 space-y-3">
              {([steps.one, steps.two, steps.three] as const).map((step, index) => (
                <li key={step} className="type-body-sm flex gap-3 text-body">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-[0.6875rem] font-semibold tabular-nums text-muted">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-col gap-3">
              <Button href={manageHref} fullWidth>
                {t.orders.confirmation.manageOrder}
              </Button>
              <PrintButton label={t.booking.confirmation.print} />
            </div>
          </div>
        </aside>
      </div>
    </Container>
  );
}
