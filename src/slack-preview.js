// Pure Slack Block Kit renderer; callers must verify ACLs BEFORE calling.
import { assertEnvelope } from "./protocol.js";
import { personalInterpretationPrompt } from "./personal.js";

const escape = value => String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const trim = (text,max) => text.length>max ? text.slice(0,max-1)+"…" : text;
function validSourceUrl(uri) {
  try {
    const u=new URL(uri);
    return u.protocol === "https:" && !/[|<>]/.test(uri);
  } catch { return false; }
}
export function renderSlackPreview(envelope, {verifiedChannelAuthorization=false}={}) {
  assertEnvelope(envelope);
  if (envelope.kind !== "brief" || envelope.audience.kind !== "channel") throw new TypeError("only channel briefs can be previewed in a Slack channel");
  if (verifiedChannelAuthorization !== true) throw new Error("verified channel publication authorization required");
  const a=envelope.artifact;
  const coverage=a.sources.length && a.sources.every(s=>s.coverage==="full") ? "submitted/authorized source content" :
    a.sources.some(s=>s.coverage==="partial") ? "partial source coverage" : "source not fully available";
  const intro=trim(escape(a.summary),900);
  const claims=(a.claims ?? []).slice(0,3).map(c=>escape(c.text)+" ("+escape(c.basis)+")").join("\n• ");
  const source=a.sources.find(s=>validSourceUrl(s.uri));
  const parts=[
    "*TL;DR:* "+intro,
    claims ? "*Key claims:*\n• "+trim(claims,800) : "",
    "*Evidence coverage:* "+coverage,
    a.limitations?.length ? "*Caveat:* "+trim(escape(a.limitations[0]),250) : "",
    source ? "<"+source.uri+"|Original shared source>" : ""
  ].filter(Boolean);
  return [
    {type:"section",text:{type:"mrkdwn",text:trim(parts.join("\n\n"),2900)}},
    {type:"actions",elements:[
      {type:"button",text:{type:"plain_text",text:"Ask my AI"},action_id:"h2h_personal_interpretation",value:envelope.message_id,agent_prompt:personalInterpretationPrompt(envelope),agent_prompt_display:"Interpret this H2H brief for me"},
      {type:"button",text:{type:"plain_text",text:"Use Claude / ChatGPT"},action_id:"h2h_copy_handoff",value:envelope.message_id}
    ]}
  ];
}
