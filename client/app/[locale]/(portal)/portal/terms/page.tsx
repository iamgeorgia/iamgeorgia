import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { PortalTermsAccept } from "@/components/partners/PortalTermsAccept";
import { Container } from "@/components/ui/Container";
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
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">Platform terms</h1>

        <section className="mt-6 rounded-sm border border-line bg-surface p-6">
          <p className="text-[0.9375rem] text-body">
            Current version: <span className="font-mono text-ink">{terms.current}</span>
          </p>

          {terms.url && (
            <a
              href={terms.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1.5 text-[0.9375rem] text-brand-text underline-offset-4 hover:underline"
            >
              <ExternalLink size={15} aria-hidden />
              Read the terms
            </a>
          )}

          <p className="mt-4 text-[0.875rem] leading-relaxed text-muted">
            {terms.acceptedVersion
              ? `Your company accepted version ${terms.acceptedVersion} on ${formatPartnerDate(terms.acceptedAt)}.`
              : "Your company has not accepted the terms yet."}
          </p>

          {terms.outdated ? (
            <>
              <p className="mt-4 rounded-sm bg-warning/12 p-3 text-[0.875rem] leading-relaxed text-warning-text">
                The terms have changed. Until they are accepted, your company cannot book or manage
                anything on the platform.
              </p>
              {mayAccept ? (
                <PortalTermsAccept version={terms.current} />
              ) : (
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-body">
                  Only the owner of your company account can accept the new terms. Ask your owner to
                  sign in and accept them.
                </p>
              )}
            </>
          ) : (
            <p className="mt-4 text-[0.9375rem] text-body">Your company is up to date. Nothing to do.</p>
          )}
        </section>
      </div>
    </Container>
  );
}
