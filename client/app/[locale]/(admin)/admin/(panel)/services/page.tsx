import type { Metadata } from "next";
import { CheckCircle2, ConciergeBell, PenLine } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { ServicesBrowser } from "@/components/admin/ServicesBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { getDestinationTree } from "@/lib/api/hotels";
import { listPartners } from "@/lib/api/partners";
import { listServices } from "@/lib/api/services";
import { listTourCancellationPolicies } from "@/lib/api/tours";
import { serviceQueryFromParams } from "@/lib/admin/services";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Services" };

/**
 * The service catalogue.
 *
 * A service has no inventory, no departures and no gallery, so unlike hotels
 * and tours there is no hub with sub-screens — the register carries the
 * create form inline and every service opens straight into its editor.
 *
 * The three picker lists are loaded here rather than inside the browser: they
 * are the same for every row, and fetching them per form would be three
 * requests each time somebody opens the create panel. The cancellation
 * templates come from the tours endpoint because services draw on the same
 * platform pool — percent-of-total and fixed-amount rules only.
 */
export default async function AdminServicesPage({
  searchParams,
}: PageProps<"/[locale]/admin/services">) {
  await requireScreen();
  const query = serviceQueryFromParams(await searchParams);

  const [list, active, drafts, tree, suppliers, policies] = await Promise.all([
    listServices(query),
    listServices({ status: "ACTIVE", pageSize: 1 }),
    listServices({ status: "DRAFT", pageSize: 1 }),
    getDestinationTree(),
    listPartners({ status: "APPROVED", pageSize: 100 }),
    listTourCancellationPolicies(),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Services"
        description="Priced extras with no inventory — kosher meals, a mashgiach, a guide, equipment. Sold inside packages."
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="On sale"
          value={String(active.total)}
          icon={CheckCircle2}
          hint="Available to package slots"
        />
        <StatCard
          label="Drafts"
          value={String(drafts.total)}
          icon={PenLine}
          hint="Being set up, not yet sellable"
        />
        <StatCard label="All services" value={String(list.total)} icon={ConciergeBell} />
      </div>

      <div className="mt-8">
        <ServicesBrowser
          {...list}
          destinations={tree.data}
          suppliers={suppliers.data}
          policies={policies.data}
        />
      </div>
    </AdminContainer>
  );
}
