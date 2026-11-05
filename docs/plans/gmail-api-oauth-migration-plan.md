# Gmail API (OAuth 2.0) mail transport — audit and migration plan

Status: **implemented 2026-10-21, uncommitted**, with the recommended answer to
OD1–OD6 (the owner said "start implementing" without choosing). Two deviations
from this plan: connect, disconnect and test send need `settings.write` only
(super admins), not `platform.admin`; and permanent errors are absorbed in
`sendMail` inside an outbox event rather than in `processEvent`, so the outbox
service itself only changed where its event context lives. Not yet done: a real
Google account connected end to end.

---

## 1. How email works today (audit)

### 1.1 One entry point, three transports

Every email in the system goes through one function, `sendMail({ to, template, data })` in
`server/lib/mailer/index.js`, or its wrapper `sendMailQuietly` (same call, failures logged and
swallowed, returns `null` on failure). It renders a named template and hands a `{ from, replyTo?, to,
subject, text, html }` object to one of three transports chosen by `MAIL_TRANSPORT` at boot:

| Transport | What it does | Used where |
|---|---|---|
| `smtp` | `nodemailer.createTransport({ host, port, secure, auth: { user, pass } })`, built lazily on first send, bounded by connect/greeting/socket timeouts | Production (`render.yaml`), and the dev `.env` since 2026-09-14 (Mailtrap sandbox) |
| `log` | Logs `to`, `subject` and the link; body at debug level | Development default |
| `capture` | Pushes the message into an in-memory `outbox` array; `failDeliveryTo` simulates a refused recipient | Test suite (`.env.test`) |

`config.js` refuses to boot on any other transport name (`assertMailConfig`). Sender identity is
`MAIL_FROM` (default `I am Georgia <no-reply@iamgeorgia.travel>`) and optional `MAIL_REPLY_TO`.
`nodemailer@10.1.0` is the only mail dependency. Nothing else in the repo imports nodemailer.

### 1.2 Message shape

Every message is: one `to` address (a string, never a list), `from`, optional `replyTo`, `subject`,
`text`, `html`. There are **no** attachments, CC, BCC, inline images, or per-recipient localisation
anywhere. All 48 templates in `server/lib/mailer/templates.js` are English, render `subject` + `text`
+ `html` from a `layout()` helper, HTML-escape every interpolated value, load nothing from the
network, and build links from `APP_URL`. Invoice PDFs are **not** emailed by the platform:
`services/invoicing/invoice.service.js#sendInvoice` asks InvoiceOcean to email the document itself.
"Multiple recipients" today means separate `sendMail` calls in a loop (guest, partner contact, ops mailbox).

### 1.3 Who sends, and how failures are handled

Seven production files import the mailer. The call sites fall into two classes with different
failure semantics, and the migration must preserve both.

**A. In-request sends** (the HTTP request is waiting):

| File | Template(s) | Failure behaviour |
|---|---|---|
| `routes/auth.routes.js` `POST /api/auth/password/forgot` | `passwordReset` | `sendMailQuietly`; always 204 (anti-enumeration) |
| `routes/invitations.routes.js` `POST /:token/accept` | `registrationSubmitted` | quiet; 201 regardless |
| `routes/admin.partners.routes.js` `POST /` | `partnerInvitation` / `accountActivation` | quiet; response carries `link` + `emailSent` |
| `routes/admin.partners.routes.js` approve/reject | `partnerApproved` / `partnerRejected` | quiet |
| `routes/admin.partners.routes.js` `POST /:id/invitations` | `invitationReissued` / `partnerInvitation` | `sendMail` in try/catch → `emailSent: false` |
| `routes/admin.drivers.routes.js` `sendActivation` | `driverAccountActivation` | quiet; `link` + `emailSent` |
| `services/user.service.js` `deliverActivation` | `staffAccountActivation` etc. | quiet; `link` + `emailSent` |
| `services/transfer/notify.service.js` `sendTransferVoucher` | `transferConfirmed` | quiet (booking stands) |

