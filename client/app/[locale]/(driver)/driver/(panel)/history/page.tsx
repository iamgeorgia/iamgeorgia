import type { Metadata } from "next";
import { History } from "lucide-react";

import { AssignmentDays, DriverEmpty, DriverPageHeader } from "@/components/driver/DriverPage";
import { listDriverAssignments } from "@/lib/api/driverPanel";
import { getI18n } from "@/lib/i18n/server";
import type { DriverAssignment } from "@/types/driver";

export const metadata: Metadata = { title: "History" };

export default async function DriverHistoryPage() {
  const [{ locale }, result] = await Promise.all([getI18n(), listDriverAssignments({ scope: "history", pageSize: 100 })]);

  // What the list holds, counted: driven, no-shows, turned down, taken away.
  const count = (test: (assignment: DriverAssignment) => boolean) => result.data.filter(test).length;
  const summary = [
    [count((a) => a.status === "COMPLETED"), "driven", "driven"],
    [count((a) => a.status === "NO_SHOW" || (a.status === "ACCEPTED" && a.leg.status === "NO_SHOW_REPORTED")), "no-show", "no-shows"],
    [count((a) => a.status === "DECLINED"), "declined", "declined"],
    [count((a) => a.status === "REVOKED"), "reassigned", "reassigned"],
  ]
    .filter(([n]) => Number(n) > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(" · ");

  return (
    <>
      <DriverPageHeader
        title="History"
        meta={summary || undefined}
      />

      {result.data.length === 0 ? (
        <DriverEmpty icon={History} title="No past jobs yet">
          Jobs you have driven, and offers you turned down, are kept here.
        </DriverEmpty>
      ) : (
        <AssignmentDays assignments={result.data} locale={locale} label="Past jobs by day" />
      )}
    </>
  );
}
