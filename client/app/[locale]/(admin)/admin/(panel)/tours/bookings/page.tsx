import type { Metadata } from "next";
import { CalendarCheck, Clock, Compass } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { CreateBookingButton } from "@/components/admin/CreateBookingButton";
import { StatCard } from "@/components/admin/StatCard";
import { TourBookingsBrowser } from "@/components/admin/TourBookingsBrowser";
import { listAdminTourBookings } from "@/lib/api/tours";
import { todayISO } from "@/lib/admin/dates";
import { tourBookingQueryFromParams } from "@/lib/admin/tours";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Tour bookings" };

/**
 * The tour booking register.
 *
 * A TUR reference is not a BKG one, so this is its own register. The queue
 * that matters is the pending one: an on-request booking has its seats
 * claimed already, and every hour it waits is capacity nobody else can buy.
 */
export default async function AdminTourBookingsPage({ searchParams }: PageProps<"/[locale]/admin/tours/bookings">) {
  await requireScreen();
  const query = tourBookingQueryFromParams(await searchParams);

  const [list, pending, confirmed] = await Promise.all([
    listAdminTourBookings(query),
    listAdminTourBookings({ status: "PENDING", pageSize: 1 }),
    listAdminTourBookings({ status: "CONFIRMED", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Tour bookings"
        description="Every departure sold, and the requests still waiting for an answer."
        actions={<CreateBookingButton />}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting your answer" value={String(pending.total)} icon={Clock} hint="Seats claimed, operator yet to confirm" />
        <StatCard label="Confirmed" value={String(confirmed.total)} icon={CalendarCheck} />
        <StatCard label="All tour bookings" value={String(list.total)} icon={Compass} />
      </div>

      <div className="mt-8">
        <TourBookingsBrowser {...list} basePath="/admin/tours/bookings" today={todayISO()} showPartner showManager />
      </div>
    </AdminContainer>
  );
}