**B. Outbox drain** (`services/notifications/outbox.service.js`, ~38 `sendMail` calls across the
topic handlers): bookings, cancellations, supplier notices, approvals, deadline reminders, finance
reminders, payment receipts, order emails, transfer dispatch, invoice sync failures. Runs every
`outboxDrainIntervalMs` on every instance under a Postgres advisory lock; a handler that throws leaves
the event with `attempts+1`, `lastError`, `nextAttemptAt = now + min(1h, 30s·2^(attempts-1))`; after
`MAX_ATTEMPTS = 8` the event is marked processed with the error kept (dead letter). Dead letters are
listed and re-queued through `routes/admin.outbox.routes.js` (`AUDIT_READ`/`PLATFORM_ADMIN` +
`SETTINGS_WRITE`). **Handlers deliberately use the throwing `sendMail`**: that throw *is* the retry.
In-app notices are de-duplicated on retry (by `outboxEventId`); **emails are not** — a handler that
emailed the guest and then failed on the supplier email re-sends the guest's email on the next attempt.
This is pre-existing behaviour, not something the SMTP transport prevents.

### 1.4 Environment variables (today)

`MAIL_TRANSPORT`, `MAIL_FROM`, `MAIL_REPLY_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_CONNECTION_TIMEOUT_MS`, `SMTP_SOCKET_TIMEOUT_MS`; mailbox targets
`BOOKING_OPS_EMAIL`, `FINANCE_OPS_EMAIL`, `TRANSFER_OPS_EMAIL`. `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
are in `requiredInProduction` (every `NODE_ENV` other than development/test), so a deploy without them
refuses to boot. They are declared in `render.yaml` (`sync: false`), `.env.example`,
`.env.production.example`, `README.md`, `docs/DEPLOYMENT.md`, `docs/LOCAL_SETUP.md`. The Dockerfile
already installs `ca-certificates` (needed for HTTPS to Google too). CI runs the suite with
`MAIL_TRANSPORT=capture` and never touches SMTP.

### 1.5 Abuse controls that exist

Per-mailbox forgot-password limit (5 / 15 min, any IP), token lookup limit, invitation limit per
signed-in user (30 / 15 min), registration limit, the global API limiter. Every email-triggering admin
route sits behind `authenticate` + `requireCapability`. There is no public "send an email" endpoint.

### 1.6 Tests that depend on the mailer

`test/mailer.test.js` (template coverage, escaping, capture, unknown template, quiet failure) and 17
other suites import `outbox`, `clearOutbox`, `failDeliveryTo` or the URL helpers. They assert on the
captured message object (`to`, `subject`, `text`, `html`, `template`, `url`, `data`). The capture
transport and its exports must keep working unchanged.

### 1.7 Frontend dependencies

The client never talks to a mail transport. It depends only on two response fields of existing admin
endpoints, `link { kind, url, expiresAt }` and `emailSent: boolean` (used by `PartnerRegistrationForm`,
`PartnerActions`, `DriverAccount`, `InviteUserModal`, `TeamSection`, and typed in
`lib/api/partners.ts`, `lib/api/drivers.ts`). Those contracts do not change.

### 1.8 Facts that shape the OAuth design

- The session cookie is `SameSite=Strict` (`services/auth.service.js`). Google's redirect back to our
  callback is a cross-site top-level navigation, so **the admin's session cookie will not be sent to
  the callback**. The callback cannot rely on `authenticate`; it must be authorised by a server-side,
  single-use `state` record created by an authenticated admin.
- There is no "API public URL" in config (only `APP_URL` for the front end), so the redirect URI must
  be configured explicitly.
- `config.js` already has the pattern for an integration that is off until configured and validated
  at boot (`finance.invoiceocean` + `assertInvoicingConfig`).
- No generic secret-encryption helper exists (`lib/password.js` only hashes). AES-256-GCM via
  `node:crypto` needs no dependency.
- nodemailer 10 exports its MIME builder, `nodemailer/lib/mail-composer` (verified importable). It
  produces a complete RFC 5322 message from the same `{ from, to, cc, bcc, replyTo, subject, text,
  html, attachments }` object nodemailer already takes, with correct UTF-8 header encoding and
  boundaries. **No new MIME library is needed**, and the message object the templates produce today
  feeds it unchanged.

### 1.9 Breaking-change risks identified

1. `requiredInProduction` hard-codes `SMTP_*`. Switching the transport without changing this blocks
   boot. Must become transport-conditional.
2. **Sender rewriting.** Gmail replaces the `From` address with the authorised account's address
   unless the address is one of the account's verified "Send mail as" aliases. Today `MAIL_FROM` is
   `no-reply@iamgeorgia.travel`. Without an alias, Gmail would *silently* send as the Google account.
   The plan refuses to boot unless `MAIL_FROM`'s address equals `GMAIL_SENDER_EMAIL` or the operator
   explicitly declares it a verified alias (§5).
3. **Daily quota.** Gmail API sending is capped per account: roughly 500 recipients/day for a consumer
   `@gmail.com` account and 2,000/day for Google Workspace (shared with the mailbox's own sending),
   plus a per-user rate limit (250 quota units/s; `messages.send` costs 100 units). The outbox drain
   can emit several emails per booking. Bulk sending is outside Gmail's intended use. This is fine for
   launch volume; it is not a long-term transactional provider, which is why the provider abstraction
   matters.
4. **Refresh-token lifetime.** A refresh token issued while the OAuth consent screen is in *Testing*
   expires after 7 days; tokens for Gmail scopes are revoked when the Google account's password
   changes; any token is revoked after 6 months unused, when the user revokes access, or when the
   account reaches 100 live refresh tokens for the client. Each of these makes every email fail
   until an admin reconnects — the reconnect flow and a visible status are therefore part of the
   core deliverable, not a nicety.
5. Mailtrap sandbox (current dev relay) is SMTP-only; developers keep `smtp`/`log` locally.
6. Dead-letter semantics change slightly if permanent errors (bad recipient address) are
   short-circuited instead of retried 8 times. Proposed as an opt-in improvement (OD5).

---

## 2. Proposed architecture

```
business code ──► sendMail / sendMailQuietly  (unchanged signature)
                        │  renders template → message object { from, to, cc?, bcc?, replyTo?, subject, text, html, attachments? }
                        ▼
              lib/mailer/index.js dispatch table
          ┌─────────┬─────────┬─────────┬──────────────┐
        smtp       log     capture    gmail  (new)
      (as is)                          │
                                       ▼
                         lib/mailer/providers/gmail.js
                           • MailComposer → raw RFC 5322 → base64url
                           • OAuth2 client (refresh token → access token, auto-refresh)
                           • gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
                           • error classification + bounded retry + structured log
                                       │
                                       ▼
                         lib/google/oauth.js        services/mail/googleAccount.service.js
                           • client factory          • authorize (state) / callback / status
                           • token store             • disconnect (revoke) / send test
                             (DB, encrypted;         • audit entries
                              env fallback)
