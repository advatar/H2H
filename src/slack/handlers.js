// First usable H2H workflow: Slack message shortcut -> consent -> review -> publish.
import {validateSubmittedText} from "./summarize.js";
import {buildBrief} from "./summarize.js";
import {verifyPublicChannelMember} from "./access.js";
import {composeView,busyView,reviewView,finishedView,privateHandoffView,revokedBlocks,readModalInput,modalDraftId} from "./views.js";
import {renderSlackPreview} from "../slack-preview.js";
import {authorizeOperation} from "../protocol.js";

function context(body) {
  return {teamId:body?.team?.id||body?.team_id||null,userId:body?.user?.id||body?.user_id||null};
}
function hasSessionScope(teamId,channelId,config) {
  return teamId===config.teamId && config.allowedChannels.has(channelId) && /^C[A-Z0-9]+$/.test(channelId);
}
function extractApprovedSourceLink(text) {
  const match=String(text||"").match(/https:\/\/(?:claude\.ai\/share\/|chatgpt\.com\/share\/|chat\.openai\.com\/share\/)[a-zA-Z0-9_\-]+/);
  return match?.[0]||null;
}
const publicMessage=async(client,channel,user,message)=>{
  try {await client.chat.postEphemeral({channel,user,text:message});}catch { /* failure is private */ }
};
const report=(logger,scope)=>{
  if(logger && typeof logger.warn==="function") logger.warn("H2H pilot: "+scope+" failed");
};

