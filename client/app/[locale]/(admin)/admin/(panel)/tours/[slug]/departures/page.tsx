import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { TourCalendarManager } from "@/components/admin/TourCalendarManager";
import { getTour, getTourCalendar } from "@/lib/api/tours";
import { ApiError } from "@/lib/api/client";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Departures" };

/**
 * The departure calendar for one option, with the bulk editor beside it.
 *
 * Which option and which window are in the URL, so a view can be shared and
 * survives a reload.
 */
export default async function TourDeparturesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/tours/[slug]/departures">) {
  await requireScreen();
  const { slug } = await params;
  const query = await searchParams;
  const { path } = await getI18n();

  let tour;

  try {
    tour = await getTour(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const live = tour.options.filter((option) => option.status !== "ARCHIVED");
  const requested = typeof query.option === "string" ? query.option : undefined;
  const option = live.find((entry) => entry.id === requested) ?? live[0];

  const from = typeof query.from === "string" ? query.from : todayISO();
  const to = typeof query.to === "string" ? query.to : addDaysISO(from, 27);

  const calendar = option ? await getTourCalendar(tour.id, option.id, { from, to }) : null;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Tours", href: path("/admin/tours") },
          { label: tour.title, href: path(`/admin/tours/${tour.id}`) },
          { label: "Departures" },
        ]}
      />
      <AdminPageHeader
        title="Departures"
        description="How many seats or groups can start on each date. Edits apply to ranges — a season of Saturday departures is one save."
      />

      <div className="mt-8">
        {option && calendar ? (
          <TourCalendarManager tour={tour} options={live} option={option} calendar={calendar} from={from} to={to} />
        ) : (
          <p className="rounded-sm border border-line bg-surface p-8 text-center text-muted">
            Add an option first — there is nothing to put on a calendar yet.
          </p>
        )}
      </div>
    </AdminContainer>
  );
}
