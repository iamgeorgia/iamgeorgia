import Link from "next/link";
import type { Metadata } from "next";
import { BedDouble, CheckCircle2, PenLine, Plus } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { HotelsBrowser } from "@/components/admin/HotelsBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listHotels } from "@/lib/api/hotels";
import { hotelQueryFromParams } from "@/lib/admin/hotels";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Hotels" };

/**
 * The property catalogue.
 *
 * Live records, filtered on the server through the URL — the same shape as the
 * partners and bookings lists, and for the same reason: the browser writes a
 * query string, this re-renders, and nothing scales with how many hotels exist.
 *
 * The counting queries ask for one row each; they want totals, not records.
 */
export default async function AdminHotelsPage({
  searchParams,
}: PageProps<"/[locale]/admin/hotels">) {
  const session = await requireScreen();
  const { path } = await getI18n();
  const params = await searchParams;
  const query = hotelQueryFromParams(params);

  const [list, active, drafts] = await Promise.all([
    listHotels(query),
    listHotels({ status: "ACTIVE", pageSize: 1 }),
    listHotels({ status: "DRAFT", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Hotels"
        description="Every property on the platform and where each sits in its lifecycle."
        actions={
          can(session, "catalogue.write") && (
            <Link
              href={path("/admin/hotels/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add property
            </Link>
          )
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="On sale"
          value={String(active.total)}
          icon={CheckCircle2}
          hint="Visible in search and bookable"
        />
        <StatCard
          label="Drafts"
          value={String(drafts.total)}
          icon={PenLine}
          hint="Being set up, invisible to guests"
        />
        <StatCard label="All properties" value={String(list.total)} icon={BedDouble} />
      </div>

      <div className="mt-8">
        <HotelsBrowser {...list} />
      </div>
    </AdminContainer>
  );
}
