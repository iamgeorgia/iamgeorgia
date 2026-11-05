import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { PackageKosherEditor } from "@/components/admin/PackageKosherEditor";
import { ApiError } from "@/lib/api/client";
import { getPackage } from "@/lib/api/packages";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Package kosher" };

/**
 * The kosher profile of one package.
 *
 * Creating the profile is the switch: a package without one shows no kosher
 * anything and is judged by no kosher rule, exactly as a hotel without one is.
 */
export default async function AdminPackageKosherPage({
  params,
}: PageProps<"/[locale]/admin/packages/[slug]/kosher">) {
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
          { label: "Kosher" },
        ]}
      />

      <AdminPageHeader title="Kosher" description="What this package promises about supervision, board and Shabbat — and the override for a case checked by hand." />

      <div className="mt-8">
        <AdminPanel title="Kosher profile">
          <PackageKosherEditor pkg={pkg} />
        </AdminPanel>
      </div>
    </AdminContainer>
  );
}
