import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { PaymentPoliciesManager } from "@/components/admin/PaymentPoliciesManager";
import { listPaymentPolicyTemplates } from "@/lib/api/payments";
import { listAdminTransferProviders } from "@/lib/api/transfers";
import { requireScreen } from "@/lib/auth/session";
import type { PaymentPolicy } from "@/types/catalogue";
import type { PaymentPolicyProductKind } from "@/types/payments";

export const metadata: Metadata = { title: "Payment terms" };

/**
 * The card rules tours, packages and transfer suppliers are sold under:
 * whether the guest must pay by card, may pay later, or settles on the spot.
 * Hotel rate plans keep their own picker on the rooms screen.
 */
export default async function PaymentPoliciesPage() {
  await requireScreen();

  const [tours, packages, transfers, providers] = await Promise.all([
    listPaymentPolicyTemplates({ productKind: "TOUR", includeInactive: true }),
    listPaymentPolicyTemplates({ productKind: "PACKAGE", includeInactive: true }),
    listPaymentPolicyTemplates({ productKind: "TRANSFER", includeInactive: true }),
    listAdminTransferProviders(),
  ]);

  const policies: Record<PaymentPolicyProductKind, PaymentPolicy[]> = {
    TOUR: tours.data,
    PACKAGE: packages.data,
    TRANSFER: transfers.data,
  };

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Payment terms"
        description="Whether a guest must pay by card at checkout, may pay later, or settles on the spot, per product. Items with nothing attached use the platform default."
      />

      <div className="mt-8">
        <PaymentPoliciesManager policies={policies} providers={providers.data} />
      </div>
    </AdminContainer>
  );
}
