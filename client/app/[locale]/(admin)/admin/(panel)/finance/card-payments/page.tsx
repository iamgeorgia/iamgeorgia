import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { CardModeChip } from "@/components/admin/finance/CardPaymentBadges";
import { CardPaymentsBrowser } from "@/components/admin/finance/CardPaymentsBrowser";
import { calendarDay, endOfDay, startOfDay } from "@/components/admin/finance/PaymentFormat";
import { getPaymentsSettings, listCardPayments } from "@/lib/api/payments";
import { requireScreen } from "@/lib/auth/session";
import type { CardPaymentQuery, PaymentsSettings, PspPaymentStatus } from "@/types/payments";

export const metadata: Metadata = { title: "Card payments" };

const STATUSES = new Set<PspPaymentStatus>([
  "CREATED",
  "REDIRECT_READY",
  "PROCESSING",
  "APPROVED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "MISMATCH",
  "REVERSED",
]);

/**
 * Reads the filters out of the URL; anything unrecognised is dropped. Dates
 * stay plain Tbilisi days in the address and become the first and last
 * instant of those days only here.
 */
function queryFromParams(params: Record<string, string | string[] | undefined>): CardPaymentQuery {
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const status = single(params.status) as PspPaymentStatus | undefined;
  const mode = single(params.mode);
  const page = Number(single(params.page));

  let from = calendarDay(single(params.from));
  let to = calendarDay(single(params.to));
  if (from && to && from > to) [from, to] = [to, from];

  return {
    q: single(params.q)?.trim().slice(0, 120) || undefined,
    status: status && STATUSES.has(status) ? status : undefined,
    mode: mode === "TEST" || mode === "LIVE" ? mode : undefined,
    attention: single(params.attention) === "true" ? true : undefined,
    from: from ? startOfDay(from) : undefined,
    to: to ? endOfDay(to) : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    pageSize: 25,
  };
}

/** Every card payment attempt, what the gateway said about it, and what it did to the ledger. */
export default async function AdminCardPaymentsPage({
  searchParams,
}: PageProps<"/[locale]/admin/finance/card-payments">) {
  await requireScreen();

  const [list, settings] = await Promise.all([
    listCardPayments(queryFromParams(await searchParams)),
    // The mode chip is decoration; the list must not depend on it.
    getPaymentsSettings().catch((): PaymentsSettings | null => null),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Card payments"
        description="Guests paying by card through the gateway: each attempt, the callbacks that came back, and the refunds sent."
        actions={settings?.mode ? <CardModeChip mode={settings.mode} className="self-center" /> : undefined}
      />

      {settings && !settings.enabled && (
        <p className="mt-6 rounded-sm border border-line bg-surface px-4 py-3 text-[0.8125rem] text-muted">
          Card payments are switched off, so guests are not offered a card. Past attempts stay listed below.
        </p>
      )}

      <CardPaymentsBrowser
        payments={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
      />
    </AdminContainer>
  );
}
