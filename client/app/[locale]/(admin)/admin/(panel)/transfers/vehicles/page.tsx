import Link from "next/link";
import type { Metadata } from "next";
import { CarFront, Globe, Plus, Users } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { StatCard } from "@/components/admin/StatCard";
import { TransferVehicleChannel } from "@/components/admin/TransferVehicleChannel";
import { listAdminTransferVehicles } from "@/lib/api/transfers";
import { vehicleClassLabels } from "@/lib/admin/transfers";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Vehicle classes" };

/**
 * The vehicle classes.
 *
 * A short list by nature — nine, not nine hundred — so there is no filtering
 * and no pagination here. What it does carry is the fallback fare model, which
 * is staff-only in the API and is the thing an operator needs to see when a
 * route has no curated price: those are the numbers that will quote it.
 */
export default async function AdminTransferVehiclesPage() {
  const session = await requireScreen();
  const [{ data: vehicles }, { path }] = await Promise.all([
    listAdminTransferVehicles(),
    getI18n(),
  ]);

  const active = vehicles.filter((vehicle) => vehicle.status === "ACTIVE");
  const published = active.filter((vehicle) => vehicle.b2cEnabled);
  const seats = Math.max(0, ...vehicles.map((vehicle) => vehicle.maxPassengers));

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Vehicle classes"
        description="The vehicle classes on sale, and the fares that apply where a route has no price of its own."
        actions={
          can(session, "catalogue.write") && (
            <Link
              href={path("/admin/transfers/vehicles/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add a class
            </Link>
          )
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Classes on sale" value={String(active.length)} icon={CarFront} />
        <StatCard
          label="Open to the public"
          value={String(published.length)}
          icon={Globe}
          hint="The rest are trade-only"
        />
        <StatCard label="Largest vehicle" value={`${seats} seats`} icon={Users} />
      </div>

      <div className="mt-10 rounded-sm border border-line bg-surface">
        <DataTable
          caption="Vehicle classes"
          columns={[
            { label: "Class" },
            { label: "Seats", align: "end", hideBelow: "sm" },
            { label: "Bags", align: "end", hideBelow: "md" },
            { label: "Per km", align: "end", hideBelow: "lg" },
            { label: "Minimum", align: "end", hideBelow: "lg" },
            { label: "Channel" },
          ]}
        >
          {vehicles.length === 0 ? (
            <EmptyRow colSpan={6} message="No vehicle classes yet. Add one to start quoting." />
          ) : (
            vehicles.map((vehicle) => (
              <Row key={vehicle.id}>
                <Cell>
                  <Link
                    href={path(`/admin/transfers/vehicles/${vehicle.id}`)}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {vehicle.name}
                  </Link>
                  <span className="type-caption mt-0.5 block text-subtle">
                    {vehicleClassLabels[vehicle.vehicleClass] ?? vehicle.vehicleClass} ·{" "}
                    {vehicle.kind === "SHARED" ? "shared, per seat" : "private"}
                    {vehicle.provider ? ` · ${vehicle.provider.name}` : ""}
                  </span>
                </Cell>
                <Cell align="end" hideBelow="sm">
                  {vehicle.maxPassengers}
                </Cell>
                <Cell align="end" hideBelow="md">
                  {vehicle.maxLuggage}
                </Cell>
                <Cell align="end" hideBelow="lg" className="tabular-nums">
                  {vehicle.fallbackPricing
                    ? formatMoney(vehicle.fallbackPricing.perKmCents, vehicle.currency)
                    : "—"}
                </Cell>
                <Cell align="end" hideBelow="lg" className="tabular-nums">
                  {vehicle.fallbackPricing
                    ? formatMoney(vehicle.fallbackPricing.minimumFareCents, vehicle.currency)
                    : "—"}
                </Cell>
                <Cell>
                  <TransferVehicleChannel
                    id={vehicle.id}
                    b2cEnabled={Boolean(vehicle.b2cEnabled)}
                    archived={vehicle.status === "ARCHIVED"}
                  />
                </Cell>
              </Row>
            ))
          )}
        </DataTable>
      </div>

      <p className="mt-4 text-[0.8125rem] text-muted">
        Per-km and minimum fares only apply where a route carries no price of its own. Everything
        in the catalogue is priced, so these are the safety net rather than the price list.
      </p>
    </AdminContainer>
  );
}
