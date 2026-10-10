"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { describeError } from "@/lib/api/client";
import { signIn } from "@/lib/api/partners";
import { forgetViewer } from "@/lib/auth/useViewer";
import { accountBlockKey } from "@/lib/auth/accountBlock";
import { useI18n, useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Admin sign-in.
 *
 * The form does no credential checking of its own beyond "both fields have
 * something in them". The server answers a wrong password and an unknown
 * address with the same 401 and the same wording on purpose, and repeating
 * that message verbatim is what keeps the sign-in screen from becoming a way
 * to discover who has an account.
 *
 * The session arrives as an httpOnly cookie, so there is nothing to store here
 * — `router.refresh()` is what makes the server re-render with it.
 */
export function SignInForm({ redirectTo = "/admin" }: { redirectTo?: string }) {
  const router = useRouter();
  const path = useLocalePath();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || !password) {
      setError("Enter an email address and a password to continue.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await signIn(email.trim(), password);
      // The site header caches who the viewer is for the life of the document.
      forgetViewer();
      router.replace(path(redirectTo));
      router.refresh();
    } catch (caught) {
      const blocked = accountBlockKey(caught);
      setError(blocked ? t.error[blocked] : describeError(caught));
      setSubmitting(false);
    }
  };

  const field =
    "h-11 w-full rounded-sm border bg-on-dark/6 px-3.5 text-sm text-on-dark placeholder:text-on-dark/35 transition-colors focus:outline-none";
  const label = "mb-1.5 block text-[0.75rem] font-medium text-on-dark/60";

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8">
      <div className="space-y-4">
        <div>
          <label htmlFor="admin-email" className={label}>
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "admin-signin-error" : undefined}
            className={cn(
              field,
              error ? "border-error-on-dark" : "border-on-dark/15 focus:border-on-dark/45",
            )}
          />
        </div>

        <div>
          <label htmlFor="admin-password" className={label}>
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "admin-signin-error" : undefined}
            className={cn(
              field,
              error ? "border-error-on-dark" : "border-on-dark/15 focus:border-on-dark/45",
            )}
          />
        </div>
      </div>

      <p className="mt-3 text-end text-[0.8125rem]">
        <Link
          href={path("/forgot-password")}
          className="text-on-dark-muted underline-offset-4 transition-colors hover:text-on-dark hover:underline"
        >
          Forgot your password?
        </Link>
      </p>

      {error && (
        <p
          id="admin-signin-error"
          role="alert"
          className="mt-3 text-[0.8125rem] text-error-on-dark"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-brand text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-70"
      >
        {submitting && <Loader2 size={16} className="animate-spin" aria-hidden />}
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
