import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewFleetVehicleForm } from "@/components/admin/NewFleetVehicleForm";
import { listAdminTransferProviders, listAdminTransferVehicles } from "@/lib/api/transfers";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add a car" };

export default async function NewFleetVehiclePage() {
  await requireScreen();
  const [{ data: providers }, { data: classes }, { path }] = await Promise.all([
    listAdminTransferProviders(),
    listAdminTransferVehicles(),
    getI18n(),
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Fleet", href: path("/admin/transfers/fleet") }, { label: "Add a car" }]}
      />

      <AdminPageHeader
        title="Add a car"
        description="A specific vehicle with a registration plate — the thing that actually turns up at the kerb."
      />

      <div className="mt-8 max-w-3xl rounded-sm border border-line bg-surface p-6">
        <NewFleetVehicleForm
          providers={providers}
          classes={classes.filter((item) => item.status !== "ARCHIVED")}
        />
      </div>
    </AdminContainer>
  );
}