```

Design choices:

- **Provider abstraction = the existing dispatch table.** `sendMail` already selects a transport by
  name; adding `gmail` is the abstraction the brief asks for. Business code, templates, in-request
  vs. outbox semantics, `emailSent` contracts and tests do not change. Swapping Gmail for
  Postmark/SES later is another dispatch entry plus an env flip.
- **MIME via nodemailer's MailComposer** (already a dependency, battle-tested, handles UTF-8 Georgian
  and Hebrew subjects, text+html alternatives, PDF attachments, address lists). The provider extends
  the message type to accept optional `cc`, `bcc`, `attachments` so future templates (e.g. a voucher
  PDF) need no transport work.
- **Google client**: `@googleapis/gmail` (the official per-API package from the `googleapis` monorepo,
  same maintainers, same `gmail({ version: 'v1', auth })` surface) plus its dependency
  `google-auth-library` for `OAuth2Client`. The umbrella `googleapis` package is ~50× larger because
  it bundles every Google API; it is a drop-in if preferred (**OD1**).
- **Refresh-token storage (OD2)**: primary store is a single-row table `mail_provider_credentials`
  with the refresh token encrypted at rest (AES-256-GCM, key from `MAIL_CREDENTIALS_KEY`, 32 random
  bytes, generated by Render like the other secrets). Written only by the OAuth callback; read only by
  the Gmail provider; never serialised. `GOOGLE_REFRESH_TOKEN` in env is accepted as a fallback for
  environments without the admin flow (local dev via a loopback helper script), with the database
  taking precedence when a row exists. Access tokens live in memory only.
- **Error classification** (`lib/mailer/errors.js`): `MailTransientError` (network, timeout before
  response, 429, 403 `rateLimitExceeded`/`userRateLimitExceeded`, 5xx) → the provider retries up to 3
  times with exponential backoff and jitter (0.5 s → 4 s), honouring `Retry-After`, then throws so the
  outbox's own 8-attempt schedule takes over; `MailAuthError` (`invalid_grant`, 401, 403
  `insufficientPermissions`) → mark credential `revokedAt`, write an in-app notice to admins, throw
  (outbox keeps retrying across the reconnect window; dead letters remain re-queueable);
  `MailPermanentError` (400 invalid recipient/argument, message too large) → no provider retry.
  Ambiguity: a timeout *after* the body was sent cannot be told from a lost request; Gmail offers no
  idempotency key. The provider retries such timeouts at most once; a rare duplicate is preferred to
  a lost booking confirmation. This is documented in the status screen's help text.
- **Duplicate-send prevention across outbox retries**: a `mail_log` row per attempted send
  (`provider`, `template`, `to`, `subject`, `messageId`, `outboxEventId`, `status`, `error`) with a
  unique `(outboxEventId, template, to)` index; a retried handler skips an email already logged as
  `SENT` for that event. This closes the pre-existing re-send gap described in §1.3 and gives the
  status screen "last send / last error" without reading logs. Independent of the transport; proposed
  as **OD5** because it touches `outbox.service.js` (one guard in `sendMail` keyed on
  `currentEvent()`, no handler changes).
- **Sender identity**: `GMAIL_SENDER_EMAIL` is the account that must authorise. The callback requests
  the non-sensitive `email` scope beside `gmail.send` only to read the signed-in account's address
  from the ID token and refuse any other account (**OD6**; without it the platform cannot verify
  which mailbox was linked). At boot, `MAIL_FROM`'s address must equal `GMAIL_SENDER_EMAIL` unless
  `GMAIL_FROM_ALIAS_VERIFIED=true` says the operator has added it as a "Send mail as" alias; otherwise
  the server refuses to start rather than letting Gmail rewrite the sender.

### 2.1 Admin OAuth flow (administrator only)

Routes under `/api/admin/mail/google`, mounted in `routes/index.js`, gated like the outbox routes
(`authenticate` + `requireCapability(PLATFORM_ADMIN, SETTINGS_WRITE)`), audited with a new
`AUDIT_ENTITY.mailProvider`:

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `GET` | `/status` | admin | `{ provider: 'gmail', configured, connected, email, connectedAt, connectedByUserId, revokedAt, lastSendAt, lastError, fromAddress, transport }`. Never tokens. |
| `POST` | `/authorize` | admin, CSRF middleware, rate-limited | Creates an `oauth_states` row (`sha256(state)`, `userId`, `expiresAt = +10 min`, `usedAt`), returns `{ url }` built with `access_type=offline`, `prompt=consent`, `include_granted_scopes=false`, `login_hint=GMAIL_SENDER_EMAIL`, `scope=gmail.send email`. The client navigates the browser to it. |
| `GET` | `/callback` | **no session** (see §1.8), authorised by `state` | Looks up `sha256(state)`: unknown, expired or used → redirect to the settings page with `?error=state`. Marks used in the same transaction (single-use). Exchanges `code` with the client secret, requires a refresh token in the response, verifies the ID token's `email` (+ `email_verified`) equals `GMAIL_SENDER_EMAIL` (else revokes the token at Google immediately and redirects with `?error=account`), encrypts and upserts the credential, audits `MAIL_PROVIDER_CONNECTED` with the initiating admin as actor, redirects to `${APP_URL}/admin/settings/email?connected=1`. `error=access_denied` from Google → `?error=denied`. Nothing from Google is echoed into the redirect except a fixed error code. |
| `POST` | `/disconnect` | admin | Revokes the refresh token at `oauth2.googleapis.com/revoke`, deletes the row, audits. |
| `POST` | `/test` | admin, rate-limited (5 / 15 min) | Sends a `mailProviderTest` template to the signed-in admin's own address only; returns `{ sent, messageId?, error? }`. |

State entropy: 32 random bytes, base64url. Expired states are purged lazily on each `/authorize`.
Redirect URI is taken from config, never from the request. Client secret is used only server-side in
the code exchange and refresh. Logs record `messageId`, `template`, `to` (as today) and error codes,
never tokens or Authorization headers.

### 2.2 Client (admin panel)

New screen `/admin/settings/email` (rule `settings.write` in `lib/admin/access.ts`, nav entry under
Settings, help stub): shows status, Connect / Reconnect / Disconnect / Send test, and explains the
"Send mail as" alias requirement and the quota. Reads from a new `lib/api/mail.ts`. Messages in
en/ka/ru/he. No other client change.

---

## 3. Files to add / modify

**Server, new**

- `lib/mailer/providers/gmail.js` — transport; `lib/mailer/providers/smtp.js` — today's SMTP code moved verbatim.
- `lib/mailer/mime.js` — MailComposer wrapper → base64url `raw`; header-injection guard (rejects CR/LF in any address or subject; MailComposer also encodes, this is belt and braces).
- `lib/mailer/errors.js` — the three error classes + `classifyGoogleError`.
- `lib/google/oauth.js` — OAuth2 client factory, scopes, token store (encrypt/decrypt, env fallback, in-memory access-token cache, single refresh in flight).
- `lib/secretBox.js` — AES-256-GCM seal/open under `MAIL_CREDENTIALS_KEY`.
- `services/mail/googleAccount.service.js`, `routes/admin.mail.routes.js`, `validation/mail.js`, `serializers/mail.js`.
- `prisma/migrations/<earlier-than-clock timestamp>_mail_provider_oauth/` — `mail_provider_credentials`, `oauth_states`, `mail_log` (OD5).
- `scripts/google-oauth-loopback.js` — optional local helper that runs the same flow on `http://localhost:5000/...` for developers (prints nothing but "stored"/"written to .env" instructions).
- `test/mailer.gmail.test.js`, `test/mail.google.oauth.test.js`, `test/mailer.mime.test.js`.

