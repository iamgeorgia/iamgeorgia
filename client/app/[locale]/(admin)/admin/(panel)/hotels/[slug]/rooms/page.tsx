import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { RoomsManager } from "@/components/admin/RoomsManager";
import { getHotel, listCancellationPolicies, listPaymentPolicies } from "@/lib/api/hotels";
import { ApiError } from "@/lib/api/client";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Rooms & rates" };

/**
 * Rooms and their rate plans, for one property.
 *
 * The hotel detail carries every room with its plans, beds and images in one
 * request; the policy lists ride alongside so the rate-plan form can always
 * offer the platform templates, even on an empty property.
 */
export default async function HotelRoomsPage({
  params,
}: PageProps<"/[locale]/admin/hotels/[slug]/rooms">) {
  await requireScreen();
  const { slug } = await params;
  const { path } = await getI18n();

  let hotel;

  try {
    hotel = await getHotel(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // The hotel's own policies plus the shared platform templates, so the
  // rate-plan form always has Flexible / Non-refundable / Tiered to offer even
  // on a property that has nothing yet.
  const [cancellations, payments] = await Promise.all([
    listCancellationPolicies(hotel.id),
    listPaymentPolicies(hotel.id),
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Hotels", href: path("/admin/hotels") },
          { label: hotel.name, href: path(`/admin/hotels/${hotel.id}`) },
          { label: "Rooms & rates" },
        ]}
      />
      <AdminPageHeader
        title="Rooms & rates"
        description="The physical rooms, and the offers each one is sold as. One room sold with two boards and two cancellation terms is one room and four rate plans — never four rooms."
      />

      <div className="mt-8">
        <RoomsManager hotel={hotel} cancellations={cancellations.data} payments={payments.data} />
      </div>
    </AdminContainer>
  );
}
