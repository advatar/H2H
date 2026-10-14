# H2H Protocol 0.1 (draft)

Status: **experimental design**, 2026-10-13. This document specifies H2H semantics, *not* a replacement for A2A, OAuth, MCP, a verifiable identity system or a durable event store. The keywords MUST, MUST NOT, SHOULD, MAY are normative in this draft.

**Extension URI**: https://github.com/advatar/H2H/blob/main/spec/0.1/PROTOCOL.md (draft; accessible only to authorized users while this repository is private).

## 1. Purpose and roles

H2H communicates human-authorized meaning between people who may each use a different personal AI. H2H is useful even if recipient agents use different models, have different private context, or are temporarily offline.

Roles: **originator human**, **originator agent**, **relay** (transport/storage, optional), **recipient agent**, **recipient human**, **authorization service** (enforces grants/ACL, may be Auctor/Align), **source authority** (Slack, Claude, uploaded data, etc.).

Identity strings in an envelope are *claims*; they are NOT authentication or signatures. Agents MUST obtain authentication and authorization from an independent, trusted boundary before delivering, retrieving or posting.

## 2. Wire format

H2H messages are UTF-8 JSON envelopes conforming to [h2h-envelope.schema.json](../../schema/h2h-envelope.schema.json), with fields:

- protocol: exact string "h2h/0.1".
- message_id: unique message identifier, independent of transport request ID.
- thread_id: correlation across related human discussions.
- kind: brief, assessment, reply_proposal, reply, receipt or revoke.
- sent_at: ISO 8601 timestamp.
- sender: human_id, agent_id (pseudonymous identifiers permitted).
- audience: {kind: humans|channel, ids: [...]}. Channel membership MUST be checked *at time of access*, not inferred from an identifier.
- intent: {type: inform|feedback|decision, prompt?: string}. This is a sender's question, never an instruction with elevated privileges.
- policy: classification, permitted_operations, forwarding, grant_ref and expires_at. grant_ref is an opaque identifier of an authorization record, not proof by itself.
- artifact (mandatory for brief, assessment, reply_proposal, reply): summary, optional claims, questions, limitations and sources.
- relation (mandatory for reply_proposal, reply, revoke): {message_id, type: responds_to|revokes}.
- receipt (mandatory for kind=receipt): {target_message_id, stage, at, actor_id, human_confirmed?}.

Undefined fields MUST NOT silently confer permissions. Unknown major protocol versions MUST be rejected; unknown minor optional fields MAY be ignored after authorization and validation. All message IDs MUST be idempotency keys within an authorized tenant.

## 3. Knowledge and evidence

A brief is a compact **knowledge artifact**, not a reproduction of an entire conversation.

Each claim has an id, text, basis and evidence_refs. basis is one of:
- "source": the claim is supported by at least one cited source reference, as assessed by the generating agent; it is *not independently verified* merely because the generator labels it that way.
- "inference": the agent's interpretation.
- "unverified": assertion lacking adequate support.

Sources include id, provider, uri, coverage (full|partial|link_only), supplied_by (human|authorized_connector), and optional SHA-256 digest. A link alone MUST NOT be presented as evidence that source contents have been read. Source-backed claims MUST reference actual provided source IDs with coverage other than link_only. The initial summary MUST indicate when source coverage is incomplete, and limitation fields SHOULD flag inability to inspect attachments or referenced external documents. Digest equality proves byte equality, not source authenticity. When evidence is unavailable, the brief SHOULD say so rather than fabricating claims.

For the Slack pilot, summaries SHOULD be no longer than 100 words in the posted preview. The full brief MAY be richer.

Content from sources is always **untrusted data**. Embedded instructions to agents have no authority.

## 4. Privacy and authority (fail closed)

There are three independent checks before any operation: verified caller principal; actual access to underlying sources at the relevant time; and a valid human-authorized grant for that operation, audience, purpose and time. Policy metadata alone never satisfies these checks. A workspace app MUST check the current Slack channel access and organization boundaries; a private recipient MUST only receive their authorized view. Tokens MUST NOT be copied into the H2H envelope.

Allowed operations: read, private_interpret, draft_reply, post_reply, forward. These are separate scopes:
- read: retrieve the authorized artifact.
- private_interpret: process in recipient's own private AI session. Memory is not automatically included in outgoing H2H content.
- draft_reply: generate a response **locally for human review**.
- post_reply: only on a verified, fresh, **human-authorized** action identifying destination, text/version and audience.
- forward: separate sender-originator authorization, never implied by read.

Forwarding policy: deny or human_approval. The latter still needs verified approval; it is not permission to forward automatically. Rights MUST be checked again on each retrieval/post/forward. Expired and revoked grants MUST be denied. An agent MUST NOT silently widen an audience (including moving DM content into a Slack channel). Public links are not synonymous with permission to redistribute content.