**Server, modified**

- `lib/mailer/index.js` — add `gmail` to the dispatch table; accept optional `cc`/`bcc`/`attachments`; OD5 dedupe guard. Signature of `sendMail`/`sendMailQuietly`, the `outbox`/`clearOutbox`/`failDeliveryTo` seams and all template exports unchanged.
- `config.js` — `MAIL_TRANSPORTS += 'gmail'`; `mail.gmail` block; `SMTP_*` required only when transport is `smtp`; `GOOGLE_*`/`GMAIL_*`/`MAIL_CREDENTIALS_KEY` required only when transport is `gmail`; sender/alias check; redirect URI must be absolute `https` outside development.
- `routes/index.js`, `lib/audit.js` (entity), `prisma/schema.prisma`.
- `services/notifications/outbox.service.js` — only if OD5 (permanent-error short-circuit in `processEvent`: 3 lines).
- `package.json` — `+ @googleapis/gmail`, `+ google-auth-library` (OD1).
- `.env.example`, `.env.production.example`, `.env.test` (nothing: stays `capture`), `render.yaml`, `README.md`, `docs/DEPLOYMENT.md`, `docs/LOCAL_SETUP.md`, Postman collection (+5 requests, keeping the "every route covered" promise), `docs/API_TESTING_GUIDE.md`.

