import type { Metadata } from "next";
import { CalendarCheck, Clock, PackageCheck } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { CreateBookingButton } from "@/components/admin/CreateBookingButton";
import { OrdersBrowser } from "@/components/admin/OrdersBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listAdminOrders } from "@/lib/api/orders";
import { todayISO } from "@/lib/admin/dates";
import { orderQueryFromParams } from "@/lib/admin/orders";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Orders" };

/**
 * The order register.
 *
 * An ORD reference is a whole trip — a hotel, a transfer, a tour and a
 * service bought as one thing — so it is its own register rather than a
 * column on any of the four. The queue that matters is the on-request one:
 * those orders already hold rooms and seats, and every hour one waits is
 * capacity nobody else can buy.
 *
 * The counts are separate one-row queries rather than a tally of the current
 * page, because the page is filtered and the queue is not.
 */
export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/[locale]/admin/orders">) {
  await requireScreen();
  const query = orderQueryFromParams(await searchParams);

  const [list, pending, confirmed] = await Promise.all([
    listAdminOrders(query),
    listAdminOrders({ status: "PENDING_CONFIRMATION", pageSize: 1 }),
    listAdminOrders({ status: "CONFIRMED", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Orders"
        description="Packages sold whole, and the parts of them still waiting for a supplier's answer."
        actions={<CreateBookingButton />}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Awaiting your answer"
          value={String(pending.total)}
          icon={Clock}
          hint="Rooms and seats claimed, supplier yet to answer"
        />
        <StatCard label="Confirmed" value={String(confirmed.total)} icon={CalendarCheck} />
        <StatCard label="All orders" value={String(list.total)} icon={PackageCheck} />
      </div>

      <div className="mt-8">
        <OrdersBrowser {...list} pendingTotal={pending.total} today={todayISO()} />
      </div>
    </AdminContainer>
  );
}
