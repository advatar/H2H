// Fully synthetic E2E demonstration, no Slack tokens, network, external models or personal records.
import {PilotStore} from "../src/slack/state.js";
import {pilotConfiguration} from "../src/slack/access.js";
import {registerSlackPilot} from "../src/slack/handlers.js";
import {personalInterpretationPrompt} from "../src/personal.js";

const TEAM="TDEMO123",CHANNEL="CDEMO123",BOT="UDEMO999",ALICE="UDEMO111",BOB="UDEMO222";
const selectedText=[
  "The product team proposes sharing AI-generated architectural conversations in Slack.",
  "The aim is to reduce time spent reading long links while allowing each recipient's own AI to",
  "evaluate the same shared information using the recipient's private context.",
  "The initial pilot will require source content to be submitted explicitly, will show a short",
  "evidence-aware brief, and will never automatically post a personal interpretation."
].join(" ");
const listeners={shortcut:new Map(),view:new Map(),action:new Map()};
const app={
  shortcut:(k,fn)=>listeners.shortcut.set(typeof k==="object"?k.callback_id:k,fn),
  view:(k,fn)=>listeners.view.set(k,fn),
  action:(k,fn)=>listeners.action.set(k,fn)
};
const events={opened:[],updated:[],posted:[],edited:[]};
const client={
  auth:{test:async()=>({ok:true,team_id:TEAM,user_id:BOT})},
  conversations:{
    info:async()=>({ok:true,channel:{id:CHANNEL,is_channel:true,is_private:false,
      is_ext_shared:false,is_archived:false,is_shared:false,is_org_shared:false,is_member:true}}),
    members:async()=>({ok:true,members:[ALICE,BOB,BOT],response_metadata:{next_cursor:""}})
  },
  views:{
    open:async input=>{events.opened.push(input);return {ok:true};},
    update:async input=>{events.updated.push(input);return {ok:true};}
  },
  chat:{
    postMessage:async input=>{events.posted.push(input);return {ok:true,ts:"123.789"};},
    update:async input=>{events.edited.push(input);return {ok:true};},
    postEphemeral:async()=>({ok:true})
  }
};
const store=new PilotStore();
registerSlackPilot(app,{store,config:pilotConfiguration({SLACK_TEAM_ID:TEAM,SLACK_ALLOWED_CHANNEL_IDS:CHANNEL})});
const body=(user=ALICE)=>({team:{id:TEAM},user:{id:user},channel:{id:CHANNEL},trigger_id:"DEMO"});
const ack=async()=>{};
await listeners.shortcut.get("h2h_create_brief")({
  ack,client,body:body(),
  shortcut:{channel:{id:CHANNEL},message:{ts:"123.456",text:selectedText},trigger_id:"DEMO"}
});
const compose={...events.opened.at(-1).view,id:"VDEMO"};
compose.state={values:{source:{text:{value:""}},rights:{confirm:{selected_options:[{value:"approved"}]}}}};
await listeners.view.get("h2h_compose")({ack,client,body:body(),view:compose});
const review={...events.updated.at(-1).view,id:"VDEMO"};
if(events.posted.length!==0) throw new Error("Unapproved public posting occurred");
await listeners.view.get("h2h_publish")({ack,client,body:body(),view:review});
if(events.posted.length!==1) throw new Error("Expected exactly one published shared brief");
const id=events.posted[0].blocks[1].elements[0].value;
const shared=store.getPublished(id)?.envelope;
if(!shared) throw new Error("Expected published, retrievable knowledge artifact");
// These are deterministic local MOCK AGENTS with fictional preferences,
// not genuine Claude/ChatGPT private memory or live model completions.
const privateContextA={focus:"security",needs:"Verify consent, ACLs and incident traceability"};
const privateContextB={focus:"product",needs:"Reduce reading load and measure decisions accelerated"};
function fakePrivateAgent(brief,context) {
  return context.focus==="security"?
    "Security interpretation: test least privilege and revocation before broader rollout.":
    "Product interpretation: pilot the 100-word brief and measure decision usefulness.";
}
const analysisA=fakePrivateAgent(shared,privateContextA);
const analysisB=fakePrivateAgent(shared,privateContextB);
if(analysisA===analysisB) throw new Error("Expected different interpretations");
const wire=JSON.stringify(shared);
if(wire.includes(privateContextA.needs)||wire.includes(privateContextB.needs)) throw new Error("Private context leaked into shared artifact");
const handoff=personalInterpretationPrompt(shared);
if(!handoff.includes("END UNTRUSTED H2H DATA")) throw new Error("Missing safety boundary");
console.log(JSON.stringify({
  status:"synthetic_demo_success",shared_briefs:events.posted.length,
  actor:"Alice",recipient:"Bob",
  shared_summary:shared.artifact.summary,
  mock_personal_interpretations:{alice:analysisA,bob:analysisB},
  privately_retained_context:true,
  automatically_published_personal_replies:0,
  live_slack_calls:0,live_model_calls:0
},null,2));
