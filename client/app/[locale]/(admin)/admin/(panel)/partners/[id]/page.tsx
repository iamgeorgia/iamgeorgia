import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banknote, Building2, FileClock, Lock, Mail, UserRound } from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { PartnerActions } from "@/components/admin/PartnerActions";
import { PartnerCreditPanel } from "@/components/admin/finance/PartnerCreditPanel";
import { PartnerInvoicingPanel } from "@/components/admin/finance/PartnerInvoicingPanel";
import { PartnerTermsPanel } from "@/components/admin/finance/PartnerTermsPanel";
import { PartnerContractPanel } from "@/components/admin/PartnerContractPanel";
import { PartnerDangerZone } from "@/components/admin/PartnerDangerZone";
import { PartnerProductAccessPanel } from "@/components/admin/PartnerProductAccessPanel";
import { InvitationStatusBadge, PartnerStatusBadge } from "@/components/admin/StatusBadge";
import { ApiError } from "@/lib/api/client";
import { getPartnerTerms } from "@/lib/api/finance";
import { getPartnerCredit } from "@/lib/api/finance-controls";
import { getInvoicingSettings } from "@/lib/api/invoices";
import { getPartner, getPartnerAudit, getPartnerInvitations, getProductAccessServer } from "@/lib/api/partners";
import { getSession } from "@/lib/auth/session";
import {
  auditActionLabels,
  formatCommission,
  formatPartnerDate,
  formatPartnerDateTime,
  partnerKindLabels,
  partnerStatusHints,
} from "@/lib/admin/partners";
import { invoiceLanguageLabels } from "@/lib/admin/finance";
import { getI18n } from "@/lib/i18n/server";
import type { AuditEntry, Invitation, Partner } from "@/types";
import type { ProductAccessEntry } from "@/types/partner";
import { can } from "@/types/auth";
import type { PartnerTerms } from "@/types/finance";
import type { CreditPosition } from "@/types/finance-controls";
import type { InvoicingSettings } from "@/types/invoice";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/partners/[id]">): Promise<Metadata> {
  const { id } = await params;

  try {
    const partner = await getPartner(id);
    return { title: `${partner.name} — ${partner.reference}` };
  } catch {
    return { title: "Partner" };
  }
}

/**
 * One partner application, in full.
 *
 * There is no `generateStaticParams` here, unlike the catalogue detail pages:
 * a partner record is private, changes on approval, and is only ever read by a
 * signed-in admin. Prerendering it would be both wrong and pointless.
 */
