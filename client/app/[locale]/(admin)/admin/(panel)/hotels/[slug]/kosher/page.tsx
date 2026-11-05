import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { HotelKosherEditor } from "@/components/admin/HotelKosherEditor";
import { KosherDocuments } from "@/components/admin/KosherDocuments";
import { getHotel, listAmenities } from "@/lib/api/hotels";
import { getKosher, listHotelDocuments } from "@/lib/api/kosher";
import { ApiError } from "@/lib/api/client";
import { KOSHER_AMENITY_CATEGORIES } from "@/types/catalogue";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Kosher" };

/**
 * Kosher services for one property.
 *
 * A screen of its own rather than a section on the details form. Twenty-two
 * facilities, a certificate register and a file library would swamp a page that
 * every ordinary hotel has to fill in, and none of it applies to most of them —
 * which is the same reason rooms, images and the calendar have their own
 * screens.
 *
 * The reads run in parallel and none of them depends on another: the hotel is
 * needed for its name and its current amenity set, the vocabulary for the
 * checklist, the kosher record for everything else, and the documents for the
 * certificate picker.
 */
export default async function HotelKosherPage({
  params,
}: PageProps<"/[locale]/admin/hotels/[slug]/kosher">) {
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

  const [{ data: vocabulary }, kosher, { data: documents }] = await Promise.all([
    listAmenities({ scope: "HOTEL" }),
    getKosher(hotel.id),
    listHotelDocuments(hotel.id),
  ]);

  // The three kosher categories, in the order the panel renders them. Filtered
  // here rather than asked of the API, because the amenity endpoint filters by
  // scope and not by category, and one request for the whole HOTEL vocabulary
  // is what the details screen already makes.
  const kosherVocabulary = KOSHER_AMENITY_CATEGORIES.flatMap((category) =>
    vocabulary.filter((amenity) => amenity.category === category),
  );

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Hotels", href: path("/admin/hotels") },
          { label: hotel.name, href: path(`/admin/hotels/${hotel.id}`) },
          { label: "Kosher" },
        ]}
      />
      <AdminPageHeader
        title="Kosher services"
        description="What this property offers, what we have verified, and the certificates behind it."
      />

      <div className="mt-8 flex flex-col gap-6">
        <HotelKosherEditor
          hotelId={hotel.id}
          hotelName={hotel.name}
          kosher={kosher}
          vocabulary={kosherVocabulary}
          selectedAmenityIds={hotel.amenities.map((amenity) => amenity.id)}
          documents={documents}
        />

        {/* Below the certificate register, because a file is only useful once
            there is a certificate to attach it to. */}
        {kosher && <KosherDocuments hotelId={hotel.id} documents={documents} />}
      </div>
    </AdminContainer>
  );
}
