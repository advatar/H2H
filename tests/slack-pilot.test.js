import test from "node:test";
import assert from "node:assert/strict";
import {PilotStore} from "../src/slack/state.js";
import {pilotConfiguration,verifyPublicChannelMember} from "../src/slack/access.js";
import {registerSlackPilot} from "../src/slack/handlers.js";
import {sourceIsOnlyLink} from "../src/slack/summarize.js";
import {privateHandoffView} from "../src/slack/views.js";

const T="T123TEST",C="C123TEST",U="U123AUTHOR",R="U222READER",BOT="U999BOT";
const config=pilotConfiguration({SLACK_TEAM_ID:T,SLACK_ALLOWED_CHANNEL_IDS:C});
const source="We are proposing a new event-driven pipeline for our shared product. The rationale is improved visibility and quicker processing. These are hypotheses rather than tested performance results. What should we do?";
function harness({selectedText=source,members=[U,R,BOT],channelProps={},modelSummarizer=null,postError=false,now=()=>Date.now()}={}) {
  const listeners={shortcuts:new Map(),views:new Map(),actions:new Map()};
  const app={
    shortcut:(key,fn)=>listeners.shortcuts.set(typeof key==="object"?key.callback_id:key,fn),
    view:(key,fn)=>listeners.views.set(key,fn),
    action:(key,fn)=>listeners.actions.set(key,fn)
  };
  const calls={opened:[],updated:[],posted:[],edited:[],ephemeral:[],acks:[]};
  const client={
    auth:{test:async()=>({ok:true,team_id:T,user_id:BOT})},
    conversations:{
      info:async()=>({ok:true,channel:{id:C,is_channel:true,is_private:false,is_ext_shared:false,is_archived:false,is_shared:false,is_org_shared:false,is_member:true,context_team_id:T,...channelProps}}),
      members:async()=>({ok:true,members,response_metadata:{next_cursor:""}})
    },
    views:{
      open:async input=>{calls.opened.push(input);return {ok:true,view:{id:"V123"}};},
      update:async input=>{calls.updated.push(input);return {ok:true,view:{id:"V123"}};}
    },
    chat:{
      postMessage:async input=>{calls.posted.push(input);if(postError) throw Error("timeout after write");return {ok:true,ts:"999.001"};},
      update:async input=>{calls.edited.push(input);return {ok:true};},
      postEphemeral:async input=>{calls.ephemeral.push(input);return {ok:true};}
    }
  };
  const store=new PilotStore({now});
  registerSlackPilot(app,{store,config,modelSummarizer,now:()=>new Date(),logger:{warn:()=>{}}});
  const body=(user=U)=>({team:{id:T},user:{id:user},channel:{id:C},trigger_id:"TRIG"});
  const ack=async v=>{calls.acks.push(v);};
  async function shortcut(user=U){
    await listeners.shortcuts.get("h2h_create_brief")({
      ack,client,body:body(user),
      shortcut:{channel:{id:C},message:{ts:"123.456",text:selectedText},trigger_id:"TRIG"}
    });
    return calls.opened.at(-1)?.view;
  }
  async function compose({user=U,text="",approved=true,view=null}={}){
    view??=calls.opened.at(-1)?.view;
    view=structuredClone(view);
    view.id="V123";
    view.state={values:{
      source:{text:{value:text}},
      rights:{confirm:{selected_options:approved?[{value:"approved"}]:[]}}
    }};
    await listeners.views.get("h2h_compose")({ack,client,body:body(user),view});
    return calls.updated.at(-1)?.view;
  }
  async function publish({user=U,view=null}={}){
    view??=calls.updated.at(-1)?.view;
    view={...view,id:"V123"};
    await listeners.views.get("h2h_publish")({ack,client,body:body(user),view});
  }
  async function action(name,recipient=R,value=calls.posted.at(-1)?.blocks[1].elements[0].value) {
    await listeners.actions.get(name)({ack,client,body:body(recipient),action:{value}});
    return calls.opened.at(-1)?.view;
  }
  return {store,client,calls,listeners,shortcut,compose,publish,action,body};
}
test("Slack configuration requires allowlist and only allowed public member can proceed",async()=>{
  assert.throws(()=>pilotConfiguration({SLACK_TEAM_ID:T,SLACK_ALLOWED_CHANNEL_IDS:""}));
  const h=harness({channelProps:{is_private:true}});
  assert.equal(await verifyPublicChannelMember(h.client,{teamId:T,channelId:C,userId:U,config}),false);
  const k=harness({members:[U,R]});
  assert.equal(await verifyPublicChannelMember(k.client,{teamId:T,channelId:C,userId:U,config}),false);
});
test("message shortcut -> explicit compose -> review -> single Slack thread post",async()=>{
  const h=harness();
  const composeView=await h.shortcut();
  assert.equal(composeView.callback_id,"h2h_compose");
  assert.equal(h.calls.posted.length,0);
  const review=await h.compose();
  assert.equal(review.callback_id,"h2h_publish");
  assert.equal(h.calls.posted.length,0);
  assert(review.blocks.some(b=>b.text?.text.includes("Visible to the entire")));
  await h.publish({view:review});
  assert.equal(h.calls.posted.length,1);
  const sent=h.calls.posted[0];
  assert.equal(sent.channel,C);
  assert.equal(sent.thread_ts,"123.456");
  assert(sent.blocks[1].elements.some(b=>b.action_id==="h2h_personal_interpretation"));
  assert(sent.blocks[1].elements.some(b=>b.action_id==="h2h_retract"));
  const messageId=sent.blocks[1].elements[0].value;
  assert(h.store.getPublished(messageId));
  await h.publish({view:review});
  assert.equal(h.calls.posted.length,1,"idempotent review submit");
});
test("consent missing and bare link are rejected before external model or Slack post",async()=>{
  const h=harness({selectedText:"https://claude.ai/share/abc123",modelSummarizer:async()=>{throw Error("must not be called");}});
  await h.shortcut();
  const noConsent=await h.compose({approved:false});
  assert.equal(noConsent,undefined);
  assert.equal(h.calls.acks.at(-1)?.response_action,"errors");
  await h.compose({approved:true});
  assert.equal(h.calls.acks.at(-1)?.response_action,"errors");
  assert.equal(h.calls.posted.length,0);
  assert.equal(h.calls.updated.length,0);
  assert(sourceIsOnlyLink("<https://claude.ai/share/abc123|Claude conversation>"));
});
test("for lengthy selected message, leaving 3000-char input blank processes original text",async()=>{
  const long=source.repeat(30);
  const h=harness({selectedText:long});
  const view=await h.shortcut();
  assert.equal(view.blocks[1].element.initial_value,undefined);
  assert(view.blocks[1].hint.text.includes("Leave the field empty"));
  const review=await h.compose({text:""});
  assert.equal(review.callback_id,"h2h_publish");
  assert(review.blocks.some(b=>b.text?.text.includes("TL;DR")));
});
test("cross-user submission cannot publish another author's draft",async()=>{
  const h=harness();
  await h.shortcut();
  await h.compose({user:R});
  assert.equal(h.calls.acks.at(-1)?.response_action,"update");
  assert.equal(h.calls.updated.length,0);
  await h.compose();
  const review=h.calls.updated.at(-1).view;
  await h.publish({user:R,view:review});
  assert.equal(h.calls.posted.length,0);
  await h.publish({user:U,view:review});
  assert.equal(h.calls.posted.length,1);
});
test("channel membership changes between draft and Publish fail closed",async()=>{
  const members=[U,R,BOT];
  const h=harness({members});
  await h.shortcut();
  const review=await h.compose();
  members.splice(members.indexOf(U),1);
  await h.publish({view:review});
  assert.equal(h.calls.posted.length,0);
});
test("recipients see private copy-paste prompt only while members and grant is valid",async()=>{
  const members=[U,R,BOT];
  const h=harness({members});
  await h.shortcut();const review=await h.compose();await h.publish({view:review});
  const modal=await h.action("h2h_personal_interpretation",R);
  assert.equal(modal.callback_id,"h2h_private_handoff");
  assert(modal.blocks.some(b=>b.text?.text.includes("UNTRUSTED")));
  const openedBefore=h.calls.opened.length;
  members.splice(members.indexOf(R),1);
  const denied=await h.action("h2h_personal_interpretation",R);
  assert.equal(h.calls.opened.length,openedBefore+1);
  assert.equal(denied.callback_id,"h2h_finished");
  assert(!JSON.stringify(denied).includes("BEGIN UNTRUSTED"));
});
test("only author can retract and revoked briefing loses private handoff",async()=>{
  const h=harness();
  await h.shortcut();const review=await h.compose();await h.publish({view:review});
  const messageId=h.calls.posted[0].blocks[1].elements[0].value;
  await h.action("h2h_retract",R,messageId);
  assert.equal(h.calls.edited.length,0);
  assert(h.store.getPublished(messageId));
  await h.action("h2h_retract",U,messageId);
  assert.equal(h.calls.edited.length,1);
  assert.equal(h.store.getPublished(messageId),null);
  const modal=await h.action("h2h_personal_interpretation",R,messageId);
  assert.equal(modal.callback_id,"h2h_finished");
});
test("network-ambiguous publish is not retried and is never reported as success",async()=>{
  const h=harness({postError:true});
  await h.shortcut();const review=await h.compose();
  await h.publish({view:review});
  await h.publish({view:review});
  assert.equal(h.calls.posted.length,1);
  assert(h.calls.updated.at(-1).view.blocks[0].text.text.includes("uncertain")||h.calls.updated.at(-1).view.blocks[0].text.text.includes("uncertain"));
});
test("ephemeral drafts expire and cannot be published later",async()=>{
  let current=Date.now();
  const h=harness({now:()=>current});
  await h.shortcut();
  const review=await h.compose();
  current+=20*60*1000;
  await h.publish({view:review});
  assert.equal(h.calls.posted.length,0);
});

test("Use Claude / ChatGPT always offers the permission-checked private handoff",async()=>{
  const h=harness();
  await h.shortcut();const review=await h.compose();await h.publish({view:review});
  const messageId=h.calls.posted[0].blocks[1].elements[0].value;
  assert(h.calls.posted[0].blocks[1].elements.some(x=>x.action_id==="h2h_copy_handoff"));
  const modal=await h.action("h2h_copy_handoff",R,messageId);
  assert.equal(modal.callback_id,"h2h_private_handoff");
  assert(JSON.stringify(modal).includes(messageId));
});
