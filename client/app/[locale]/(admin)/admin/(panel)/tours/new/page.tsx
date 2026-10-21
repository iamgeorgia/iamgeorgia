import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { NewTourForm } from "@/components/admin/NewTourForm";
import { getDestinationTree } from "@/lib/api/hotels";
import { listPartners } from "@/lib/api/partners";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add tour" };

/**
 * Step one of the tour wizard: what the server insists on before it will make
 * a record. Submitting creates a DRAFT and lands on the tour page, whose
 * publish checklist walks the operator through the rest.
 */
export default async function NewTourPage() {
  await requireScreen();
  const { path } = await getI18n();

  const [tree, suppliers] = await Promise.all([
    getDestinationTree(),
    listPartners({ status: "APPROVED", kind: "TOUR_OPERATOR", pageSize: 100 }),
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs items={[{ label: "Tours", href: path("/admin/tours") }, { label: "Add tour" }]} />
      <AdminPageHeader
        title="Add a tour"
        description="Name it and place it. Options, prices, departures, images and the itinerary are filled in on the tour page it creates."
      />

      <div className="mt-8 max-w-3xl">
        <NewTourForm destinations={tree.data} suppliers={suppliers.data} />
      </div>
    </AdminContainer>
  );
}
