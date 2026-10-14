# H2H Slack pilot — operator guide (experimental)

This repo includes a **Slack Bolt Socket Mode app backed by encrypted PostgreSQL**. It has not been installed in your workspace, deployed on infrastructure, or approved for production use. This guide is for a single operator-controlled test workspace.

## Prerequisites and setup

1. Create an app from [slack-app-manifest.yml](../slack-app-manifest.yml) at the Slack API app management site; install it into one test workspace.
2. Configure the **Create H2H Brief** message shortcut. The manifest requests bot scopes: commands, chat:write, channels:read only. Do NOT add message history or file scopes.
3. Enable Socket Mode and create an app-level token with connections:write. Record the bot token (xoxb) and app token (xapp). Do not commit these.
4. Add the bot to the public, non-shared **test** channel(s). Pilot rejects private channels, Slack Connect, and other shared channels.
5. Set SLACK_TEAM_ID and SLACK_ALLOWED_CHANNEL_IDS (comma-delimited explicit list). Run:
   
       npm install
       npm test
       npm run slack

   To run a full **synthetic** approval and two-human interaction without tokens, use `npm run demo:h2h`. This is a deterministic mock, not a live Slack or Claude integration.

   Before starting the live app, configure DATABASE_URL and H2H_ENCRYPTION_KEY and run npm run migrate. For remote databases, enable verified PostgreSQL TLS. See [deployment](DEPLOYMENT.md). Supply all secrets through a secret manager. See [.env.example](../.env.example). Do not source a file containing untrusted shell text.

6. In an allowed channel, select the **Create H2H Brief** message shortcut on a message containing actual conversation text, or on a link and paste a transcript excerpt in the form.
7. Confirm rights and, if an AI provider is configured, its processing; review the resulting H2H Brief, then click **Publish**. The app replies only in the selected message's existing thread.
8. The **Ask my AI** button uses Slack's agent_prompt when Slackbot AI is available to the individual. **Use Claude / ChatGPT** always offers a private copy-paste prompt after verifying current membership; it does not automatically open a recipient's existing Claude or ChatGPT conversation. Only the author can **Retract** the H2H post.

## Long-form inputs and source integrity

A Slack plain_text_input modal can accept at most **3,000 characters**. If the selected Slack message itself contains up to 50,000 characters of text, leaving the input empty uses that original message text (within the stored input limit). Messages that contain **only a Claude or ChatGPT link cannot be read or summarized** by this app; paste the permitted text into the input or share it in a long Slack message first. We do not scrape Claude/ChatGPT links, private conversations or files.

All author-submitted content is tagged **partial** even when the author considers it complete, because the app does not verify coverage of the external conversation. A link, where retained, is tagged **link_only**. The preview explicitly separates source excerpts from AI interpretations. No false claim of reading attachments.

## Summarization

No model configured: deterministic extractive preview (first meaningful sentences, up to 98 words); it is **not** a reliable semantic TL;DR of a long conversation. For actual synthesis, set H2H_MODEL_URL, H2H_MODEL_NAME and H2H_MODEL_API_KEY for an operator-approved OpenAI-compatible chat-completions endpoint. Source text is sent to that provider **only after explicit checkbox consent**. Use approved data processing terms and retention settings. Model errors fall back to extractive text with visible limitation. Model only sees the first 20,000 characters; full source is not fetched.

Model-proposed source claims are labeled source-backed only when the *exact quoted excerpt* appears in the provided text; unsupported paraphrases remain unverified. Even quotes do not establish factual correctness.

## Consent and privacy behavior

- The initial shortcut author is authenticated by Slack's Socket Mode transport; the app checks team allowlist and later verifies current channel metadata/membership for both author and bot.
- A review modal shows the actual artifact before public publication; only an explicit author submission posts it.
- The personal handoff never retrieves the user's personal model memory. For Slackbot users, its proprietary personal context remains with Slackbot. Other agents require a future authorized MCP connector.
- The bot does not collect messages passively, join channels automatically, or subscribe to message events.
- A recipient must be a current channel member to open the fallback modal, with fresh Slack ACL checks.
- Retracting a message edits the existing bot post and disables future pilot lookups in memory, best effort. It CANNOT erase previous views, Slackbot conversations, screenshots or exports.

## Important limitations / production gates

The live app uses **encrypted PostgreSQL state**, with atomic publish transitions and a minimal durable operational audit (not tamper-proof). Drafts expire after 15 minutes and published lookup after 24 hours. The synthetic demo still uses an in-memory store. Slackbot may continue to show embedded prompt text already posted. After a network-ambiguous post, the app intentionally does **not** retry; a human must inspect the thread before restarting a draft. H2H does not yet provide a proper OAuth-protected remote MCP or complete A2A receiving service.

No enterprise deployment until: an independent security review, signed/independently verified human grants, complete cross-process Slack reconciliation, key rotation, rate limiting, operational incident response, provider privacy assessment, multi-tenant policy and actual workspace testing. An OAuth resource server with linked-user ACL checks has been added, but it has not been deployed or live-verified. See [Threat Model](THREAT_MODEL.md) and [Issue #12](https://github.com/advatar/H2H/issues/12).

## Operator acceptance checklist

- [ ] Tests pass locally and CI
- [ ] Channel not in allowlist fails before composing
- [ ] Private/Slack Connect channels fail closed
- [ ] Only original author can publish a draft
- [ ] A bare shared URL fails source ingestion
- [ ] Recipient without membership gets no fallback
- [ ] Duplicate Publish click produces no duplicate post
- [ ] Only author can retract; revoked H2H handoff denied
- [ ] Slackbot user and copy-paste fallback tested separately
- [ ] No secrets, source transcripts or personal context in logs
