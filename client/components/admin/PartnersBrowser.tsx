"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import { PartnerStatusBadge } from "./StatusBadge";
import {
  PARTNER_KINDS,
  PARTNER_STATUSES,
  formatPartnerDate,
  partnerKindLabels,
  partnerStatusLabels,
} from "@/lib/admin/partners";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { PartnerKind, PartnerStatus, PartnerSummary } from "@/types";

interface PartnersBrowserProps {
  partners: PartnerSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Statuses this screen is scoped to, which the filter row cannot leave. */
  lockedStatuses?: PartnerStatus[];
}

const COLUMNS: Column[] = [
  { label: "Company" },
  { label: "Partner ID" },
  { label: "Type" },
  { label: "Status" },
  { label: "Contact", hideBelow: "xl" },
  { label: "Location", hideBelow: "xl" },
  { label: "Registered", hideBelow: "xl" },
  { label: "", align: "end" },
];

/**
 * The partners table and its filters.
 *
 * Filtering happens on the server and travels in the URL rather than in
 * component state. Three reasons: a hundredth partner should not mean shipping
 * a hundred records to the browser to hide ninety of them; a filtered view is
 * a link an operator can send to a colleague; and the search has to reach
 * fields that are not in the row at all — the primary contact's email lives on
 * a different table.
 */
export function PartnersBrowser({
  partners,
  total,
  page,
  pageSize,
  totalPages,
  lockedStatuses,
}: PartnersBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "all";
  const kind = params.get("kind") ?? "all";

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }

    // Any change to the filters invalidates the page number: page 3 of a
    // narrower result set is usually empty.
    if (!("page" in changes)) next.delete("page");

    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  };

  // Debounced, so typing a company name is one navigation rather than one per
  // keystroke. The input stays controlled locally so it never feels laggy.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;

    const timer = setTimeout(() => apply({ q: query.trim() || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const statusOptions = lockedStatuses ?? PARTNER_STATUSES;
  const activeFilters = [status !== "all", kind !== "all", query.trim() !== ""].filter(
    Boolean,
  ).length;

  const chip = (selected: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors",
      selected
        ? "border-ink bg-ink text-on-dark"
        : "border-line bg-surface text-body hover:border-ink/40 hover:text-ink",
    );

  return (
    <section className="mt-8">
      <div className="rounded-sm border border-line bg-surface p-4 sm:p-5">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Company name, Partner ID, registration number or email"
            aria-label="Search partners"
            className="h-11 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          <fieldset>
            <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
              Status
            </legend>
            <div className="flex flex-wrap gap-2">
              {(["all", ...statusOptions] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => apply({ status: value })}
                  aria-pressed={status === value}
                  className={chip(status === value)}
                >
                  {value === "all" ? "All" : partnerStatusLabels[value as PartnerStatus]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
              Type
            </legend>
            <div className="flex flex-wrap gap-2">
              {(["all", ...PARTNER_KINDS] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => apply({ kind: value })}
                  aria-pressed={kind === value}
                  className={chip(kind === value)}
                >
                  {value === "all" ? "All" : partnerKindLabels[value as PartnerKind]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <p aria-live="polite" className={cn("text-[0.8125rem] text-muted", pending && "opacity-50")}>
            {total === 1 ? "1 partner" : `${total} partners`}
            {activeFilters > 0 && " matching your filters"}
          </p>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                apply({ q: null, status: null, kind: null });
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
          <DataTable columns={COLUMNS} caption="Partner companies">
            {partners.length === 0 && (
              <EmptyRow colSpan={COLUMNS.length} message="No partners match your filters." />
            )}

            {/*
              The detail links do not prefetch. The partner page's
              `generateMetadata` reads the record for its title, and Next runs
              that for every prefetch, so a page of twenty rows would cost
              twenty API calls before anyone clicked — against a limiter the
              whole panel shares. The panel's loading boundary still streams
              the shell first on a click, so nothing is lost but the head start.
            */}
            {partners.map((partner) => (
              <Row key={partner.id}>
                <Cell>
                  <Link
                    href={path(`/admin/partners/${partner.id}`)}
                    prefetch={false}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {partner.name}
                  </Link>
                  {partner.registrationNumber && (
                    <span className="block text-[0.75rem] text-muted">
                      {partner.registrationNumber}
                    </span>
                  )}
                </Cell>
                <Cell>
                  <span className="font-mono text-[0.8125rem] text-body">{partner.reference}</span>
                </Cell>
                <Cell>{partnerKindLabels[partner.kind]}</Cell>
                <Cell>
                  <PartnerStatusBadge status={partner.status} />
                </Cell>
                <Cell hideBelow="xl">
                  {partner.contact ? (
                    <>
                      <span className="block text-body">{partner.contact.fullName}</span>
                      <span className="block text-[0.75rem] text-muted">{partner.contact.email}</span>
                    </>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </Cell>
                <Cell hideBelow="xl">
                  {[partner.city, partner.country].filter(Boolean).join(", ") || "—"}
                </Cell>
                <Cell hideBelow="xl">
                  {formatPartnerDate(partner.submittedAt ?? partner.createdAt)}
                </Cell>
                <Cell align="end">
                  <Link
                    href={path(`/admin/partners/${partner.id}`)}
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
          {partners.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              No partners match your filters.
            </li>
          )}

          {partners.map((partner) => (
            <li key={partner.id}>
              <Link
                href={path(`/admin/partners/${partner.id}`)}
                prefetch={false}
                className="block rounded-sm border border-line bg-surface p-4 transition-colors hover:border-ink/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{partner.name}</p>
                    <p className="mt-0.5 font-mono text-[0.75rem] text-muted">{partner.reference}</p>
                  </div>
                  <PartnerStatusBadge status={partner.status} />
                </div>
                <p className="mt-3 text-[0.8125rem] text-muted">
                  {partnerKindLabels[partner.kind]}
                  {partner.city ? ` · ${partner.city}` : ""}
                </p>
                {partner.contact && (
                  <p className="mt-1 truncate text-[0.8125rem] text-muted">{partner.contact.email}</p>
                )}
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
