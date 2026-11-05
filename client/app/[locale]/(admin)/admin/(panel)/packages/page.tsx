import Link from "next/link";
import type { Metadata } from "next";
import { Boxes, CheckCircle2, PenLine, Plus } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { PackagesBrowser } from "@/components/admin/PackagesBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listPackages } from "@/lib/api/packages";
import { packageQueryFromParams } from "@/lib/admin/packages";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Packages" };

/**
 * The package register.
 *
 * Live records, filtered on the server through the URL — the same shape as
 * the hotels and tours lists. The counting queries ask for one row each; they
 * want totals, not records.
 */
export default async function AdminPackagesPage({
  searchParams,
}: PageProps<"/[locale]/admin/packages">) {
  const session = await requireScreen();
  const { path } = await getI18n();
  const query = packageQueryFromParams(await searchParams);

  const [list, active, drafts] = await Promise.all([
    listPackages(query),
    listPackages({ status: "ACTIVE", pageSize: 1 }),
    listPackages({ status: "DRAFT", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Packages"
        description="Trips assembled from a hotel, transfers, tours and services, sold and cancelled as one."
        actions={
          can(session, "catalogue.write") ? (
            <Link
              href={path("/admin/packages/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add package
            </Link>
          ) : undefined
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="On sale"
          value={String(active.total)}
          icon={CheckCircle2}
          hint="Quotable and bookable"
        />
        <StatCard
          label="Drafts"
          value={String(drafts.total)}
          icon={PenLine}
          hint="Being assembled, invisible to buyers"
        />
        <StatCard label="All packages" value={String(list.total)} icon={Boxes} />
      </div>

      <div className="mt-8">
        <PackagesBrowser {...list} />
      </div>
    </AdminContainer>
  );
}
