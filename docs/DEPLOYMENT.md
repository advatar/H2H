# H2H deployment — single-workspace secure pilot

**Status: code and CI only. No Slack app, external OAuth issuer, PostgreSQL instance, domain, or connected personal-AI client has been provisioned by this repository.** This is a runbook, not a production security certification.

## Trust boundaries

- Slack Socket Mode authenticates Slack interaction payloads; the app additionally checks the current workspace, channel metadata and live membership. Only explicitly allowlisted public, non-shared channels are supported.
- PostgreSQL persists encrypted drafts and briefs with atomic Publish and Revoke transitions and minimal operational audit. Audit events deliberately omit transcripts and personal AI context. This audit is **not** independently anchored or tamper-proof.
- MCP v2 (2026-07-28) is an OAuth-protected **read-only resource server**. It offers h2h_get_brief and h2h_prepare_private_assessment; no auto-posting tools.
- An externally managed OAuth authorization server issues JWT access tokens; H2H verifies signature, fixed issuer, exact resource audience, expiry and the h2h:read scope. An OAuth subject must be explicitly and independently mapped to its Slack human identity by an authorized administrator.
- A linked human must still be a current member of the authorized Slack channel. The server never requests personal memory.

## Prerequisites

1. Test Slack workspace with permission to install a custom app. Import [slack-app-manifest.yml](../slack-app-manifest.yml), enable Socket Mode, create an app-level connections:write token, install the bot and invite it only to the test channel. No passive message-reading scopes.
2. Dedicated PostgreSQL 16+, encrypted backups, restricted DB role, network ACLs and operator-managed key recovery.
3. HTTPS reverse proxy with a real domain and TLS certificate. Limit access to the Node service behind the proxy. The service defaults to listening on loopback.
4. OAuth 2.1 / OIDC-compatible authorization server with human authorization-code + PKCE S256, JWKS, RFC 8414 discovery and audience-restricted JWT **access tokens**. OAuth client registration is the IdP's responsibility.
5. Node 22+, source code, private secrets manager. Never commit operational .env values.

## Required settings

Slack worker:
- DATABASE_URL: dedicated PostgreSQL DSN; remote DB requires TLS.
- H2H_ENCRYPTION_KEY: canonical base64 of 32 random bytes. Generate with: openssl rand -base64 32. Back up in a secret manager; loss makes data inaccessible. Key rotation is not automatic.
- H2H_DB_TLS=true for remote PostgreSQL, optionally H2H_DB_CA_FILE.
- SLACK_BOT_TOKEN, SLACK_APP_TOKEN from custom app.
- SLACK_TEAM_ID (one workspace) and SLACK_ALLOWED_CHANNEL_IDS (comma-separated C... IDs).

MCP service additionally:
- H2H_MCP_PUBLIC_URL=https://h2h.example.org/mcp (exact RFC 8707 resource audience).
- H2H_OAUTH_ISSUER=https://issuer.example.org (must match access-token iss).
- H2H_OAUTH_METADATA_URL=https://issuer.example.org/.well-known/oauth-authorization-server (fixed trusted metadata URL).
- H2H_LISTEN_HOST=127.0.0.1 (default), H2H_MCP_PORT=3000 (default). An isolated container can use host 0.0.0.0 behind its reverse proxy.
- SLACK_BOT_TOKEN also lets MCP verify recipient's current membership via Slack Web API.

The development-only H2H_ALLOW_LOCAL_HTTP_MCP=true option permits a loopback HTTP resource URL. Never use this for a public deployment. Optional model settings are H2H_MODEL_URL, H2H_MODEL_NAME and H2H_MODEL_API_KEY. When absent, the pilot uses extractive text only. Authors explicitly consent before any externally configured model sees source text.

## Setup

    npm install --ignore-scripts --no-audit --no-fund
    npm run migrate
    npm test
    npm run slack   # separate Socket Mode process
    npm run mcp     # separate OAuth-protected resource service

