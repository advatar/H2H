// PostgreSQL-backed pilot state, using atomic status transitions and encrypted records.
// Reads and writes are scoped to one allowlisted Slack workspace. No personal AI memory.
import {randomUUID} from "node:crypto";
import {assertEnvelope,artifactSha256} from "../protocol.js";

const aad=(table,team,id)=>["h2h",table,team,id].join(":");
function positiveText(value){return typeof value==="string"&&value.length>0;}
export class PostgresPilotStore {
  constructor({pool,cipher,now=()=>Date.now(),draftTtlMs=15*60*1000,publishedTtlMs=24*60*60*1000}={}) {
    if(!pool||!cipher)throw new TypeError("Postgres pool and cipher required");
    this.pool=pool;this.cipher=cipher;this.now=now;
    this.draftTtlMs=draftTtlMs;this.publishedTtlMs=publishedTtlMs;
  }
  #readDraft(row) {
    if(!row)return null;
    const d={
      id:row.id,shortcutKey:row.shortcut_key,teamId:row.team_id,userId:row.user_id,
      channelId:row.channel_id,sourceTs:row.source_ts,threadTs:row.thread_ts,
      selectedText:row.selected_cipher?this.cipher.decrypt(row.selected_cipher,aad("draft",row.team_id,row.id)):"",
      sourceText:null,status:row.status,artifactHash:row.artifact_hash,
      consentAt:row.consent_at?new Date(row.consent_at).getTime():null,
      postedTs:row.post_ts,
      expiresAt:new Date(row.expires_at).getTime(),
      envelope:row.envelope_cipher?this.cipher.decrypt(row.envelope_cipher,aad("draft-envelope",row.team_id,row.id)):null
    };
    return d;
  }
  async open({teamId,userId,channelId,sourceTs,threadTs,selectedText=""}) {
    if([teamId,userId,channelId,sourceTs,threadTs].some(x=>!positiveText(x)))throw new TypeError("Slack identifiers required");
    const shortcutKey=[teamId,userId,channelId,sourceTs].join("|");
    const id=randomUUID();
    const expiresAt=new Date(this.now()+this.draftTtlMs);
    const selectedCipher=this.cipher.encrypt(String(selectedText).slice(0,50000),aad("draft",teamId,id));
    let result=await this.pool.query(
      "INSERT INTO h2h_drafts (id,shortcut_key,team_id,user_id,channel_id,source_ts,thread_ts,selected_cipher,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (shortcut_key) DO NOTHING RETURNING *",
      [id,shortcutKey,teamId,userId,channelId,sourceTs,threadTs,selectedCipher,expiresAt]);
    if(!result.rows.length){
      result=await this.pool.query("SELECT * FROM h2h_drafts WHERE shortcut_key=$1",[shortcutKey]);
      if(!result.rows.length)throw new Error("Concurrent draft creation; retry shortcut");
      if(new Date(result.rows[0].expires_at).getTime()<=this.now()) {
        await this.pool.query("DELETE FROM h2h_drafts WHERE shortcut_key=$1 AND expires_at<=now()",[shortcutKey]);
        return this.open({teamId,userId,channelId,sourceTs,threadTs,selectedText});
      }
    }
    return this.#readDraft(result.rows[0]);
  }
  async get(id,teamId,userId){
    if(!positiveText(id)||!positiveText(teamId)||!positiveText(userId))return null;
    const r=await this.pool.query(
      "SELECT * FROM h2h_drafts WHERE id=$1 AND team_id=$2 AND user_id=$3 AND expires_at>now()",
      [id,teamId,userId]);
    return this.#readDraft(r.rows[0]);
  }
  async startProcessing(d,{text,consent}){
    if(d.status!=="compose"||consent!==true||!positiveText(text))throw new Error("consent or state invalid");
    const r=await this.pool.query(
      "UPDATE h2h_drafts SET status='processing',consent_at=now(),selected_cipher=NULL WHERE id=$1 AND team_id=$2 AND user_id=$3 AND status='compose' AND expires_at>now() RETURNING consent_at",
      [d.id,d.teamId,d.userId]);
    if(r.rowCount!==1)throw new Error("Draft changed or expired");
    d.status="processing";d.consentAt=new Date(r.rows[0].consent_at).getTime();
    d.selectedText="";d.sourceText=text; // process memory only, never persisted
  }
  async ready(d,envelope){
    if(d.status!=="processing")throw new Error("Draft not processing");
    assertEnvelope(envelope);
    if(envelope.sender.human_id!==d.userId||envelope.audience.ids[0]!==d.channelId)throw new Error("Envelope recipient differs");
    const hash=artifactSha256(envelope.artifact);
    const cipher=this.cipher.encrypt(envelope,aad("draft-envelope",d.teamId,d.id));
    const r=await this.pool.query(
      "UPDATE h2h_drafts SET status='ready',envelope_cipher=$1,artifact_hash=$2 WHERE id=$3 AND team_id=$4 AND user_id=$5 AND status='processing' AND consent_at IS NOT NULL AND expires_at>now()",
      [cipher,hash,d.id,d.teamId,d.userId]);
    if(r.rowCount!==1)throw new Error("Draft changed/expired");
    d.envelope=envelope;d.artifactHash=hash;d.status="ready";d.sourceText=null;
  }
  async beginPublish(d,hash){
    if(d.status!=="ready"||d.artifactHash!==hash||this.now()>=d.expiresAt)return false;
    const r=await this.pool.query(
      "UPDATE h2h_drafts SET status='publishing' WHERE id=$1 AND team_id=$2 AND user_id=$3 AND status='ready' AND artifact_hash=$4 AND consent_at IS NOT NULL AND expires_at>now()",
      [d.id,d.teamId,d.userId,hash]);
    if(r.rowCount!==1)return false;
    d.status="publishing";return true;
  }
  async markPublished(d,postTs){
    if(d.status!=="publishing"||!positiveText(postTs)||!d.envelope)throw new Error("publish receipt invalid");
    const e=d.envelope;
    const cipher=this.cipher.encrypt(e,aad("brief",d.teamId,e.message_id));
    const expireAt=new Date(Math.min(this.now()+this.publishedTtlMs,Date.parse(e.policy.expires_at)));
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const transition=await client.query(
        "UPDATE h2h_drafts SET status='published',post_ts=$1,selected_cipher=NULL WHERE id=$2 AND team_id=$3 AND user_id=$4 AND status='publishing' AND consent_at IS NOT NULL RETURNING consent_at",
        [postTs,d.id,d.teamId,d.userId]);
      if(transition.rowCount!==1)throw new Error("Publish transition conflict");
      await client.query(
        "INSERT INTO h2h_briefs(message_id,team_id,author_user_id,channel_id,thread_ts,post_ts,envelope_cipher,grant_ref,consent_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [e.message_id,d.teamId,d.userId,d.channelId,d.threadTs,postTs,cipher,e.policy.grant_ref,transition.rows[0].consent_at,expireAt]);
      await client.query(
        "INSERT INTO h2h_audit(team_id,actor_id,action,message_id) VALUES ($1,$2,'published',$3)",
        [d.teamId,d.userId,e.message_id]);
      await client.query("COMMIT");
    }catch(err){await client.query("ROLLBACK");throw err;}
    finally{client.release();}
    d.status="published";d.postedTs=postTs;d.selectedText="";d.sourceText=null;
    return this.getPublished(e.message_id);
  }
  async markAmbiguous(d){
    await this.pool.query(
      "UPDATE h2h_drafts SET status='uncertain',selected_cipher=NULL WHERE id=$1 AND team_id=$2 AND status='publishing'",
      [d.id,d.teamId]);
    d.status="uncertain";d.selectedText="";d.sourceText=null;
  }
  async failDraft(d){
    await this.pool.query(
      "UPDATE h2h_drafts SET status='failed',selected_cipher=NULL WHERE id=$1 AND team_id=$2 AND status='processing'",
      [d.id,d.teamId]);
    d.status="failed";d.selectedText="";d.sourceText=null;
  }
  async getPublished(id){
    if(!positiveText(id))return null;
    const r=await this.pool.query(
      "SELECT * FROM h2h_briefs WHERE message_id=$1 AND revoked_at IS NULL AND expires_at>now()",[id]);
    const row=r.rows[0];if(!row)return null;
    const envelope=this.cipher.decrypt(row.envelope_cipher,aad("brief",row.team_id,row.message_id));
    assertEnvelope(envelope);
    return {messageId:row.message_id,teamId:row.team_id,userId:row.author_user_id,
      channelId:row.channel_id,threadTs:row.thread_ts,postTs:row.post_ts,
      grantRef:row.grant_ref,envelope,consentAt:new Date(row.consent_at).getTime(),
      expiresAt:new Date(row.expires_at).getTime(),revoked:false};
  }
  async revoke(id,teamId,userId){
    const r=await this.pool.query(
      "UPDATE h2h_briefs SET revoked_at=now() WHERE message_id=$1 AND team_id=$2 AND author_user_id=$3 AND revoked_at IS NULL AND expires_at>now() RETURNING *",
      [id,teamId,userId]);
    if(r.rowCount!==1)return null;
    await this.pool.query(
      "INSERT INTO h2h_audit(team_id,actor_id,action,message_id) VALUES ($1,$2,'revoked',$3)",
      [teamId,userId,id]);
    const row=r.rows[0];
    return {messageId:id,teamId,userId,channelId:row.channel_id,
      postTs:row.post_ts,threadTs:row.thread_ts,revoked:true};
  }
  async getPrincipalLink(issuer,subject){
    if(!positiveText(issuer)||!positiveText(subject))return null;
    const r=await this.pool.query("SELECT team_id,slack_user_id FROM h2h_principals WHERE issuer=$1 AND subject=$2",[issuer,subject]);
    return r.rows[0]?{teamId:r.rows[0].team_id,slackUserId:r.rows[0].slack_user_id}:null;
  }
  // ADMIN-ONLY. Caller MUST separately verify the OAuth human and Slack account.
  async provisionPrincipal({issuer,subject,teamId,slackUserId}){
    if([issuer,subject,teamId,slackUserId].some(x=>!positiveText(x)))throw new TypeError("Explicit principal binding required");
    if(!/^T[A-Z0-9]+$/.test(teamId)||!/^[UW][A-Z0-9]+$/.test(slackUserId))throw new Error("Invalid Slack binding");
    await this.pool.query(
      "INSERT INTO h2h_principals(issuer,subject,team_id,slack_user_id) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET team_id=EXCLUDED.team_id,slack_user_id=EXCLUDED.slack_user_id",
      [issuer,subject,teamId,slackUserId]);
    await this.pool.query("INSERT INTO h2h_audit(team_id,actor_id,action) VALUES($1,'operator','principal_linked')",[teamId]);
  }
}
