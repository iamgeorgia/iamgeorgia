import { apiFetch, serverFetch } from "./client";
import type { MailProviderStatus, MailTestResult } from "@/types/mail";

const base = "/api/admin/mail/google";

export const getMailProviderStatus = () => serverFetch<MailProviderStatus>(base);

export const getMailProviderStatusClient = () => apiFetch<MailProviderStatus>(base);

/**
 * Starts the Google consent flow; the browser is sent to `url` — the API's own
 * stop on the way to Google, on the host Google will return to, which trades
 * the single-use ticket in it for the binding cookie.
 */
export const authorizeMailProvider = () => apiFetch<{ url: string; expiresAt: string }>(`${base}/authorize`, { method: "POST" });

export const disconnectMailProvider = () => apiFetch<{ revokedAtGoogle: boolean }>(`${base}/disconnect`, { method: "POST" });

/** A real email through Gmail, to the signed-in administrator only. */
export const sendMailProviderTest = () => apiFetch<MailTestResult>(`${base}/test`, { method: "POST" });
