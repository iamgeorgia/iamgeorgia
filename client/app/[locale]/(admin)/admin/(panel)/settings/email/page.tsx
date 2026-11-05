import type { Metadata } from "next";

import { AdminContainer, AdminPageHeader } from "@/components/admin/AdminPage";
import { MailProviderSettings } from "@/components/admin/MailProviderSettings";
import { getMailProviderStatus } from "@/lib/api/mail";
import { requireScreen } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Email" };

/**
 * The Google account outgoing mail is sent as, through the Gmail API.
 * Connecting it is a round trip to Google that lands back here with
 * `?connected=1` or `?error=<code>`; the server never puts anything Google
 * sent into that URL, only its own fixed codes.
 */
export default async function AdminEmailSettingsPage({ searchParams }: PageProps<"/[locale]/admin/settings/email">) {
  await requireScreen();
  const [status, params] = await Promise.all([getMailProviderStatus(), searchParams]);
  const pick = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

  return (
    <AdminContainer>
      <AdminPageHeader
        title="Email"
        description="The Google account the platform sends booking confirmations, invitations and reminders from, when email goes through the Gmail API."
      />
      <div className="mt-8">
        <MailProviderSettings initial={status} connected={pick(params.connected) === "1"} errorCode={pick(params.error)} />
      </div>
    </AdminContainer>
  );
}
