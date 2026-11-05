"use client";

import { CalendarRange, Clock, Users } from "lucide-react";

import { OrderItemCancel } from "@/components/packages/OrderItemCancel";
import { OrderItems } from "@/components/packages/OrderItems";
import { Badge } from "@/components/ui/Badge";
import { formatInstant, formatStayDate } from "@/lib/booking/stay";
import { fill } from "@/lib/i18n/fill";
import { plural } from "@/lib/i18n/plural";
import { useI18n } from "@/lib/i18n/provider";
import { formatMoney } from "@/lib/money";
import type {
  CustomOrderSnapshotPackage,
  Order,
  OrderCancellationQuote,
  OrderStatus,
} from "@/types/order";
import { cn } from "@/lib/utils";

const TONES: Record<OrderStatus, "neutral" | "outline" | "nature"> = {
  PENDING_APPROVAL: "outline",
  PENDING_CONFIRMATION: "outline",
  CONFIRMED: "nature",
  PARTIALLY_CANCELLED: "neutral",
  CANCELLED: "neutral",
  COMPLETED: "neutral",
};

interface OrderDetailProps {
  order: Order;
  /**
   * Present when the viewer may still drop parts, carrying what doing so
   * would cost. Data rather than a render prop, because the callers are
   * Server Components and a function cannot cross that boundary.
   */
  cancel?: { quote: OrderCancellationQuote | null; email?: string } | null;
  className?: string;
}

/**
 * One order, whole: the trip, its parts and what it cost.
 *
 * Shared by the confirmation page, the guest's manage page and the partner
 * portal, because all three show the same record and differ only in what they
 * let you do to it — which is what `cancel` is for.
 */
