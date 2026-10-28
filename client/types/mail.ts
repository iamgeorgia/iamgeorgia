/** `GET /api/admin/mail/google`: the Google account outgoing mail is sent as. Never carries a token. */
export interface MailProviderStatus {
  provider: "gmail";
  /** MAIL_TRANSPORT on the server: `smtp`, `gmail`, `log` or `capture`. */
  transport: string;
  /** True when Gmail is the transport in use right now. */
  active: boolean;
  /** The four Google identifiers are set on the server. */
  configured: boolean;
  senderEmail: string | null;
  fromAddress: string;
  fromAliasVerified: boolean;
  fromMatchesSender: boolean;
  redirectUri: string | null;
  connected: boolean;
  /** Where the grant comes from: connected here, or a GOOGLE_REFRESH_TOKEN on the server. */
  source: "database" | "environment" | null;
  account: {
    accountEmail: string;
    scopes: string[];
    connectedAt: string;
    connectedByEmail: string | null;
    revokedAt: string | null;
    lastAuthError: string | null;
  } | null;
  volume: { sentLast24h: number; warnAt: number };
  lastSent: { at: string; template: string } | null;
  lastFailure: { at: string; template: string; error: string | null } | null;
}

export interface MailTestResult {
  sent: boolean;
  to: string;
  error: { kind: string; reason: string | null; message: string } | null;
}
