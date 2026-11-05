import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { TourDetailsEditor } from "@/components/admin/TourDetailsEditor";
import { getTour } from "@/lib/api/tours";
import { ApiError } from "@/lib/api/client";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Details & itinerary" };

/** Words, ages, the meeting point and the day-by-day. Prices live on the options screen. */
export default async function TourDetailsPage({ params }: PageProps<"/[locale]/admin/tours/[slug]/details">) {
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
          { label: "Details & itinerary" },
        ]}
      />
      <AdminPageHeader
        title="Details & itinerary"
        description="The English record. Every list and the itinerary are sent whole on save."
      />

      <div className="mt-8">
        <TourDetailsEditor tour={tour} />
      </div>
    </AdminContainer>
  );
}
