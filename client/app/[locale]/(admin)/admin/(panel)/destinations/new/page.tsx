import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { DestinationForm } from "@/components/admin/DestinationForm";
import { getDestinationTree } from "@/lib/api/hotels";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add a destination" };

/**
 * A new place for things to be filed under.
 *
 * The whole record in one form, like the pick-up point and unlike the hotel
 * wizard: a destination has no publish checklist to walk anybody through, and
 * everything below the structural half is optional, so splitting it into steps
 * would be ceremony around something an operator finishes in a minute.
 *
 * The tree is read here rather than inside the form because the parent picker
 * needs it during the first render — it is tens of rows, so it ships whole.
 */
export default async function NewDestinationPage() {
  await requireScreen();
  const [{ path }, tree] = await Promise.all([getI18n(), getDestinationTree()]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Destinations", href: path("/admin/destinations") },
          { label: "Add a destination" },
        ]}
      />

      <AdminPageHeader
        title="Add a destination"
        description="Name it and say where it sits. Its place in the tree is what decides which searches find the hotels, tours and transfers filed under it, so that half is worth getting right; the editorial copy underneath can wait."
      />

      <div className="mt-8 rounded-sm border border-line bg-surface p-6">
        <DestinationForm tree={tree.data} />
      </div>
    </AdminContainer>
  );
}
