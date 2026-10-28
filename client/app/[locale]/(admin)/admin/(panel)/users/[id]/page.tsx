import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { CapabilityList } from "@/components/admin/CapabilityChecklist";
import { UserActions } from "@/components/admin/UserActions";
import { UserDangerZone } from "@/components/admin/UserDangerZone";
import { UserOverridesPanel, UserRolesPanel } from "@/components/admin/UserAccess";
import { UserStatusBadge } from "@/components/admin/UserStatusBadge";
import { formatPartnerDate, formatPartnerDateTime } from "@/lib/admin/partners";
import { rolesText, userStatusHints } from "@/lib/admin/users";
import { ApiError } from "@/lib/api/client";
import { listCapabilities } from "@/lib/api/roles";
import { getGrantable, getUser, getUserDetail } from "@/lib/api/users";
import { requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import type { UserDetail } from "@/types/rbac";
import type { UserActorRef } from "@/types/user";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/users/[id]">): Promise<Metadata> {
  const { id } = await params;

  try {
    const user = await getUser("staff", id);
    return { title: `${user.fullName} — Staff` };
  } catch {
    return { title: "Staff" };
  }
}

const actor = (ref: UserActorRef | null) =>
  ref ? (
    <>
      {ref.fullName}
      <span className="block text-[0.75rem] font-normal text-muted">{ref.email}</span>
    </>
  ) : (
    "—"
  );

/** One staff account: who they are, where it stands, and what can be done to it. */
export default async function AdminUserPage({ params }: PageProps<"/[locale]/admin/users/[id]">) {
  const session = await requireScreen();


  const { id } = await params;
  const { path } = await getI18n();

  let user: UserDetail;

  try {
    user = await getUserDetail(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const isSelf = session?.user.id === user.id;

  // Your own account is read-only here, so there is nothing to offer for it.
  const [grantable, catalogue] = await Promise.all([
    isSelf ? Promise.resolve({ roles: [], capabilities: [] }) : getGrantable("staff", id),
    listCapabilities(),
  ]);
  const protectedCapabilities = new Set(catalogue.protected);
  // A platform account is only ever denied platform capabilities; the partner
  // ones belong to company teams.
  const deniable = catalogue.data
    .flatMap((group) => group.capabilities)
    .filter((capability) => !capability.startsWith("partner.") && !protectedCapabilities.has(capability));

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Staff", href: path("/admin/users") }, { label: user.fullName }]}
      />

      <AdminPageHeader
        title={user.fullName}
        description={`${rolesText(user)}${user.position ? ` · ${user.position}` : ""}${isSelf ? " · this is you" : ""}`}
        actions={<UserStatusBadge status={user.status} className="text-[0.8125rem]" />}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <AdminPanel title="Profile">
            <AdminDefinitionList
              items={[
                { label: "Name", value: user.fullName },
                { label: "Email", value: <span className="break-all">{user.email}</span> },
                { label: "Phone", value: user.phone ?? "—" },
                { label: "Position", value: user.position ?? "—" },
                { label: "Account created", value: formatPartnerDate(user.createdAt) },
              ]}
            />
          </AdminPanel>

          <UserRolesPanel user={user} assignable={grantable.roles} readOnly={isSelf} />

          <UserOverridesPanel
            user={user}
            grantable={grantable.capabilities ?? []}
            deniable={deniable}
            readOnly={isSelf}
          />

          <AdminPanel
            title="What this account can do"
            description="Everything its roles give it, plus grants, minus anything withheld."
          >
            <CapabilityList capabilities={user.capabilities} />
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-6">
          <AdminPanel title="Status">
            <p className="text-[0.875rem] leading-relaxed text-body">{userStatusHints[user.status]}</p>

            <AdminDefinitionList
              className="mt-4 border-t border-line pt-4"
              items={[
                {
                  label: "Last sign-in",
                  value: user.lastLoginAt ? formatPartnerDateTime(user.lastLoginAt) : "Never",
                },
                { label: "Invited", value: formatPartnerDateTime(user.invitedAt) },
                { label: "Invited by", value: actor(user.invitedBy) },
                ...(user.deactivatedAt
                  ? [
                      { label: "Deactivated", value: formatPartnerDateTime(user.deactivatedAt) },
                      { label: "Deactivated by", value: actor(user.deactivatedBy) },
                    ]
                  : []),
              ]}
            />
          </AdminPanel>

          <UserActions user={user} />

          <UserDangerZone user={user} />
        </div>
      </div>
    </AdminContainer>
  );
}