**Client, new/modified**

- `app/[locale]/(admin)/admin/(panel)/settings/email/page.tsx`, `components/admin/MailProviderSettings.tsx`, `lib/api/mail.ts`, `lib/admin/access.ts` (+1 rule), nav registry (+1 entry), messages for 4 locales, help article stub.

Not touched: templates, every route and service that calls `sendMail`, the outbox handlers, the
response shapes, the client components that read `emailSent`.

---

## 4. Environment variables

| Variable | Required when | Notes |
|---|---|---|
| `MAIL_TRANSPORT` | always | `smtp` \| `gmail` \| `log` \| `capture`. Production example and `render.yaml` move to `gmail` **only after** the account is connected and a test email verified. |
| `MAIL_FROM`, `MAIL_REPLY_TO` | as today | With `gmail`, the address must equal `GMAIL_SENDER_EMAIL` or `GMAIL_FROM_ALIAS_VERIFIED=true` must be set. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `gmail` | From the Cloud Console OAuth client ("Web application"). |
| `GOOGLE_REDIRECT_URI` | `gmail` | Exact, e.g. `https://api.iamgeorgia.travel/api/admin/mail/google/callback`; must be registered on the OAuth client. `http://localhost:5000/...` in development. |
| `GMAIL_SENDER_EMAIL` | `gmail` | The one Google account allowed to connect. |
| `MAIL_CREDENTIALS_KEY` | `gmail` (DB store) | 32 bytes, base64; `generateValue: true` in `render.yaml`. Rotating it requires reconnecting. |
| `GOOGLE_REFRESH_TOKEN` | optional | Fallback when no DB credential exists (local dev). Never set in Render. |
| `GMAIL_REQUEST_TIMEOUT_MS` | optional | default 15000 |
| `GMAIL_DAILY_SEND_WARN` | optional | Soft counter; log a warning and raise an admin notice at e.g. 80 % of the account's daily cap (default 400). Not a hard stop. |
| `SMTP_*` | `smtp` only | Unchanged; no longer required when the transport is `gmail`. |

