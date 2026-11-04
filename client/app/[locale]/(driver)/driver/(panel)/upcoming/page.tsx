import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";

import { AssignmentDays, DriverEmpty, DriverPageHeader } from "@/components/driver/DriverPage";
import { DriverFreshness } from "@/components/driver/DriverFreshness";
import { listDriverAssignments } from "@/lib/api/driverPanel";
import { DRIVER_FALLBACK_TIME_ZONE } from "@/lib/driver/assignment";
import { getI18n } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Upcoming" };

export default async function DriverUpcomingPage() {
  const [{ locale }, result] = await Promise.all([getI18n(), listDriverAssignments({ scope: "upcoming", pageSize: 100 })]);
  const offers = result.data.filter((assignment) => assignment.status === "OFFERED").length;
  const renderedAt = new Date().toISOString();

  return (
    <>
      <DriverPageHeader
        title="Upcoming"
        aside={<DriverFreshness renderedAt={renderedAt} timeZone={result.data[0]?.leg.timezone || DRIVER_FALLBACK_TIME_ZONE} />}
        meta={
          result.data.length > 0
            ? [
                result.data.length === 1 ? "1 job" : `${result.data.length} jobs`,
                offers > 0 && (offers === 1 ? "1 waiting for your answer" : `${offers} waiting for your answer`),
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      />

      {result.data.length === 0 ? (
        <DriverEmpty icon={CalendarDays} title="Nothing scheduled yet">
          New jobs from dispatch appear here, and on Today when they are waiting for your answer.
        </DriverEmpty>
      ) : (
        <AssignmentDays assignments={result.data} locale={locale} label="Upcoming jobs by day" jump />
      )}
    </>
  );
}
