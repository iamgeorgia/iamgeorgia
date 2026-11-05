import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Compass, PenLine, Plus } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { StatCard } from "@/components/admin/StatCard";
import { ToursBrowser } from "@/components/admin/ToursBrowser";
import { listTours } from "@/lib/api/tours";
import { tourQueryFromParams } from "@/lib/admin/tours";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Tours" };

/**
 * The tour register.
 *
 * Live records, filtered on the server through the URL — the same shape as
 * the hotels list. The counting queries ask for one row each; they want
 * totals, not records.
 */
export default async function AdminToursPage({ searchParams }: PageProps<"/[locale]/admin/tours">) {
  const session = await requireScreen();
  const { path } = await getI18n();
  const query = tourQueryFromParams(await searchParams);

  const [list, active, drafts] = await Promise.all([
    listTours(query),
    listTours({ status: "ACTIVE", pageSize: 1 }),
    listTours({ status: "DRAFT", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Tours"
        description="Every journey on the platform and where each sits in its lifecycle."
        actions={
          can(session, "catalogue.write", "tours.write") ? (
            <Link
              href={path("/admin/tours/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add tour
            </Link>
          ) : undefined
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="On sale" value={String(active.total)} icon={CheckCircle2} hint="Visible in search and bookable" />
        <StatCard label="Drafts" value={String(drafts.total)} icon={PenLine} hint="Being set up, invisible to travellers" />
        <StatCard label="All tours" value={String(list.total)} icon={Compass} />
      </div>

      <div className="mt-8">
        <ToursBrowser {...list} />
      </div>
    </AdminContainer>
  );
}
