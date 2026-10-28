import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { DestinationDangerZone } from "@/components/admin/DestinationDangerZone";
import { DestinationForm } from "@/components/admin/DestinationForm";
import { ApiError } from "@/lib/api/client";
import { getDestination, getDestinationTree, listHotels } from "@/lib/api/hotels";
import { destinationTypeLabels } from "@/lib/admin/destinations";
import { getI18n } from "@/lib/i18n/server";
import type { Destination } from "@/types/catalogue";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Destination" };

/**
 * One destination.
 *
 * The sidebar leads with what is filed here, because that number is the thing
 * an operator wants before they change anything: re-homing this record rewrites
 * the path of everything beneath it, and the path is what "every hotel in
 * Georgia" matches on. The hotel count is read with `pageSize: 1` — the total
 * is the answer, the records are not.
 *
 * Children are listed rather than counted, because each one is somewhere to go
 * next. A destination with thirty children is a region whose cities are the
 * real work.
 */
export default async function AdminDestinationPage({
  params,
}: PageProps<"/[locale]/admin/destinations/[id]">) {
  await requireScreen();
  const { id } = await params;
  const { path } = await getI18n();

  let destination: Destination;

  try {
    destination = await getDestination(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [tree, hotels] = await Promise.all([
    getDestinationTree(),
    // `destinationPath` rather than `destinationId`: the honest answer to "what
    // is filed here" includes the hotels in the cities inside this region, and
    // a prefix match is how the server asks that question.
    listHotels({ destinationPath: destination.path, pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Destinations", href: path("/admin/destinations") },
          ...(destination.parent
            ? [
                {
                  label: destination.parent.name,
                  href: path(`/admin/destinations/${destination.parent.id}`),
                },
              ]
            : []),
          { label: destination.name },
        ]}
      />

      <AdminPageHeader
        title={destination.name}
        description={
          destination.parent
            ? `${destinationTypeLabels[destination.type]} in ${destination.parent.name}.`
            : `${destinationTypeLabels[destination.type]}, and a root of the tree.`
        }
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <AdminPanel title="Details">
            <DestinationForm destination={destination} tree={tree.data} />
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-8 lg:col-span-4">
          <AdminPanel title="At a glance">
            <AdminDefinitionList
              items={[
                { label: "Slug", value: destination.slug },
                { label: "Type", value: destinationTypeLabels[destination.type] },
                {
                  label: "Path",
                  value: <span className="font-mono text-[0.8125rem]">{destination.path}</span>,
                },
                { label: "Country", value: destination.countryCode },
                { label: "Time zone", value: destination.timezone },
                ...(destination.place
                  ? [
                      {
                        label: "Address",
                        value: destination.place.formattedAddress ?? destination.place.name ?? "—",
                      },
                    ]
                  : []),
                {
                  label: "Coordinates",
                  value:
                    destination.latitude === null || destination.longitude === null
                      ? "Not placed"
                      : `${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)}`,
                },
                { label: "Featured", value: destination.featured ? "Yes" : "No" },
                // Plain text rather than a link: the hotels list filters on
                // status and property type, not on a destination path, so a
                // link would land on an unfiltered register and read as a bug.
                { label: "Hotels here and below", value: hotels.total },
              ]}
            />
          </AdminPanel>

          {destination.children.length > 0 && (
            <AdminPanel
              title="Inside this destination"
              description={`${destination.children.length} filed directly under it.`}
            >
              <ul className="space-y-2">
                {destination.children.map((child) => (
                  <li key={child.id} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={path(`/admin/destinations/${child.id}`)}
                      className="text-[0.875rem] font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {child.name}
                    </Link>
                    <span className="shrink-0 text-[0.75rem] text-subtle">
                      {destinationTypeLabels[child.type]}
                    </span>
                  </li>
                ))}
              </ul>
            </AdminPanel>
          )}

          <DestinationDangerZone destination={destination} />
        </div>
      </div>
    </AdminContainer>
  );
}
