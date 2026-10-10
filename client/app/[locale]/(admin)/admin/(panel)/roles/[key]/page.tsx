import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { RoleEditor } from "@/components/admin/RoleEditor";
import { Badge } from "@/components/ui/Badge";
import { ApiError } from "@/lib/api/client";
import { getRole, listCapabilities } from "@/lib/api/roles";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { Role } from "@/types/rbac";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/roles/[key]">): Promise<Metadata> {
  const { key } = await params;

  try {
    const role = await getRole(key);
    return { title: `${role.name} — Roles` };
  } catch {
    return { title: "Roles" };
  }
}

/** One role: edit what it is called and what it may do, or delete it. */
export default async function AdminRolePage({ params }: PageProps<"/[locale]/admin/roles/[key]">) {
  const session = await getSession();

  if (!can(session, "roles.manage")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const { key } = await params;
  const { path } = await getI18n();

  let role: Role;

  try {
    role = await getRole(key);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const catalogue = await listCapabilities();

  return (
    <AdminContainer>
      <AdminBreadcrumbs items={[{ label: "Roles", href: path("/admin/roles") }, { label: role.name }]} />

      <AdminPageHeader
        title={role.name}
        description={
          role.members === null
            ? undefined
            : `${role.members} ${role.members === 1 ? "account holds" : "accounts hold"} this role.`
        }
        actions={role.isSystem ? <Badge tone="outline">Built in</Badge> : undefined}
      />

      <div className="mt-8 max-w-4xl">
        <RoleEditor key={role.key} role={role} catalogue={catalogue} />
      </div>
    </AdminContainer>
  );
}
