import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { TransferBlackouts } from "@/components/admin/TransferBlackouts";
import { TransferPriceGrid } from "@/components/admin/TransferPriceGrid";
import { TransferRouteDangerZone } from "@/components/admin/TransferRouteDangerZone";
import { TransferRouteEditor } from "@/components/admin/TransferRouteEditor";
import { TransferStopsEditor } from "@/components/admin/TransferStopsEditor";
import { ApiError } from "@/lib/api/client";
import {
  getAdminTransferRoute,
  listAdminTransferBlackouts,
  listAdminTransferPoints,
  listAdminTransferVehicles,
} from "@/lib/api/transfers";
import { categoryLabels, formatDuration, tierLabels } from "@/lib/admin/transfers";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Route" };

/**
 * One route, and what it costs.
 *
 * The publish checklist comes back with the record rather than being derived
 * here, so the panel and the endpoint can never disagree about whether a route
 * is ready — the same arrangement hotels use.
 */
export default async function AdminTransferRoutePage({
  params,
}: PageProps<"/[locale]/admin/transfers/routes/[id]">) {
  await requireScreen();
  const { id } = await params;
  const { path } = await getI18n();

  let route;

  try {
    route = await getAdminTransferRoute(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [{ data: vehicles }, { data: points }, { data: blackouts }] = await Promise.all([
    listAdminTransferVehicles(),
    listAdminTransferPoints(),
    listAdminTransferBlackouts({ routeId: route.id }),
  ]);

  const sellable = vehicles.filter((vehicle) => vehicle.status !== "ARCHIVED");

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Transfer routes", href: path("/admin/transfers/routes") },
          { label: `${route.from.name} → ${route.to.name}` },
        ]}
      />

      <AdminPageHeader
        title={route.title ?? `${route.from.name} → ${route.to.name}`}
        description={route.summary ?? "No summary yet — the landing page will read thin without one."}
      />

      {route.publishChecklist.length > 0 && (
        <div className="mt-6 rounded-sm border border-warning/40 bg-warning/5 p-4">
          <p className="flex items-center gap-2 text-[0.875rem] font-semibold text-warning-text">
            <AlertTriangle size={16} aria-hidden />
            Before this route goes live
          </p>
          <ul className="mt-2 space-y-1">
            {route.publishChecklist.map((entry) => (
              <li key={entry.code} className="text-[0.875rem] text-body">
                {entry.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 space-y-8 lg:col-span-8">
          <AdminPanel title="Fares" description="What this journey costs in each vehicle class.">
            <TransferPriceGrid route={route} vehicles={sellable} />
          </AdminPanel>

          <AdminPanel
            title="The route itself"
            description="What /transfers/routes/… says about this journey, and the numbers it is quoted from."
          >
            <TransferRouteEditor route={route} />
          </AdminPanel>

          <AdminPanel
            title="Stops"
            description="Where a multi-stop itinerary calls on the way. Order is the order of this list."
          >
            <TransferStopsEditor route={route} points={points} />
          </AdminPanel>

          <AdminPanel
            title="Closed dates"
            description="When the road is impassable and the route should not be sold."
          >
            <TransferBlackouts routeId={route.id} blackouts={blackouts} />
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-8 lg:col-span-4">
          <AdminPanel title="The journey">
            <AdminDefinitionList
              items={[
                { label: "Pick-up", value: `${route.from.name} (${route.from.region})` },
                { label: "Drop-off", value: `${route.to.name} (${route.to.region})` },
                { label: "Distance", value: `${route.distanceKm} km` },
                { label: "Journey time", value: formatDuration(route.durationMinutes) },
                { label: "Tier", value: tierLabels[route.tier] },
                { label: "Category", value: categoryLabels[route.category] },
                { label: "Status", value: route.status ?? "DRAFT" },
                { label: "URL", value: `/transfers/routes/${route.slug}` },
              ]}
            />
          </AdminPanel>

          <TransferRouteDangerZone route={route} />
        </div>
      </div>
    </AdminContainer>
  );
}
