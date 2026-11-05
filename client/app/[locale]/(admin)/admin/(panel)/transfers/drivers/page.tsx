import Link from "next/link";
import type { Metadata } from "next";
import { Plus, ShieldCheck, ShieldQuestion, UserRound } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { DriversBrowser } from "@/components/admin/DriversBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listDrivers } from "@/lib/api/drivers";
import { driverQueryFromParams } from "@/lib/admin/fleet";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Drivers" };

export default async function AdminDriversPage({
  searchParams,
}: PageProps<"/[locale]/admin/transfers/drivers">) {
  const session = await requireScreen();
  const params = await searchParams;
  const query = driverQueryFromParams(params);

  const [result, active, verified, unchecked, { path }] = await Promise.all([
    listDrivers(query),
    listDrivers({ isActive: "true", pageSize: 1 }),
    listDrivers({ isActive: "true", verificationStatus: "VERIFIED", pageSize: 1 }),
    listDrivers({ isActive: "true", verificationStatus: ["UNVERIFIED", "PENDING"], pageSize: 1 }),
    getI18n(),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Drivers"
        description="Everyone who can be sent to a pick-up. A profile can be dispatched to by phone before it has a login."
        actions={
          can(session, "dispatch.write") && (
            <Link
              href={path("/admin/transfers/drivers/new")}
              className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Plus size={15} aria-hidden />
              Add a driver
            </Link>
          )
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Active drivers" value={String(active.total)} icon={UserRound} />
        <StatCard label="Verified" value={String(verified.total)} icon={ShieldCheck} />
        <StatCard label="Awaiting checks" value={String(unchecked.total)} icon={ShieldQuestion} hint="Not yet verified" />
      </div>

      <div className="mt-10">
        <DriversBrowser {...result} />
      </div>
    </AdminContainer>
  );
}
