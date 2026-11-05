import type { Metadata } from "next";
import { Coins, Percent, Archive } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { StatCard } from "@/components/admin/StatCard";
import { TransferExtrasEditor } from "@/components/admin/TransferExtrasEditor";
import { listAdminTransferExtras } from "@/lib/api/transfers";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Transfer extras" };

/**
 * The add-ons, and what each costs.
 *
 * A short list maintained on one screen — adding, repricing and retiring all
 * happen here rather than behind a register of detail pages, because seeing
 * the whole price list at once is what keeps the prices sensible relative to
 * each other.
 *
 * Retired extras are listed too. A booking records the code it bought, and a
 * support conversation six months later still has to be able to say what
 * "skiEquipment" was.
 */
export default async function AdminTransferExtrasPage() {
  await requireScreen();
  const { data: extras } = await listAdminTransferExtras();

  const offered = extras.filter((extra) => extra.isActive !== false);
  const percent = offered.filter((extra) => extra.basis === "PERCENT");
  const retired = extras.length - offered.length;

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Transfer extras"
        description="Child seats, ski carriage, extra stops — offered on every route and priced here."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="On offer" value={String(offered.length)} icon={Coins} />
        <StatCard
          label="Priced off the fare"
          value={String(percent.length)}
          icon={Percent}
          hint="A share of the journey rather than a fixed amount"
        />
        <StatCard
          label="Retired"
          value={String(retired)}
          icon={Archive}
          hint="Hidden from travellers, kept for past bookings"
        />
      </div>

      <div className="mt-8">
        <TransferExtrasEditor extras={extras} />
      </div>
    </AdminContainer>
  );
}
