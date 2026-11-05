import type { Metadata } from "next";
import { redirect } from "next/navigation";

import Link from "next/link";

import { PortalSignInForm } from "@/components/partners/PortalSignInForm";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { homePathFor } from "@/types/auth";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function PortalSignInPage() {
  const session = await getSession();
  const locale = await getLocale();

  // Already signed in: the portal home works out where they belong.
  if (session) {
    redirect(localePath(locale, homePathFor(session) === "/" ? "/portal" : homePathFor(session)));
  }

  const { path } = await getI18n();

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6 sm:py-20">
      <div className="rounded-md border border-line bg-surface p-6 shadow-card sm:p-8">
        <h1 className="font-display text-[1.75rem] leading-[1.2] font-normal text-ink">Partner sign in</h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
          Use the email address your invitation was sent to.
        </p>

        <PortalSignInForm />
      </div>

      {/* Partner accounts are opened by invitation only, so the way in for a
          company without one is a conversation, not a sign-up form. */}
      <p className="mt-6 text-center text-[0.875rem] leading-relaxed text-muted">
        Accounts are opened by invitation.{" "}
        <Link href={path("/contact")} className="font-medium text-brand-text underline-offset-4 hover:underline">
          Get in touch
        </Link>{" "}
        to work with us.
      </p>
    </div>
  );
}
