import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, Clock, ListFilter, Wallet } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { StatCard } from "@/components/admin/StatCard";
import { PayablesBrowser } from "@/components/admin/finance/PayablesBrowser";
import { UNSETTLED, payableQueryFromParams } from "@/components/admin/finance/PayableFormat";
import { listPayables } from "@/lib/api/finance";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Payables" };

/**
 * What the platform owes its suppliers, one row per booking.
 *
 * Finance and the admins only: the server answers 403 to anyone without
 * `finance.payables.read`, so a viewer without it is sent home rather than
 * shown a screen of refusals.
 */
export default async function AdminPayablesPage({ searchParams }: PageProps<"/[locale]/admin/finance/payables">) {
  const session = await getSession();

  if (!can(session, "finance.payables.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const query = payableQueryFromParams(await searchParams);

  // The counters describe every payable, the table the current filter.
  // `pageSize: 1` asks each counter for a total and not the records. They are
  // counts, not sums: the payables are in several currencies, and a total
  // across them would be a number that means nothing.
  const [list, unsettled, late, review] = await Promise.all([
    listPayables(query),
    listPayables({ status: UNSETTLED, pageSize: 1 }),
    listPayables({ status: UNSETTLED, dueBefore: new Date().toISOString(), pageSize: 1 }),
    listPayables({ needsReview: "true", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Payables"
        description="What we owe suppliers, one line per booking: the net price, split into a deposit and a balance by the supplier's payment terms."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Still to pay" value={String(unsettled.total)} icon={Wallet} hint="Open or part paid" />
        <StatCard label="Late" value={String(late.total)} icon={Clock} hint="Next instalment's date has passed" />
        <StatCard
          label="Needs review"
          value={String(review.total)}
          icon={AlertTriangle}
          hint="No terms, or a cancellation to settle by hand"
        />
        <StatCard label="In this view" value={String(list.total)} icon={ListFilter} hint="Matching the current filters" />
      </div>

      <PayablesBrowser
        payables={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
      />
    </AdminContainer>
  );
}
