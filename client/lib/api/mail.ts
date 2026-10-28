import { apiFetch, serverFetch } from "./client";
import type { MailProviderStatus, MailTestResult } from "@/types/mail";

const base = "/api/admin/mail/google";

export const getMailProviderStatus = () => serverFetch<MailProviderStatus>(base);

export const getMailProviderStatusClient = () => apiFetch<MailProviderStatus>(base);

/** Starts the Google consent flow; the browser is sent to `url`. Sets a short-lived binding cookie on the API. */
export const authorizeMailProvider = () => apiFetch<{ url: string; expiresAt: string }>(`${base}/authorize`, { method: "POST" });

export const disconnectMailProvider = () => apiFetch<{ revokedAtGoogle: boolean }>(`${base}/disconnect`, { method: "POST" });

/** A real email through Gmail, to the signed-in administrator only. */
export const sendMailProviderTest = () => apiFetch<MailTestResult>(`${base}/test`, { method: "POST" });
