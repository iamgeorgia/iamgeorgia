import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { FleetStatusBadge } from "@/components/admin/FleetBadges";
import { FleetDocuments } from "@/components/admin/FleetDocuments";
import { FleetGallery } from "@/components/admin/FleetGallery";
import { FleetVehicleDangerZone } from "@/components/admin/FleetVehicleDangerZone";
import { FleetVehicleEditor } from "@/components/admin/FleetVehicleEditor";
import { ApiError } from "@/lib/api/client";
import { getFleetVehicle } from "@/lib/api/fleet";
import { listAdminTransferProviders, listAdminTransferVehicles } from "@/lib/api/transfers";
import { fleetFeatureLabels } from "@/lib/admin/fleet";
import { getSession, requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { FleetVehicleAdmin } from "@/types/driver";

export const metadata: Metadata = { title: "Car" };

export default async function AdminFleetVehiclePage({
  params,
}: PageProps<"/[locale]/admin/transfers/fleet/[id]">) {
  await requireScreen();
  const { id } = await params;

  let vehicle: FleetVehicleAdmin;

  try {
    vehicle = await getFleetVehicle(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [{ data: providers }, { data: classes }, { path }, session] = await Promise.all([
    listAdminTransferProviders(),
    listAdminTransferVehicles(),
    getI18n(),
    getSession(),
  ]);

  const title = `${vehicle.make} ${vehicle.model}`;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Fleet", href: path("/admin/transfers/fleet") }, { label: title }]}
      />

      <AdminPageHeader
        title={title}
        description={`${vehicle.plateNumber}${vehicle.colour ? ` · ${vehicle.colour}` : ""}${vehicle.year ? ` · ${vehicle.year}` : ""}`}
        actions={<FleetStatusBadge status={vehicle.status} />}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 space-y-8 lg:col-span-8">
          <AdminPanel title="Details">
            <FleetVehicleEditor
              vehicle={vehicle}
              providers={providers}
              classes={classes.filter((item) => item.status !== "ARCHIVED" || item.id === vehicle.vehicleClass?.id)}
            />
          </AdminPanel>

          <FleetGallery vehicle={vehicle} />

          <FleetDocuments vehicleId={vehicle.id} documents={vehicle.documents} />
        </div>

        <div className="min-w-0 space-y-8 lg:col-span-4">
          <AdminPanel title="At a glance">
            <AdminDefinitionList
              items={[
                { label: "Sold as", value: vehicle.vehicleClass?.name ?? "—" },
                { label: "Operated by", value: vehicle.provider?.name ?? "—" },
                {
                  label: "Carries",
                  value: `${vehicle.passengerCapacity} passengers · ${vehicle.luggageCapacity} bags`,
                },
                {
                  label: "On board",
                  value: vehicle.features.map((feature) => fleetFeatureLabels[feature]).join(", ") || "—",
                },
              ]}
            />
          </AdminPanel>

          <AdminPanel
            title="Drivers"
            description="Who usually takes this car. Set from each driver's page."
          >
            {vehicle.drivers.length === 0 ? (
              <p className="text-[0.875rem] text-muted">Nobody is linked to this car yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {vehicle.drivers.map((driver) => (
                  <li key={driver.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                    <Link
                      href={path(`/admin/transfers/drivers/${driver.id}`)}
                      className="text-[0.875rem] font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {driver.firstName} {driver.lastName}
                    </Link>
                    <span className="text-[0.75rem] text-subtle">
                      {driver.isPrimary ? "Primary" : ""}
                      {!driver.isActive ? " · deactivated" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>

          <FleetVehicleDangerZone
            vehicle={vehicle}
            canDelete={can(session, "platform.admin")}
            listHref={path("/admin/transfers/fleet")}
          />
        </div>
      </div>
    </AdminContainer>
  );
}
