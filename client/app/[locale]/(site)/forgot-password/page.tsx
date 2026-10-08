import type { Metadata } from "next";

import { Container } from "@/components/ui/Container";
import { ForgotPasswordForm } from "@/components/partners/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

/**
 * Where "Forgot your password?" leads from every sign-in screen. The partner
 * portal, the admin panel and the driver panel share one account table, so
 * they share one reset flow too.
 */
export default function ForgotPasswordPage() {
  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto max-w-md">
        <p className="text-[0.8125rem] font-medium tracking-[0.12em] text-brand-text uppercase">
          Password reset
        </p>
        <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">
          Forgot your password?
        </h1>
        <p className="mt-4 text-[1rem] leading-relaxed text-muted">
          Enter the email address you sign in with. If it belongs to an account, we will send a
          link to choose a new password. The link works once and expires after an hour.
        </p>

        <ForgotPasswordForm />
      </div>
    </Container>
  );
}