Secrets stay in env / Render dashboard, never in the repo. `.env.example` keeps `log` as default.

---

## 5. Google Cloud Console setup (operator steps, documented in DEPLOYMENT.md)

1. Create (or pick) a project; **APIs & Services → Library → Gmail API → Enable**.
2. **OAuth consent screen**: if `GMAIL_SENDER_EMAIL` is a Google Workspace account, choose *Internal*
   (no verification, no 7-day expiry, no user cap). If it is a consumer `@gmail.com`, the app is
   *External*: add the sender as a test user while developing, then **Publish → In production**
   before connecting the real account, otherwise the refresh token dies after 7 days. `gmail.send`
   is a *sensitive* scope: an External app in production shows an "unverified app" interstitial until
   Google verifies it, and verification for sensitive scopes requires a privacy policy URL and a
   short review (no security assessment; that is only for *restricted* scopes such as full mailbox
   access). With a single company account the interstitial is acceptable short-term; verification is
   still recommended.
3. Scopes: `https://www.googleapis.com/auth/gmail.send` and `email` (OD6).
4. **Credentials → OAuth client ID → Web application**: authorised redirect URI = `GOOGLE_REDIRECT_URI`
   exactly (scheme, host, path). One client for production, a separate one for development.
5. Workspace only: if the admin console restricts third-party apps, mark this client as *Trusted*
   (Security → API controls → App access control).