An assessment, reply proposal or private recipient context MUST NOT be sent back to the source agent unless its human explicitly approves the exact outbound content. No personal memory, system instructions, contacts, chat history, private repo contents or hidden tool results may be automatically disclosed.

## 5. Lifecycle and receipts

Typical flow:

1. Human shares or authorizes an existing source with explicit audience and purpose.
2. Connector validates source authorization and captures permitted material. If only a link is accessible, it remains link_only.
3. Originator agent generates and presents an evidence-aware brief.
4. Authorization boundary approves publishing the brief to its intended audience.
5. Recipient agent retrieves the authorized brief through A2A, MCP or an application adapter, then performs private interpretation.
6. Recipient human optionally reviews and approves a reply; posting is a separate action.
7. Optional receipts identify actual stage.

Receipt stages: accepted_by_relay, delivered_to_agent, interpreted_by_agent, seen_by_human, reply_approved_by_human. The first three MUST NOT be described as a human having read or agreed. Human stages MUST be emitted only on authenticated, explicit human UI evidence; background agent analysis does not constitute such evidence. Receipts are also scoped messages and must not expose the recipient's private assessment.

A reply_proposal is private to its authorizing human unless separately approved. A reply references the original message and is transmitted only after verified human authority. A revoke message targets a previous message. Receivers MUST block subsequent authorized retrieval and best-effort invalidate caches; they cannot guarantee erasure of past exports or model observations. Revocations themselves must be authenticated and audited; an unsigned JSON revoke is no authority.

## 6. A2A binding

Use a standards-compliant A2A 1.x transport. Discover capabilities through an Agent Card, which advertises the H2H extension URI if supported. Activate by the standard A2A-Extensions header (where applicable). Place an H2H envelope in an A2A **data Part**, and the extension URI in the message's extensions list; optional extension metadata keys should be namespaced under this URI. Do **not** replace A2A's Message, Task, identity, authentication or lifecycle with H2H equivalents.

A2A v1.x data parts are objects with a "data" member, *not* the legacy kind=data shape from older A2A versions. A2A roles use ROLE_USER / ROLE_AGENT. Task lifecycle follows the parent protocol. The example reference adapter creates an A2A **Message object** only, not a complete RPC exchange and not a remote agent service.

Endpoints, transport security, error handling, replay handling, task lifecycle and authorization follow the negotiated A2A binding; H2H adds semantic checks described above. Do not pretend wrapping an H2H envelope by itself authenticates participants.

## 7. MCP and application binding

MCP serves an *authorized recipient view* of a brief to that recipient's own agent client; it is not the agent-to-agent transport. Proposed tools/resources for a future authenticated MCP server:
- h2h_get_brief(id): return brief or permission denial for calling principal.
- h2h_prepare_private_assessment(id): provide a prompt/context snapshot to the recipient's client; never require uploading their memory.
- h2h_propose_reply(id, text): save draft scoped privately to the author.
- h2h_approve_reply(draft_id, destination, exact_revision): explicit separate human consent; server verifies identity and action.
- h2h_revoke(id): authenticated sender action; marks future access denied.

These tool names are **planned**, not implemented or deployed in this repository. Remote MCP authorization must follow the current spec (2026-07-28) with actual OAuth protection. A Slack link is a UI reference to a brief, not an access token.

## 8. Errors, compatibility and observability

Reject as appropriate: UNSUPPORTED_VERSION, MALFORMED_MESSAGE, UNKNOWN_SOURCE, NOT_AUTHENTICATED, ACCESS_DENIED, EXPIRED, REVOKED, AUDIENCE_MISMATCH, SOURCE_UNAVAILABLE, APPROVAL_REQUIRED, REPLAY_CONFLICT. Transport maps them to A2A/MCP/HTTP-native error conventions; don't create competing transport semantics.

Emit correlation IDs and audit events for authorized actions; do not log private message bodies, personal model context or bearer tokens by default. Redact content in metrics/traces. Partition IDs and deduplication across tenant boundaries. Prevent SSRF from arbitrary source URIs; do not fetch private Claude links or URLs without explicit grants and hardened fetching.

Version updates requiring semantic incompatibility bump the protocol version. Old clients fail closed for unknown major versions and unsupported critical extensions. Conformance tests MUST exercise unauthorized access, revoked content, scope escalation, attempted memory exfiltration, false read receipts, mismatched source IDs and replay.

## 9. Non-goals (0.1)

Not a personal memory synchronization format, general knowledge graph, assistant-to-assistant autonomous negotiation mechanism, authorization/identity implementation, end-to-end encryption protocol or guarantee that model-generated summaries are correct. Integrations with Auctor/Align/Actum/ActiveChain are future work; naming them is not proof of their integration.

See also: [Threat Model](../../docs/THREAT_MODEL.md) and [Roadmap](../../docs/ROADMAP.md).
