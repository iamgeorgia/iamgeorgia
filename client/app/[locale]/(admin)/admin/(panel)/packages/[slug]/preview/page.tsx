import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { PackagePreviewQuote } from "@/components/admin/PackagePreviewQuote";
import { ApiError } from "@/lib/api/client";
import { getPackage } from "@/lib/api/packages";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Package preview" };

/**
 * What a partner would see, before a partner sees it.
 *
 * A package has no price of its own, so whether a template actually sells can
 * only be answered by quoting it for one date and one party. Finding a broken
 * slot here is the whole reason the screen exists.
 */
export default async function AdminPackagePreviewPage({
  params,
}: PageProps<"/[locale]/admin/packages/[slug]/preview">) {
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
          { label: "Preview" },
        ]}
      />

      <AdminPageHeader title="Preview a quote" description="The real engine, run as staff, on any date. Works on a draft — which is the point." />

      <div className="mt-8">
        <AdminPanel title="Quote">
          <PackagePreviewQuote pkg={pkg} />
        </AdminPanel>
      </div>
    </AdminContainer>
  );
}
