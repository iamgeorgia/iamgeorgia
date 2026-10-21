import type { Metadata } from "next";
import { AlertTriangle, Layers, ShieldQuestion } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { AllBookingsBrowser } from "@/components/admin/AllBookingsBrowser";
import { CreateBookingButton } from "@/components/admin/CreateBookingButton";
import { StatCard } from "@/components/admin/StatCard";
import { BOOKING_APPROVAL_PRODUCTS } from "@/lib/admin/bookingApprovals";
import { bookingFiltersFromParams } from "@/lib/admin/bookingFilters";
import { todayISO } from "@/lib/admin/dates";
import { listAllBookings } from "@/lib/api/bookingIndex";
import { requireScreen } from "@/lib/auth/session";
import type { BookingApprovalProduct } from "@/types/booking";

export const metadata: Metadata = { title: "All bookings" };

const PAGE_SIZE = 25;

/**
 * The register of every booking: hotels, transfers, tours, services and
 * orders in one list, read from the booking index.
 *
 * This is the screen a desk opens with a name or an email and no idea which
 * register the booking is on. Each row says which product it is and links to
 * that product's own detail page, where the booking is worked; nothing is
 * changed here.
 *
 * Filtering is read out of the URL and applied on the server, so the list
 * survives a reload, can be shared with a colleague, and costs the same for
 * forty bookings as for forty thousand. The two counting queries ask for a
 * single row: they want a total, not the records.
 */
export default async function AdminAllBookingsPage({ searchParams }: PageProps<"/[locale]/admin/bookings/all">) {
  await requireScreen();
  const params = await searchParams;
  const { product, ...filters } = bookingFiltersFromParams(params, { products: BOOKING_APPROVAL_PRODUCTS });
  const query = { ...filters, product: product as BookingApprovalProduct[] | undefined, pageSize: PAGE_SIZE };

  const [list, awaiting, overdue] = await Promise.all([
    listAllBookings(query),
    listAllBookings({ approval: "PENDING", pageSize: 1 }),
    listAllBookings({ paymentStatus: "OVERDUE", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="All bookings"
        description="Every booking on the platform, whatever the product, in one list — for the moment you have a name and no reference."
        actions={<CreateBookingButton />}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting approval" value={String(awaiting.total)} icon={ShieldQuestion} hint="Nothing is confirmed until somebody says yes" />
        <StatCard label="Overdue payments" value={String(overdue.total)} icon={AlertTriangle} />
        <StatCard label="All bookings" value={String(list.total)} icon={Layers} />
      </div>

      <div className="mt-8">
        <AllBookingsBrowser {...list} today={todayISO()} />
      </div>
    </AdminContainer>
  );
}
