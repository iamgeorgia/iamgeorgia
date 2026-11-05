"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { UserStatusBadge } from "./UserStatusBadge";
import { formatPartnerDate, formatPartnerDateTime } from "@/lib/admin/partners";
import { USER_STATUSES, rolesText, staffRoleLabels, userStatusLabels } from "@/lib/admin/users";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { STAFF_ROLES, type ManagedUser } from "@/types/user";

interface UsersBrowserProps {
  users: ManagedUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const COLUMNS: Column[] = [
  { label: "Name" },
  { label: "Role" },
  { label: "Status" },
  { label: "Last sign-in", hideBelow: "xl" },
  { label: "Invited", hideBelow: "xl" },
  { label: "", align: "end" },
];

/**
 * The staff table and its filters.
 *
 * Same arrangement as the partners register: the filters live in the URL and
 * the server does the narrowing, so a filtered view is a link and the search
 * reaches every account rather than the twenty on screen.
 */
export function UsersBrowser({ users, total, page, pageSize, totalPages }: UsersBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const role = params.get("role") ?? "all";
  const status = params.get("status") ?? "all";

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }

    // A narrower filter makes the old page number meaningless.
    if (!("page" in changes)) next.delete("page");

    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  };

  // Debounced: one navigation per pause in typing, not one per keystroke.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;

    const timer = setTimeout(() => apply({ q: query.trim() || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const activeFilters = [role !== "all", status !== "all", query.trim() !== ""].filter(Boolean).length;

  const chip = (selected: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
      selected
        ? "border-ink bg-ink text-on-dark"
        : "border-line bg-surface text-body hover:border-ink/40 hover:text-ink",
    );

  const invited = (user: ManagedUser) =>
    user.invitedAt ? (
      <>
        <span className="block text-body">{formatPartnerDate(user.invitedAt)}</span>
        <span className="block text-[0.75rem] text-muted">
          {user.invitedBy ? `by ${user.invitedBy.fullName}` : "by the system"}
        </span>
      </>
    ) : (
      <span className="text-subtle">—</span>
    );

  return (
    <section className="mt-8">
      <div className="rounded-sm border border-line bg-surface p-4 sm:p-5">
        <FilterDisclosure
          count={(role !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0)}
          lead={
            <div className="relative min-w-[16rem] flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or email"
                aria-label="Search staff"
                className="h-11 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
              />
            </div>
          }
        >
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <fieldset>
              <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                Role
              </legend>
              <div className="flex flex-wrap gap-2">
                {(["all", ...STAFF_ROLES] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => apply({ role: value })}
                    aria-pressed={role === value}
                    className={chip(role === value)}
                  >
                    {value === "all" ? "All" : staffRoleLabels[value]}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                Status
              </legend>
              <div className="flex flex-wrap gap-2">
                {(["all", ...USER_STATUSES] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => apply({ status: value })}
                    aria-pressed={status === value}
                    className={chip(status === value)}
                  >
                    {value === "all" ? "All" : userStatusLabels[value]}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </FilterDisclosure>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <p aria-live="polite" className={cn("text-[0.8125rem] text-muted", pending && "opacity-50")}>
            {total === 1 ? "1 account" : `${total} accounts`}
            {activeFilters > 0 && " matching your filters"}
          </p>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                apply({ q: null, role: null, status: null });
              }}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
            >
              <X size={13} aria-hidden />
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className={cn("mt-5 transition-opacity", pending && "opacity-60")}>
        <div className="hidden lg:block">
          <DataTable columns={COLUMNS} caption="Staff accounts">
            {users.length === 0 && (
              <EmptyRow colSpan={COLUMNS.length} message="No staff accounts match your filters." />
            )}

            {/* No prefetch: the detail page's metadata reads the record, and a
                prefetch per row would spend the panel's shared rate limit. */}
            {users.map((user) => (
              <Row key={user.id}>
                <Cell>
                  <Link
                    href={path(`/admin/users/${user.id}`)}
                    prefetch={false}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {user.fullName}
                  </Link>
                  <span className="block text-[0.75rem] text-muted">{user.email}</span>
                </Cell>
                <Cell>{rolesText(user)}</Cell>
                <Cell>
                  <UserStatusBadge status={user.status} />
                </Cell>
                <Cell hideBelow="xl">
                  {user.lastLoginAt ? (
                    formatPartnerDateTime(user.lastLoginAt)
                  ) : (
                    <span className="text-subtle">Never</span>
                  )}
                </Cell>
                <Cell hideBelow="xl">{invited(user)}</Cell>
                <Cell align="end">
                  <Link
                    href={path(`/admin/users/${user.id}`)}
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
        </div>

        <ul className="space-y-3 lg:hidden">
          {users.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              No staff accounts match your filters.
            </li>
          )}

          {users.map((user) => (
            <li key={user.id}>
              <Link
                href={path(`/admin/users/${user.id}`)}
                prefetch={false}
                className="block rounded-sm border border-line bg-surface p-4 transition-colors hover:border-ink/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{user.fullName}</p>
                    <p className="mt-0.5 truncate text-[0.75rem] text-muted">{user.email}</p>
                  </div>
                  <UserStatusBadge status={user.status} />
                </div>
                <p className="mt-3 text-[0.8125rem] text-muted">
                  {rolesText(user)}
                  {" · "}
                  {user.lastLoginAt
                    ? `last signed in ${formatPartnerDate(user.lastLoginAt)}`
                    : "never signed in"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
            className="h-10 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-[0.8125rem] text-muted">
            Page {page} of {totalPages}
            <span className="sr-only">, {pageSize} per page</span>
          </p>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => apply({ page: String(page + 1) })}
            className="h-10 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
