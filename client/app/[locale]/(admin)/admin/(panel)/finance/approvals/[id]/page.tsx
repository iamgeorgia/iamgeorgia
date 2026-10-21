import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import {
  AdminBreadcrumbs,
  AdminContainer,
  AdminDefinitionList,
  AdminPageHeader,
  AdminPanel,
} from "@/components/admin/AdminPage";
import { ApprovalDecision } from "@/components/admin/finance/ApprovalDecision";
import { ApprovalStatusBadge } from "@/components/admin/finance/ApprovalStatusBadge";
import { formatFinanceDate, formatFinanceDateTime } from "@/components/admin/finance/PaymentFormat";
import {
  APPROVAL_SCREEN_CAPABILITIES,
  approvalKindLabels,
  approveCapability,
} from "@/lib/admin/approvals";
import { paymentMethodLabels } from "@/lib/admin/finance";
import { getApproval } from "@/lib/api/approvals";
import { ApiError } from "@/lib/api/client";
import { requireScreen } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { formatMoney } from "@/lib/money";
import { can } from "@/types/auth";
import type { Approval } from "@/types/approval";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/finance/approvals/[id]">): Promise<Metadata> {
  const { id } = await params;

  try {
    const approval = await getApproval(id);
    return { title: `${approval.reference} — Approvals` };
  } catch {
    return { title: "Approvals" };
  }
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const cents = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The screen the request is about: the payable or receivable it changes, or the payment a refund made. */
function subjectPath(approval: Approval): { label: string; href: string } | null {
  if (!approval.subjectId) return null;
  if (approval.kind === "PAYABLE_OVERRIDE" || approval.kind === "PAYABLE_WAIVE") {
    return { label: "Open the payable", href: `/admin/finance/payables/${approval.subjectId}` };
  }
  if (approval.kind === "RECEIVABLE_DUE_DATE" || approval.kind === "RECEIVABLE_WAIVE") {
    return { label: "Open the receivable", href: `/admin/finance/receivables/${approval.subjectId}` };
  }
  return null;
}

/** What the request asks for, in the words Finance would use, from its payload. */
function requestedChange(approval: Approval): { label: string; value: React.ReactNode }[] {
  const payload = approval.payload ?? {};
  const currency = approval.currency ?? text(payload.currency) ?? "GEL";
  const reason = text(payload.reason);
  const items: { label: string; value: React.ReactNode }[] = [];

  switch (approval.kind) {
    case "REFUND": {
      const amount = cents(payload.amountCents) ?? approval.amountCents;
      const paidAt = text(payload.paidAt);
      const method = text(payload.method);
      const allocations = Array.isArray(payload.allocations) ? payload.allocations.length : 0;

      items.push({
        label: "Direction",
        value: payload.direction === "IN" ? "Refund received from a supplier" : "Refund paid back to a buyer",
      });
      if (amount !== null) items.push({ label: "Amount", value: <span className="tabular-nums">{formatMoney(amount, currency)}</span> });
      if (paidAt) items.push({ label: "Paid on", value: formatFinanceDate(paidAt) });
      if (method) items.push({ label: "Method", value: paymentMethodLabels[method as keyof typeof paymentMethodLabels] ?? method });
      if (text(payload.reference)) items.push({ label: "Reference", value: text(payload.reference) });
      if (allocations > 0) {
        items.push({ label: "Settles", value: allocations === 1 ? "1 item" : `${allocations} items` });
      } else {
        items.push({ label: "Settles", value: "Nothing yet — allocated later" });
      }
      if (text(payload.note)) items.push({ label: "Note", value: text(payload.note) });
      break;
    }
    case "PAYABLE_OVERRIDE": {
      const amount = cents(payload.amountOverrideCents);
      items.push({
        label: "Amount owed to the supplier",
        value:
          amount === null ? (
            "Hand back to the supplier's terms"
          ) : (
            <span className="tabular-nums">{formatMoney(amount, currency)}</span>
          ),
      });
      break;
    }
    case "PAYABLE_WAIVE":
      items.push({ label: "Change", value: "Write off what is left to pay the supplier" });
      break;
    case "RECEIVABLE_DUE_DATE": {
      const dueAt = text(payload.dueAt);
      items.push({ label: "New due date", value: dueAt ? formatFinanceDate(dueAt) : "No due date" });
      break;
    }
    case "RECEIVABLE_WAIVE":
      items.push({ label: "Change", value: "Write off what the buyer still owes" });
      break;
  }

  items.push({ label: "Reason", value: reason ?? "—" });
  return items;
}

