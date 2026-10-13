// Single-workspace Socket Mode pilot. Refuses to start without explicit allowlist.
import {App} from "@slack/bolt";
import {PilotStore} from "./state.js";
import {pilotConfiguration} from "./access.js";
import {configuredSummarizer} from "./summarize.js";
import {registerSlackPilot} from "./handlers.js";

const config=pilotConfiguration();
if(!process.env.SLACK_BOT_TOKEN||!process.env.SLACK_APP_TOKEN) {
  throw new Error("Provide SLACK_BOT_TOKEN and SLACK_APP_TOKEN. See docs/SLACK_PILOT.md.");
}
const store=new PilotStore();
const app=new App({
  token:process.env.SLACK_BOT_TOKEN,
  socketMode:true,
  appToken:process.env.SLACK_APP_TOKEN,
  ...(process.env.SLACK_SIGNING_SECRET?{signingSecret:process.env.SLACK_SIGNING_SECRET}:{})
});
registerSlackPilot(app,{store,config,modelSummarizer:configuredSummarizer(),logger:app.logger});
await app.start();
app.logger.info("H2H experimental Slack pilot started with explicit channel allowlist; no automatic message subscriptions.");
