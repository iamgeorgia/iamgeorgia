import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { DriverAccount } from "@/components/admin/DriverAccount";
import { DriverDangerZone } from "@/components/admin/DriverDangerZone";
import { DriverDocuments } from "@/components/admin/DriverDocuments";
import { DriverEditor } from "@/components/admin/DriverEditor";
import { DriverPhoto } from "@/components/admin/DriverPhoto";
import { DriverVehicles } from "@/components/admin/DriverVehicles";
import { DriverVerification } from "@/components/admin/DriverVerification";
import { DriverActiveBadge, DriverVerificationBadge } from "@/components/admin/FleetBadges";
import { ApiError } from "@/lib/api/client";
import { getDriver } from "@/lib/api/drivers";
import { listFleetVehicles } from "@/lib/api/fleet";
import { listAdminTransferProviders } from "@/lib/api/transfers";
import { driverDisplayName, languageLabels } from "@/lib/admin/fleet";
import { getSession, requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { DriverAdmin, DriverLanguage } from "@/types/driver";

export const metadata: Metadata = { title: "Driver" };

export default async function AdminDriverPage({
  params,
}: PageProps<"/[locale]/admin/transfers/drivers/[id]">) {
  await requireScreen();
  const { id } = await params;

  let driver: DriverAdmin;

  try {
    driver = await getDriver(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [{ data: providers }, fleet, { path }, session] = await Promise.all([
    listAdminTransferProviders(),
    listFleetVehicles({ pageSize: 100 }),
    getI18n(),
    getSession(),
  ]);

  const name = driverDisplayName(driver);

  return (
    <AdminContainer>
      <AdminBreadcrumbs items={[{ label: "Drivers", href: path("/admin/transfers/drivers") }, { label: name }]} />

      <AdminPageHeader
        title={name}
        description={driver.provider?.name ?? undefined}
        actions={
          <span className="flex items-center gap-2">
            <DriverVerificationBadge status={driver.verificationStatus} />
            {!driver.isActive && <DriverActiveBadge isActive={false} />}
          </span>
        }
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 space-y-8 lg:col-span-8">
          <AdminPanel title="Profile">
            <DriverEditor driver={driver} providers={providers} />
          </AdminPanel>

          <DriverDocuments driverId={driver.id} documents={driver.documents} />

          <DriverVehicles driver={driver} fleet={fleet.data} />
        </div>

        <div className="min-w-0 space-y-8 lg:col-span-4">
          <DriverPhoto driver={driver} />

          <AdminPanel title="At a glance">
            <AdminDefinitionList
              items={[
                { label: "Phone", value: driver.phone },
                {
                  label: "Languages",
                  value:
                    driver.languages.map((code) => languageLabels[code as DriverLanguage] ?? code).join(", ") || "—",
                },
                { label: "Experience", value: `${driver.yearsExperience} years` },
                {
                  label: "Rating",
                  value: driver.ratingCount > 0 ? `${driver.ratingAvg.toFixed(1)} · ${driver.ratingCount} ratings` : "None yet",
                },
                { label: "Transfers completed", value: String(driver.completedCount) },
                { label: "Licence expires", value: driver.licenceExpiresOn ?? "—" },
              ]}
            />
          </AdminPanel>

          <DriverVerification driver={driver} />

          <DriverAccount driver={driver} />

          <DriverDangerZone
            driver={driver}
            canDelete={can(session, "platform.admin")}
            listHref={path("/admin/transfers/drivers")}
          />
        </div>
      </div>
    </AdminContainer>
  );
}
