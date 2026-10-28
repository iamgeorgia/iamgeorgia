import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewHotelForm } from "@/components/admin/NewHotelForm";
import { getDestinationTree } from "@/lib/api/hotels";
import { listPartners } from "@/lib/api/partners";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add property" };

/**
 * Step one of the property wizard.
 *
 * Deliberately tiny: the handful of things an admin knows before they know
 * anything else. Submitting creates a DRAFT and lands on the property page,
 * whose publish checklist then walks them through the rest — so an interrupted
 * setup is a resumable record, not lost form state.
 */
export default async function NewHotelPage() {
  await requireScreen();
  const { path } = await getI18n();

  const [tree, suppliers] = await Promise.all([
    getDestinationTree(),
    // Only hotel-kind partners can supply a property.
    listPartners({ status: "APPROVED", kind: "HOTEL", pageSize: 100 }),
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Hotels", href: path("/admin/hotels") }, { label: "Add property" }]}
      />
      <AdminPageHeader
        title="Add a property"
        description="Name it and place it. Everything else — rooms, rates, images, policies — is filled in on the property page it creates."
      />

      <div className="mt-8 max-w-2xl">
        <NewHotelForm destinations={tree.data} suppliers={suppliers.data} />
      </div>
    </AdminContainer>
  );
}