Until a dependency lockfile is generated and reviewed, installation is not reproducible byte-for-byte; operators should generate a lockfile on a networked development machine, review it, and commit it before production deployment. Then switch to npm ci.

Run npm run prune on a scheduled job. Drafts expire after 15 minutes, shared records after 24 hours; minimal audit events have up to 30 days of retention subject to pruning. Backups have separate retention that the operator must enforce. Never expose Postgres directly to the internet.

## Verify identity mapping (operator-only)

Before binding identities, independently verify the person's OAuth issuer and subject AND that person's Slack account, using your organization identity records or a trusted out-of-band confirmation. Then run as administrator:

    H2H_OAUTH_ISSUER=https://issuer.example.org \
    H2H_LINK_SUBJECT=verified-oidc-sub \
    H2H_LINK_SLACK_USER=U123456789 \
    SLACK_TEAM_ID=T123456789 \
    npm run link:user

The exact pair (issuer, subject) is linked to one Slack team/user. Never accept an unverified chat instruction as evidence of identity. A mapped token does not override Slack channel permissions. User self-service linking/unlinking is not provided; removal requires an authorized DB operation and audit.

## Connect a personal AI client

Configure a Claude or ChatGPT client that supports remote custom MCP integration to use your HTTPS /mcp endpoint, sign in through the configured OAuth issuer, request the exact resource and scope h2h:read, and call h2h_get_brief with an authorized H2H message ID. The receiving assistant uses its own context; H2H does not impersonate a personal model or automatically acquire that model's memory. The h2h_prepare_private_assessment tool returns only a prompt for the recipient to interpret privately.

Slackbot's agent_prompt is a separate Slack-native experience; the fallback is a private copy-paste modal. These are not the same as MCP authentication.


## Operational preflight and containerized test deployment

Static configuration checking (no network calls or secrets printed):

    npm run doctor:slack
    npm run doctor:mcp

The included [Dockerfile](../Dockerfile) and [compose.yaml](../compose.yaml) run the Slack worker and OAuth-protected MCP process against an **operator-managed external TLS PostgreSQL instance and OAuth identity provider**. Put real configuration values in an untracked local .env file or a secret manager. Before starting, run the migrations with the same environment in a one-off container:

    docker compose build
    docker compose run --rm --no-deps slack npm run migrate
    docker compose up -d

The MCP container binds the upstream service only to the host's 127.0.0.1:3000, which requires an external HTTPS reverse proxy with Host header preservation. Do not publicly expose raw port 3000. The Dockerfile currently uses npm install without a lockfile; pin dependencies and the base image digest before a real production release. Encrypt and back up the Postgres database and key separately; the Compose file does **not** provision a secure database or IdP.

## Security review before broad deployment

- Test ACL denial for unknown tenant/users/channels, Slack Connect, revoked/expired briefs, token expiry/audience/issuer/scope, concurrency, SSRF and prompt injection.
- Confirm live IdP discovery and token issuance with a supported personal-AI MCP client. OAuth ID tokens must NOT be substituted for audience-restricted access tokens.
- Set log redaction, secure metrics, rate limiting at reverse proxy, encryption-key backup, DB least privilege, secret rotation, incident response, GDPR/data processing agreements, retention and secure deletion including backups.
- Review response handling when Slack post succeeds but the DB or network fails; no automatic retries are allowed. A durable reconciliation/outbox workflow is required before high-volume rollouts.
- Retraction blocks future H2H retrieval but cannot erase Slackbot prompts already included in messages, previously copied data, or past model observations.
- H2H currently supports a single workspace. Full A2A receiving-task implementation, Auctor/Align integration, signed consent attestations, multi-tenant administration, independent audit anchoring and real-user end-to-end testing remain future work. Document limits honestly.

See [Threat Model](THREAT_MODEL.md), [Slack Pilot](SLACK_PILOT.md) and security issue #12.
