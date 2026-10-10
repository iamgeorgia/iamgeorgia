import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewRoleForm } from "@/components/admin/NewRoleForm";
import { listCapabilities } from "@/lib/api/roles";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "New role — Roles" };

/** Creating a custom role. */
export default async function NewRolePage() {
  const session = await getSession();

  if (!can(session, "roles.manage")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

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
