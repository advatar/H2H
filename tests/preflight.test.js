import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {checkPilotEnvironment} from "../src/ops/preflight.js";
const env=()=>({
  SLACK_TEAM_ID:"TDEMO123",SLACK_ALLOWED_CHANNEL_IDS:"CDEMO123",
  SLACK_BOT_TOKEN:"xoxb-fake-test",SLACK_APP_TOKEN:"xapp-fake-test",
  DATABASE_URL:"postgres://h2h:test@localhost:5432/h2h_test",
  H2H_ENCRYPTION_KEY:randomBytes(32).toString("base64"),
  H2H_MCP_PUBLIC_URL:"https://h2h.example.org/mcp",
  H2H_OAUTH_ISSUER:"https://idp.example.org",
  H2H_OAUTH_METADATA_URL:"https://idp.example.org/.well-known/oauth-authorization-server"
});
test("preflight validates separate Slack and MCP operator requirements without making calls",()=>{
  const good=env();
  assert.equal(checkPilotEnvironment(good,"slack").ready,true);
  assert.equal(checkPilotEnvironment(good,"mcp").ready,true);
  const noSecret={...good,SLACK_APP_TOKEN:""};
  assert.equal(checkPilotEnvironment(noSecret,"slack").ready,false);
  assert.equal(checkPilotEnvironment(noSecret,"mcp").ready,true);
  assert(!JSON.stringify(checkPilotEnvironment(good,"slack")).includes("xoxb-"));
});
test("preflight rejects insecure remote storage and non-HTTPS OAuth/MCP endpoints",()=>{
  const original=env();
  assert.equal(checkPilotEnvironment({...original,DATABASE_URL:"postgres://user:pw@db.example.org/h2h"},"slack").ready,false);
  assert.equal(checkPilotEnvironment({...original,H2H_MCP_PUBLIC_URL:"http://h2h.example.org/mcp"},"mcp").ready,false);
  assert.equal(checkPilotEnvironment({...original,H2H_OAUTH_ISSUER:"http://idp.example.org"},"mcp").ready,false);
  assert.equal(checkPilotEnvironment({...original,H2H_ENCRYPTION_KEY:"incorrect"},"slack").ready,false);
});
