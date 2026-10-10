import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { PenaltiesBrowser } from "@/components/admin/finance/PenaltiesBrowser";
import { productLabels } from "@/lib/admin/finance";
import { listPenalties, type PenaltyQuery } from "@/lib/api/finance-controls";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { PenaltyProduct } from "@/types/finance-controls";

export const metadata: Metadata = { title: "Cancellation penalties" };

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Reads the filters out of the URL; anything unrecognised is dropped rather than sent. */
function penaltyQueryFromParams(params: Record<string, string | string[] | undefined>): PenaltyQuery {
  const product = single(params.product);
  const currency = single(params.currency)?.trim().toUpperCase();
  const overridden = single(params.overridden);
  const partner = single(params.partner)?.trim();
  const page = Number(single(params.page));

  return {
    partnerId: partner || undefined,
    product: product && product in productLabels ? (product as PenaltyProduct) : undefined,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    overridden: overridden === "true" || overridden === "false" ? overridden : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    pageSize: 25,
  };
}

/**
 * What cancellations cost the buyer, as the policy set it and as finance
 * changed it. A change is always an approval request, never an edit.
 */
export default async function AdminPenaltiesPage({ searchParams }: PageProps<"/[locale]/admin/finance/penalties">) {
  const session = await getSession();

  if (!can(session, "finance.receivables.read")) {
    redirect(localePath(await getLocale(), "/admin/finance"));
  }

  const query = penaltyQueryFromParams(await searchParams);
  const list = await listPenalties(query);

  // The picker names the partner the list is narrowed to from the rows it shows.
  const partnerName = query.partnerId
    ? (list.data.find((penalty) => penalty.partner?.id === query.partnerId)?.partner?.name ?? "Selected partner")
    : null;

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Cancellation penalties"
        description="What each cancelled booking was charged under its policy, and where finance agreed to charge something else."
      />

      <PenaltiesBrowser
        penalties={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
        partnerName={partnerName}
        canRequest={can(session, "finance.adjustments.request")}
      />
    </AdminContainer>
  );
}
