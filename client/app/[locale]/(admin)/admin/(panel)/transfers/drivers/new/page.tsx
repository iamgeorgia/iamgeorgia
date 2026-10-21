import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewDriverForm } from "@/components/admin/NewDriverForm";
import { listAdminTransferProviders } from "@/lib/api/transfers";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add a driver" };

export default async function NewDriverPage() {
  await requireScreen();
  const [{ data: providers }, { path }] = await Promise.all([listAdminTransferProviders(), getI18n()]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Drivers", href: path("/admin/transfers/drivers") }, { label: "Add a driver" }]}
      />

      <AdminPageHeader
        title="Add a driver"
        description="The profile first. A login, a photo, documents and the cars they take are added from the driver's page."
      />

      <div className="mt-8 max-w-3xl rounded-sm border border-line bg-surface p-6">
        <NewDriverForm providers={providers} />
      </div>
    </AdminContainer>
  );
}
