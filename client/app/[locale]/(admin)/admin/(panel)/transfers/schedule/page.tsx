import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { ScheduleView } from "@/components/admin/ScheduleView";
import { driverDisplayName, fleetVehicleLabel } from "@/lib/admin/fleet";
import { listBlocks, listOccupancy } from "@/lib/api/dispatch";
import { listDrivers } from "@/lib/api/drivers";
import { listFleetVehicles } from "@/lib/api/fleet";
import { defaultWindow } from "@/lib/admin/dispatch";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Schedule" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * One driver's or one car's diary. Jobs and blocks from the same view the
 * dispatcher's conflict check reads, so what this shows is what dispatch
 * will refuse.
 */
export default async function AdminSchedulePage({
  searchParams,
}: PageProps<"/[locale]/admin/transfers/schedule">) {
  await requireScreen();
  const params = await searchParams;
  const fallback = defaultWindow(14);
  const from = DATE.test(first(params.from) ?? "") ? first(params.from)! : fallback.from;
  const to = DATE.test(first(params.to) ?? "") ? first(params.to)! : fallback.to;
  const driverId = first(params.driverId) || null;
  const fleetVehicleId = driverId ? null : first(params.fleetVehicleId) || null;

  const [drivers, fleet, occupancy, blocks] = await Promise.all([
    listDrivers({ isActive: "true", pageSize: 100 }),
    listFleetVehicles({ status: ["ACTIVE", "INACTIVE"], pageSize: 100 }),
    driverId || fleetVehicleId
      ? listOccupancy({ driverId: driverId ?? undefined, fleetVehicleId: fleetVehicleId ?? undefined, from, to })
      : Promise.resolve({ data: [] }),
    driverId || fleetVehicleId
      ? listBlocks({ driverId: driverId ?? undefined, fleetVehicleId: fleetVehicleId ?? undefined, from, to })
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader title="Schedule" description="Who is busy when — jobs and blocks, for one driver or one car at a time." />

      <div className="mt-8">
        <ScheduleView
          drivers={drivers.data.map((driver) => ({ id: driver.id, label: driverDisplayName(driver) }))}
          fleet={fleet.data.map((car) => ({ id: car.id, label: fleetVehicleLabel(car) }))}
          rows={occupancy.data}
          blocks={blocks.data}
          from={from}
          to={to}
          driverId={driverId}
          fleetVehicleId={fleetVehicleId}
        />
      </div>
    </AdminContainer>
  );
}
