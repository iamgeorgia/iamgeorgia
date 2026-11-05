import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { AuditBrowser } from "@/components/admin/AuditBrowser";
import { auditQueryFromParams } from "@/lib/admin/audit";
import { listAudit } from "@/lib/api/audit";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Audit log" };

/**
 * The whole audit trail, newest first.
 *
 * Read-only by construction: the trail is only ever appended to, so this
 * screen has filters and nothing else. The guard mirrors the server's — a
 * role without `audit.read` would get a 403 from the API, and the sidebar
 * already hides the item, so a typed URL goes back to the overview instead
 * of to an error page.
 */
export default async function AdminAuditPage({ searchParams }: PageProps<"/[locale]/admin/audit">) {
  const session = await requireScreen();


  const list = await listAudit(auditQueryFromParams(await searchParams));

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Audit log"
        description="Every change made on the platform, every sign-in and every look at a partner's bank details — who, what and when. Entries are never edited or deleted."
      />

      <AuditBrowser
        entries={list.data}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        totalPages={list.totalPages}
        capabilities={session?.user.capabilities ?? []}
      />
    </AdminContainer>
  );
}
