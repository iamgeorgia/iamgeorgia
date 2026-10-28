import type { Metadata } from "next";
import { Clock, PenLine } from "lucide-react";

import { AdminBreadcrumbs, AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { PartnersBrowser } from "@/components/admin/PartnersBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listPartners } from "@/lib/api/partners";
import { APPLICATION_STATUSES, partnerQueryFromParams } from "@/lib/admin/partners";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Applications" };

/**
 * Partners → Applications: the review queue.
 *
 * The same table as the partners list, scoped to the two statuses that are
 * waiting on a person. Splitting it out rather than making it a saved filter
 * is what lets it carry a count in the sidebar and be the thing an operator
 * opens first in the morning.
 */
export default async function PartnerApplicationsPage({
  searchParams,
}: PageProps<"/[locale]/admin/partners/applications">) {
  await requireScreen();
  const { path } = await getI18n();
  const params = await searchParams;

  const query = partnerQueryFromParams(params, {
    statuses: APPLICATION_STATUSES,
    lockedStatuses: APPLICATION_STATUSES,
  });

  const [list, submitted, inProgress] = await Promise.all([
    listPartners(query),
    listPartners({ status: "PENDING_APPROVAL", pageSize: 1 }),
    listPartners({ status: "REGISTRATION_IN_PROGRESS", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Partners", href: path("/admin/partners") },
          { label: "Applications" },
        ]}
      />

      <AdminPageHeader
        title="Applications"
        description="Companies that have been invited onto the network and are not yet approved. Open one to see everything it submitted."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Awaiting your decision"
          value={String(submitted.total)}
          icon={Clock}
          hint="Complete and submitted for review"
        />
        <StatCard
          label="Still being filled in"
          value={String(inProgress.total)}
          icon={PenLine}
          hint="The invitee has opened their link"
        />
      </div>

      <PartnersBrowser
        partners={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
        lockedStatuses={APPLICATION_STATUSES}
      />
    </AdminContainer>
  );
}
