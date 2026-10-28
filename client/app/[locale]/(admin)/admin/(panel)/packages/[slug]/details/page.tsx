import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { PackageDetailsEditor } from "@/components/admin/PackageDetailsEditor";
import { ApiError } from "@/lib/api/client";
import { getPackage } from "@/lib/api/packages";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Package details" };

/** Everything about a package that is not one of its slots. */
export default async function AdminPackageDetailsPage({
  params,
}: PageProps<"/[locale]/admin/packages/[slug]/details">) {
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
          { label: "Details" },
        ]}
      />

      <AdminPageHeader
        title="Details & pricing"
        description="The prose a buyer reads, the party it fits, the windows it sells in, and the adjustment that makes it a package rather than four bookings."
      />

      <div className="mt-8">
        <AdminPanel title="Package">
          <PackageDetailsEditor pkg={pkg} />
        </AdminPanel>
      </div>
    </AdminContainer>
  );
}
