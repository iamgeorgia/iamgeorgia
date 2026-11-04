import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalContainer, PortalPageHeader } from "@/components/partners/PortalPage";
import { TeamSection } from "@/components/partners/TeamSection";
import { getGrantable, listUsers } from "@/lib/api/users";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can, homePathFor } from "@/types/auth";

export const metadata: Metadata = { title: "Team" };

/**
 * The people who can sign in for this company.
 *
 * Owners and partner admins only (`partner.team.manage`); anyone else is sent
 * to the dashboard rather than shown a page whose every call would answer 403.
 * A team is capped at 25 members on the server, so one page of 100 is all of it.
 */
export default async function PortalTeamPage() {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));

  if (!session.partner) {
    redirect(localePath(locale, homePathFor(session)));
  }

  // Managing the team is gated on approval server-side, as editing the company is.
  if (session.partner.status !== "APPROVED") {
    redirect(localePath(locale, "/portal"));
  }

  // A new version of the platform terms locks the portal until the owner accepts it.
  if (session.partner.terms?.outdated) {
    redirect(localePath(locale, "/portal/terms"));
  }

  if (!can(session, "partner.team.manage")) {
    redirect(localePath(locale, "/portal/dashboard"));
  }

  const [team, grantable] = await Promise.all([
    listUsers("team", { pageSize: 100 }),
    getGrantable("team"),
  ]);

  return (
    <PortalContainer>
      <PortalPageHeader
        title="Team"
        description={`Invite the people who book and manage ${session.partner.name}'s account, choose what each of them can do, and switch off anyone who has left.`}
      />

      <TeamSection members={team.data} total={team.total} viewer={session.user} grantable={grantable.roles} />
    </PortalContainer>
  );
}
