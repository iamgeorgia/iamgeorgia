import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { HotelLocationEditor } from "@/components/admin/HotelLocationEditor";
import { getHotel } from "@/lib/api/hotels";
import { ApiError } from "@/lib/api/client";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Location" };

/**
 * Where the property is.
 *
 * The coordinates set here are load-bearing well beyond the map on the hotel
 * page: search distance, and later transfers and recommendations, all join on
 * the PostGIS point the server derives from them. The publish checklist
 * refuses a property that has not been placed.
 */
export default async function HotelLocationPage({
  params,
}: PageProps<"/[locale]/admin/hotels/[slug]/location">) {
  const { slug } = await params;
  const { path } = await getI18n();

  let hotel;

  try {
    hotel = await getHotel(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Hotels", href: path("/admin/hotels") },
          { label: hotel.name, href: path(`/admin/hotels/${hotel.id}`) },
          { label: "Location" },
        ]}
      />
      <AdminPageHeader
        title="Location"
        description="The address guests are given, and the exact point on the map that search and distances are measured from."
      />

      <div className="mt-8">
        <HotelLocationEditor hotel={hotel} />
      </div>
    </AdminContainer>
  );
}
