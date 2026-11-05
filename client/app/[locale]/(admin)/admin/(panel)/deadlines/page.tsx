import type { Metadata } from "next";
import { AlertTriangle, CalendarClock, CalendarRange, Wallet } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { DeadlinesCalendar } from "@/components/admin/deadlines/DeadlinesCalendar";
import { StatCard } from "@/components/admin/StatCard";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import { calendarStateFromParams, countByKind, instantRangeFor } from "@/lib/admin/deadlines";
import { listDeadlines } from "@/lib/api/deadlines";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Deadlines" };

/** The server's page cap: one window is read in one request. */
const WINDOW_PAGE_SIZE = 500;

/** How far ahead "upcoming" looks: the same week the reminders and the overview count. */
const UPCOMING_DAYS = 7;

/**
 * The deadline calendar: every payment due, every free-cancellation window
 * closing and every confirmation falling due, by day.
 *
 * The view, the anchor day and the filters live in the URL
 * (`lib/admin/deadlines.ts` reads and writes them), so the page is a plain
 * server render: one request for the window shown, two for the counters.
 * The month window is fetched as whole weeks, padded a day either side,
 * because each row is placed on the calendar by the day it falls on in its
 * own time zone rather than in UTC.
 */
export default async function AdminDeadlinesPage({ searchParams }: PageProps<"/[locale]/admin/deadlines">) {
  await requireScreen();
  const params = await searchParams;
  const today = todayISO();
  const now = new Date().toISOString();

  const state = calendarStateFromParams(params, today);
  const viewExplicit = typeof params.view === "string" && params.view === state.view;
  const window = instantRangeFor(state.view, state.from);

  const filters = {
    kind: state.kind.length > 0 ? state.kind : undefined,
    status: state.status.length > 0 ? state.status : undefined,
    product: state.product.length > 0 ? state.product : undefined,
    partnerId: state.partnerId,
    managerId: state.managerId,
  };

  const [inWindow, upcoming, overdue] = await Promise.all([
    listDeadlines({ ...filters, from: window.from, to: window.to, sort: "soonest", pageSize: WINDOW_PAGE_SIZE }),
    listDeadlines({ ...filters, status: "OPEN", from: now, to: `${addDaysISO(today, UPCOMING_DAYS)}T23:59:59.999Z`, pageSize: 1 }),
    listDeadlines({ ...filters, status: "OPEN", to: now, pageSize: 1 }),
  ]);

  const counts = countByKind(inWindow.data);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Deadlines"
        description="Payments falling due, free-cancellation windows closing and confirmations owed — by day, across every product. Open a chip to see the booking or move the date."
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Overdue" value={String(overdue.total)} icon={AlertTriangle} hint="Open and past their moment" />
        <StatCard label="Due in the next 7 days" value={String(upcoming.total)} icon={CalendarClock} hint="Open, from now" />
        <StatCard label="Payments in view" value={String(counts.PAYMENT)} icon={Wallet} hint={`${counts.FREE_CANCELLATION} cancellation windows in view`} />
        <StatCard label="Confirmations in view" value={String(counts.CONFIRMATION)} icon={CalendarRange} hint={`${inWindow.total} deadlines in this window`} />
      </div>

      <div className="mt-8">
        <DeadlinesCalendar rows={inWindow.data} total={inWindow.total} state={state} viewExplicit={viewExplicit} today={today} />
      </div>
    </AdminContainer>
  );
}
