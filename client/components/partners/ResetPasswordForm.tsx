"use client";

import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";

import { ApiError, describeError } from "@/lib/api/client";
import { resetPasswordWithToken } from "@/lib/api/partners";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const MIN_PASSWORD = 12;

/** The server's answer to a link that cannot be used, in words a person can act on. */
const linkProblem = (error: unknown): string | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 410) return "This link has expired. Reset links last an hour, so ask for a new one.";
  if (error.status === 409) return "This link has already been used. Ask for a new one if you still need it.";
  if (error.status === 404) return "This link is not valid. Check you copied all of it, or ask for a new one.";
  return null;
};

/**
 * Choosing a new password from a reset link.
 *
 * A reset ends every session on the account and deliberately does not start a
 * new one, so success hands the person to a sign-in screen rather than into
 * the app. Which screen depends on who they are, and this page cannot know,
 * so it offers all three.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const path = useLocalePath();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deadLink, setDeadLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    if (password !== confirm) {
      setError("Both passwords must match.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await resetPasswordWithToken(token, password);
      setDone(true);
    } catch (caught) {
      const problem = linkProblem(caught);
      setDeadLink(Boolean(problem));
      setError(problem ?? describeError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mt-8 rounded-sm border border-line bg-surface p-5" role="status">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <div className="text-[0.9375rem] leading-relaxed text-ink">
            <p>Your password has been changed, and every session on the account has been ended.</p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.875rem]">
              <Link href={path("/portal/sign-in")} className="font-medium underline underline-offset-4">
                Partner sign in
              </Link>
              <Link href={path("/admin/sign-in")} className="font-medium underline underline-offset-4">
                Staff sign in
              </Link>
              <Link href={path("/driver/sign-in")} className="font-medium underline underline-offset-4">
                Driver sign in
              </Link>
            </div>
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
        <label htmlFor="new-password" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "reset-error" : "new-password-hint"}
          className={cn(field, error ? "border-error" : "border-line focus:border-ink")}
        />
        <p id="new-password-hint" className="mt-1.5 text-[0.75rem] text-muted">
          At least {MIN_PASSWORD} characters, and not built from your name or email address.
        </p>
      </div>

      <div>
        <label htmlFor="confirm-password" className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          aria-invalid={Boolean(error)}
          className={cn(field, error ? "border-error" : "border-line focus:border-ink")}
        />
      </div>

      {error && (
        <p id="reset-error" role="alert" className="text-[0.8125rem] text-error-text">
          {error}{" "}
          {deadLink && (
            <Link href={path("/forgot-password")} className="text-ink underline underline-offset-4">
              Request a new link
            </Link>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-brand text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
      >
        {submitting && <Loader2 size={16} className="animate-spin" aria-hidden />}
        Save new password
      </button>
    </form>
  );
}
