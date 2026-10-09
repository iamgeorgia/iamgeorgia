import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { UserActions } from "@/components/admin/UserActions";
import { UserDangerZone } from "@/components/admin/UserDangerZone";
import { UserStatusBadge } from "@/components/admin/UserStatusBadge";
import { formatPartnerDate, formatPartnerDateTime } from "@/lib/admin/partners";
import { roleLabel, staffRoleDescriptions, userStatusHints, type StaffRole } from "@/lib/admin/users";
import { ApiError } from "@/lib/api/client";
import { getUser } from "@/lib/api/users";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { ManagedUser, UserActorRef } from "@/types/user";

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
  const session = await getSession();

  if (!can(session, "users.staff.manage")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const { id } = await params;
  const { path } = await getI18n();

  let user: ManagedUser;

  try {
    user = await getUser("staff", id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const isSelf = session?.user.id === user.id;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Staff", href: path("/admin/users") }, { label: user.fullName }]}
      />

      <AdminPageHeader
        title={user.fullName}
        description={`${roleLabel(user.role)}${user.position ? ` · ${user.position}` : ""}${isSelf ? " · this is you" : ""}`}
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

          <AdminPanel title="Role" description="What this account can see and change in the panel.">
            <p className="text-[0.9375rem] font-medium text-ink">{roleLabel(user.role)}</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
              {staffRoleDescriptions[user.role as StaffRole] ?? "Not a staff role."}
            </p>
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
