import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { CalendarManager } from "@/components/admin/CalendarManager";
import { getHotel } from "@/lib/api/hotels";
import { getCalendar } from "@/lib/api/inventory";
import { ApiError } from "@/lib/api/client";
import { addDaysISO, todayISO } from "@/lib/admin/dates";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Inventory & pricing" };

/**
 * The nightly calendar for one room type, with the bulk editors beside it.
 *
 * The grid is read fresh on every render; the editors write ranges and the
 * page re-reads. Which room and which window are in the URL, so a view can be
 * shared and survives a reload — the same rule as every list in the panel.
 */
export default async function HotelCalendarPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/hotels/[slug]/calendar">) {
  await requireScreen();
  const { slug } = await params;
  const query = await searchParams;
  const { path } = await getI18n();

  let hotel;

  try {
    hotel = await getHotel(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const activeRooms = hotel.roomTypes.filter((room) => room.status === "ACTIVE");
  const requested = typeof query.roomType === "string" ? query.roomType : undefined;
  const roomType = activeRooms.find((room) => room.id === requested) ?? activeRooms[0];

  const from = typeof query.from === "string" ? query.from : todayISO();
  const to = typeof query.to === "string" ? query.to : addDaysISO(from, 27);

  const calendar = roomType ? await getCalendar(hotel.id, roomType.id, { from, to }) : null;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Hotels", href: path("/admin/hotels") },
          { label: hotel.name, href: path(`/admin/hotels/${hotel.id}`) },
          { label: "Inventory & pricing" },
        ]}
      />
      <AdminPageHeader
        title="Inventory & pricing"
        description="How many rooms are open each night and what each rate plan charges. Edits apply to ranges — a month with a weekday split is two saves, not sixty-two."
      />

      <div className="mt-8">
        {roomType && calendar ? (
          <CalendarManager
            hotel={hotel}
            roomTypes={activeRooms}
            roomType={roomType}
            calendar={calendar}
            from={from}
            to={to}
          />
        ) : (
          <p className="rounded-sm border border-line bg-surface p-8 text-center text-muted">
            Add a room type first — there is nothing to put on a calendar yet.
          </p>
        )}
      </div>
    </AdminContainer>
  );
}
