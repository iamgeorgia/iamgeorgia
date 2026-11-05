import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { TransferPointForm } from "@/components/admin/TransferPointForm";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add a pick-up point" };

/**
 * A new place a journey can start or end.
 *
 * The whole record in one form, unlike the hotel wizard: a point is twelve
 * fields and has no publish checklist to walk anybody through, so splitting it
 * into steps would be ceremony around something an operator finishes in a
 * minute. It is created ACTIVE and appears in the picker straight away.
 */
export default async function NewTransferPointPage() {
  await requireScreen();
  const { path } = await getI18n();

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Pick-up points", href: path("/admin/transfers/points") },
          { label: "Add a point" },
        ]}
      />

      <AdminPageHeader
        title="Add a pick-up point"
        description="A place a transfer can start or end. Its coordinates price every route through it that has no fare of its own, so place it on the map rather than typing numbers."
      />

      <div className="mt-8 rounded-sm border border-line bg-surface p-6">
        <TransferPointForm />
      </div>
    </AdminContainer>
  );
}
