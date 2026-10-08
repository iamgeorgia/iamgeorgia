"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { describeError } from "@/lib/api/client";
import { signIn } from "@/lib/api/partners";
import { forgetViewer } from "@/lib/auth/useViewer";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Partner sign-in.
 *
 * Signing in succeeds in every partner status, including while an application
 * is under review and after it has been declined. That is deliberate: the
 * portal has a page explaining each of those, and telling someone their
 * password is wrong when the real answer is "we are still reading your
 * application" only generates a support call. Nothing behind the gate opens —
 * the server enforces that separately, on every request.
 */
export function PortalSignInForm({ redirectTo = "/portal" }: { redirectTo?: string } = {}) {
  const router = useRouter();
  const path = useLocalePath();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || !password) {
      setError("Enter your email address and password to continue.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await signIn(email.trim(), password);
      forgetViewer();
      router.replace(path(redirectTo));
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
      setSubmitting(false);
    }
  };

  const field =
    "h-11 w-full rounded-sm border bg-background px-3 text-[0.875rem] text-ink transition-colors focus:outline-none";

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
      <div>
        <label htmlFor="portal-email" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
          Email
        </label>
        <input
          id="portal-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "portal-signin-error" : undefined}
          className={cn(field, error ? "border-error" : "border-line focus:border-ink")}
        />
      </div>

      <div>
        <label
          htmlFor="portal-password"
          className="mb-1.5 block text-[0.8125rem] font-medium text-ink"
        >
          Password
        </label>
        <input
          id="portal-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "portal-signin-error" : undefined}
          className={cn(field, error ? "border-error" : "border-line focus:border-ink")}
        />
        <p className="mt-1.5 text-end text-[0.8125rem]">
          <Link
            href={path("/forgot-password")}
            className="text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            Forgot your password?
          </Link>
        </p>
      </div>

      {error && (
        <p id="portal-signin-error" role="alert" className="text-[0.8125rem] text-error-text">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-brand text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
      >
        {submitting && <Loader2 size={16} className="animate-spin" aria-hidden />}
        Sign in
      </button>
    </form>
  );
}
