"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, MailPlus, RotateCcw } from "lucide-react";

import { AdminPanel } from "./AdminPage";
import { useCan } from "./AdminViewerContext";
import { FormError, SubmitButton, TextInput } from "./FormControls";
import { ReadOnlyNote } from "./ReadOnlyNote";
import { ApiError, describeError } from "@/lib/api/client";
import {
  createDriverAccount,
  resendDriverActivation,
  type DriverAccountResult,
} from "@/lib/api/drivers";
import type { DriverAdmin } from "@/types/driver";

/**
 * The driver's login.
 *
 * Three states: no account, an account waiting for its first password, an
 * active account. The activation link goes by email, and it is also shown
 * here with a copy button — as the partner invitation is — so an operator
 * can pass it on over WhatsApp when the email has not landed, or when the
 * mail server was down.
 */
export function DriverAccount({ driver }: { driver: DriverAdmin }) {
  const router = useRouter();
  const can = useCan();
  const canManage = can("dispatch.write");
  const [email, setEmail] = useState(driver.email ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DriverAccountResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  const run = async (call: () => Promise<DriverAccountResult>) => {
    setBusy(true);
    setError(null);
    setFieldError(undefined);

    try {
      setResult(await call());
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldError(caught.fieldErrors().email);
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!driver.user) {
    return (
      <AdminPanel title="Login" description="Not created yet. The driver can still be dispatched to by phone.">
        {!canManage ? (
          <ReadOnlyNote needs="dispatch.write" what="Creating a login" />
        ) : (
          <>
            <TextInput
              label="Login email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={fieldError}
              hint="They will receive a link to choose a password."
            />
            <FormError message={error} />
            <SubmitButton
              className="mt-4"
              busy={busy}
              disabled={!email.trim()}
              onClick={() => run(() => createDriverAccount(driver.id, email.trim()))}
            >
              <MailPlus size={14} aria-hidden />
              {busy ? "Creating…" : "Create login and send the link"}
            </SubmitButton>
          </>
        )}
      </AdminPanel>
    );
  }

  return (
    <AdminPanel title="Login">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.875rem]">
        <dt className="text-muted">Email</dt>
        <dd className="break-all text-ink">{driver.user.email}</dd>
        <dt className="text-muted">Status</dt>
        <dd className="text-ink">
          {!driver.user.isActive ? "Deactivated" : driver.user.isPending ? "Waiting for a password" : "Active"}
        </dd>
      </dl>

      {driver.user.isPending && driver.user.isActive && !canManage && (
        <ReadOnlyNote needs="dispatch.write" what="Sending a new activation link" className="mt-4" />
      )}

      {driver.user.isPending && driver.user.isActive && canManage && (
        <>
          <FormError message={error} />
          <SubmitButton
            className="mt-4"
            busy={busy}
            saved={result !== null}
            onClick={() => run(() => resendDriverActivation(driver.id))}
          >
            <RotateCcw size={14} aria-hidden />
            {busy ? "Sending…" : result ? "Send another link" : "Send a new activation link"}
          </SubmitButton>

          {result && <ActivationLink result={result} />}
        </>
      )}
    </AdminPanel>
  );
}

/**
 * The link that was just issued, whether or not the email went out. Every
 * new link kills the previous one, so this is the only one that works.
 */
function ActivationLink({ result }: { result: DriverAccountResult }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    await navigator.clipboard.writeText(result.link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4 rounded-sm bg-surface-soft p-3">
      <p className="text-[0.8125rem] text-body">
        {result.emailSent
          ? `A link has been emailed to ${result.email}. Any earlier link has stopped working.`
          : `The link could not be emailed to ${result.email} — send it yourself.`}
      </p>
      <p className="mt-2 text-[0.75rem] font-medium tracking-wide text-muted uppercase">Password link</p>
      <p className="mt-1 font-mono text-[0.6875rem] break-all text-body">{result.link.url}</p>
      <button
        type="button"
        onClick={copyLink}
        className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
      >
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
