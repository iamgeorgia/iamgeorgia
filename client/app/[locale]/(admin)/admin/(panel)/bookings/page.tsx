import type { Metadata } from "next";
import { BedDouble, CalendarCheck, CheckCircle2, Wallet } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { BookingsBrowser } from "@/components/admin/BookingsBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listAdminBookings } from "@/lib/api/bookings";
import { bookingQueryFromParams } from "@/lib/admin/bookings";
import { formatMoneyCompact } from "@/lib/money";

export const metadata: Metadata = { title: "Bookings" };

/**
 * The bookings queue.
 *
 * Filtering happens on the server, driven by the URL: the browser writes a
 * query string and this re-renders. Nothing is filtered in the browser, so the
 * page costs the same whether there are forty bookings or forty thousand.
 *
 * The counting queries ask for `pageSize: 1` — they want a total and a single
 * row, not the records.
 */
export default async function AdminBookingsPage({
  searchParams,
}: PageProps<"/[locale]/admin/bookings">) {
  const params = await searchParams;
  const query = bookingQueryFromParams(params);

  const [list, confirmed, arriving] = await Promise.all([
    listAdminBookings(query),
    listAdminBookings({ status: "CONFIRMED", pageSize: 1 }),
    // Only the total is read, so one row is all the API needs to send.
    listAdminBookings({
      status: "CONFIRMED",
      from: new Date().toISOString().slice(0, 10),
      pageSize: 1,
    }),
  ]);

  // Revenue is summed over the page in view rather than fetched whole: a total
  // across every booking ever made would mean reading every booking ever made.
  const pageValue = list.data
    .filter((booking) => booking.status !== "CANCELLED")
    .reduce((sum, booking) => sum + booking.totalCents, 0);
  const currency = list.data[0]?.currency ?? "GEL";

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Bookings"
        description="Every hotel reservation on the platform, newest first."
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Confirmed"
          value={String(confirmed.total)}
          icon={CheckCircle2}
          hint="Rooms committed"
        />
        <StatCard
          label="Arriving from today"
          value={String(arriving.total)}
          icon={CalendarCheck}
          hint="Upcoming stays"
        />
        <StatCard label="All bookings" value={String(list.total)} icon={BedDouble} />
        <StatCard
          label="Value on this page"
          value={formatMoneyCompact(pageValue, currency)}
          icon={Wallet}
          hint="Cancelled bookings excluded"
        />
      </div>

      <div className="mt-8">
        <BookingsBrowser {...list} />
      </div>
    </AdminContainer>
  );
}
