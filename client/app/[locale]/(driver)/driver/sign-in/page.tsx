import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Logo } from "@/components/layout/Logo";
import { PortalSignInForm } from "@/components/partners/PortalSignInForm";
import { getSession } from "@/lib/auth/session";
import { localePath } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { homePathFor } from "@/types/auth";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

/**
 * Outside the panel shell, so it carries its own wordmark. One card, centred
 * on a wide screen and edge-to-edge-ish on a phone, with nothing to read but
 * the one instruction a driver needs.
 */
export default async function DriverSignInPage() {
  const session = await getSession();
  const locale = await getLocale();

  if (session) {
    redirect(localePath(locale, homePathFor(session)));
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:px-6 sm:py-20">
        <p className="mb-6 flex items-center justify-center gap-2.5">
          <Logo className="size-8" />
          <span>
            <span className="block font-display text-[1rem] leading-none tracking-[0.06em] text-ink">I&apos;AM GEORGIA</span>
            <span className="mt-1 block text-[0.6875rem] leading-none tracking-[0.14em] text-muted uppercase">Drivers</span>
          </span>
        </p>

        <div className="rounded-md border border-line bg-surface p-6 shadow-card sm:p-8">
          <h1 className="font-display text-[1.75rem] leading-[1.2] font-normal text-ink">Driver sign in</h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
            <bdi>Use the email address your activation link was sent to.</bdi>
          </p>

          <PortalSignInForm redirectTo="/driver" />
        </div>

        <p className="mt-6 text-center text-[0.875rem] leading-relaxed text-muted">
          <bdi>No activation link, or it has expired? Ask dispatch to send a new one.</bdi>
        </p>
      </div>
    </div>
  );
}
