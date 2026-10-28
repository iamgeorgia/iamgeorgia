"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Cell, DataTable, EmptyRow, Row } from "./DataTable";
import { DriverActiveBadge, DriverVerificationBadge } from "./FleetBadges";
import { languageLabels, verificationOptions } from "@/lib/admin/fleet";
import { useLocalePath } from "@/lib/i18n/provider";
import type { DriverAdmin, DriverLanguage } from "@/types/driver";

export function DriversBrowser({
  data,
  total,
  page,
  pageSize,
  totalPages,
}: {
  data: DriverAdmin[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const path = useLocalePath();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`${pathname}?${next}`);
  };

  useEffect(() => {
    const current = searchParams.get("search") ?? "";
    if (search === current) return;
    const timer = setTimeout(() => setParam("search", search), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchParams]);

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(next));
    router.push(`${pathname}?${params}`);
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const thumb = (driver: DriverAdmin) =>
    driver.photo?.variants.find((variant) => variant.variant === "thumb")?.url ?? driver.photo?.url;

  const select =
    "h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-body focus:border-ink focus:outline-none";

  return (
    <div>
      <FilterDisclosure
        count={["verificationStatus", "isActive"].filter((key) => { const value = searchParams.get(key); return value && value !== "all"; }).length}
        lead={
        <label className="relative min-w-56 flex-1">
          <Search size={15} className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, phone or email"
            aria-label="Search drivers"
            className="h-10 w-full rounded-sm border border-line bg-surface ps-9 pe-3 text-[0.875rem] text-ink focus:border-ink focus:outline-none"
          />
        </label>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={searchParams.get("verificationStatus") ?? ""}
            onChange={(event) => setParam("verificationStatus", event.target.value)}
            aria-label="Filter by verification"
            className={select}
          >
            <option value="">Any verification</option>
            {verificationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={searchParams.get("isActive") ?? ""}
            onChange={(event) => setParam("isActive", event.target.value)}
            aria-label="Filter by active"
            className={select}
          >
            <option value="">Active and deactivated</option>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
          </select>
        </div>
      </FilterDisclosure>

      <div className="mt-6 rounded-sm border border-line bg-surface">
        <DataTable
          caption="Drivers"
          columns={[
            { label: "Driver" },
            { label: "Works for", hideBelow: "md" },
            { label: "Languages", hideBelow: "lg" },
            { label: "Verification" },
            { label: "Login", hideBelow: "sm" },
          ]}
        >
          {data.length === 0 ? (
            <EmptyRow colSpan={5} message="No drivers match those filters." />
          ) : (
            data.map((driver) => (
              <Row key={driver.id}>
                <Cell>
                  <div className="flex items-center gap-3">
                    {thumb(driver) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- API-served
                      <img src={thumb(driver)} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-soft text-subtle">
                        <UserRound size={18} aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0">
                      <Link
                        href={path(`/admin/transfers/drivers/${driver.id}`)}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {driver.firstName} {driver.lastName}
                      </Link>
                      <span className="type-caption mt-0.5 flex items-center gap-2 text-subtle">
                        {driver.phone}
                        {!driver.isActive && <DriverActiveBadge isActive={false} />}
                      </span>
                    </div>
                  </div>
                </Cell>
                <Cell hideBelow="md">{driver.provider?.name ?? "—"}</Cell>
                <Cell hideBelow="lg">
                  {driver.languages.map((code) => languageLabels[code as DriverLanguage] ?? code).join(", ") || "—"}
                </Cell>
                <Cell>
                  <DriverVerificationBadge status={driver.verificationStatus} />
                </Cell>
                <Cell hideBelow="sm">
                  {!driver.user ? "—" : driver.user.isPending ? "Pending" : driver.user.isActive ? "Active" : "Off"}
                </Cell>
              </Row>
            ))
          )}
        </DataTable>
      </div>

      <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-[0.8125rem] text-muted">
        <p aria-live="polite">{total === 0 ? "No drivers" : `${from}–${to} of ${total}`}</p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)} className="h-8 rounded-sm border border-line px-3 disabled:opacity-40">
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => goToPage(page + 1)} className="h-8 rounded-sm border border-line px-3 disabled:opacity-40">
            Next
          </button>
        </div>
      </nav>
    </div>
  );
}
