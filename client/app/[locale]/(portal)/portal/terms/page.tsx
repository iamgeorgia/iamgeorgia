import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";

import { PortalContainer, PortalFacts, PortalPageHeader, PortalPanel } from "@/components/partners/PortalPage";
import { PortalTermsAccept } from "@/components/partners/PortalTermsAccept";
import { getOwnTerms } from "@/lib/api/partners";
import { formatPartnerDate } from "@/lib/admin/partners";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { can, homePathFor } from "@/types/auth";

export const metadata: Metadata = { title: "Platform terms" };

/**
 * The platform terms, and where the owner accepts a new version.
 *
 * Readable in every partner status: the server does not gate this endpoint on
 * approval, because a partner locked out by a new version has to be able to get
 * here. Only the owner (`partner.terms.accept`) sees the button; everyone else
 * is told who to ask.
 */
export default async function PortalTermsPage() {
  const session = await getSession();
  const locale = await getLocale();

  if (!session) redirect(localePath(locale, "/portal/sign-in"));
  if (!session.partner) redirect(localePath(locale, homePathFor(session)));

  const terms = await getOwnTerms();
  const mayAccept = can(session, "partner.terms.accept");

  return (
    <PortalContainer narrow>
      <PortalPageHeader
        title="Platform terms"
        description="The terms your company works with us under. A new version has to be accepted by your company's owner before anyone can book or manage anything."
      />

      <div className="max-w-2xl space-y-6">
        {terms.outdated && (
          <p
            role="status"
            className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-4 text-[0.875rem] leading-relaxed text-warning-text"
          >
            <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
            The terms have changed. Until they are accepted, your company cannot book or manage anything on
            the platform.
          </p>
        )}

        <PortalPanel title="Current version">
          <PortalFacts
            items={[
              { label: "Version", value: <span className="font-mono">{terms.current}</span> },
              {
                label: "Your company",
                value: terms.acceptedVersion
                  ? `Accepted version ${terms.acceptedVersion} on ${formatPartnerDate(terms.acceptedAt)}`
                  : "Not accepted yet",
              },
            ]}
          />

          {terms.url && (
            <a
              href={terms.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-4 inline-flex min-h-10 items-center gap-1.5 text-[0.9375rem] font-medium text-brand-text underline-offset-4 hover:underline"
            >
              <ExternalLink size={15} aria-hidden />
              Read the terms
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}

          {terms.outdated ? (
            mayAccept ? (
              <PortalTermsAccept version={terms.current} />
            ) : (
              <p className="mt-5 border-t border-line pt-4 text-[0.9375rem] leading-relaxed text-body">
                Only the owner of your company account can accept the new terms. Ask your owner to sign in
                and accept them.
              </p>
            )
          ) : (
            <p className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-[0.9375rem] text-body">
              <CircleCheck size={17} className="shrink-0 text-success" aria-hidden />
              Your company is up to date. Nothing to do.
            </p>
          )}
        </PortalPanel>
      </div>
    </PortalContainer>
  );
}
