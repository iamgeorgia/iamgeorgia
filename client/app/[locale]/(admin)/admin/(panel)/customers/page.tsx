import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { CustomersBrowser } from "@/components/admin/CustomersBrowser";
import { NewCustomerButton } from "@/components/admin/CustomerForm";
import { listCustomers } from "@/lib/api/customers";
import { customerQueryFromParams } from "@/lib/admin/customers";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Customers" };

/**
 * The customers register: the people and companies the desk books for when
 * the buyer has no partner account. Read by whoever reads bookings; a new
 * customer is the desk's to add (`bookings.write`), here or inline on the
 * booking wizard.
 */
export default async function AdminCustomersPage({ searchParams }: PageProps<"/[locale]/admin/customers">) {
  const session = await requireScreen();
  const list = await listCustomers(customerQueryFromParams(await searchParams));

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Customers"
        description="Buyers without a partner account: the people and companies the desk books for."
        actions={can(session, "bookings.write") ? <NewCustomerButton /> : undefined}
      />

      <div className="mt-8">
        <CustomersBrowser {...list} />
      </div>
    </AdminContainer>
  );
}
