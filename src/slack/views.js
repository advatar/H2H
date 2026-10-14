// Slack Block Kit UI factory. Only text the author confirms is eventually public.
import {personalInterpretationPrompt} from "../personal.js";

const plain=text=>({type:"plain_text",text:String(text).slice(0,2900)});
const safe=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const section=text=>({type:"section",text:{type:"mrkdwn",text:safe(text).slice(0,2900)}});
const metadata=id=>JSON.stringify({draft_id:id});

export function composeView(draft,{aiConfigured=false}={}) {
  const selected=draft.selectedText||"";
  const initial=selected.length<=3000?selected:undefined;
  const hint=selected.length>3000?
    "Selected message has "+selected.length+" characters. Leave the field empty to summarize the selected message in full (up to 50,000 characters).":
    "Paste actual content, not just a Claude/ChatGPT link. A link is not a readable transcript.";
  const input={type:"plain_text_input",action_id:"text",multiline:true,max_length:3000,
    placeholder:plain("Paste conversation text, or keep the selected Slack message.")};
  if(initial) input.initial_value=initial;
  return {
    type:"modal",callback_id:"h2h_compose",private_metadata:metadata(draft.id),
    title:plain("H2H Brief"),submit:plain("Create preview"),close:plain("Cancel"),
    blocks:[
      section("Create a short H2H brief in this public Slack channel. It will NOT be posted until you review and approve the summary."),
      {type:"input",block_id:"source",optional:true,label:plain("Conversation text / excerpt"),
        hint:plain(hint),element:input},
      {type:"input",block_id:"rights",optional:false,label:plain("Permission and disclosure"),
        element:{type:"checkboxes",action_id:"confirm",options:[{
          text:plain(aiConfigured?
            "I can share this content with this channel and consent to processing by the configured AI provider.":
            "I can share this content with this channel and consent to H2H creating an extractive preview."),
          value:"approved"
        }]}}
    ]
  };
}
export function busyView(draft,text="Preparing your private preview…") {
  return {type:"modal",callback_id:"h2h_busy",private_metadata:metadata(draft.id),
    title:plain("H2H Brief"),close:plain("Close"),
    blocks:[section(text)]};
}
export function reviewView(draft) {
  const e=draft.envelope;
  const summary=e.artifact.summary;
  const claims=(e.artifact.claims??[]).slice(0,3).map(c=>c.text+" ["+c.basis+"]").join("\n• ");
  const problems=e.artifact.limitations.slice(0,3).join("\n");
  return {
    type:"modal",callback_id:"h2h_publish",
    private_metadata:JSON.stringify({draft_id:draft.id,hash:draft.artifactHash}),
    title:plain("Review H2H Brief"),submit:plain("Publish"),close:plain("Cancel"),
    blocks:[
      section("*Visible to the entire selected Slack channel* after you click Publish. Personal AI assessments are not posted."),
      section("*TL;DR*\n"+summary),
      ...(claims?[section("*Extracted claims*\n• "+claims)]:[]),
      section("*Evidence limitations*\n"+problems),
      section("This is an author-approved briefing. It does not certify the claims or fetch external conversation links.")
    ]
  };
}
export function finishedView(message) {
  return {type:"modal",callback_id:"h2h_finished",title:plain("H2H Brief"),
    close:plain("Close"),blocks:[section(message)]};
}
export function privateHandoffView(envelope) {
  const prompt=personalInterpretationPrompt(envelope);
  const chunks=prompt.match(/[\s\S]{1,1700}/g)||[];
  return {type:"modal",callback_id:"h2h_private_handoff",
    title:plain("Ask Your AI"),close:plain("Close"),
    blocks:[
      section("Slackbot AI was not available for this click. Copy the text below into your own AI chat. H2H will NOT post your interpretation."),
      ...chunks.map(c=>section(c))
    ]};
}
export function revokedBlocks(){
  return [section("*H2H brief retracted by its author.* Please do not rely on the earlier preview. Previously copied content cannot be erased.")];
}
export function readModalInput(view) {
  const values=view?.state?.values||{};
  const text=values.source?.text?.value??"";
  const options=values.rights?.confirm?.selected_options??[];
  const approved=Array.isArray(options)&&options.some(x=>x?.value==="approved");
  return {text,approved};
}
export function modalDraftId(view) {
  try{
    const value=JSON.parse(view.private_metadata);
    return typeof value.draft_id==="string"?value.draft_id:null;
  }catch{return null;}
}
