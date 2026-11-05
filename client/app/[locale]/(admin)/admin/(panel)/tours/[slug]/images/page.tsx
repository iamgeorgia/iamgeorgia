import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { TourGalleryManager } from "@/components/admin/TourGalleryManager";
import { getTour } from "@/lib/api/tours";
import { ApiError } from "@/lib/api/client";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Images" };

export default async function TourImagesPage({ params }: PageProps<"/[locale]/admin/tours/[slug]/images">) {
  await requireScreen();
  const { slug } = await params;
  const { path } = await getI18n();

  let tour;

  try {
    tour = await getTour(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Tours", href: path("/admin/tours") },
          { label: tour.title, href: path(`/admin/tours/${tour.id}`) },
          { label: "Images" },
        ]}
      />
      <AdminPageHeader
        title="Images"
        description="The gallery travellers see. The first upload becomes the cover unless another is chosen; JPEG, PNG, WebP and AVIF are accepted, up to 10 MB."
      />

      <div className="mt-8">
        <TourGalleryManager tour={tour} />
      </div>
    </AdminContainer>
  );
}
