import Link from "next/link";
import type { Metadata } from "next";
import { Globe2, MapPinned, Plus, Star } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { DestinationsBrowser } from "@/components/admin/DestinationsBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listDestinations } from "@/lib/api/hotels";
import { destinationQueryFromParams } from "@/lib/admin/destinations";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Destinations" };

/**
 * The geography spine.
 *
 * Every hotel, tour, transfer point and pricing rule is filed under one of
 * these, and "everything in Georgia" is a prefix match on the path they form —
 * so this register is less a catalogue than the index the rest of the panel is
 * sorted by. That is why the counting cards ask about *coverage* (how many
 * countries, how many places carry hotels) rather than about volume.
 *
 * Filtering runs on the server through the URL, the same shape as the hotels
 * and routes lists. The counting queries ask for one row each; they want
 * totals, not records.
 */
export default async function AdminDestinationsPage({
  searchParams,
}: PageProps<"/[locale]/admin/destinations">) {
  const session = await requireScreen();
  const { path } = await getI18n();
  const params = await searchParams;
  const query = destinationQueryFromParams(params);

  // The cards count the catalogue, not the current filter — so each is its own
  // one-row query rather than a number read off the filtered page.
  const [list, all, countries, featured] = await Promise.all([
    listDestinations(query),
    listDestinations({ pageSize: 1 }),
    listDestinations({ type: "COUNTRY", pageSize: 1 }),
    listDestinations({ featured: true, pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Destinations"
        description="Countries, regions, cities and resorts. Everything else on the platform is filed under one of these, and searching a whole country is a search of the tree they form."
        actions={
          can(session, "catalogue.write") && (
            <Link
              href={path("/admin/destinations/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add destination
            </Link>
          )
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Places on the map" value={String(all.total)} icon={MapPinned} />
        <StatCard
          label="Countries"
          value={String(countries.total)}
          icon={Globe2}
          hint="Roots of the tree. Everything below inherits their country code."
        />
        <StatCard
          label="Featured"
          value={String(featured.total)}
          icon={Star}
          hint="Marked for anywhere that asks for a curated list"
        />
      </div>

      <div className="mt-8">
        <DestinationsBrowser
          data={list.data}
          total={list.total}
          page={list.page}
          pageSize={list.pageSize}
          totalPages={list.totalPages}
        />
      </div>
    </AdminContainer>
  );
}
