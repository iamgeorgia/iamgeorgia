import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { PackageGalleryManager } from "@/components/admin/PackageGalleryManager";
import { ApiError } from "@/lib/api/client";
import { getPackage } from "@/lib/api/packages";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Package images" };

/**
 * The package gallery.
 *
 * The same manager the tours use, over the package endpoints: the upload,
 * reorder and cover rules are identical, and two implementations of them
 * would drift.
 */
export default async function AdminPackageImagesPage({
  params,
}: PageProps<"/[locale]/admin/packages/[slug]/images">) {
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


  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Packages", href: path("/admin/packages") },
          { label: pkg.name, href: path(`/admin/packages/${pkg.id}`) },
          { label: "Images" },
        ]}
      />

      <AdminPageHeader title="Images" description="The gallery a buyer scrolls. The cover is what every card and search result uses." />

      <div className="mt-8">
        <AdminPanel title="Gallery" bodyClassName="p-0">
          <PackageGalleryManager pkg={pkg} />
        </AdminPanel>
      </div>
    </AdminContainer>
  );
}
