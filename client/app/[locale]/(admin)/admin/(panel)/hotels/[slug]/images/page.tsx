import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { GalleryManager } from "@/components/admin/GalleryManager";
import { RoomGalleries } from "@/components/admin/RoomGalleries";
import { getHotel } from "@/lib/api/hotels";
import { ApiError } from "@/lib/api/client";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Images" };

/**
 * The property gallery.
 *
 * Upload and attach are one action here, though the API keeps them separate:
 * the file goes to the media library — sniffed, re-encoded, EXIF stripped —
 * and is then attached to this hotel's gallery. Renditions come back with it,
 * so what the operator sees is exactly what a card will serve.
 */
export default async function HotelImagesPage({
  params,
}: PageProps<"/[locale]/admin/hotels/[slug]/images">) {
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

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Hotels", href: path("/admin/hotels") },
          { label: hotel.name, href: path(`/admin/hotels/${hotel.id}`) },
          { label: "Images" },
        ]}
      />
      <AdminPageHeader
        title="Images"
        description="The gallery guests see. The first image becomes the cover unless another is chosen; JPEG, PNG, WebP and AVIF are accepted, up to 10 MB."
      />

      <div className="mt-8">
        <GalleryManager hotel={hotel} />
      </div>

      <div className="mt-12">
        <h2 className="text-[1.0625rem] font-semibold text-ink">Room images</h2>
        <p className="mt-1 text-[0.8125rem] text-muted">
          What search shows for each room. Upload straight into a room, or push a gallery image
          into one with “Add to room” above — the file is shared, never copied.
        </p>
        <div className="mt-4">
          <RoomGalleries hotel={hotel} />
        </div>
      </div>
    </AdminContainer>
  );
}
