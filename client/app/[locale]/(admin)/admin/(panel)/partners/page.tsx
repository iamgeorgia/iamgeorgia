import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, Handshake, MailPlus, UserPlus } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { PartnersBrowser } from "@/components/admin/PartnersBrowser";
import { StatCard } from "@/components/admin/StatCard";
import { listPartners } from "@/lib/api/partners";
import { APPLICATION_STATUSES, partnerQueryFromParams } from "@/lib/admin/partners";
import { getI18n } from "@/lib/i18n/server";
import { requireScreen } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Partners" };

export default async function AdminPartnersPage({
  searchParams,
}: PageProps<"/[locale]/admin/partners">) {
  const session = await requireScreen();
  const { path } = await getI18n();
  const params = await searchParams;

  const query = partnerQueryFromParams(params);

  // Four requests rather than one, because the counters describe the whole
  // network while the table describes the current filter. `pageSize: 1` asks
  // each counting query for a total and a single row, not for the records.
  const [list, approved, applications, invited] = await Promise.all([
    listPartners(query),
    listPartners({ status: "APPROVED", pageSize: 1 }),
    listPartners({ status: APPLICATION_STATUSES, pageSize: 1 }),
    listPartners({ status: "INVITED", pageSize: 1 }),
  ]);

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Partners"
        description="Hotels, operators and transport companies that supply what we sell."
        actions={
          <>
            <Link
              href={path("/admin/partners/applications")}
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink"
            >
              <Clock size={15} aria-hidden />
              Applications
              {applications.total > 0 && (
                <span className="rounded-full bg-brand px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white">
                  {applications.total}
                </span>
              )}
            </Link>
            {can(session, "partners.write") && (
              <Link
                href={path("/admin/partners/new")}
                className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
              >
                <UserPlus size={15} aria-hidden />
                Add a partner
              </Link>
            )}
          </>
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Approved partners"
          value={String(approved.total)}
          icon={CheckCircle2}
          hint="Full access to the platform"
        />
        <StatCard
          label="Awaiting review"
          value={String(applications.total)}
          icon={Clock}
          hint="Applications in the queue"
        />
        <StatCard
          label="Invitations open"
          value={String(invited.total)}
          icon={MailPlus}
          hint="Sent but not yet opened"
        />
        <StatCard
          label="On the network"
          value={String(list.total)}
          icon={Handshake}
          hint="Matching the current view"
        />
      </div>

      <PartnersBrowser
        partners={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
      />
    </AdminContainer>
  );
}
