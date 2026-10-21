import type { OrderQuery, OrderStatus } from "@/types/order";

/**
 * The order register's URL vocabulary.
 *
 * No label map here, unlike `lib/admin/bookings.ts`: `t.orders.status` and
 * `t.orders.itemStatus` already carry the words for every order state, and a
 * second English-only copy for the register is exactly how two screens end up
 * calling the same state different things.
 */

export const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_APPROVAL",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PARTIALLY_CANCELLED",
  "CANCELLED",
  "COMPLETED",
];

type ParamValue = string | string[] | undefined;

const read = (params: Record<string, ParamValue>, key: string): string | undefined => {
  const value = params[key];

  return Array.isArray(value) ? value[0] : value;
};

/**
 * Reads an order query out of URL search params.
 *
 * Unrecognised values are dropped rather than rejected, mirroring
 * `bookingQueryFromParams`: a stale bookmark or a hand-edited URL should show
 * an unfiltered register, not an error page.
 */
export function orderQueryFromParams(params: Record<string, ParamValue>): OrderQuery {
  const requested = params.status;
  const asArray = Array.isArray(requested) ? requested : requested ? [requested] : [];
  const valid = asArray.filter((value): value is OrderStatus =>
    ORDER_STATUSES.includes(value as OrderStatus),
  );
  const page = Number.parseInt(read(params, "page") ?? "", 10);

  return {
    status: valid.length > 0 ? valid : undefined,
    search: read(params, "search") || undefined,
    from: read(params, "from") || undefined,
    to: read(params, "to") || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 25,
  };
}
