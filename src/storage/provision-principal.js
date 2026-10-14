// Operator-only provisioning after verifying BOTH IdP person and Slack identity.
// Do not expose this command to MCP or Slack, nor use unverified JWT token claims.
import {createDurableRuntime} from "./runtime.js";
const {H2H_OAUTH_ISSUER:issuer,H2H_LINK_SUBJECT:subject,SLACK_TEAM_ID:teamId,H2H_LINK_SLACK_USER:slackUserId}=process.env;
if(!issuer||!subject||!teamId||!slackUserId)throw new Error("Set H2H_OAUTH_ISSUER, H2H_LINK_SUBJECT, SLACK_TEAM_ID, H2H_LINK_SLACK_USER");
const {pool,store}=await createDurableRuntime();
try{
  await store.provisionPrincipal({issuer,subject,teamId,slackUserId});
  console.log("Authenticated principal binding provisioned by operator");
}finally{await pool.end();}
