import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { PackageTranslationsEditor } from "@/components/admin/PackageTranslationsEditor";
import { ApiError } from "@/lib/api/client";
import { getPackage, listPackageTranslations } from "@/lib/api/packages";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Package translations" };

/**
 * The prose of a package in the other three languages.
 *
 * Facts — nights, dates, party limits, the adjustment — are not language and
 * are not here.
 */
export default async function AdminPackageTranslationsPage({
  params,
}: PageProps<"/[locale]/admin/packages/[slug]/translations">) {
  await requireScreen();
  const { slug } = await params;
  const { path } = await getI18n();

  let pkg;

  try {
    pkg = await getPackage(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const translations = await listPackageTranslations(pkg.id);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Packages", href: path("/admin/packages") },
          { label: pkg.name, href: path(`/admin/packages/${pkg.id}`) },
          { label: "Translations" },
        ]}
      />

      <AdminPageHeader title="Translations" description="Georgian, Russian and Hebrew prose. A blank field falls back to English rather than blanking the page." />

      <div className="mt-8">
        <AdminPanel title="Locales">
          <PackageTranslationsEditor pkg={pkg} translations={translations.data} />
        </AdminPanel>
      </div>
    </AdminContainer>
  );
}
