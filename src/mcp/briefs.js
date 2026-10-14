// Authorized read views for recipient-owned AI clients; never access personal memory.
import {authorizeOperation} from "../protocol.js";
import {verifyPublicChannelMember} from "../slack/access.js";
import {personalInterpretationPrompt} from "../personal.js";

export async function getAuthorizedBrief({store,slackClient,config,issuer,subject,messageId,now=new Date()}){
  if(!issuer||!subject||typeof messageId!=="string"||messageId.length>200||messageId.length<1)return null;
  const mapping=await store.getPrincipalLink(issuer,subject);
  if(!mapping||mapping.teamId!==config.teamId)return null;
  const published=await store.getPublished(messageId);
  if(!published||published.teamId!==mapping.teamId||!config.allowedChannels.has(published.channelId))return null;
  if(!await verifyPublicChannelMember(slackClient,{
    teamId:published.teamId,channelId:published.channelId,userId:mapping.slackUserId,config
  }))return null;
  const envelope=published.envelope;
  const verdict=await authorizeOperation(envelope,{
    operation:"read",principalId:mapping.slackUserId,now,
    verifyGrant:async ({grantRef})=>{
      const current=await store.getPublished(messageId);
      return !!current&&current.grantRef===grantRef&&Number.isFinite(current.consentAt)&&current.consentAt>0;
    },
    verifyAudience:({audience})=>audience.kind==="channel"&&audience.ids.length===1&&audience.ids[0]===published.channelId,
    // Only author-submitted material was shared. This verifies recorded submission
    // permission, NOT authenticity or full rights to inaccessible original links.
    verifySourceAccess:({sources})=>Array.isArray(sources)&&
      sources.some(s=>s.provider==="author-submitted-text"&&s.supplied_by==="human"&&s.coverage==="partial")&&
      sources.every(s=>s.coverage==="partial"||s.coverage==="link_only")
  });
  return verdict.allowed?envelope:null;
}
export function recipientView(envelope){
  if(!envelope||envelope.kind!=="brief")throw new TypeError("Authorized H2H brief required");
  const {message_id,thread_id,intent,artifact,sent_at}=envelope;
  return {protocol:envelope.protocol,message_id,thread_id,sent_at,
    sender_intent:intent,artifact:{
      summary:artifact.summary,claims:artifact.claims??[],questions:artifact.questions??[],
      limitations:artifact.limitations??[],sources:artifact.sources
    }};
}
export function recipientPrivatePrompt(envelope){
  return personalInterpretationPrompt(envelope);
}
