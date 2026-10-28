import type { Metadata } from "next";
import { CalendarCheck, Clock, ConciergeBell } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { CreateBookingButton } from "@/components/admin/CreateBookingButton";
import { ServiceBookingsBrowser } from "@/components/admin/ServiceBookingsBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listAdminServiceBookings } from "@/lib/api/services";
import { todayISO } from "@/lib/admin/dates";
import { serviceBookingQueryFromParams } from "@/lib/admin/services";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Service bookings" };

/**
 * The service bookings register.
 *
 * An SVC reference is its own thing — a kosher meal, a guide, a mashgiach —
 * booked on its own or as the part of an order. The queue that matters is
 * the pending one: an on-request service has been promised to the buyer and
 * the supplier has yet to say whether it can be provided.
 */
export default async function AdminServiceBookingsPage({ searchParams }: PageProps<"/[locale]/admin/services/bookings">) {
  await requireScreen();
  const query = serviceBookingQueryFromParams(await searchParams);

  const [list, pending, confirmed] = await Promise.all([
    listAdminServiceBookings(query),
    listAdminServiceBookings({ status: "PENDING", pageSize: 1 }),
    listAdminServiceBookings({ status: "CONFIRMED", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Service bookings"
        description="Every service sold, and the requests still waiting for a supplier's answer."
        actions={<CreateBookingButton />}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting your answer" value={String(pending.total)} icon={Clock} hint="Supplier yet to confirm" />
        <StatCard label="Confirmed" value={String(confirmed.total)} icon={CalendarCheck} />
        <StatCard label="All service bookings" value={String(list.total)} icon={ConciergeBell} />
      </div>

      <div className="mt-8">
        <ServiceBookingsBrowser {...list} today={todayISO()} />
      </div>
    </AdminContainer>
  );
}
