import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Wallet } from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { HotelStatusBadge } from "@/components/admin/HotelStatusBadge";
import { ServiceActions } from "@/components/admin/ServiceActions";
import { ServiceDangerZone } from "@/components/admin/ServiceDangerZone";
import { ServiceEditor } from "@/components/admin/ServiceEditor";
import { ServiceTranslationsEditor } from "@/components/admin/ServiceTranslationsEditor";
import { ApiError } from "@/lib/api/client";
import { getDestinationTree } from "@/lib/api/hotels";
import { listPartners } from "@/lib/api/partners";
import { getService, listServiceTranslations } from "@/lib/api/services";
import { listTourCancellationPolicies } from "@/lib/api/tours";
import { serviceBasisLabels, serviceCategoryLabels } from "@/lib/admin/services";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { can } from "@/types/auth";

export const metadata: Metadata = { title: "Service" };

/**
 * One service, whole, on one screen.
 *
 * No hub and no sub-screens: a service has no inventory, no departures and no
 * gallery, so splitting four fieldsets across four routes would be navigation
 * for its own sake. The publish checklist and the lifecycle buttons sit in the
 * sidebar, where they do on every other product.
 */
export default async function AdminServicePage({
  params,
}: PageProps<"/[locale]/admin/services/[id]">) {
  const { id } = await params;
  const [{ path }, session] = await Promise.all([getI18n(), getSession()]);

  let service;

  try {
    service = await getService(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [tree, suppliers, policies, translations] = await Promise.all([
    getDestinationTree(),
    listPartners({ status: "APPROVED", pageSize: 100 }),
    listTourCancellationPolicies(),
    listServiceTranslations(service.id),
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Services", href: path("/admin/services") }, { label: service.name }]}
      />

      <AdminPageHeader
        title={service.name}
        description={`${serviceCategoryLabels[service.category]} · ${serviceBasisLabels[service.basis]}`}
        actions={service.status ? <HotelStatusBadge status={service.status} /> : undefined}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-6 lg:col-span-2">
          <AdminPanel title="Service">
            <ServiceEditor
              service={service}
              destinations={tree.data}
              suppliers={suppliers.data}
              policies={policies.data}
            />
          </AdminPanel>

          <AdminPanel
            title="Translations"
            description="Georgian, Russian and Hebrew prose. A blank field falls back to English rather than blanking the page."
          >
            <ServiceTranslationsEditor service={service} translations={translations.data} />
          </AdminPanel>
        </div>

        <div className="flex flex-col gap-6">
          <AdminPanel
            title="Publishing"
            description={
              service.publishChecklist.length === 0
                ? "Everything required is in place."
                : "What still stands between this service and going on sale."
            }
          >
            {service.publishChecklist.length > 0 && (
              <ul className="mb-4 space-y-2">
                {service.publishChecklist.map((item) => (
                  <li key={item.code} className="flex items-start gap-2 text-[0.8125rem] text-body">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
                    {item.message}
                  </li>
                ))}
              </ul>
            )}
            <ServiceActions service={service} />
          </AdminPanel>

          {can(session, "finance.payables.read", "catalogue.write") && (
            <AdminPanel title="Payment terms" description="When the supplier is paid, and what it is owed after a cancellation.">
              <Link
                href={path(`/admin/finance/terms/services/${service.id}`)}
                className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-brand-text underline-offset-4 hover:underline"
              >
                <Wallet size={15} aria-hidden />
                Open payment terms
              </Link>
            </AdminPanel>
          )}

          <ServiceDangerZone service={service} />
        </div>
      </div>
    </AdminContainer>
  );
}
