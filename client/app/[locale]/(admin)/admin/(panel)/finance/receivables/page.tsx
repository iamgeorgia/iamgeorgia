import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { ReceivablesBrowser } from "@/components/admin/finance/ReceivablesBrowser";
import { listReceivables, type ReceivableQuery } from "@/lib/api/finance";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { SettlementStatus } from "@/types/finance";

export const metadata: Metadata = { title: "Receivables" };

const STATUSES = new Set<SettlementStatus>(["OPEN", "PARTIAL", "PAID", "VOID", "WAIVED"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CURRENCY = /^[A-Z]{3}$/;

/**
 * Reads the filters out of the URL. Anything unrecognised is dropped rather
 * than sent — the server answers 400 to it, and a hand-edited address should
 * show the whole list rather than an error page.
 */
function receivableQueryFromParams(params: Record<string, string | string[] | undefined>): ReceivableQuery {
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const status = (single(params.status) ?? "")
    .split(",")
    .filter((value): value is SettlementStatus => STATUSES.has(value as SettlementStatus));
  const partner = single(params.partner);
  const currency = single(params.currency);
  const page = Number(single(params.page));

  return {
    q: single(params.q)?.trim().slice(0, 120) || undefined,
    status: status.length ? status : undefined,
    overdue: single(params.overdue) === "true" ? "true" : undefined,
    // "Guests only" wins over a partner: the two cannot both be true of one row.
    debtorPartnerId:
      single(params.guests) === "true" ? "GUEST" : partner && ID.test(partner) ? partner : undefined,
    currency: currency && CURRENCY.test(currency) ? currency : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    pageSize: 25,
  };
}

/**
 * What buyers owe us — one row per confirmed booking or answered order,
 * whether the buyer is an agency or a guest paying for themselves.
 */
export default async function AdminReceivablesPage({
  searchParams,
}: PageProps<"/[locale]/admin/finance/receivables">) {
  const session = await getSession();

  if (!can(session, "finance.receivables.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const query = receivableQueryFromParams(await searchParams);
  const list = await listReceivables(query);

  // The chip names the partner from the rows themselves: every row on a
  // partner-filtered page is owed by that one partner.
  const partnerName =
    query.debtorPartnerId && query.debtorPartnerId !== "GUEST"
      ? (list.data[0]?.debtor.partner?.name ?? null)
      : null;

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Receivables"
        description="What agencies and guests owe us for confirmed bookings and orders, when each is due, and what has been paid against it."
      />

      <ReceivablesBrowser
        receivables={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
        partnerName={partnerName}
      />
    </AdminContainer>
  );
}
