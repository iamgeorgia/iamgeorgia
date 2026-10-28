import type { Metadata } from "next";
import { Ban, CheckCircle2, MailPlus, UsersRound } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { InviteUserButton } from "@/components/admin/InviteUserModal";
import { StatCard } from "@/components/admin/StatCard";
import { UsersBrowser } from "@/components/admin/UsersBrowser";
import { staffQueryFromParams } from "@/lib/admin/users";
import { getGrantable, listUsers } from "@/lib/api/users";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Staff" };

/**
 * Everyone with a seat in this panel. Super admins only: the server answers
 * 403 to anyone else, so a viewer without the capability is sent home rather
 * than shown a screen of refusals.
 */
export default async function AdminUsersPage({ searchParams }: PageProps<"/[locale]/admin/users">) {
  const session = await requireScreen();


  const query = staffQueryFromParams(await searchParams);

  // The counters describe the whole staff, the table the current filter;
  // `pageSize: 1` asks each counter for a total and not the records.
  const [list, active, invited, deactivated, grantable] = await Promise.all([
    listUsers("staff", query),
    listUsers("staff", { status: "ACTIVE", pageSize: 1 }),
    listUsers("staff", { status: "INVITED", pageSize: 1 }),
    listUsers("staff", { status: "DEACTIVATED", pageSize: 1 }),
    // The roles this viewer may invite someone into, from the server.
    getGrantable("staff"),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Staff"
        description="Everyone who can sign in to this panel, the role each one holds, and who invited them."
        actions={<InviteUserButton roles={grantable.roles} />}
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active"
          value={String(active.total)}
          icon={CheckCircle2}
          hint="Can sign in now"
        />
        <StatCard
          label="Invited"
          value={String(invited.total)}
          icon={MailPlus}
          hint="No password chosen yet"
        />
        <StatCard
          label="Deactivated"
          value={String(deactivated.total)}
          icon={Ban}
          hint="Switched off, kept on file"
        />
        <StatCard
          label="In this view"
          value={String(list.total)}
          icon={UsersRound}
          hint="Matching the current filters"
        />
      </div>

      <UsersBrowser
        users={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
      />
    </AdminContainer>
  );
}
