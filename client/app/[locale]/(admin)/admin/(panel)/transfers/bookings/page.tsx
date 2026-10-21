import type { Metadata } from "next";
import { CalendarCheck, CarFront, Coins } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { CreateBookingButton } from "@/components/admin/CreateBookingButton";
import { StatCard } from "@/components/admin/StatCard";
import { TransferBookingsBrowser } from "@/components/admin/TransferBookingsBrowser";
import { getTransferBookingSummary, type TransferBookingSummary } from "@/lib/api/admin";
import { listAdminTransferBookings } from "@/lib/api/transfers";
import { todayISO } from "@/lib/admin/dates";
import { transferBookingQueryFromParams } from "@/lib/admin/transfers";
import { formatMoneyCompact } from "@/lib/money";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Transfer bookings" };

/**
 * Transfer bookings.
 *
 * A separate register from the hotel one rather than a filter on it. The two
 * share no identifier space — a TRF reference is not a BKG one — and a single
 * list that had to work out which kind of thing each row was would be a worse
 * list than two that each know.
 *
 * Ordered by pick-up rather than by when it was booked: what an operator needs
 * from this screen is which cars go out next.
 *
 * The summary tiles sum confirmed value in the database, which is a margin
 * figure, so they are only asked for by a viewer who may read margins — a
 * dispatcher opens this screen too, and the summary would answer them 403.
 */
export default async function AdminTransferBookingsPage({
  searchParams,
}: PageProps<"/[locale]/admin/transfers/bookings">) {
  const session = await requireScreen();
  const params = await searchParams;
  const query = transferBookingQueryFromParams(params);

  const [list, summary] = await Promise.all([
    listAdminTransferBookings(query),
    can(session, "finance.margin.read")
      ? getTransferBookingSummary()
      : Promise.resolve<TransferBookingSummary | null>(null),
  ]);

  // Summed in the database, per currency, largest first — not over a page.
  const [leading, ...otherCurrencies] = summary?.confirmedValue.byCurrency ?? [];
  const revenue = leading ?? { amountCents: 0, currency: "GEL" };

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Transfer bookings"
        description="Every journey sold, soonest pick-up first."
        actions={<CreateBookingButton />}
      />

      {summary && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Bookings" value={String(summary.total)} icon={CalendarCheck} />
          <StatCard label="Confirmed" value={String(summary.confirmed)} icon={CarFront} />
          <StatCard
            label="Confirmed value"
            value={formatMoneyCompact(revenue.amountCents, revenue.currency)}
            icon={Coins}
            hint={
              otherCurrencies.length > 0
                ? `In ${revenue.currency}; ${otherCurrencies.length} more not shown`
                : "Every confirmed journey"
            }
          />
        </div>
      )}

      <div className="mt-8">
        <TransferBookingsBrowser {...list} today={todayISO()} />
      </div>
    </AdminContainer>
  );
}
