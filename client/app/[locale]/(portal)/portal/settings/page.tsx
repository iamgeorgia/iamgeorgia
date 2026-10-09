import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Container } from "@/components/ui/Container";
import { PortalSettings } from "@/components/partners/PortalSettings";
import { ApiError, serverFetchOptional } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { homePathFor } from "@/types/auth";
import type { PartnerFinancial } from "@/types";

export const metadata: Metadata = { title: "Settings" };

/**
 * Profile settings for a partner.
 *
 * The bank details are fetched here rather than read off `partner.financial`,
 * for the same reason the server keeps them in their own table: the roles
 * entitled to see them are narrower than the roles entitled to see a company.
 * `serverFetchOptional` turns the 403 an agent gets into a null, so the section
 * is simply absent for them instead of the page failing.
 */
export default async function PortalSettingsPage() {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));

  if (!session.partner) {
    redirect(localePath(locale, homePathFor(session)));
  }

  // Editing a company is gated on approval server-side, so an unapproved
  // partner is sent back to the page that explains where they stand.
  if (session.partner.status !== "APPROVED") {
    redirect(localePath(locale, "/portal"));
  }

  let financial: PartnerFinancial | null = null;

  try {
    financial = await serverFetchOptional<PartnerFinancial>("/api/partner/financial");
  } catch (error) {
    // 404 means this partner has no bank details on file yet, which is a state
    // the form handles; anything else is a real failure.
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">Settings</h1>
        <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-muted">
          Keep your company details, your own contact information and your bank details up to
          date. Changes take effect immediately.
        </p>

        <PortalSettings
          partner={session.partner}
          user={session.user}
          financial={financial}
        />
      </div>
    </Container>
  );
}
