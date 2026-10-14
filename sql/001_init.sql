-- H2H single-workspace pilot persistence. Run with npm run migrate.
-- Database backup/encryption, roles, retention and key rotation are operator responsibilities.
BEGIN;
CREATE TABLE IF NOT EXISTS h2h_drafts (
  id uuid PRIMARY KEY,
  shortcut_key text NOT NULL UNIQUE,
  team_id text NOT NULL,
  user_id text NOT NULL,
  channel_id text NOT NULL,
  source_ts text NOT NULL,
  thread_ts text NOT NULL,
  selected_cipher text,
  envelope_cipher text,
  artifact_hash char(64),
  status text NOT NULL DEFAULT 'compose' CHECK (status IN ('compose','processing','ready','publishing','published','uncertain','failed')),
  consent_at timestamptz,
  post_ts text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS h2h_drafts_expiry ON h2h_drafts(expires_at);
CREATE TABLE IF NOT EXISTS h2h_briefs (
  message_id text PRIMARY KEY,
  team_id text NOT NULL,
  author_user_id text NOT NULL,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  post_ts text NOT NULL,
  envelope_cipher text NOT NULL,
  grant_ref text NOT NULL UNIQUE,
  consent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS h2h_briefs_access ON h2h_briefs(team_id,channel_id,expires_at);
CREATE TABLE IF NOT EXISTS h2h_principals (
  issuer text NOT NULL,
  subject text NOT NULL,
  team_id text NOT NULL,
  slack_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer,subject)
);
CREATE TABLE IF NOT EXISTS h2h_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_at timestamptz NOT NULL DEFAULT now(),
  team_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  message_id text,
  -- no transcript, personal context, token or prompt is stored here.
  detail text
);
CREATE INDEX IF NOT EXISTS h2h_audit_retention ON h2h_audit(event_at);
COMMIT;
