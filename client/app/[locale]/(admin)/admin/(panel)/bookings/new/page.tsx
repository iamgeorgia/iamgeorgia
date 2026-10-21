import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { CreateBookingWizard } from "@/components/admin/booking-desk/CreateBookingWizard";
import { getCustomer } from "@/lib/api/customers";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import type { Customer } from "@/types/customer";

export const metadata: Metadata = { title: "Create booking" };

/**
 * The desk: a booking made by phone, by email, through another agency or
 * face to face, for a partner or for a customer with no account. The same
 * products, prices and approval step as a booking made on the site; the
 * wizard only says who it is for and where it came from.
 *
 * `?customerId=` preselects the buyer — the customer page's "Create booking"
 * arrives this way — and the customer is read here so the wizard can prefill
 * the lead traveller without a round trip from the browser.
 */
export default async function AdminCreateBookingPage({ searchParams }: PageProps<"/[locale]/admin/bookings/new">) {
  await requireScreen();
  const params = await searchParams;
  const { path } = await getI18n();

  const customerId = Array.isArray(params.customerId) ? params.customerId[0] : params.customerId;
  let initialCustomer: Customer | null = null;

  if (customerId) {
    try {
      initialCustomer = await getCustomer(customerId);
    } catch {
      // An unknown id is not a reason to refuse the desk: the wizard opens unprefilled.
      initialCustomer = null;
    }
  }

  return (
    <AdminContainer>
      <AdminBreadcrumbs items={[{ label: "Bookings", href: path("/admin/bookings") }, { label: "Create booking" }]} />

      <AdminPageHeader
        title="Create booking"
        description="A booking taken at the desk — by phone, by email, through another agency or in person — for a partner or a customer without an account."
      />

      <CreateBookingWizard initialCustomer={initialCustomer} />
    </AdminContainer>
  );
}
