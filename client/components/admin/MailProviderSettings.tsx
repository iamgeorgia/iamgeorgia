"use client";

import { AlertTriangle, CheckCircle2, Mail, Send, Unplug } from "lucide-react";
import { useCallback, useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { useCan } from "@/components/admin/AdminViewerContext";
import { FormError, SubmitButton } from "@/components/admin/FormControls";
import { ReadOnlyNote } from "@/components/admin/ReadOnlyNote";
import { Modal } from "@/components/ui/Modal";
import { describeError } from "@/lib/api/client";
import {
  authorizeMailProvider,
  disconnectMailProvider,
  getMailProviderStatusClient,
  sendMailProviderTest,
} from "@/lib/api/mail";
import { cn } from "@/lib/utils";
import type { MailProviderStatus, MailTestResult } from "@/types/mail";

/**
 * What came back from Google, in words. The codes are the server's own
 * (`settingsUrl` in server/services/mail/googleAccount.service.js); nothing
 * Google sent is ever shown.
 */
const callbackErrors = (sender: string | null): Record<string, string> => ({
  state: "That connection attempt expired or was already used. Press Connect again.",
  session: "Google sent the browser back without the sign-in cookie this screen set. Connect again from this browser, and allow cookies for the API.",
  denied: "Permission was not granted on Google’s screen, so nothing changed.",
  account: `Only ${sender ?? "the configured sender account"} may send for the platform. Connect again and choose that account. The other account’s access was revoked.`,
  scope: "Permission to send email was unticked on Google’s screen. Connect again and leave it ticked.",
  no_refresh_token: "Google did not issue a long-lived token. Remove the app under the Google account’s security settings, then connect again.",
  forbidden: "Your account can no longer change email settings.",
  not_configured: "The Gmail API is not configured on the server.",
  exchange: "Google could not complete the connection. Try again in a minute.",
  google: "Google could not complete the connection. Try again in a minute.",
  server: "The connection could not be saved. Try again; if it keeps failing, check the API log.",
});

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tbilisi" }).format(new Date(iso));

const secondaryButton =
  "inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:pointer-events-none disabled:opacity-50";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-[0.8125rem] text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-[0.875rem] text-body">{children}</dd>
    </div>
  );
}

