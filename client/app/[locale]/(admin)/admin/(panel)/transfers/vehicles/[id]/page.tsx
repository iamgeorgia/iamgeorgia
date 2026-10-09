import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { TransferVehicleChannel } from "@/components/admin/TransferVehicleChannel";
import { TransferVehicleDangerZone } from "@/components/admin/TransferVehicleDangerZone";
import { TransferVehicleEditor } from "@/components/admin/TransferVehicleEditor";
import { ApiError } from "@/lib/api/client";
import { getAdminTransferVehicle } from "@/lib/api/transfers";
import { featureLabels, vehicleClassLabels } from "@/lib/admin/transfers";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { can } from "@/types/auth";
import type { TransferVehicle } from "@/types/transfer";

export const metadata: Metadata = { title: "Vehicle class" };

/**
 * One vehicle class.
 *
 * Fetched through the admin endpoint rather than the public one, because the
 * fallback fare model is staff-only and the editor needs it.
 */
export default async function AdminTransferVehiclePage({
  params,
}: PageProps<"/[locale]/admin/transfers/vehicles/[id]">) {
  const { id } = await params;
  const [{ path }, session] = await Promise.all([getI18n(), getSession()]);

  let vehicle: TransferVehicle;

  try {
    vehicle = await getAdminTransferVehicle(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Vehicle classes", href: path("/admin/transfers/vehicles") },
          { label: vehicle.name },
        ]}
      />

      <AdminPageHeader title={vehicle.name} description={vehicle.summary} />

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <AdminPanel title="Details">
            <TransferVehicleEditor vehicle={vehicle} />
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-8 lg:col-span-4">
          <AdminPanel title="At a glance">
            <AdminDefinitionList
              items={[
                {
                  label: "Class",
                  value: vehicleClassLabels[vehicle.vehicleClass] ?? vehicle.vehicleClass,
                },
                { label: "Body", value: vehicle.body },
                { label: "Sold as", value: vehicle.kind === "SHARED" ? "Per seat" : "Whole vehicle" },
                { label: "Supplier", value: vehicle.provider?.name ?? "—" },
                { label: "Slug", value: vehicle.slug },
                { label: "Status", value: vehicle.status ?? "—" },
                {
                  label: "Channel",
                  value: (
                    <TransferVehicleChannel
                      id={vehicle.id}
                      b2cEnabled={Boolean(vehicle.b2cEnabled)}
                      archived={vehicle.status === "ARCHIVED"}
                    />
                  ),
                },
                {
                  label: "On board",
                  value:
                    vehicle.features.map((feature) => featureLabels[feature]).join(", ") || "—",
                },
              ]}
            />

            <p className="mt-4 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-subtle">
              Class, body, sold-as and supplier are set when the class is created. They decide
              which searches offer it and who operates it, so changing one is a new class rather
              than an edit.
            </p>
          </AdminPanel>

          {vehicle.provider && can(session, "finance.payables.read", "catalogue.write") && (
            <AdminPanel
              title="Payment terms"
              description={`Set per supplier, so they cover every class ${vehicle.provider.name} operates.`}
            >
              <Link
                href={path(`/admin/finance/terms/transfer-providers/${vehicle.provider.id}`)}
                className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
              >
                <Wallet size={15} aria-hidden />
                Open payment terms
              </Link>
            </AdminPanel>
          )}

          <TransferVehicleDangerZone vehicle={vehicle} />
        </div>
      </div>
    </AdminContainer>
  );
}
