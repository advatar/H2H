// Ephemeral single-process store for an opt-in Slack pilot. Not durable authorization.
import {randomUUID} from "node:crypto";
import {assertEnvelope,artifactSha256} from "../protocol.js";

export class PilotStore {
  #drafts=new Map();
  #byShortcut=new Map();
  #published=new Map();
  constructor({now=()=>Date.now(),draftTtlMs=15*60*1000,publishedTtlMs=24*60*60*1000}={}) {
    this.now=now;this.draftTtlMs=draftTtlMs;this.publishedTtlMs=publishedTtlMs;
  }
  #purge() {
    const time=this.now();
    for(const [id,d] of this.#drafts) if(d.expiresAt<=time){
      this.#drafts.delete(id);this.#byShortcut.delete(d.shortcutKey);
    }
    for(const [id,p] of this.#published) if(p.expiresAt<=time) this.#published.delete(id);
  }
  open({teamId,userId,channelId,sourceTs,threadTs,selectedText=""}) {
    this.#purge();
    if([teamId,userId,channelId,sourceTs,threadTs].some(x=>typeof x!=="string"||!x)) throw new TypeError("Slack identifiers required");
    const shortcutKey=[teamId,userId,channelId,sourceTs].join("|");
    const existingId=this.#byShortcut.get(shortcutKey);
    if(existingId && this.#drafts.has(existingId)) return this.#drafts.get(existingId);
    const draft={
      id:randomUUID(),shortcutKey,teamId,userId,channelId,sourceTs,threadTs,
      selectedText:String(selectedText).slice(0,50000),sourceText:null,
      status:"compose",envelope:null,artifactHash:null,consentAt:null,postedTs:null,
      expiresAt:this.now()+this.draftTtlMs
    };
    this.#drafts.set(draft.id,draft);
    this.#byShortcut.set(shortcutKey,draft.id);
    return draft;
  }
  get(id,teamId,userId) {
    this.#purge();
    const d=this.#drafts.get(id);
    return d&&d.teamId===teamId&&d.userId===userId?d:null;
  }
  startProcessing(d,{text,consent}) {
    if(d.status!=="compose"||consent!==true) throw new Error("consent or state invalid");
    d.status="processing";d.sourceText=text;d.consentAt=this.now();
  }
  ready(d,envelope) {
    if(d.status!=="processing") throw new Error("not processing");
    assertEnvelope(envelope);
    if(envelope.sender.human_id!==d.userId||envelope.audience.ids[0]!==d.channelId) throw new Error("envelope audience mismatch");
    d.envelope=envelope;d.artifactHash=artifactSha256(envelope.artifact);d.status="ready";
  }
  beginPublish(d,hash) {
    if(d.status!=="ready"||d.artifactHash!==hash||this.now()>=d.expiresAt) return false;
    d.status="publishing";return true;
  }
  markPublished(d,postTs) {
    if(d.status!=="publishing"||typeof postTs!=="string"||!postTs) throw new Error("invalid post receipt");
    d.status="published";d.postedTs=postTs;
    const p={
      messageId:d.envelope.message_id,teamId:d.teamId,userId:d.userId,
      channelId:d.channelId,postTs,threadTs:d.threadTs,
      envelope:d.envelope,grantRef:d.envelope.policy.grant_ref,
      expiresAt:Math.min(this.now()+this.publishedTtlMs,Date.parse(d.envelope.policy.expires_at)),
      revoked:false
    };
    d.sourceText=null;d.selectedText="";
    this.#published.set(p.messageId,p);
    return p;
  }
  markAmbiguous(d) {
    if(d.status==="publishing") d.status="uncertain";
    d.sourceText=null;d.selectedText="";
  }
  failDraft(d) {
    if(d.status==="processing"){d.status="failed";d.sourceText=null;d.selectedText="";}
  }
  getPublished(messageId) {
    this.#purge();
    const p=this.#published.get(messageId);
    return p&&!p.revoked?p:null;
  }
  revoke(messageId,teamId,userId) {
    const p=this.getPublished(messageId);
    if(!p||p.teamId!==teamId||p.userId!==userId) return null;
    p.revoked=true;return p;
  }
}
