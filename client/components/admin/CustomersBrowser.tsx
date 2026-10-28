"use client";

import Link from "next/link";
import { Building2, UserRound } from "lucide-react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import { ChipGroup } from "./filters/ChipGroup";
import { Pager } from "./filters/Pager";
import { SearchField } from "./filters/SearchField";
import { useFilterUrl } from "./filters/useFilterUrl";
import { CUSTOMER_KINDS, customerKindLabels } from "@/lib/admin/customers";
import { formatInstant } from "@/lib/admin/bookings";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { Customer, CustomerKind } from "@/types/customer";

/**
 * The customers register: the people and companies the desk books for.
 * Filters live in the URL, as on every register.
 */

const columns: Column[] = [
  { label: "Customer" },
  { label: "Contact", hideBelow: "md" },
  { label: "Email" },
  { label: "Phone", hideBelow: "lg" },
  { label: "Country", hideBelow: "xl" },
  { label: "Added", hideBelow: "xl" },
];

export function CustomersBrowser({
  data,
  total,
  page,
  totalPages,
}: {
  data: Customer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}) {
  const localePath = useLocalePath();
  const url = useFilterUrl();

  const q = url.params.get("q") ?? "";
  const kind = url.params.get("kind");
  const selected = CUSTOMER_KINDS.includes(kind as CustomerKind) ? [kind as CustomerKind] : [];

  const icon = (customer: Customer) =>
    customer.kind === "COMPANY" ? (
      <Building2 size={14} aria-hidden className="shrink-0 text-muted" />
    ) : (
      <UserRound size={14} aria-hidden className="shrink-0 text-muted" />
    );

  return (
    <div>
      <FilterDisclosure
        count={selected.length}
        lead={
          <SearchField
            value={q}
            onCommit={(next) => url.apply({ q: next || null })}
            placeholder="Name, email, phone or tax ID"
            label="Search customers"
          />
        }
      >
        <ChipGroup<CustomerKind>
          label="Kind"
          options={CUSTOMER_KINDS.map((value) => ({ value, label: customerKindLabels[value] }))}
          value={selected}
          onChange={(next) => url.apply({ kind: next[0] ?? null })}
          multiple={false}
        />
      </FilterDisclosure>

      <p className="mt-3 text-[0.8125rem] text-muted" aria-live="polite">
        {total === 0 ? "No customers match." : `${total} customer${total === 1 ? "" : "s"}`}
      </p>

      <div className={cn("mt-4 transition-opacity", url.pending && "opacity-60")}>
        <div className="hidden rounded-sm border border-line bg-surface md:block">
          <DataTable columns={columns} caption="Customers">
            {data.length === 0 ? (
              <EmptyRow colSpan={columns.length} message="Nothing to show. A customer is created when the desk books for someone without an account." />
            ) : (
              data.map((customer) => (
                <Row key={customer.id}>
                  <Cell>
                    <span className="flex items-center gap-2">
                      {icon(customer)}
                      <Link
                        href={localePath(`/admin/customers/${customer.id}`)}
                        prefetch={false}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {customer.name}
                      </Link>
                    </span>
                    <span className="block ps-6 text-[0.75rem] text-muted">{customerKindLabels[customer.kind]}</span>
                  </Cell>
                  <Cell hideBelow="md">{customer.contactName ?? "—"}</Cell>
                  <Cell className="break-all">{customer.email}</Cell>
                  <Cell hideBelow="lg">{customer.phone ?? "—"}</Cell>
                  <Cell hideBelow="xl">{customer.country ?? "—"}</Cell>
                  <Cell hideBelow="xl" className="text-[0.8125rem] text-muted">
                    {formatInstant(customer.createdAt)}
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>

        <ul className="flex flex-col gap-3 md:hidden">
          {data.length === 0 && <li className="py-12 text-center text-[0.875rem] text-muted">Nothing to show.</li>}
          {data.map((customer) => (
            <li key={customer.id} className="rounded-sm border border-line bg-surface p-4">
              <Link
                href={localePath(`/admin/customers/${customer.id}`)}
                prefetch={false}
                className="flex items-center gap-2 font-medium text-ink underline-offset-4 hover:underline"
              >
                {icon(customer)}
                {customer.name}
              </Link>
              <p className="mt-1 text-[0.8125rem] text-muted">
                {customerKindLabels[customer.kind]}
                {customer.contactName ? ` · ${customer.contactName}` : ""}
              </p>
              <p className="mt-1 text-[0.8125rem] text-body break-all">{customer.email}</p>
              {customer.phone && <p className="text-[0.8125rem] text-muted">{customer.phone}</p>}
            </li>
          ))}
        </ul>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={(next) => url.apply({ page: String(next) })} />
    </div>
  );
}