export function OrderDetail({ order, cancel, className }: OrderDetailProps) {
  const { t, locale, intlLocale } = useI18n();
  const money = (cents: number) => formatMoney(cents, order.currency, intlLocale);

  const party = [
    plural(locale, order.adults, t.units.adult),
    order.childAges.length > 0 ? plural(locale, order.childAges.length, t.units.child) : null,
    order.rooms > 1 ? plural(locale, order.rooms, t.units.room) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // A cart order is a trip of its own naming, not a package; its items may
  // come from several packages, which the snapshot names for the list.
  const custom = order.kind === "CUSTOM";
  const packages = snapshotPackages(order.packageSnapshot);

  const pending = order.items.filter((item) => item.status === "REQUESTED");
  const live = order.items.filter(
    (item) => item.status !== "CANCELLED" && item.status !== "DECLINED",
  );
  const partsTotal = live.reduce((sum, item) => sum + item.sellCents, 0);
  const adjustment = live.reduce((sum, item) => sum + item.adjustmentCents, 0);

  return (
    <div className={cn("flex flex-col gap-8", className)}>
      <section className="border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="type-caption text-muted">{t.orders.manage.reference}</p>
            <p className="type-h4 mt-0.5 tabular-nums text-ink">{order.reference}</p>
            <p className="type-caption mt-1 text-muted">
              {fill(t.orders.manage.bookedOn, {
                date: formatStayDate(order.createdAt.slice(0, 10), intlLocale),
              })}
            </p>
          </div>
          <Badge tone={TONES[order.status]}>{t.orders.status[order.status]}</Badge>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
          <div>
            <dt className="type-caption text-muted">
              {custom ? t.orders.cart.tripName : t.orders.manage.package}
            </dt>
            <dd className="type-body-sm mt-0.5 text-ink">{order.package.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="type-caption flex items-center gap-1.5 text-muted">
              <CalendarRange size={12} aria-hidden />
              {t.orders.manage.dates}
            </dt>
            <dd className="type-body-sm mt-0.5 text-ink">
              {formatStayDate(order.startDate, intlLocale)} –{" "}
              {formatStayDate(order.endDate, intlLocale)}
            </dd>
          </div>
          <div>
            <dt className="type-caption flex items-center gap-1.5 text-muted">
              <Users size={12} aria-hidden />
              {t.orders.manage.party}
            </dt>
            <dd className="type-body-sm mt-0.5 text-ink">{party}</dd>
          </div>
        </dl>

        {pending.length > 0 && order.requestDeadlineAt && (
          <p className="type-body-sm mt-5 flex items-start gap-2.5 rounded-sm bg-surface-soft p-3.5 text-body">
            <Clock size={15} className="mt-0.5 shrink-0 text-brand-text" aria-hidden />
            {fill(t.orders.manage.awaiting, {
              date: formatInstant(order.requestDeadlineAt, intlLocale),
              items: pending.map((item) => item.label).join(", "),
            })}
          </p>
        )}

        {order.cancelledAt && (
          <p className="type-body-sm mt-5 rounded-sm bg-surface-soft p-3.5 text-body">
            {fill(t.orders.manage.cancelledOn, {
              date: formatStayDate(order.cancelledAt.slice(0, 10), intlLocale),
            })}
            {(order.cancellationChargeCents ?? 0) > 0 && (
              <>
                {" · "}
                {t.orders.manage.cancellationCharge}:{" "}
                {money(order.cancellationChargeCents ?? 0)}
              </>
            )}
            {order.cancellationReason && ` · ${order.cancellationReason}`}
          </p>
        )}
      </section>

      <section>
        <h2 className="type-h4">{t.orders.manage.parts}</h2>
        <OrderItems
          items={order.items}
          currency={order.currency}
          packages={packages}
          action={
            cancel
              ? (item) => (
                  <OrderItemCancel
                    reference={order.reference}
                    email={cancel.email}
                    currency={order.currency}
                    item={item}
                    quote={cancel.quote}
                  />
                )
              : undefined
          }
          className="mt-4"
        />
      </section>

      <section className="border border-line bg-surface p-5">
        <h2 className="type-h4">{t.orders.manage.priceTitle}</h2>
        <dl className="mt-4 flex flex-col gap-2">
          <div className="type-body-sm flex items-baseline justify-between gap-4">
            <dt className="text-muted">{t.orders.manage.partsTotal}</dt>
            <dd className="tabular-nums text-body">{money(partsTotal)}</dd>
          </div>
          {adjustment !== 0 && (
            <div className="type-body-sm flex items-baseline justify-between gap-4">
              <dt className={adjustment < 0 ? "text-accent-green" : "text-muted"}>
                {adjustment < 0 ? t.orders.manage.discount : t.orders.manage.supplement}
              </dt>
              <dd
                className={cn("tabular-nums", adjustment < 0 ? "text-accent-green" : "text-body")}
              >
                {money(adjustment)}
              </dd>
            </div>
          )}
          <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-3">
            <dt className="type-body font-semibold text-ink">{t.orders.manage.total}</dt>
            <dd className="type-h4 tabular-nums text-ink">{money(order.totalCents)}</dd>
          </div>
          {typeof order.marginCents === "number" && (
            <div className="type-caption flex items-baseline justify-between gap-4 text-muted">
              <dt>{t.packages.quote.margin}</dt>
              <dd className="tabular-nums">{money(order.marginCents)}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="border border-line bg-surface p-5">
        <h2 className="type-h4">{t.orders.manage.leadGuest}</h2>
        <p className="type-body-sm mt-2 text-ink">{order.leadName}</p>
        <p className="type-caption text-muted">{order.leadEmail}</p>
        {order.leadPhone && <p className="type-caption text-muted">{order.leadPhone}</p>}

        <h3 className="type-caption mt-4 font-semibold tracking-wide text-muted uppercase">
          {t.orders.manage.specialRequests}
        </h3>
        <p className="type-body-sm mt-1 text-body">
          {order.specialRequests || t.orders.manage.noRequests}
        </p>
      </section>
    </div>
  );
}

/** The packages a CUSTOM snapshot flattened, for heading their lines. */
function snapshotPackages(snapshot: Record<string, unknown>): CustomOrderSnapshotPackage[] {
  const packages = snapshot.packages;

  if (!Array.isArray(packages)) return [];

  return packages.filter(
    (entry): entry is CustomOrderSnapshotPackage =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as { groupKey?: unknown }).groupKey === "string",
  );
}
