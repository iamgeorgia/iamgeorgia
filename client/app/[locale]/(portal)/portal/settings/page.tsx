import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalAgreements } from "@/components/partners/PortalAgreements";
import { PortalContainer, PortalPageHeader } from "@/components/partners/PortalPage";
import { PortalSettings } from "@/components/partners/PortalSettings";
import { ApiError, serverFetchOptional } from "@/lib/api/client";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can, homePathFor } from "@/types/auth";
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

  // A new version of the platform terms locks the portal until the owner accepts it.
  if (session.partner.terms?.outdated) {
    redirect(localePath(locale, "/portal/terms"));
  }

  let financial: PartnerFinancial | null = null;

  try {
    financial = await serverFetchOptional<PartnerFinancial>("/api/partner/financial");
  } catch (error) {
    // 404 means this partner has no bank details on file yet, which is a state
    // the form handles; anything else is a real failure.
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  // The index beside the forms lists exactly the sections rendered — the same
  // capability checks `PortalSettings` and `PortalAgreements` apply — so it
  // never offers a jump to a form this account does not get.
  const sections = [
    can(session.user, "partner.profile.write") && { id: "company", label: "Company" },
    { id: "account", label: "Your details" },
    can(session.user, "partner.financial.read") && { id: "financial", label: "Bank details" },
    { id: "password", label: "Password" },
    (session.partner.contract || session.partner.terms) && { id: "agreements", label: "Agreements" },
  ].filter((section): section is { id: string; label: string } => Boolean(section));

  return (
    <PortalContainer>
      <PortalPageHeader
        title="Settings"
        description="Keep your company details, your own contact information and your bank details up to date. Changes take effect immediately."
      />

      <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[13rem_minmax(0,48rem)]">
        {/* Desktop only: on a phone the forms are one column and the page is
            its own index. Anchors, so it works before hydration. */}
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-24 space-y-0.5 border-s border-line">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="-ms-px flex min-h-9 items-center border-s-2 border-transparent ps-4 text-[0.875rem] text-muted transition-colors hover:border-ink/30 hover:text-ink"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <PortalSettings partner={session.partner} user={session.user} financial={financial} />
          <PortalAgreements partner={session.partner} />
        </div>
      </div>
    </PortalContainer>
  );
}
