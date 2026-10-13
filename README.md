# H2H

**Human-to-Human, powered by AI agents.** H2H makes AI-mediated human communication short, evidence-aware, permissioned, and personally interpretable.

A2A connects agents. H2H connects the humans behind them.

## What it is

H2H is an experimental **semantic extension** of [Agent2Agent (A2A) v1.0.1](https://a2a-protocol.org/v1.0.1/specification/), not a new agent transport. A sender authorizes an agent to share a small structured *knowledge brief*. A recipient's personal agent interprets that same brief **privately** in the context available to that recipient. A reply is never posted merely because an agent proposed it.

First use case: long Claude/ChatGPT conversations shared into Slack. A useful short brief is posted to the thread; teammates can ask their personal AI what it means for them.

## Protocol at a glance

Human A -> Personal Agent A -> H2H Brief -> A2A or MCP -> Personal Agent B -> Human B

- Sender, audience, intent, sources, claims, limitations and permission policy are explicit.
- Personal memories are **not** exchanged as part of the H2H message.
- Evidence distinguishes source-backed assertions from inference or unverified claims.
- A policy document inside a message is **not** authorization: a receiver must verify grants and resource ACLs separately.
- Sharing, interpreting, drafting, posting and forwarding are separate actions.
- Delivery, machine interpretation and human acknowledgment are separate receipts.
- Revocation blocks future retrieval/processing when enforced; it cannot erase already-exposed copies.

## Repository status

**Draft H2H 0.1; reference code only. Not a deployed Slack app, production authorization service, MCP server, or A2A agent.** The initial implementation includes a JSON Schema, reference contract checks, A2A wrapping, safe Slack Block Kit preview generation, a local example and offline tests. Integration requires actual identities, consent verification, storage and OAuth.

- [Protocol](spec/0.1/PROTOCOL.md)
- [JSON Schema](schema/h2h-envelope.schema.json)
- [Threat model](docs/THREAT_MODEL.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [Illustrative brief](examples/brief.json)

## Try the reference implementation

Requires Node.js 22 or newer; no runtime dependencies.

~~~sh
npm install
npm test
npm run demo
~~~

The demo uses a fictional, locally provided brief and prints an example A2A message plus a Slack preview. It never fetches Claude links or posts to Slack.

## Design principle

The shared artifact is about **what was said and why it might matter**. The receiving human's agent decides what it means **to that human**, without revealing their memory to the sender.

Contributions: experimental project; versioned schemas and compatibility tests are required before changes to the wire format.
