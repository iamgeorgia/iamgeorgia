import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { InvoicesBrowser } from "@/components/admin/finance/InvoicesBrowser";
import { getInvoicingSettings, listInvoices, type InvoiceQuery } from "@/lib/api/invoices";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can } from "@/types/auth";
import type { InvoiceKind, InvoiceStatus } from "@/types/invoice";

export const metadata: Metadata = { title: "Invoices" };

const KINDS = new Set<InvoiceKind>(["PROFORMA", "VAT", "ADVANCE", "FINAL", "CORRECTION"]);
const STATUSES = new Set<InvoiceStatus>(["DRAFT", "ISSUED", "SENT", "PAID", "PARTIAL", "CANCELLED", "ERROR"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the filters out of the URL; anything unrecognised is dropped rather than sent. */
function invoiceQueryFromParams(params: Record<string, string | string[] | undefined>): InvoiceQuery {
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const kind = single(params.kind);
  const status = (single(params.status) ?? "")
    .split(",")
    .filter((value): value is InvoiceStatus => STATUSES.has(value as InvoiceStatus));
  const partner = single(params.partner);
  const from = single(params.from);
  const to = single(params.to);
  const page = Number(single(params.page));

  return {
    q: single(params.q)?.trim().slice(0, 120) || undefined,
    kind: kind && KINDS.has(kind as InvoiceKind) ? (kind as InvoiceKind) : undefined,
    status: status.length ? status : undefined,
    debtorPartnerId:
      single(params.guests) === "true" ? "GUEST" : partner && ID.test(partner) ? partner : undefined,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    pageSize: 25,
  };
}

/** Every proforma, VAT invoice and correction issued through the invoicing provider. */
export default async function AdminInvoicesPage({
  searchParams,
}: PageProps<"/[locale]/admin/finance/invoices">) {
  const session = await getSession();

  if (!can(session, "invoices.read")) {
    redirect(localePath(await getLocale(), "/admin"));
  }

  const query = invoiceQueryFromParams(await searchParams);

  const [list, enabled] = await Promise.all([
    listInvoices(query),
    getInvoicingSettings().then(
      (settings) => settings.enabled,
      (error) => {
        console.error("Could not read the invoicing settings", error);
        return true; // unknown: show no notice
      },
    ),
  ]);

  const partnerName =
    query.debtorPartnerId && query.debtorPartnerId !== "GUEST"
      ? (list.data[0]?.receivable.debtor?.partner?.name ?? null)
      : null;

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Invoices"
        description="Proformas, VAT invoices and corrections issued for confirmed bookings and orders, and where each one stands."
      />

      {!enabled && (
        <p className="mt-6 flex items-start gap-3 rounded-sm border border-line bg-surface px-4 py-3 text-[0.875rem] leading-relaxed text-muted">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Invoicing is not switched on for this server. Documents already issued are listed; nothing new is
            created until INVOICEOCEAN_ENABLED is set — see the deployment guide.
          </span>
        </p>
      )}

      <InvoicesBrowser
        invoices={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
        partnerName={partnerName}
      />
    </AdminContainer>
  );
}
