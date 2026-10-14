// Durable single-workspace Slack Socket Mode process. Explicitly allowlisted channels.
import {App} from "@slack/bolt";
import {createDurableRuntime} from "../storage/runtime.js";
import {pilotConfiguration} from "./access.js";
import {configuredSummarizer} from "./summarize.js";
import {registerSlackPilot} from "./handlers.js";

const config=pilotConfiguration();
if(!process.env.SLACK_BOT_TOKEN||!process.env.SLACK_APP_TOKEN){
  throw new Error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN required; see docs/DEPLOYMENT.md");
}
const {pool,store}=await createDurableRuntime();
const app=new App({
  token:process.env.SLACK_BOT_TOKEN,
  socketMode:true,
  appToken:process.env.SLACK_APP_TOKEN,
  ...(process.env.SLACK_SIGNING_SECRET?{signingSecret:process.env.SLACK_SIGNING_SECRET}:{})
});
registerSlackPilot(app,{store,config,modelSummarizer:configuredSummarizer(),logger:app.logger});
await app.start();
app.logger.info("H2H Slack pilot started; durable encrypted state, public-channel allowlist, no passive subscriptions");
let exiting=false;
async function shutdown(){
  if(exiting)return;exiting=true;
  try{await app.stop();}finally{await pool.end();}
}
process.once("SIGTERM",()=>void shutdown());
process.once("SIGINT",()=>void shutdown());
