"use client";

import { LayoutDashboard, PanelLeft } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { dashboardFor, type DashboardWidgetId } from "@/lib/admin/dashboard";
import { adminGroupItems, navigationFor } from "@/lib/admin/navigation";
import { cn } from "@/lib/utils";

/**
 * What an account with these capabilities would see: the sidebar it gets and
 * the overview widgets it starts the day with. Computed from the same two
 * tables the panel itself renders from (`lib/admin/navigation.ts`,
 * `lib/admin/dashboard.ts`), so the preview cannot drift from the truth —
 * and so a role's effect is visible while it is being edited, before anyone
 * is given it. Pure: nothing here makes a request.
 */

const WIDGET_LABELS: Record<DashboardWidgetId, string> = {
  bookingApprovals: "Awaiting your approval",
  tourRequests: "Tour requests",
  pendingOrders: "Orders to confirm",
  unassignedLegs: "Legs without a driver",
  applications: "Partner applications",
  paymentsDue: "Supplier payments due",
  overdueReceivables: "Overdue from buyers",
  approvals: "Approvals waiting",
  invoiceErrors: "Invoices that failed to issue",
  bookingFigures: "Booking figures",
  arrivals: "Arriving next",
  latestBookings: "Latest bookings",
  financeFigures: "Who owes whom (per currency)",
  dispatchFigures: "Dispatch figures",
  recentPayments: "Recent payments",
  deadlinesWeek: "Deadlines this week",
};

export function RolePreview({ capabilities, className }: { capabilities: readonly string[]; className?: string }) {
  const groups = navigationFor(capabilities);
  const widgets = dashboardFor(capabilities);
  const decide = widgets.filter((widget) => widget.section === "decide");
  const watch = widgets.filter((widget) => widget.section === "watch");
  const screens = groups.reduce((total, group) => total + adminGroupItems(group).length, 0);

  return (
    <AdminPanel
      title="What this role sees"
      description={`${screens} ${screens === 1 ? "screen" : "screens"} in the sidebar and ${widgets.length} overview ${widgets.length === 1 ? "widget" : "widgets"}, from the capabilities ticked above. Updates as you tick.`}
      className={className}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="role-preview-sidebar">
          <h3 id="role-preview-sidebar" className="flex items-center gap-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
            <PanelLeft size={14} aria-hidden /> Sidebar
          </h3>
          <ul className="mt-3 space-y-3">
            {groups.map((group) => (
              <li key={group.title || "overview"}>
                {group.title && (
                  <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-subtle uppercase">{group.title}</p>
                )}
                <ul className={cn("mt-1 flex flex-wrap gap-1.5", !group.title && "mt-0")}>
                  {adminGroupItems(group).map((item) => (
                    <li
                      key={item.href}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface-soft/60 px-2 py-1 text-[0.8125rem] text-body"
                    >
                      <item.icon size={13} className="text-subtle" aria-hidden />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="role-preview-overview">
          <h3 id="role-preview-overview" className="flex items-center gap-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
            <LayoutDashboard size={14} aria-hidden /> Overview
          </h3>
          {widgets.length === 0 ? (
            <p className="mt-3 text-[0.8125rem] text-muted">
              Only the greeting and the manual: no capability ticked above shows a figure or a queue.
            </p>
          ) : (
            <dl className="mt-3 space-y-3 text-[0.8125rem]">
              {decide.length > 0 && (
                <div>
                  <dt className="text-[0.6875rem] font-semibold tracking-[0.14em] text-subtle uppercase">Needs a decision</dt>
                  <dd className="mt-1 text-body">{decide.map((widget) => WIDGET_LABELS[widget.id]).join(" · ")}</dd>
                </div>
              )}
              {watch.length > 0 && (
                <div>
                  <dt className="text-[0.6875rem] font-semibold tracking-[0.14em] text-subtle uppercase">Watches</dt>
                  <dd className="mt-1 text-body">{watch.map((widget) => WIDGET_LABELS[widget.id]).join(" · ")}</dd>
                </div>
              )}
            </dl>
          )}
        </section>
      </div>
    </AdminPanel>
  );
}
