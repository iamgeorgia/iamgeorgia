import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FinanceStatement, type StatementFilter } from "@/components/partners/FinanceStatement";
import { Container } from "@/components/ui/Container";
import { getPartnerStatement, getSupplierStatement } from "@/lib/api/finance";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { can, homePathFor } from "@/types/auth";
import type { SettlementStatus, SupplierStatementPayable } from "@/types/finance";
import type { Paginated } from "@/types/partner";

export const metadata: Metadata = { title: "Finance" };

const STATUSES: Record<StatementFilter, SettlementStatus[] | undefined> = {
  open: ["OPEN", "PARTIAL"],
  paid: ["PAID"],
  all: undefined,
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const pageNumber = (value: string | undefined) => {
  const page = Number(value);
  return Number.isInteger(page) && page > 1 ? page : 1;
};

/**
 * A partner's money: what it owes us, booking by booking, with its balance
 * per currency — and, for a supplier, what we owe it.
 *
 * Owners, partner admins and finance users (`partner.statement.read`); an
 * agent is sent to the dashboard rather than shown a 403. Both endpoints
 * scope every query to the session's own company on the server, so nothing
 * here can widen what is shown. The filter and the page live in the URL, so
 * a reload or a link to a colleague lands on the same view.
 */
export default async function PortalFinancePage({ searchParams }: PageProps<"/[locale]/portal/finance">) {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));

  if (!session.partner) {
    redirect(localePath(locale, homePathFor(session)));
  }

  // The statement is served to approved partners only, exactly as the
  // settings screen's edits are.
  if (session.partner.status !== "APPROVED") {
    redirect(localePath(locale, "/portal"));
  }

  if (!can(session, "partner.statement.read")) {
    redirect(localePath(locale, "/portal/dashboard"));
  }

  const { path } = await getI18n();
  const params = await searchParams;
  const requested = first(params.status);
  const filter: StatementFilter = requested === "paid" || requested === "all" ? requested : "open";
  const page = pageNumber(first(params.page));
  const supplierPage = pageNumber(first(params.spage));

  const [statement, payables] = await Promise.all([
    getPartnerStatement({ status: STATUSES[filter], page, pageSize: 25 }),
    // Only a supplier has rows here; for an agency the list is empty and the
    // section is left out. A failure costs the section, not the statement.
    getSupplierStatement({ status: STATUSES[filter], page: supplierPage, pageSize: 25 }).catch(
      (error: unknown): Paginated<SupplierStatementPayable> | null => {
        console.error("Supplier statement failed:", error);
        return null;
      },
    ),
  ]);

  const current: Record<string, string | null> = {
    status: filter === "open" ? null : filter,
    page: page > 1 ? String(page) : null,
    spage: supplierPage > 1 ? String(supplierPage) : null,
  };

  const hrefFor = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...changes })) {
      if (value) next.set(key, value);
    }
    // A new filter starts both lists again from their first page.
    if ("status" in changes) {
      next.delete("page");
      next.delete("spage");
    }
    const query = next.toString();
    return path(query ? `/portal/finance?${query}` : "/portal/finance");
  };

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">Finance</h1>
        <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-muted">
          What your company owes for its bookings and when each is due, with the payments we have
          received against them. Amounts are kept in the currency each booking was made in.
        </p>

        <FinanceStatement
          statement={statement}
          payables={payables}
          filter={filter}
          path={path}
          hrefFor={hrefFor}
        />
      </div>
    </Container>
  );
}