export function registerSlackPilot(app,{store,config,modelSummarizer=null,now=()=>new Date(),logger=null}) {
  if(!app||!store||!config) throw new TypeError("app, store and config required");
  const member=(client,teamId,channelId,userId)=>
    verifyPublicChannelMember(client,{teamId,channelId,userId,config});

  app.shortcut({callback_id:"h2h_create_brief",type:"message_action"},async({ack,shortcut,client,body})=>{
    await ack();
    const {teamId,userId}=context(body||shortcut);
    const channelId=shortcut?.channel?.id;
    const sourceTs=shortcut?.message?.ts;
    const threadTs=shortcut?.message?.thread_ts||sourceTs;
    if(!hasSessionScope(teamId,channelId,config)||!userId||!sourceTs) {
      if(shortcut?.trigger_id) await client.views.open({trigger_id:shortcut.trigger_id,view:finishedView("H2H is only enabled in specifically allowlisted public channels.")});
      return;
    }
    const draft=await store.open({teamId,userId,channelId,sourceTs,threadTs,selectedText:shortcut.message.text||""});
    try {
      await client.views.open({trigger_id:shortcut.trigger_id,
        view:draft.status==="compose"?composeView(draft,{aiConfigured:!!modelSummarizer}):
          finishedView("This shortcut already has an H2H draft. Nothing has been posted again.")});
    }catch {report(logger,"open shortcut modal");}
  });

  app.view("h2h_compose",async({ack,body,view,client})=>{
    const {teamId,userId}=context(body);
    const draft=await store.get(modalDraftId(view),teamId,userId);
    if(!draft||draft.status!=="compose"){
      await ack({response_action:"update",view:finishedView("Draft expired or no longer available. Start the shortcut again.")});
      return;
    }
    const submitted=readModalInput(view);
    if(!submitted.approved){
      await ack({response_action:"errors",errors:{rights:"Confirm you have permission to share this text in the channel."}});
      return;
    }
    const text=(submitted.text||"").trim()||draft.selectedText;
    try {validateSubmittedText(text);}
    catch {
      await ack({response_action:"errors",errors:{source:"Provide at least 60 characters of actual conversation text (maximum 50,000); a link alone is insufficient."}});
      return;
    }
    await store.startProcessing(draft,{text,consent:true});
    await ack({response_action:"update",view:busyView(draft)});
    try {
      if(!await member(client,teamId,draft.channelId,userId)) throw new Error("Slack channel authorization denied");
      const envelope=await buildBrief({
        text,teamId,userId,channelId:draft.channelId,sourceTs:draft.sourceTs,
        threadTs:draft.threadTs,grantRef:"slack-pilot:"+draft.id,
        now:now(),modelSummarizer,
        sourceUrl:extractApprovedSourceLink(draft.selectedText)
      });
      await store.ready(draft,envelope);
      await client.views.update({view_id:view.id,view:reviewView(draft)});
    }catch {
      try{await store.failDraft(draft);}catch{/* database failure; do not post */}
      report(logger,"create preview");
      try{await client.views.update({view_id:view.id,view:finishedView("Unable to prepare a preview. No Slack message was posted.")});}catch{/* modal closed */}
    }
  });

  app.view("h2h_publish",async({ack,body,view,client})=>{
    const {teamId,userId}=context(body);
    const draft=await store.get(modalDraftId(view),teamId,userId);
    let hash;
    try{hash=JSON.parse(view.private_metadata).hash;}catch{/* invalid metadata */}
    if(!draft||!draft.envelope||!hash||!await store.beginPublish(draft,hash)) {
      await ack({response_action:"update",view:finishedView("Draft was published, expired or modified. No second post was made.")});
      return;
    }
    await ack({response_action:"update",view:busyView(draft,"Checking channel access and publishing your approved brief…")});
    try {
      if(!await member(client,teamId,draft.channelId,userId)) {
        await store.markAmbiguous(draft);
        await client.views.update({view_id:view.id,view:finishedView("Slack access denied. Nothing was sent.")});
        return;
      }
      const blocks=renderSlackPreview(draft.envelope,{verifiedChannelAuthorization:true});
      blocks[1].elements.push({
        type:"button",text:{type:"plain_text",text:"Retract"},
        action_id:"h2h_retract",value:draft.envelope.message_id
      });
      const posted=await client.chat.postMessage({
        channel:draft.channelId,thread_ts:draft.threadTs,
        text:"H2H Brief: "+draft.envelope.artifact.summary.slice(0,900),
        blocks,unfurl_links:false,unfurl_media:false
      });
      if(posted?.ok===false||!posted?.ts) throw new Error("Slack did not confirm post");
      await store.markPublished(draft,posted.ts);
      await client.views.update({view_id:view.id,view:finishedView("Published to your Slack thread. Other participants may interpret the brief privately.")});
    }catch {
      // The API might have accepted the post before connection failed. Never
      // retry automatically; a duplicate would be worse than an uncertain post.
      try{await store.markAmbiguous(draft);}catch{/* store might be unavailable; never auto-retry */}
      report(logger,"publish ambiguous");
      try{await client.views.update({view_id:view.id,view:finishedView("Posting result uncertain. Check your Slack thread before starting again. No automatic retry.")});}catch{/* modal closed */}
    }
  });

  const handlePrivateHandoff=async({ack,action,body,client})=>{
    await ack();
    const {teamId,userId}=context(body);
    const p=await store.getPublished(action?.value);
    const channelId=body?.channel?.id;
    if(!p||!userId||p.teamId!==teamId||p.channelId!==channelId||
      !await member(client,teamId,p.channelId,userId)) {
      if(body?.trigger_id) {
        try{await client.views.open({trigger_id:body.trigger_id,view:finishedView("Brief expired, retracted, or you no longer have access.")});}catch{/*no access*/}
      }
      return;
    }
    const decision=await authorizeOperation(p.envelope,{
      operation:"read",principalId:userId,
      verifyGrant:async ({grantRef})=>grantRef===p.grantRef&&Boolean(await store.getPublished(p.messageId)),
      verifyAudience:({audience})=>audience.kind==="channel"&&audience.ids.length===1&&audience.ids[0]===p.channelId,
      verifySourceAccess:({sources})=>sources.some(s=>s.id==="submitted"&&s.coverage==="partial"&&s.supplied_by==="human")
    });
    try{
      await client.views.open({trigger_id:body.trigger_id,
        view:decision.allowed?privateHandoffView(p.envelope):finishedView("Brief access denied.")});
    }catch{report(logger,"open private handoff");}
  };
  app.action("h2h_personal_interpretation",handlePrivateHandoff);
  app.action("h2h_copy_handoff",handlePrivateHandoff);

  app.action("h2h_retract",async({ack,action,body,client})=>{
    await ack();
    const {teamId,userId}=context(body);
    const p=await store.getPublished(action?.value);
    if(!p||p.userId!==userId||p.teamId!==teamId||p.channelId!==body?.channel?.id||
      !await member(client,teamId,p.channelId,userId)) {
      if(body?.channel?.id&&userId) await publicMessage(client,body.channel.id,userId,"Only the original author may retract an accessible H2H brief.");
      return;
    }
    // Revocation blocks future in-process lookups even if the Slack update fails.
    await store.revoke(p.messageId,teamId,userId);
    try {
      await client.chat.update({channel:p.channelId,ts:p.postTs,
        text:"H2H brief retracted by its author.",blocks:revokedBlocks()});
      await publicMessage(client,p.channelId,userId,"Retracted. Previously copied content may still exist.");
    }catch {
      report(logger,"retract Slack message");
      await publicMessage(client,p.channelId,userId,"Future H2H handoffs revoked, but Slack could not update the original post. Contact an admin.");
    }
  });
}