6. In the Gmail account, if `MAIL_FROM` is not the account itself: Settings → Accounts → *Send mail
   as* → add and verify `no-reply@iamgeorgia.travel` (requires SMTP access to that domain or
   Workspace alias). Then set `GMAIL_FROM_ALIAS_VERIFIED=true`. Deliverability also requires SPF/DKIM
   for whichever domain is in `From`; for a Workspace domain Google signs it; for an alias domain the
   mail is signed by Google but SPF should include `_spf.google.com`.
7. Quotas: Workspace ~2,000 messages/day per account (~500 for trial/consumer), ~10,000 recipient
   addresses/day; per-user API rate 250 units/s (`send` = 100 units, i.e. ~2 sends/s sustained, which
   is why the provider's retry honours 429s and the outbox drain is paced).

---

## 6. Step-by-step migration

1. **Foundations (no behaviour change)**: move SMTP into `providers/smtp.js`; add `mime.js`,
   `errors.js`, `secretBox.js`; extend the message object with optional `cc`/`bcc`/`attachments`.
   All existing tests pass; `capture` and `log` unchanged.
2. **Schema**: migration for `mail_provider_credentials`, `oauth_states`, `mail_log` (hand-named
   timestamp earlier than the clock, per the repo's convention).
3. **Google client + token store** with the env fallback; unit-tested with a mocked OAuth2 client.
4. **Gmail provider** behind `MAIL_TRANSPORT=gmail` with retry/classification; tests with a mocked
   `gmail.users.messages.send` (success, 429 then success, 5xx ×4 → throws transient, `invalid_grant`
   → auth error + credential marked, 400 → permanent, timeout → one retry).
5. **Admin OAuth routes + service**, audit entity, Postman requests; tests for authorize (admin only,
   403 for others, 401 anonymous), callback (bad/expired/reused state, wrong account → revoke, happy
   path → row encrypted, never returned by `/status`), disconnect, test send.
6. **Config**: transport-conditional requirements, sender/alias assertion, examples, `render.yaml`,
   docs.
7. **Client settings screen** + i18n.
8. **Verification before cut-over** (staging/Render): deploy with `MAIL_TRANSPORT=smtp` still set;
   connect the account from the panel; `/status` shows `connected`; "Send test" lands in the
   operator's inbox with the expected `From`; a second test proves the token refresh path (force by
   expiring the cached access token). Only then flip `MAIL_TRANSPORT=gmail` and restart; watch
   `outbox_events` (`attempts`, `lastError`) and `mail_log` for the first hour.
9. **Rollback**: set `MAIL_TRANSPORT=smtp` and restart. SMTP code and env stay in place until the
   owner decides to remove them (not in this plan). Outbox events pending at the flip simply retry on
   the other transport; nothing is lost. The credential row can stay for the next attempt.

---

## 7. Security review checklist (applied during implementation)

- Tokens: refresh token encrypted at rest, decrypted only inside the provider; access token in memory;
  neither in logs, audit metadata, serializers or responses. `secretBox` output is versioned to allow
  key rotation later.
- Client secret: server env only; never sent to the browser (the authorize URL carries only the client
  ID, which is public by design).
- CSRF / account linking: state is 32 random bytes, hashed in the DB, bound to the initiating admin,
  10-minute TTL, single use; `prompt=consent` ensures a refresh token; account email must match
  config; mismatch revokes the just-issued token before anything is stored. Callback redirects only to
  `APP_URL` paths with fixed error codes.
- Authorisation: every new route except the callback is `authenticate` + `PLATFORM_ADMIN`/`SETTINGS_WRITE`;
  the callback's only side effect is storing a credential for the pre-configured account, and it can
  only succeed with a state issued to an admin. Test send goes to the admin's own address only.
- Header injection: every address and subject rejected on CR/LF; MailComposer encodes headers.
  Template escaping is unchanged.
- Abuse: existing per-mailbox/per-user limiters stay; `/authorize` and `/test` get their own small
  limiters; daily soft counter warns before Gmail's cap.
- Retries: transient vs permanent vs auth distinguished; provider retries bounded (3) and outbox
  retries bounded (8); post-send timeouts retried once; OD5 `mail_log` removes cross-attempt duplicates.
- Revocation: `MailAuthError` flips `revokedAt`, raises an admin in-app notice, `/status` shows it;
  reconnect is the same flow.
- Sender: boot refuses a `MAIL_FROM` Gmail would rewrite.

---

## 8. Testing plan

Automated (mocked Google, run by the existing `npm test`):

1. OAuth authorize → state row, URL contents (scopes, offline, consent, login_hint).
2. Callback rejects missing/unknown/expired/reused state; rejects wrong account and revokes.
3. Happy-path callback stores an encrypted credential; `/status` reports `connected` without tokens.
4. Access-token expiry → one refresh call, reused across concurrent sends (single flight).
5. `invalid_grant` → credential marked revoked, admin notice, error thrown.
6. Plain-text, HTML, UTF-8 (Georgian/Hebrew subject and body), PDF attachment, multiple `to`,
   CC/BCC, Reply-To: raw MIME decoded and asserted.
7. Every existing template renders through the MIME builder (reuse `mailer.test.js` samples).
8. 429 → backoff → success; 5xx exhaustion → transient error; 400 → permanent, no retry; timeout → one retry.
9. OD5: a retried outbox event skips emails already logged as sent.
10. 20 concurrent sends share one token refresh and all complete.
11. Boot with `MAIL_TRANSPORT=gmail` and missing `GOOGLE_*` / mismatched `MAIL_FROM` throws (spawned
    `node --input-type=module -e "import('./config.js')"` with a controlled env).
12. Non-admin and anonymous callers get 403/401 on every new route; the test send cannot be pointed
    at an arbitrary address.
13. The full existing suite (invitations, bookings notifications with `failDeliveryTo`, finance
    reminders, transfers) passes unchanged under `capture`.

Manual, only with owner approval: one real send from staging to the owner's mailbox before cut-over.

---

## 9. Decisions needed from the owner

| # | Question | Recommendation |
|---|---|---|
| OD1 | `@googleapis/gmail` + `google-auth-library` (slim, official) vs umbrella `googleapis` | slim |
| OD2 | Refresh token in DB encrypted under `MAIL_CREDENTIALS_KEY` (admin flow) with env fallback, vs env only (admin flow then has to show the token once, which conflicts with "never expose credentials") | DB + env fallback |
| OD3 | Which Google account will send, and is it Workspace or consumer `@gmail.com`? Will `no-reply@iamgeorgia.travel` be added as a verified "Send mail as" alias, or does `MAIL_FROM` become the account's own address? | Workspace account; alias verified before cut-over |
| OD4 | Is Gmail's daily cap acceptable for expected booking volume, or is Gmail a launch-stage transport to be replaced via the same abstraction? | Launch-stage; revisit |
| OD5 | Add `mail_log` dedupe + permanent-error short-circuit in the outbox (small change to `outbox.service.js`) | yes |
| OD6 | Request the `email` scope beside `gmail.send` to verify the linked account | yes |

Alternative noted for completeness: nodemailer's SMTP transport supports Gmail OAuth2 (XOAUTH2) with
the same client ID/secret/refresh token and would need no Gmail API client at all. It keeps SMTP's
port dependence and offers no per-message id, so this plan follows the brief's Gmail API choice, but
the token store and admin flow above would serve either.
