import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { ReminderPoliciesEditor } from "@/components/admin/ReminderPoliciesEditor";
import { listReminderPolicies } from "@/lib/api/deadlines";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Reminders" };

/**
 * The reminder schedule: when, how and to whom a deadline is announced
 * before it falls due. One platform row per kind; a partner's own rows
 * where it needs something different. The platform rows are read here;
 * a partner's are read in the browser once one is chosen.
 */
export default async function AdminRemindersSettingsPage() {
  await requireScreen();
  const { data } = await listReminderPolicies();

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Reminders"
        description="Who is told before a payment falls due, a free-cancellation window closes or a confirmation is owed — and how many days ahead."
      />
      <div className="mt-8">
        <ReminderPoliciesEditor initial={data} />
      </div>
    </AdminContainer>
  );
}
