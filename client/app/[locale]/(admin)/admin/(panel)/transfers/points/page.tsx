import Link from "next/link";
import type { Metadata } from "next";
import { MapPin, Plane, Plus, Star } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { StatCard } from "@/components/admin/StatCard";
import { TransferPointSearch } from "@/components/admin/TransferPointSearch";
import { listAdminTransferPoints } from "@/lib/api/transfers";
import { pointKindLabels } from "@/lib/admin/transfers";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Pick-up points" };

/**
 * The pick-up and drop-off network.
 *
 * A register: what exists, what is missing, and a way into each record. The
 * editing itself happens on the point's own page, where the coordinates are a
 * map rather than two numbers in a table row — a point's coordinates *are* the
 * fare wherever a route has no curated price, so a place to fat-finger one
 * inline is a place to quietly reprice a dozen journeys.
 *
 * Retired points are listed too, greyed and labelled. They are hidden from the
 * traveller's picker, and an operator looking for a place that has vanished
 * from search needs to find it here rather than conclude it was deleted.
 */
export default async function AdminTransferPointsPage({
  searchParams,
}: PageProps<"/[locale]/admin/transfers/points">) {
  const session = await requireScreen();
  const params = await searchParams;
  const searchParam = Array.isArray(params.search) ? params.search[0] : params.search;

  const [{ data: points }, { path }] = await Promise.all([
    listAdminTransferPoints(searchParam ? { search: searchParam } : {}),
    getI18n(),
  ]);

  const live = points.filter((point) => point.status !== "INACTIVE" && point.status !== "ARCHIVED");
  const airports = live.filter((point) => point.kind === "AIRPORT");
  const popular = live.filter((point) => point.popular);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Pick-up points"
        description="Every place a journey can start or end. Coordinates here price any route that has no fare of its own."
        actions={
          can(session, "catalogue.write") && (
            <Link
              href={path("/admin/transfers/points/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add a point
            </Link>
          )
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Points in service" value={String(live.length)} icon={MapPin} />
        <StatCard label="Airports" value={String(airports.length)} icon={Plane} />
        <StatCard
          label="Shown first"
          value={String(popular.length)}
          icon={Star}
          hint="Surfaced in the picker before anyone types"
        />
      </div>

      <div className="mt-8">
        <TransferPointSearch />
      </div>

      <div className="mt-6 rounded-sm border border-line bg-surface">
        <DataTable
          caption="Pick-up points"
          columns={[
            { label: "Place" },
            { label: "Kind", hideBelow: "sm" },
            { label: "Region", hideBelow: "md" },
            { label: "Coordinates", align: "end", hideBelow: "lg" },
            { label: "Timezone", hideBelow: "xl" },
            { label: "Status" },
          ]}
        >
          {points.length === 0 ? (
            <EmptyRow
              colSpan={6}
              message={
                searchParam
                  ? `Nothing matches “${searchParam}”.`
                  : "No pick-up points yet. Add one to start building routes."
              }
            />
          ) : (
            points.map((point) => {
              const retired = point.status === "INACTIVE" || point.status === "ARCHIVED";

              return (
                <Row key={point.id} className={retired ? "opacity-60" : undefined}>
                  <Cell>
                    <Link
                      href={path(`/admin/transfers/points/${point.id}`)}
                      className="font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {point.name}
                    </Link>
                    <span className="type-caption mt-0.5 block text-subtle">
                      {point.slug}
                      {point.code ? ` · ${point.code}` : ""}
                      {point.popular ? " · shown first" : ""}
                    </span>
                  </Cell>
                  <Cell hideBelow="sm">{pointKindLabels[point.kind] ?? point.kind}</Cell>
                  <Cell hideBelow="md">{point.region}</Cell>
                  <Cell align="end" hideBelow="lg" className="tabular-nums">
                    {point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}
                  </Cell>
                  <Cell hideBelow="xl">{point.timezone}</Cell>
                  <Cell>
                    {retired ? (
                      <span className="inline-flex items-center rounded-sm border border-line bg-surface-soft px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-subtle uppercase">
                        Retired
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-sm border border-success/40 bg-success/10 px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-success uppercase">
                        In service
                      </span>
                    )}
                  </Cell>
                </Row>
              );
            })
          )}
        </DataTable>
      </div>
    </AdminContainer>
  );
}
