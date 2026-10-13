# Repository guidance

H2H is a human-authorized semantic protocol atop A2A; do not introduce a competing wire transport.

- Never assume a URL grants the right to fetch, summarize or redistribute its contents.
- Do not treat envelope sender/agent/policy/grant_ref as proof of authenticated identity or consent.
- Never make an assessment or personal context public by default; publishing requires fresh human approval tied to exact content and destination.
- Keep protocol changes versioned and update schema, examples and tests together.
- Keep source-backed claims tied to actually accessible source IDs. Link-only is never evidence that linked content has been read.
- No hardcoded credentials, private transcripts, customer data or unapproved API calls in examples/tests.
- Node.js >=22; no dependencies in initial reference runtime. Test with npm test.
- Distinguish **reference library** from a deployed/secured Slack, MCP or A2A service in docs and issue updates.

## Slack pilot

- Single-workspace Socket Mode; explicit allowlist of public, unshared channels.
- Never add passive message subscriptions or extra Slack scopes without explicit review.
- Author sees an exact brief before Publish; verify Slack membership at publish and recipient handoff.
- No automatic retry of ambiguous Slack message posts.
- Never log source text, secrets or personal-context output.
- Run `npm test` after every change; do not claim a real workspace deployment until confirmed.
