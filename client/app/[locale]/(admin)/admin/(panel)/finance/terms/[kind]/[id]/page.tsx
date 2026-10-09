import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { SupplierTermsForm } from "@/components/admin/finance/SupplierTermsForm";
import { ApiError } from "@/lib/api/client";
import { getSupplierTerms } from "@/lib/api/finance";
import { getHotel } from "@/lib/api/hotels";
import { getService } from "@/lib/api/services";
import { getTour } from "@/lib/api/tours";
import { listAdminTransferProviders } from "@/lib/api/transfers";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { SupplierTerms, SupplierTermsKind } from "@/types/finance";

export const metadata: Metadata = { title: "Payment terms" };

const KINDS: Record<SupplierTermsKind, { singular: string; plural: string; listHref: string }> = {
  hotels: { singular: "Hotel", plural: "Hotels", listHref: "/admin/hotels" },
  tours: { singular: "Tour", plural: "Tours", listHref: "/admin/tours" },
  services: { singular: "Service", plural: "Services", listHref: "/admin/services" },
  "transfer-providers": {
    singular: "Transfer provider",
    plural: "Vehicle classes",
    listHref: "/admin/transfers/vehicles",
  },
};

const isKind = (value: string): value is SupplierTermsKind => Object.hasOwn(KINDS, value);

interface Subject {
  name: string | null;
  currency: string | null;
  href: string | null;
}

/**
 * The name, currency and page of what the terms belong to — for the heading
 * and the preview only. Best effort: the terms endpoint is the one that
 * decides whether the subject exists, and a viewer who may read terms but
 * not, say, a hotel's admin record still gets the form, headed by the id.
 */
async function subjectFor(kind: SupplierTermsKind, id: string): Promise<Subject> {
  try {
    switch (kind) {
      case "hotels": {
        const hotel = await getHotel(id);
        return { name: hotel.name, currency: hotel.currency, href: `/admin/hotels/${hotel.id}` };
      }
      case "tours": {
        const tour = await getTour(id);
        return { name: tour.title, currency: tour.currency, href: `/admin/tours/${tour.id}` };
      }
      case "services": {
        const service = await getService(id);
        return { name: service.name, currency: service.currency, href: `/admin/services/${service.id}` };
      }
      case "transfer-providers": {
        const { data } = await listAdminTransferProviders();
        const provider = data.find((row) => row.id === id);
        return { name: provider?.name ?? null, currency: null, href: null };
      }
    }
  } catch (error) {
    console.error("Payment terms subject failed:", error);
  }

  return { name: null, currency: null, href: null };
}

/**
 * One supplier's payment terms: when it is paid, and what it is owed after a
 * cancellation.
 *
 * Readable by Finance and by the catalogue team (who negotiate the contract);
 * editable only with `finance.terms.write`, which the server checks again on
 * the PUT. The page guard mirrors the GET's own so a typed URL goes back to
 * the overview instead of rendering an error.
 */
export default async function AdminSupplierTermsPage({
  params,
}: PageProps<"/[locale]/admin/finance/terms/[kind]/[id]">) {
  const session = await getSession();

  if (!can(session, "finance.payables.read", "catalogue.write")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const { kind, id } = await params;

  if (!isKind(kind)) notFound();

  const { path } = await getI18n();
  const meta = KINDS[kind];

  let terms: SupplierTerms;
  let subject: Subject;

  try {
    [terms, subject] = await Promise.all([getSupplierTerms(kind, id), subjectFor(kind, id)]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const name = subject.name ?? `${meta.singular} ${id}`;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: meta.plural, href: path(meta.listHref) },
          { label: name, href: subject.href ? path(subject.href) : undefined },
          { label: "Payment terms" },
        ]}
      />

      <AdminPageHeader
        title="Payment terms"
        description={`${name} · ${meta.singular.toLowerCase()}. When this supplier is paid for a booking, and what it is owed if the booking is cancelled.`}
      />

      <AdminPanel
        className="mt-8"
        title={terms.isDefault ? "No terms saved yet" : "Terms"}
        description={
          terms.isDefault
            ? "The defaults apply: no payment schedule, and the same share of the net after a cancellation. Bookings without a schedule are flagged for Finance."
            : "These apply to bookings confirmed from now on. Bookings already confirmed keep the schedule they were given."
        }
      >
        <SupplierTermsForm
          kind={kind}
          id={id}
          terms={terms}
          currency={subject.currency ?? "GEL"}
          currencyKnown={subject.currency !== null}
          canEdit={can(session, "finance.terms.write")}
        />
      </AdminPanel>
    </AdminContainer>
  );
}
