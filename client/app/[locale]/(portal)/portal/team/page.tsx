import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Container } from "@/components/ui/Container";
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

  if (!can(session, "partner.team.manage")) {
    redirect(localePath(locale, "/portal/dashboard"));
  }

  const [team, grantable] = await Promise.all([
    listUsers("team", { pageSize: 100 }),
    getGrantable("team"),
  ]);

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">Team</h1>
        <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-muted">
          Invite the people who book and manage {session.partner.name}&apos;s account, choose what
          each of them can do, and switch off anyone who has left.
        </p>

        <TeamSection members={team.data} total={team.total} viewer={session.user} grantable={grantable.roles} />
      </div>
    </Container>
  );
}
