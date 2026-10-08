"use client";

import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { useState } from "react";

import { describeError } from "@/lib/api/client";
import { requestPasswordReset } from "@/lib/api/partners";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Asking for a reset link.
 *
 * The confirmation reads the same whether or not the address has an account,
 * because the server answers the same. Saying "no such account" here would
 * turn the form into a way to find out who is registered.
 */
export function ForgotPasswordForm() {
  const path = useLocalePath();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();

    if (!address.includes("@")) {
      setError("Enter the email address you sign in with.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await requestPasswordReset(address);
      setSentTo(address);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <div className="mt-8 rounded-sm border border-line bg-surface p-5" role="status">
        <div className="flex items-start gap-3">
          <MailCheck size={20} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <div className="text-[0.9375rem] leading-relaxed text-ink">
            <p>
              If <span className="font-medium">{sentTo}</span> has an account, a reset link is on
              its way. Check your inbox and your spam folder.
            </p>
            <p className="mt-3 text-muted">
              Nothing after a few minutes? Check the address and{" "}
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className="text-ink underline underline-offset-4"
              >
                try again
              </button>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  const field =
    "h-11 w-full rounded-sm border bg-background px-3 text-[0.875rem] text-ink transition-colors focus:outline-none";

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
      <div>
        <label htmlFor="reset-email" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
          Email address
        </label>
        <input
          id="reset-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "reset-email-error" : undefined}
          className={cn(field, error ? "border-error" : "border-line focus:border-ink")}
        />
      </div>

      {error && (
        <p id="reset-email-error" role="alert" className="text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-brand text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
      >
        {submitting && <Loader2 size={16} className="animate-spin" aria-hidden />}
        Send reset link
      </button>

      <p className="text-center text-[0.8125rem] text-muted">
        Remembered it?{" "}
        <Link href={path("/portal/sign-in")} className="text-ink underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
