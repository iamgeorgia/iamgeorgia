import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { TransferPointDangerZone } from "@/components/admin/TransferPointDangerZone";
import { TransferPointForm } from "@/components/admin/TransferPointForm";
import { ApiError } from "@/lib/api/client";
import { getAdminTransferPoint, listAdminTransferRoutes } from "@/lib/api/transfers";
import { pointKindLabels } from "@/lib/admin/transfers";
import { getI18n } from "@/lib/i18n/server";
import type { TransferPoint } from "@/types/transfer";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Pick-up point" };

/**
 * One pick-up point.
 *
 * The sidebar counts the routes that touch this place, because that number is
 * the thing an operator wants before they change anything here: moving a pin
 * reprices every unpriced journey through it, and retiring it takes the place
 * out of the picker those journeys are searched from. The count is read with
 * `pageSize: 1` — the total is the answer, the records are not.
 */
export default async function AdminTransferPointPage({
  params,
}: PageProps<"/[locale]/admin/transfers/points/[id]">) {
  await requireScreen();
  const { id } = await params;
  const { path } = await getI18n();

  let point: TransferPoint;

  try {
    point = await getAdminTransferPoint(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // The route list has no "touches this point" filter, but its search matches
  // either end of a journey, and the point's own name is what it indexes.
  const touching = await listAdminTransferRoutes({ search: point.name, pageSize: 1 });

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Pick-up points", href: path("/admin/transfers/points") },
          { label: point.name },
        ]}
      />

      <AdminPageHeader
        title={point.name}
        description={`${pointKindLabels[point.kind] ?? point.kind} in ${point.region}.`}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <AdminPanel title="Details">
            <TransferPointForm point={point} />
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-8 lg:col-span-4">
          <AdminPanel title="At a glance">
            <AdminDefinitionList
              items={[
                { label: "Slug", value: point.slug },
                { label: "Kind", value: pointKindLabels[point.kind] ?? point.kind },
                { label: "IATA", value: point.code ?? "—" },
                { label: "Status", value: point.status ?? "ACTIVE" },
                { label: "Time zone", value: point.timezone },
                {
                  label: "Address",
                  value: point.place?.formattedAddress ?? point.place?.name ?? "Pin placed by hand",
                },
                {
                  label: "Coordinates",
                  value: `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`,
                },
                { label: "In the picker", value: point.popular ? "Shown first" : "On search" },
                {
                  label: "Routes named after it",
                  value: (
                    <a
                      href={`${path("/admin/transfers/routes")}?search=${encodeURIComponent(point.name)}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {touching.total}
                    </a>
                  ),
                },
              ]}
            />
          </AdminPanel>

          <TransferPointDangerZone point={point} />
        </div>
      </div>
    </AdminContainer>
  );
}
