import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { ApprovalsBrowser } from "@/components/admin/finance/ApprovalsBrowser";
import { APPROVAL_SCREEN_CAPABILITIES, approvalKinds, approvalStatuses } from "@/lib/admin/approvals";
import { listApprovals, type ApprovalQuery } from "@/lib/api/approvals";
import { requireScreen } from "@/lib/auth/session";
import type { ApprovalKind, ApprovalStatus } from "@/types/approval";

export const metadata: Metadata = { title: "Approvals" };

/** Reads the filters out of the URL; anything unrecognised is dropped. No status means "waiting". */
function approvalQueryFromParams(params: Record<string, string | string[] | undefined>): ApprovalQuery {
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const status = single(params.status);
  const kind = single(params.kind) as ApprovalKind | undefined;
  const page = Number(single(params.page));

  return {
    status:
      status === "all"
        ? undefined
        : approvalStatuses.includes(status as ApprovalStatus)
          ? (status as ApprovalStatus)
          : "PENDING",
    kind: kind && approvalKinds.includes(kind) ? kind : undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    pageSize: 25,
  };
}

/** Changes to money that need a second person: asked for by one, decided by another. */
export default async function AdminApprovalsPage({ searchParams }: PageProps<"/[locale]/admin/finance/approvals">) {
  const session = await requireScreen();


  const list = await listApprovals(approvalQueryFromParams(await searchParams));

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Approvals"
        description="Refunds, write-offs and other money changes that need a second person to say yes before they happen."
      />

      <ApprovalsBrowser
        approvals={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
      />
    </AdminContainer>
  );
}
