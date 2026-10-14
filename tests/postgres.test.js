import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {EnvelopeCipher} from "../src/storage/cipher.js";
import {PostgresPilotStore} from "../src/storage/postgres.js";
import {buildBrief} from "../src/slack/summarize.js";

test("Postgres: encrypted drafts, transaction-safe publish, identity link, revoke and redacted audit",
 {skip:!process.env.DATABASE_URL},async()=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
  try{
    const sql=await readFile(new URL("../sql/001_init.sql",import.meta.url),"utf8");
    await pool.query(sql);
    await pool.query("TRUNCATE h2h_audit,h2h_principals,h2h_briefs,h2h_drafts RESTART IDENTITY CASCADE");
    const key=randomBytes(32);
    const store=new PostgresPilotStore({pool,cipher:new EnvelopeCipher(key)});
    const input={teamId:"TTEST1",userId:"UALICE1",channelId:"CCHAN1",
      sourceTs:"101.123",threadTs:"101.123",selectedText:"Fake author message text that is definitely longer than 60 characters for a user."};
    const draft=await store.open(input);
    const draftDuplicate=await store.open(input);
    assert.equal(draft.id,draftDuplicate.id);
    const row=await pool.query("SELECT selected_cipher FROM h2h_drafts WHERE id=$1",[draft.id]);
    assert(!row.rows[0].selected_cipher.includes(input.selectedText),"plaintext source must not be in Postgres");
    const otherTenant=await store.get(draft.id,"TBAD","UALICE1");
    assert.equal(otherTenant,null);
    const text="A proposed architecture allows private agents to interpret the same shared brief. The proposal is only a hypothesis and has not been validated independently.";
    await store.startProcessing(draft,{text,consent:true});
    const env=await buildBrief({
      text,teamId:input.teamId,userId:input.userId,channelId:input.channelId,
      sourceTs:input.sourceTs,threadTs:input.threadTs,grantRef:"test:"+draft.id
    });
    await store.ready(draft,env);
    const separatelyLoaded=await store.get(draft.id,input.teamId,input.userId);
    assert.equal(separatelyLoaded.envelope.message_id,env.message_id);
    assert.equal(await store.beginPublish(draft,draft.artifactHash),true);
    assert.equal(await store.beginPublish(separatelyLoaded,separatelyLoaded.artifactHash),false);
    const published=await store.markPublished(draft,"102.333");
    assert.equal(published.envelope.message_id,env.message_id);
    const stored=await pool.query("SELECT envelope_cipher FROM h2h_briefs WHERE message_id=$1",[env.message_id]);
    assert(!stored.rows[0].envelope_cipher.includes(env.artifact.summary));
    const thirdStore=new PostgresPilotStore({pool,cipher:new EnvelopeCipher(key)});
    assert((await thirdStore.getPublished(env.message_id)).envelope.artifact.summary);
    await thirdStore.provisionPrincipal({
      issuer:"https://issuer.example",subject:"bob",teamId:"TTEST1",slackUserId:"UBOB123"
    });
    assert.deepEqual(await thirdStore.getPrincipalLink("https://issuer.example","bob"),
      {teamId:"TTEST1",slackUserId:"UBOB123"});
    assert.equal(await store.revoke(env.message_id,"TTEST1","UBOB123"),null);
    assert(await store.getPublished(env.message_id));
    assert(await thirdStore.revoke(env.message_id,"TTEST1","UALICE1"));
    assert.equal(await store.getPublished(env.message_id),null);
    const audit=await pool.query("SELECT action,detail FROM h2h_audit ORDER BY id");
    assert.deepEqual(audit.rows.map(x=>x.action),["published","principal_linked","revoked"]);
    assert(audit.rows.every(x=>x.detail===null));
  }finally{await pool.end();}
});
