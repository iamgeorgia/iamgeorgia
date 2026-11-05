import type { Metadata } from "next";
import { CalendarClock, UserPlus, Users } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { DispatchBoard } from "@/components/admin/DispatchBoard";
import { StatCard } from "@/components/admin/StatCard";
import { listDispatchLegs } from "@/lib/api/dispatch";
import { requireScreen } from "@/lib/auth/session";
import { dispatchQueryFromParams } from "@/lib/admin/dispatch";

export const metadata: Metadata = { title: "Dispatch" };

/**
 * The dispatch board.
 *
 * Legs, not bookings: a return is two jobs on two days and may well need two
 * drivers. Soonest first, because the question this screen answers is which
 * cars go out next and who is in them. Every leg unless the dates narrow it.
 */
export default async function AdminDispatchPage({
  searchParams,
}: PageProps<"/[locale]/admin/transfers/dispatch">) {
  await requireScreen();
  const params = await searchParams;
  const query = dispatchQueryFromParams(params);

  const [result, unassigned, offered] = await Promise.all([
    listDispatchLegs(query),
    listDispatchLegs({ from: query.from, to: query.to, legStatus: "UNASSIGNED", pageSize: 1 }),
    listDispatchLegs({ from: query.from, to: query.to, legStatus: "ASSIGNED", pageSize: 1 }),
  ]);

  // A dispatcher by capability, not by role name: someone who runs the board
  // but does not read bookings lands here, so their checklist lives here too.

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Dispatch"
        description="Every leg, who is on it, and what happens next. Narrow by date, status or search."
      />


      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={query.from || query.to ? "Legs in window" : "Legs"} value={String(result.total)} icon={CalendarClock} />
        <StatCard label="Need a driver" value={String(unassigned.total)} icon={UserPlus} />
        <StatCard label="Waiting for an answer" value={String(offered.total)} icon={Users} hint="Offered, not yet accepted" />
      </div>

      <div className="mt-10">
        <DispatchBoard {...result} from={query.from ?? ""} to={query.to ?? ""} />
      </div>
    </AdminContainer>
  );
}
