import type { Metadata } from "next";

import { Container } from "@/components/ui/Container";
import { ResetPasswordForm } from "@/components/partners/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

/**
 * The landing page for a password-reset email.
 *
 * Unlike activation there is no preview endpoint to ask whether the link is
 * still good, so the form is shown straight away and the server's answer to
 * the submit says whether the link was expired, used or never valid.
 */
export default async function ResetPasswordPage({
  params,
}: PageProps<"/[locale]/reset-password/[token]">) {
  const { token } = await params;

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto max-w-md">
        <p className="text-[0.8125rem] font-medium tracking-[0.12em] text-brand-text uppercase">
          Password reset
        </p>
        <h1 className="mt-3 font-display text-[2rem] leading-tight text-ink">
          Choose a new password
        </h1>
        <p className="mt-4 text-[1rem] leading-relaxed text-muted">
          Saving it signs you out everywhere, including on any device someone else may have used.
          You will then sign in with the new password.
        </p>

        <ResetPasswordForm token={token} />
      </div>
    </Container>
  );
}
