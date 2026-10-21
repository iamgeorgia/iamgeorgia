import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { TourTranslationsEditor } from "@/components/admin/TourTranslationsEditor";
import { getTour, listTourTranslations } from "@/lib/api/tours";
import { ApiError } from "@/lib/api/client";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Translations" };

export default async function TourTranslationsPage({ params }: PageProps<"/[locale]/admin/tours/[slug]/translations">) {
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

  const translations = await listTourTranslations(tour.id);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Tours", href: path("/admin/tours") },
          { label: tour.title, href: path(`/admin/tours/${tour.id}`) },
          { label: "Translations" },
        ]}
      />
      <AdminPageHeader
        title="Translations"
        description="The prose in Georgian, Russian and Hebrew. A field left blank shows the English on the public page."
      />

      <div className="mt-8">
        <TourTranslationsEditor tour={tour} translations={translations.data} />
      </div>
    </AdminContainer>
  );
}
