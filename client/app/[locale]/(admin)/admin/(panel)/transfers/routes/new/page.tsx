import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewTransferRouteForm } from "@/components/admin/NewTransferRouteForm";
import { listAdminTransferPoints } from "@/lib/api/transfers";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add a route" };

/**
 * A new named journey.
 *
 * Retired points are filtered out here rather than in the form: a route built
 * on a point that is out of service would be unsearchable from the day it was
 * created, and offering one in the dropdown is offering a mistake.
 */
export default async function NewTransferRoutePage() {
  await requireScreen();
  const [{ data: points }, { path }] = await Promise.all([
    listAdminTransferPoints(),
    getI18n(),
  ]);

  const sellable = points.filter(
    (point) => point.status !== "INACTIVE" && point.status !== "ARCHIVED",
  );

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Transfer routes", href: path("/admin/transfers/routes") },
          { label: "Add a route" },
        ]}
      />

      <AdminPageHeader
        title="Add a route"
        description="A named journey between two pick-up points. It is created as a draft — pricing it across the vehicle classes is the next step, and the publish checklist will not let it go live until you have."
      />

      <div className="mt-8 max-w-3xl rounded-sm border border-line bg-surface p-6">
        <NewTransferRouteForm points={sellable} />
      </div>
    </AdminContainer>
  );
}
