import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewPackageForm } from "@/components/admin/NewPackageForm";
import { getDestinationTree } from "@/lib/api/hotels";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add package" };

/**
 * Step one of the package wizard: what the server insists on before it will
 * make a record. Submitting creates a DRAFT and lands on the package page,
 * whose publish checklist walks the operator through the rest.
 */
export default async function NewPackagePage() {
  await requireScreen();
  const { path } = await getI18n();
  const tree = await getDestinationTree();

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Packages", href: path("/admin/packages") },
          { label: "Add package" },
        ]}
      />
      <AdminPageHeader
        title="Add a package"
        description="Name it, place it and say how long it runs. The slots it is assembled from, its pricing and its prose are filled in on the page it creates."
      />

      <div className="mt-8 max-w-3xl">
        <NewPackageForm destinations={tree.data} />
      </div>
    </AdminContainer>
  );
}
