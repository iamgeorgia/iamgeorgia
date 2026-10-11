import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { FinanceOverviewCurrency } from "@/components/admin/finance/FinanceOverviewCurrency";
import { FinanceOverviewPayments, FinanceOverviewReceivables } from "@/components/admin/finance/FinanceOverviewPanels";
import { PaymentsDuePanel } from "@/components/admin/finance/PaymentsDuePanel";
import { getFinanceSummary, getPaymentsDue, listPayments, listReceivables } from "@/lib/api/finance";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Finance overview" };

/** How far ahead "due soon" looks — the same week the reminders and the sidebar badge count. */
const DUE_DAYS = 7;

/**
 * Who owes whom, right now.
 *
 * Every figure is per currency and stays that way: lari owed by one agency and
 * dollars owed by another are two numbers, never a sum (owner decision). The
 * summary already arrives split by currency, so each one gets its own row of
 * cards. The three lists below are the work the cards point at.
 *
 * The roles that read payables read the rest of Finance too, but each request
 * still asks for its own capability, so a narrower role later would get an
 * emptier screen rather than an error page.
 */
export default async function AdminFinanceOverviewPage() {
  const session = await getSession();

  if (!can(session, "finance.payables.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const { path } = await getI18n();
  const now = new Date();

  // The due queue is instalment by instalment — the rows the reminders are
  // about — rather than the payable list filtered on its next date.
  const [summary, due, receivables, payments] = await Promise.all([
    can(session, "finance.reports.read") ? getFinanceSummary() : null,
    getPaymentsDue(DUE_DAYS),
    can(session, "finance.receivables.read") ? listReceivables({ overdue: "true", pageSize: 8 }) : null,
    can(session, "finance.payments.read") ? listPayments({ pageSize: 5 }) : null,
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Finance overview"
        description="What buyers owe us, what we owe suppliers, and what needs paying or chasing — one currency at a time."
      />

      {summary && (
        <div className="mt-8 space-y-8">
          {summary.currencies.length === 0 ? (
            <p className="rounded-sm border border-dashed border-line p-8 text-center text-[0.875rem] text-muted">
              Nothing is owed either way yet. Figures appear here once a booking is confirmed.
            </p>
          ) : (
            summary.currencies.map((figures) => (
              <FinanceOverviewCurrency
                key={figures.currency}
                figures={figures}
                reviewHref={path("/admin/finance/payables?needsReview=true")}
              />
            ))
          )}
        </div>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <PaymentsDuePanel
          instalments={due.instalments ?? []}
          totals={due.totals.instalments ?? { overdue: 0, due: 0, outstandingByCurrency: {} }}
          days={due.days}
          now={now.toISOString()}
          canPay={can(session, "finance.payments.write")}
        />
        {receivables && (
          <FinanceOverviewReceivables
            receivables={receivables.data}
            total={receivables.total}
            now={now}
            path={path}
          />
        )}
        {payments && <FinanceOverviewPayments payments={payments.data} path={path} />}
      </div>
    </AdminContainer>
  );
}
