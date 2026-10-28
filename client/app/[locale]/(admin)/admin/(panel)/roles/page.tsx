import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";

import { AdminContainer, AdminPageHeader, AdminPanel } from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row, type Column } from "@/components/admin/DataTable";
import { Badge } from "@/components/ui/Badge";
import { listRoles } from "@/lib/api/roles";
import { requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import type { Role } from "@/types/rbac";

export const metadata: Metadata = { title: "Roles" };

const COLUMNS: Column[] = [
  { label: "Role" },
  { label: "Key", hideBelow: "md" },
  { label: "Accounts", align: "end" },
  { label: "Capabilities", align: "end", hideBelow: "sm" },
  { label: "", align: "end" },
];

/**
 * Who can do what, as data. Built-in roles ship with the platform; custom
 * ones are made here. Super admins only (`roles.manage`): anyone else is sent
 * home rather than shown a screen of refusals.
 */
export default async function AdminRolesPage() {
  const session = await requireScreen();


  const { path } = await getI18n();
  const [platform, partner] = await Promise.all([listRoles("PLATFORM"), listRoles("PARTNER")]);

  const table = (roles: Role[], caption: string) => (
    <DataTable columns={COLUMNS} caption={caption}>
      {roles.length === 0 && <EmptyRow colSpan={COLUMNS.length} message="No roles yet." />}

      {roles.map((role) => (
        <Row key={role.key}>
          <Cell>
            <Link
              href={path(`/admin/roles/${role.key}`)}
              prefetch={false}
              className="font-medium text-ink underline-offset-4 hover:underline"
            >
              {role.name}
            </Link>
            {role.isSystem && (
              <Badge tone="outline" className="ms-2">
                Built in
              </Badge>
            )}
            {role.description && (
              <span className="mt-0.5 block max-w-md text-[0.75rem] text-muted">{role.description}</span>
            )}
          </Cell>
          <Cell hideBelow="md">
            <span className="font-mono text-[0.8125rem]">{role.key}</span>
          </Cell>
          <Cell align="end">{role.members ?? "—"}</Cell>
          <Cell align="end" hideBelow="sm">
            {role.key === "SUPER_ADMIN" ? "All" : role.capabilities.length}
          </Cell>
          <Cell align="end">
            <Link
              href={path(`/admin/roles/${role.key}`)}
              prefetch={false}
              className="inline-flex items-center gap-1 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
            >
              Open
              <ChevronRight size={14} className="rtl:-scale-x-100" aria-hidden />
            </Link>
          </Cell>
        </Row>
      ))}
    </DataTable>
  );

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Roles"
        description="A role is a named set of things an account may do. Give someone one or more roles, and fine-tune with overrides on their page."
        actions={
          <Link
            href={path("/admin/roles/new")}
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <Plus size={15} aria-hidden />
            New role
          </Link>
        }
      />

      <div className="mt-8 space-y-6">
        <AdminPanel title="Platform" description="For staff who sign in to this panel." bodyClassName="p-0">
          {table(platform, "Platform roles")}
        </AdminPanel>

        <AdminPanel
          title="Partner"
          description="For the teams of agencies and suppliers in the partner portal."
          bodyClassName="p-0"
        >
          {table(partner, "Partner roles")}
        </AdminPanel>
      </div>
    </AdminContainer>
  );
}
