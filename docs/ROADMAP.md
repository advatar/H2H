# H2H roadmap (2026-10)

This document separates implemented library pieces from proposed deployable integrations.

## P0 — protocol foundation (this PR)

- Versioned H2H 0.1 semantic specification and JSON Schema.
- Example brief and reply proposal, offline contract tests.
- Reference A2A 1.x Message mapping and Slack Block Kit preview generation.
- Threat model and hard non-goals (no claims of end-to-end authorization).

Exit: samples conform to schema; tests pass and wire extension behaves as declared.

## P1 — Slack pilot (code in dependent PR, installation and security qualification outstanding)

- Installable Slack Bolt app with message shortcut **Create H2H Brief** (opt-in first; avoid blanket channel scanning).
- Author submits or explicitly authorizes a conversation excerpt. Only process what the app is allowed to read. Do not assume private shared links can be scraped.
- Model adapter generates up-to-100-word preview and structured claims/evidence/limitations; author confirms audience.
- Post one thread reply with TL;DR, source coverage badge in text, and **Ask my AI** button (Slack agent_prompt when available; interaction fallback otherwise).
- Signed Slack requests, retries/idempotency, narrow OAuth scopes, message delete/revoke handling, workspace ACLs.

Exit: two users in a test workspace can share one permitted sample and get a correct preview without unauthorized retrieval.

## P2 — personal handoff

- OAuth-protected remote MCP server for h2h_get_brief with per-user authorization at each access (MCP 2026-07-28).
- Claude and ChatGPT client compatibility; fallback deep link or copyable text **without leaking bearer tokens**.
- Recipient can privately interpret and draft a suggested reply.
- Explicit approval UI on exact revision before post; no automatic personal-context disclosure.

Exit: two users receive demonstrably different private interpretations of the same brief, but nothing private leaves recipient without approval.

## P3 — A2A interoperability

- Advertise extension URI and negotiate A2A 1.x Agent Card capabilities, add full task handling, streaming/errors.
- Signed/delegated authority, Auctor/Align integration only after verifying actual interfaces.
- Cross-agent roundtrip tests; permission attenuation and revocation tests; durable audit and receipts.

Exit: independently implemented agents exchange briefs; denied permissions and revocations are consistently enforced.

## P4 — larger collaboration

- Compare authorized individual perspectives when humans opt in; identify consensus, disagreement and assumptions.
- Connect GitHub, email, Teams and document sources; privacy-preserving linked evidence.
- Open protocol governance, public specification site, interoperability and threat-model reviews.

## Product success metrics

Time-to-understand per shared item; percentage of source claims with grounded references; actionability; rate of human-approved responses; hallucinated citation rate; unauthorized access attempts blocked. Optimize for *less noise*, not more agent-generated commentary.
