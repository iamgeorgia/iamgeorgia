import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewTransferVehicleForm } from "@/components/admin/NewTransferVehicleForm";
import { listAdminTransferProviders } from "@/lib/api/transfers";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add a vehicle class" };

/**
 * A new vehicle class.
 *
 * The suppliers are fetched here rather than in the form: a class carries a
 * required supplier, and a Server Component that already has the session is
 * the cheapest place to resolve the list. If it comes back empty the form says
 * so instead of offering an empty dropdown.
 */
export default async function NewTransferVehiclePage() {
  await requireScreen();
  const [{ data: providers }, { path }] = await Promise.all([
    listAdminTransferProviders(),
    getI18n(),
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Vehicle classes", href: path("/admin/transfers/vehicles") },
          { label: "Add a class" },
        ]}
      />

      <AdminPageHeader
        title="Add a vehicle class"
        description="A category a traveller can choose — never an individual car. Set its capacity, its fallback fare and the copy that sells it."
      />

      <div className="mt-8 max-w-3xl rounded-sm border border-line bg-surface p-6">
        <NewTransferVehicleForm providers={providers} />
      </div>
    </AdminContainer>
  );
}
