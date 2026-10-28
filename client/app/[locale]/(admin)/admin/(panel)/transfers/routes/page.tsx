import Link from "next/link";
import type { Metadata } from "next";
import { CircleSlash, Plus, Route, Sparkles } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { StatCard } from "@/components/admin/StatCard";
import { TransferBulkPricer } from "@/components/admin/TransferBulkPricer";
import { TransferRoutesBrowser } from "@/components/admin/TransferRoutesBrowser";
import { listAdminTransferRoutes, listAdminTransferVehicles } from "@/lib/api/transfers";
import { transferRouteQueryFromParams } from "@/lib/admin/transfers";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Transfer routes" };

/**
 * The route catalogue.
 *
 * Live records, filtered on the server through the URL — the same shape as the
 * hotels and partners lists. The counting queries ask for one row each; they
 * want totals, not records, and with nearly four hundred routes the difference
 * is the whole page.
 */
export default async function AdminTransferRoutesPage({
  searchParams,
}: PageProps<"/[locale]/admin/transfers/routes">) {
  const session = await requireScreen();
  const params = await searchParams;
  const query = transferRouteQueryFromParams(params);

  const [list, tier1, drafts, vehicles, { path }] = await Promise.all([
    listAdminTransferRoutes(query),
    listAdminTransferRoutes({ tier: "TIER_1", pageSize: 1 }),
    listAdminTransferRoutes({ pageSize: 100 }),
    listAdminTransferVehicles(),
    getI18n(),
  ]);

  // The API has no "unpriced" filter, and adding one for a headline figure
  // would be a poor trade. A page of a hundred is enough to say whether this is
  // a handful or a problem, and the label says so.
  const unpriced = drafts.data.filter((route) => route.startingFromCents === null).length;

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Transfer routes"
        description="Every named journey in the catalogue, and what each costs in every vehicle class."
        actions={
          can(session, "catalogue.write") && (
            <Link
              href={path("/admin/transfers/routes/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add a route
            </Link>
          )
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Routes" value={String(list.total)} icon={Route} />
        <StatCard
          label="Tier 1"
          value={String(tier1.total)}
          icon={Sparkles}
          hint="The journeys the business runs on"
        />
        <StatCard
          label="Unpriced"
          value={unpriced > 0 ? `${unpriced}+` : "0"}
          icon={CircleSlash}
          hint="In the first 100 — these fall back to the distance estimate"
        />
      </div>

      {can(session, "catalogue.write") && (
        <div className="mt-10">
          <TransferBulkPricer
            vehicles={vehicles.data.filter((vehicle) => vehicle.status !== "ARCHIVED")}
          />
        </div>
      )}

      <div className="mt-8">
        <TransferRoutesBrowser
          data={list.data}
          total={list.total}
          page={list.page}
          pageSize={list.pageSize}
          totalPages={list.totalPages}
        />
      </div>
    </AdminContainer>
  );
}
