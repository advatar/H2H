# H2H threat model — draft

Trust boundaries: (1) third-party conversation/source -> ingestion, (2) ingestion -> summarizer, (3) shared artifact -> audience, (4) MCP/A2A tool -> personal agent, (5) personal reasoning -> posted reply, (6) transport -> authorization server / immutable audit.

| Threat | Required control |
| --- | --- |
| Prompt injection in Claude/chat transcript | Treat all source text, links, summaries and agent metadata as untrusted data; never follow embedded operational instructions |
| Fake human identity/approval | Authenticated principal, fresh human action tied to exact content, audience and destination; policy/grant_ref alone is not proof |
| Private context exfiltration | Personal interpretation local to recipient; outbound release requires explicit approval, least-privileged resources |
| Channel membership changes / cross-tenant leak | Authorization on each read/notification; tenant and channel ACLs; fail closed on membership resolution failure |
| Public shared links interpreted as permission | Explicit source rights and human authorization; link-only metadata cannot justify a source-grounded summary |
| Malicious URL / SSRF / credential leakage | Deny private network targets, redirects to private addresses, protocol abuse; canonicalize URLs and constrain domains; no automatic fetch in first release |
| Replay / duplicated Slack messages | Unique message IDs, dedupe per tenant/source, signatures and timestamp checks for inbound Slack events |
| False 'read' receipts | Distinct delivered/interpreted/seen signals; human acknowledgment only from authenticated UI event |
| Content staleness / revocation | Expiring grants, access checks on every retrieval, best-effort cache invalidation; do not promise erasure of copies |
| Hallucinated claims / citations | Track source coverage, explicit claim basis and evidence IDs, distinguish inference from verified evidence |
| Sensitive content at rest or in provider telemetry | Purpose limitation, encryption, short retention, approved AI providers, redact logs; GDPR/DPA review before production |
| Overbroad Slack OAuth scope | Least privilege, opt-in channels, shortcut-first installation, no blanket conversation history |
| Signature theatre | Hashes/signatures only after verifying actual keys, authenticated authorship, authoritative anchoring and replay policy; never equate a SHA-256 digest with provenance |

**Security stop condition:** do not deploy a Slack/MCP/A2A receiving service until authn/authz, consent proof, ACL rechecks, source fetching policy, signed webhook verification, audit/retention and incident handling have been implemented and tested. Local reference utilities are not security boundaries.