function Banner({ tone, children }: { tone: "success" | "warning" | "error"; children: React.ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-sm border bg-surface px-4 py-3 text-[0.875rem]",
        tone === "success" && "border-success/40 text-body",
        tone === "warning" && "border-warning/40 text-warning-text",
        tone === "error" && "border-error/40 text-error-text",
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function MailProviderSettings({
  initial,
  connected: justConnected,
  errorCode,
}: {
  initial: MailProviderStatus;
  connected: boolean;
  errorCode: string | null;
}) {
  const can = useCan();
  const canWrite = can("settings.write");
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<"connect" | "test" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<MailTestResult | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [notice, setNotice] = useState<string | null>(justConnected ? "The Google account is connected." : null);
  const callbackError = errorCode ? (callbackErrors(status.senderEmail)[errorCode] ?? callbackErrors(null).google) : null;

  const refresh = useCallback(async () => {
    setStatus(await getMailProviderStatusClient());
  }, []);

  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      const { url } = await authorizeMailProvider();
      window.location.assign(url);
    } catch (err) {
      setError(describeError(err));
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      setTest(await sendMailProviderTest());
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      const { revokedAtGoogle } = await disconnectMailProvider();
      setNotice(
        revokedAtGoogle
          ? "Disconnected, and the access was revoked at Google."
          : "Disconnected here. Google did not confirm the revocation; remove the app under the Google account’s security settings to be sure.",
      );
      setConfirmDisconnect(false);
      setTest(null);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const account = status.account;
  const revoked = Boolean(account?.revokedAt);
  const nearCap = status.volume.warnAt > 0 && status.volume.sentLast24h >= status.volume.warnAt;
  const senderMismatch = status.configured && !status.fromMatchesSender && !status.fromAliasVerified;

  return (
    <div className="space-y-6">
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {callbackError && !notice ? <Banner tone="error">{callbackError}</Banner> : null}
      {revoked ? (
        <Banner tone="error">
          Google refused the connection on {dateTime(account!.revokedAt!)}. Outgoing email through Gmail has stopped; queued messages are kept and
          will go once the account is reconnected.
        </Banner>
      ) : null}
      {status.active && !status.connected && !revoked ? (
        <Banner tone="error">Gmail is the active transport but no account is connected, so no email is being sent.</Banner>
      ) : null}
      {nearCap ? (
        <Banner tone="warning">
          {status.volume.sentLast24h} emails went through Gmail in the last 24 hours. Gmail refuses further sends at its daily cap; messages then wait in
          the queue until the window rolls.
        </Banner>
      ) : null}

      <AdminPanel
        title="Gmail connection"
        description={
          status.active
            ? "Gmail is the active transport: every email the platform sends goes through this account."
            : `The active transport is ${status.transport}. The account can be connected and tested here before the server is switched to Gmail.`
        }
      >
        {!status.configured ? (
          <p className="text-[0.875rem] text-body">
            The Gmail API is not configured on the server. Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>,{" "}
            <code>GOOGLE_REDIRECT_URI</code> and <code>GMAIL_SENDER_EMAIL</code>, then redeploy. The deployment guide, section 3.4c, has the Google Cloud
            steps.
          </p>
        ) : (
          <>
            <dl className="divide-y divide-line">
              <Fact label="Status">
                {status.connected ? (
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <CheckCircle2 size={15} className="text-success" aria-hidden /> Connected
                  </span>
                ) : revoked ? (
                  <span className="font-medium text-error-text">Disconnected by Google</span>
                ) : (
                  <span className="font-medium text-warning-text">Not connected</span>
                )}
              </Fact>
              <Fact label="Sender account">{account?.accountEmail ?? status.senderEmail}</Fact>
              <Fact label="Emails are sent as">
                {status.fromAddress}
                {senderMismatch ? (
                  <span className="mt-1 block text-[0.8125rem] text-warning-text">
                    This is not the sender account. Before switching to Gmail, add it to that account as a verified “Send mail as” alias and set{" "}
                    <code>GMAIL_FROM_ALIAS_VERIFIED=true</code>; the server refuses to start on Gmail otherwise.
                  </span>
                ) : null}
              </Fact>
              {account ? (
                <Fact label="Connected">
                  {dateTime(account.connectedAt)}
                  {account.connectedByEmail ? ` by ${account.connectedByEmail}` : ""}
                </Fact>
              ) : status.source === "environment" ? (
                <Fact label="Connected">Through a refresh token in the server’s environment</Fact>
              ) : null}
              <Fact label="Sent in the last 24 hours">
                {status.volume.sentLast24h}
                {status.volume.warnAt > 0 ? <span className="text-muted"> · warning at {status.volume.warnAt}</span> : null}
              </Fact>
              <Fact label="Last sent">{status.lastSent ? `${dateTime(status.lastSent.at)} · ${status.lastSent.template}` : "Nothing yet"}</Fact>
              {status.lastFailure ? (
                <Fact label="Last failure">
                  {dateTime(status.lastFailure.at)} · {status.lastFailure.template}
                  {status.lastFailure.error ? <span className="mt-1 block text-[0.8125rem] text-muted">{status.lastFailure.error}</span> : null}
                </Fact>
              ) : null}
            </dl>

            {canWrite ? (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <SubmitButton busy={busy === "connect"} disabled={busy !== null} onClick={connect}>
                  {busy !== "connect" ? <Mail size={15} aria-hidden /> : null}
                  {account || status.connected ? "Reconnect Google account" : "Connect Google account"}
                </SubmitButton>
                <button type="button" className={secondaryButton} disabled={busy !== null || !status.connected} onClick={sendTest}>
                  <Send size={15} aria-hidden />
                  {busy === "test" ? "Sending…" : "Send test email"}
                </button>
                {account ? (
                  <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => setConfirmDisconnect(true)}>
                    <Unplug size={15} aria-hidden />
                    Disconnect
                  </button>
                ) : null}
              </div>
            ) : (
              <ReadOnlyNote needs="settings.write" what="Connecting or disconnecting the account" className="mt-6" />
            )}

            {test ? (
              <div className="mt-4">
                {test.sent ? (
                  <Banner tone="success">
                    A test email went to {test.to} through Gmail. Check it arrived, and that the sender is {status.fromAddress}.
                  </Banner>
                ) : (
                  <Banner tone="error">
                    The test email to {test.to} was not sent: {test.error?.message ?? "unknown error"}
                  </Banner>
                )}
              </div>
            ) : null}
            <FormError message={error} />
          </>
        )}
      </AdminPanel>

      <Modal open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Disconnect the Google account?">
        <p className="text-[0.9375rem] text-body">
          The platform’s access to {account?.accountEmail} is revoked at Google and forgotten here.
          {status.active ? " Gmail is the active transport, so every email stops until an account is connected again." : ""}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className={secondaryButton} onClick={() => setConfirmDisconnect(false)}>
            Keep it
          </button>
          <SubmitButton busy={busy === "disconnect"} onClick={disconnect} className="bg-error hover:bg-error/90">
            Disconnect
          </SubmitButton>
        </div>
      </Modal>
    </div>
  );
}
