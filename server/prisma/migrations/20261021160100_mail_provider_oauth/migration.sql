-- The Gmail API mail transport: the connected Google account (refresh token
-- sealed at rest), OAuth states in flight, and a log of sends that doubles as
-- the outbox's duplicate-email guard.

CREATE TABLE "mail_provider_credentials" (
    "provider" TEXT NOT NULL,
    "account_email" TEXT NOT NULL,
    "refresh_token_cipher" TEXT NOT NULL,
    "scopes" TEXT[],
    "connected_by_user_id" TEXT,
    "connected_by_email" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "last_auth_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_provider_credentials_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_states_state_hash_key" ON "oauth_states"("state_hash");
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

CREATE TABLE "mail_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "error" TEXT,
    "outbox_event_id" TEXT,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mail_logs_dedupe_key_key" ON "mail_logs"("dedupe_key");
CREATE INDEX "mail_logs_provider_status_created_at_idx" ON "mail_logs"("provider", "status", "created_at");
CREATE INDEX "mail_logs_outbox_event_id_idx" ON "mail_logs"("outbox_event_id");
