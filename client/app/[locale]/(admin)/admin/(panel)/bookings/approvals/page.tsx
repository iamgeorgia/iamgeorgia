import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { BookingApprovalsBrowser } from "@/components/admin/BookingApprovalsBrowser";
import { bookingApprovalQueryFromParams } from "@/lib/admin/bookingApprovals";
import { listBookingApprovals } from "@/lib/api/bookingApprovals";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Booking approvals" };

/**
 * The approval queue (owner decision OD1): every hotel, transfer, tour and
 * service booking and every order waiting for the platform's yes, across the
 * four registers, earliest deadline first. Nothing is confirmed, no supplier
 * is told and no invoice issues until a row here is approved.
 */
export default async function AdminBookingApprovalsPage({
  searchParams,
}: PageProps<"/[locale]/admin/bookings/approvals">) {
  await requireScreen();
  const list = await listBookingApprovals(bookingApprovalQueryFromParams(await searchParams));

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Booking approvals"
        description="Every booking waits here for a yes before it is confirmed. Approve to confirm it, tell the supplier and issue the invoice; reject to release what is held."
        help="bk-booking-approvals"
      />

      <div className="mt-8">
        <BookingApprovalsBrowser
          data={list.data}
          total={list.total}
          page={list.page}
          pageSize={list.pageSize}
          totalPages={list.totalPages}
          now={new Date().toISOString()}
        />
      </div>
    </AdminContainer>
  );
}
