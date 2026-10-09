import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { calendarDay, endOfDay, startOfDay } from "@/components/admin/finance/PaymentFormat";
import { PaymentsBrowser } from "@/components/admin/finance/PaymentsBrowser";
import { RecordPaymentButton } from "@/components/admin/finance/RecordPaymentModal";
import { listPayments, type PaymentQuery } from "@/lib/api/finance";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { PaymentDirection, PaymentKind, PaymentMethod } from "@/types/finance";

export const metadata: Metadata = { title: "Payments" };

const DIRECTIONS = new Set<PaymentDirection>(["IN", "OUT"]);
const KINDS = new Set<PaymentKind>(["PAYMENT", "REFUND"]);
const METHODS = new Set<PaymentMethod>(["BANK_TRANSFER", "CASH", "CARD", "OTHER"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CURRENCY = /^[A-Z]{3}$/;

/**
 * Reads the filters out of the URL; anything unrecognised is dropped. Dates
 * stay plain Tbilisi days in the address and become the first and last
 * instant of those days only here.
 */
function paymentQueryFromParams(params: Record<string, string | string[] | undefined>): PaymentQuery {
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const direction = single(params.direction) as PaymentDirection | undefined;
  const kind = single(params.kind) as PaymentKind | undefined;
  const method = single(params.method) as PaymentMethod | undefined;
  const currency = single(params.currency);
  const partner = single(params.partner);
  const page = Number(single(params.page));

  let from = calendarDay(single(params.from));
  let to = calendarDay(single(params.to));
  if (from && to && from > to) [from, to] = [to, from];

  return {
    q: single(params.q)?.trim().slice(0, 120) || undefined,
    direction: direction && DIRECTIONS.has(direction) ? direction : undefined,
    kind: kind && KINDS.has(kind) ? kind : undefined,
    method: method && METHODS.has(method) ? method : undefined,
    currency: currency && CURRENCY.test(currency) ? currency : undefined,
    counterpartyPartnerId: partner && ID.test(partner) ? partner : undefined,
    from: from ? startOfDay(from) : undefined,
    to: to ? endOfDay(to) : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    pageSize: 25,
  };
}

/** Every payment and refund recorded, in and out, and what each one settled. */
export default async function AdminPaymentsPage({ searchParams }: PageProps<"/[locale]/admin/finance/payments">) {
  const session = await getSession();

  if (!can(session, "finance.payments.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const list = await listPayments(paymentQueryFromParams(await searchParams));

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Payments"
        description="Money in from buyers and out to suppliers, refunds both ways, and what each payment settled."
        actions={can(session, "finance.payments.write") ? <RecordPaymentButton /> : undefined}
      />

      <PaymentsBrowser
        payments={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
      />
    </AdminContainer>
  );
}
