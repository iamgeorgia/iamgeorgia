import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewRoleForm } from "@/components/admin/NewRoleForm";
import { listCapabilities } from "@/lib/api/roles";
import { requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "New role — Roles" };

/** Creating a custom role. */
export default async function NewRolePage() {
  const session = await requireScreen();


  const { path } = await getI18n();
  const catalogue = await listCapabilities();

  return (
    <AdminContainer>
      <AdminBreadcrumbs items={[{ label: "Roles", href: path("/admin/roles") }, { label: "New role" }]} />
      <AdminPageHeader
        title="New role"
        description="Name it, choose which side it is for, and tick what it may do. You can change the capabilities later."
      />

      <div className="mt-8 max-w-4xl">
        <NewRoleForm catalogue={catalogue} />
      </div>
    </AdminContainer>
  );
}