/** One approval request: what is asked, by whom, and the decision. */
export default async function AdminApprovalPage({ params }: PageProps<"/[locale]/admin/finance/approvals/[id]">) {
  const session = await requireScreen();


  const { id } = await params;
  const { path } = await getI18n();

  let approval: Approval;

  try {
    approval = await getApproval(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const isRequester = Boolean(approval.requestedBy && approval.requestedBy.id === session?.user.id);
  const canDecide = can(session, approveCapability(approval.kind));
  const subject = subjectPath(approval);
  const executed =
    approval.status === "APPROVED" && approval.executedEntityId
      ? approval.kind === "REFUND"
        ? { label: "Open the refund", href: `/admin/finance/payments/${approval.executedEntityId}` }
        : subject
      : null;

  return (
    <AdminContainer>
      <AdminBreadcrumbs
        items={[{ label: "Approvals", href: path("/admin/finance/approvals") }, { label: approval.reference }]}
      />

      <AdminPageHeader
        title={approval.reference}
        description={`${approvalKindLabels[approval.kind]} · ${approval.summary}`}
        actions={<ApprovalStatusBadge status={approval.status} className="text-[0.8125rem]" />}
      />

      {approval.lastError && approval.status === "PENDING" && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-sm border border-error/40 bg-surface px-4 py-3 text-[0.875rem] leading-relaxed text-error-text"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">The last attempt to make this change failed.</span> {approval.lastError} It
            is still waiting; fix the cause and approve it again, or reject it.
          </span>
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <AdminPanel title="What is being asked" description={approvalKindLabels[approval.kind]}>
            <AdminDefinitionList items={requestedChange(approval)} />
            {subject && (
              <p className="mt-4 border-t border-line pt-4 text-[0.8125rem]">
                <Link
                  href={path(subject.href)}
                  prefetch={false}
                  className="text-brand-text underline-offset-4 hover:underline"
                >
                  {subject.label}
                </Link>
              </p>
            )}
          </AdminPanel>

          <AdminPanel title="Who and when">
            <AdminDefinitionList
              items={[
                { label: "Asked by", value: approval.requestedBy?.fullName ?? "—" },
                { label: "Asked", value: formatFinanceDateTime(approval.createdAt) },
                ...(approval.requestNote ? [{ label: "Their note", value: approval.requestNote }] : []),
                ...(approval.decidedAt
                  ? [
                      {
                        label: approval.status === "CANCELLED" ? "Withdrawn" : "Decided",
                        value: formatFinanceDateTime(approval.decidedAt),
                      },
                    ]
                  : []),
                ...(approval.decidedBy && approval.status !== "CANCELLED"
                  ? [{ label: "Decided by", value: approval.decidedBy.fullName }]
                  : []),
                ...(approval.decisionNote ? [{ label: "Decision note", value: approval.decisionNote }] : []),
              ]}
            />
            {executed && (
              <p className="mt-4 border-t border-line pt-4 text-[0.8125rem]">
                <Link
                  href={path(executed.href)}
                  prefetch={false}
                  className="text-brand-text underline-offset-4 hover:underline"
                >
                  {executed.label}
                </Link>
              </p>
            )}
          </AdminPanel>
        </div>

        <div className="min-w-0 space-y-6">
          <ApprovalDecision approval={approval} canDecide={canDecide} isRequester={isRequester} />

          {approval.status === "PENDING" && !canDecide && !isRequester && (
            <AdminPanel title="Waiting">
              <p className="text-[0.8125rem] leading-relaxed text-muted">
                This is waiting for someone who can approve it. You can read it but not decide on it.
              </p>
            </AdminPanel>
          )}
        </div>
      </div>
    </AdminContainer>
  );
}