export default async function AdminPartnerPage({
  params,
}: PageProps<"/[locale]/admin/partners/[id]">) {
  const { id } = await params;
  const [{ path }, session] = await Promise.all([getI18n(), getSession()]);

  // Payment terms (D5) are Finance's, read separately: a viewer who may not
  // read them — or any failure — just leaves the panel out.
  const termsRequest: Promise<PartnerTerms | null> = can(session, "finance.receivables.read", "partners.write")
    ? getPartnerTerms(id).catch(() => null)
    : Promise.resolve(null);

  // The credit limit is read the same way: no right to read, or a failure, leaves the panel out.
  const creditRequest: Promise<CreditPosition | null> = can(session, "finance.receivables.read", "partners.write")
    ? getPartnerCredit(id).catch(() => null)
    : Promise.resolve(null);

  // The languages invoices can be printed in. No right to read, or a failure, falls back to the known list.
  const invoicingRequest: Promise<InvoicingSettings | null> = can(session, "invoices.read")
    ? getInvoicingSettings().catch(() => null)
    : Promise.resolve(null);

  // What the partner may sell. Read separately so a failure leaves only this panel out.
  const accessRequest: Promise<ProductAccessEntry[] | null> = getProductAccessServer(id)
    .then((result) => result.data)
    .catch(() => null);

  let partner: Partner;
  let audit: AuditEntry[] = [];
  let invitations: Invitation[] = [];

  try {
    [partner, { data: audit }, { data: invitations }] = await Promise.all([
      getPartner(id),
      getPartnerAudit(id),
      getPartnerInvitations(id),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { review } = partner;
  const [terms, credit, access, invoicing] = await Promise.all([
    termsRequest,
    creditRequest,
    accessRequest,
    invoicingRequest,
  ]);

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[
          { label: "Partners", href: path("/admin/partners") },
          { label: partner.name },
        ]}
      />

      <AdminPageHeader
        title={partner.name}
        description={`${partnerKindLabels[partner.kind]}${partner.city ? ` · ${partner.city}` : ""} · ${
          partner.submittedAt
            ? `applied ${formatPartnerDate(partner.submittedAt)}`
            : `created ${formatPartnerDate(partner.createdAt)}`
        }`}
        actions={<PartnerStatusBadge status={partner.status} className="text-[0.8125rem]" />}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <AdminPanel title="Company" description="Submitted by the partner and verifiable against the register.">
            <AdminDefinitionList
              items={[
                {
                  label: "Partner ID",
                  value: <span className="font-mono">{partner.reference}</span>,
                },
                { label: "Trading name", value: partner.name },
                { label: "Legal entity", value: partner.legalName ?? "—" },
                { label: "Partner type", value: partnerKindLabels[partner.kind] },
                { label: "Registration number", value: partner.registrationNumber ?? "—" },
                { label: "Legal address", value: partner.legalAddress ?? "—" },
                {
                  label: "City and country",
                  value: [partner.city, partner.country].filter(Boolean).join(", ") || "—",
                },
                { label: "Company phone", value: partner.phone ?? "—" },
                { label: "Company email", value: partner.email ?? "—" },
                {
                  label: "Website",
                  value: partner.website ? (
                    <a
                      href={partner.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-brand-text underline-offset-4 hover:underline"
                    >
                      {partner.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    "—"
                  ),
                },
                { label: "Commission", value: formatCommission(partner.commissionRateBps) },
              ]}
            />

            {partner.socialLinks.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                {partner.socialLinks.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-full border border-line px-3 py-1 text-[0.8125rem] text-body transition-colors hover:border-ink/40 hover:text-ink"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </AdminPanel>

          <AdminPanel
            title="People"
            description="Everyone who can sign in on behalf of this company."
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-line">
              {partner.users.length === 0 && (
                <li className="px-5 py-6 text-[0.8125rem] text-muted">
                  Nobody has an account yet. The invitation creates one when it is accepted.
                </li>
              )}
              {partner.users.map((user) => (
                <li key={user.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      <UserRound size={15} className="shrink-0 text-subtle" aria-hidden />
                      {user.fullName}
                      {user.isPrimaryContact && (
                        <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[0.6875rem] text-muted">
                          Primary contact
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[0.8125rem] text-muted">
                      {[user.position, user.email, user.phone].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="text-[0.75rem] text-muted">
                    {user.isPending ? "Password not set" : user.isActive ? "Active" : "Disabled"}
                  </span>
                </li>
              ))}
            </ul>
          </AdminPanel>

          {/*
            Present only when the API actually returned it. A viewer without the
            entitlement gets no `financial` key at all, which is different from a
            partner that supplied no bank details — and the two must not look
            the same on screen.
          */}
          <AdminPanel
            title="Bank details"
            description="Visible to administrators and to the partner's own owner and finance users."
          >
            {partner.financial ? (
              <AdminDefinitionList
                items={[
                  {
                    label: "IBAN",
                    value: <span className="font-mono">{partner.financial.iban}</span>,
                  },
                  {
                    label: "SWIFT / BIC",
                    value: <span className="font-mono">{partner.financial.swift}</span>,
                  },
                  { label: "Bank", value: partner.financial.bankName ?? "—" },
                  { label: "Account holder", value: partner.financial.accountHolder ?? "—" },
                  {
                    label: "Last updated",
                    value: formatPartnerDateTime(partner.financial.updatedAt),
                  },
                ]}
              />
            ) : (
              <p className="flex items-center gap-2 text-[0.8125rem] text-muted">
                <Banknote size={15} className="text-subtle" aria-hidden />
                No bank details on file yet.
              </p>
            )}
          </AdminPanel>

          {terms && <PartnerTermsPanel terms={terms} canEdit={can(session, "finance.terms.write")} />}

          <PartnerContractPanel
            partnerId={id}
            contract={partner.contract}
            canWrite={can(session, "partners.contract.write")}
            canOpen={can(session, "partners.contract.write", "partners.financial.read")}
          />

          {access && (
            <PartnerProductAccessPanel
              partnerId={id}
              entries={access}
              canEdit={can(session, "partners.access.write")}
            />
          )}

          {credit && <PartnerCreditPanel partnerId={id} credit={credit} canEdit={can(session, "partners.credit.write")} />}

          {partner.notes && (
            <AdminPanel title="Internal note" description="Never shown to the partner.">
              <p className="text-[0.875rem] leading-relaxed whitespace-pre-line text-body">
                {partner.notes}
              </p>
            </AdminPanel>
          )}

          <AdminPanel title="Invitations" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {invitations.length === 0 && (
                <li className="px-5 py-6 text-[0.8125rem] text-muted">
                  No invitation has been issued for this partner.
                </li>
              )}
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-[0.875rem] text-ink">
                      <Mail size={14} className="shrink-0 text-subtle" aria-hidden />
                      {invitation.email}
                    </p>
                    <p className="mt-1 text-[0.75rem] text-muted">
                      Sent {formatPartnerDateTime(invitation.createdAt)} · expires{" "}
                      {formatPartnerDateTime(invitation.expiresAt)}
                      {invitation.resentCount > 0 && ` · resent ${invitation.resentCount}×`}
                    </p>
                  </div>
                  <InvitationStatusBadge status={invitation.status} />
                </li>
              ))}
            </ul>
          </AdminPanel>

          <AdminPanel
            title="History"
            description="Every decision and edit, and who made it."
            bodyClassName="p-0"
          >
            <ol className="divide-y divide-line">
              {audit.length === 0 && (
                <li className="px-5 py-6 text-[0.8125rem] text-muted">Nothing recorded yet.</li>
              )}
              {audit.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[0.875rem] font-medium text-ink">
                      <FileClock size={14} className="shrink-0 text-subtle" aria-hidden />
                      {auditActionLabels[entry.action] ?? entry.action}
                    </p>
                    <p className="mt-1 text-[0.8125rem] text-muted">{entry.summary}</p>
                    {typeof entry.metadata.reason === "string" && (
                      <p className="mt-1 text-[0.8125rem] text-body">
                        Reason: {entry.metadata.reason}
                      </p>
                    )}
                  </div>
                  <time
                    dateTime={entry.createdAt}
                    className="shrink-0 text-[0.75rem] whitespace-nowrap text-muted"
                  >
                    {formatPartnerDateTime(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          </AdminPanel>
        </div>

        <div className="space-y-6">
          <AdminPanel title="Status">
            <p className="text-[0.875rem] leading-relaxed text-body">
              {partnerStatusHints[partner.status]}
            </p>

            <AdminDefinitionList
              className="mt-4 border-t border-line pt-4"
              items={[
                { label: "Registered", value: formatPartnerDate(partner.createdAt) },
                { label: "Submitted", value: formatPartnerDate(partner.submittedAt) },
                ...(review.approvedAt
                  ? [
                      { label: "Approved", value: formatPartnerDateTime(review.approvedAt) },
                      { label: "Approved by", value: review.approvedBy?.email ?? "—" },
                    ]
                  : []),
                ...(review.rejectedAt
                  ? [
                      { label: "Rejected", value: formatPartnerDateTime(review.rejectedAt) },
                      { label: "Rejected by", value: review.rejectedBy?.email ?? "—" },
                    ]
                  : []),
                ...(review.suspendedAt
                  ? [
                      { label: "Suspended", value: formatPartnerDateTime(review.suspendedAt) },
                      { label: "Suspended by", value: review.suspendedBy?.email ?? "—" },
                    ]
                  : []),
                ...(review.blockedAt
                  ? [
                      { label: "Blocked", value: formatPartnerDateTime(review.blockedAt) },
                      { label: "Blocked by", value: review.blockedBy?.email ?? "—" },
                    ]
                  : []),
                ...(review.terminatedAt
                  ? [
                      { label: "Terminated", value: formatPartnerDateTime(review.terminatedAt) },
                      { label: "Terminated by", value: review.terminatedBy?.email ?? "—" },
                    ]
                  : []),
                {
                  label: "Platform terms",
                  value: partner.terms.acceptedVersion
                    ? `v${partner.terms.acceptedVersion}${partner.terms.outdated ? " (out of date)" : ""}`
                    : "Not accepted yet",
                },
              ]}
            />

            {review.rejectionReason && (
              <div className="mt-4 rounded-sm bg-surface-soft p-3">
                <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                  Reason given to the partner
                </p>
                <p className="mt-1 text-[0.8125rem] text-body">{review.rejectionReason}</p>
              </div>
            )}

            {review.rejectionNote && (
              <div className="mt-3 rounded-sm bg-surface-soft p-3">
                <p className="flex items-center gap-1.5 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                  <Lock size={11} aria-hidden />
                  Internal note
                </p>
                <p className="mt-1 text-[0.8125rem] text-body">{review.rejectionNote}</p>
              </div>
            )}

            {review.suspensionReason && (
              <div className="mt-3 rounded-sm bg-surface-soft p-3">
                <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                  Suspension reason
                </p>
                <p className="mt-1 text-[0.8125rem] text-body">{review.suspensionReason}</p>
              </div>
            )}

            {review.blockedReason && (
              <div className="mt-3 rounded-sm bg-surface-soft p-3">
                <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                  Block reason
                </p>
                <p className="mt-1 text-[0.8125rem] text-body">{review.blockedReason}</p>
              </div>
            )}

            {review.terminatedReason && (
              <div className="mt-3 rounded-sm bg-surface-soft p-3">
                <p className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                  Termination reason
                </p>
                <p className="mt-1 text-[0.8125rem] text-body">{review.terminatedReason}</p>
              </div>
            )}
          </AdminPanel>

          <PartnerActions partner={partner} />

          <PartnerInvoicingPanel
            partner={{
              id: partner.id,
              taxId: partner.taxId,
              invoiceLang: partner.invoiceLang,
              legalName: partner.legalName,
              legalAddress: partner.legalAddress,
              city: partner.city,
              country: partner.country,
            }}
            canEdit={can(session, "partners.write")}
            languages={invoicing?.languages ?? Object.keys(invoiceLanguageLabels)}
            defaultLang={invoicing?.defaultLang ?? "en"}
          />

          <AdminPanel title="Completeness">
            <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-muted">
              <Building2 size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
              A partner cannot be approved until the company record is complete — legal
              entity, registration number, address, country, phone and email.
            </p>
          </AdminPanel>

          <PartnerDangerZone partner={partner} />
        </div>
      </div>
    </AdminContainer>
  );
}
