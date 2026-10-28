import Link from "next/link";
import type { Metadata } from "next";
import { Archive, CarFront, Plus, Wrench } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { FleetBrowser } from "@/components/admin/FleetBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listFleetVehicles } from "@/lib/api/fleet";
import { fleetQueryFromParams } from "@/lib/admin/fleet";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Fleet" };

/**
 * The cars. Unlike the vehicle classes this list grows with the business, so
 * it is filtered and paginated through the URL like the routes are.
 */
export default async function AdminFleetPage({
  searchParams,
}: PageProps<"/[locale]/admin/transfers/fleet">) {
  const session = await requireScreen();
  const params = await searchParams;
  const query = fleetQueryFromParams(params);

  const [result, onRoad, offRoad, archived, { path }] = await Promise.all([
    listFleetVehicles(query),
    listFleetVehicles({ status: "ACTIVE", pageSize: 1 }),
    listFleetVehicles({ status: ["DRAFT", "INACTIVE"], pageSize: 1 }),
    listFleetVehicles({ status: "ARCHIVED", pageSize: 1 }),
    getI18n(),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Fleet"
        description="The physical cars dispatch sends. Each is sold as one vehicle class and driven by the drivers linked to it."
        actions={
          can(session, "dispatch.write") && (
            <Link
              href={path("/admin/transfers/fleet/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add a car
            </Link>
          )
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="On the road" value={String(onRoad.total)} icon={CarFront} />
        <StatCard label="Off the road" value={String(offRoad.total)} icon={Wrench} hint="In for service, or not yet started" />
        <StatCard label="Archived" value={String(archived.total)} icon={Archive} />
      </div>

      <div className="mt-10">
        <FleetBrowser {...result} />
      </div>
    </AdminContainer>
  );
}
