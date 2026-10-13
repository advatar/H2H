import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {validateEnvelope,assertEnvelope,authorizeOperation,artifactSha256,H2H_EXTENSION_URI} from "../src/protocol.js";
import {toA2AMessage,fromA2AMessage} from "../src/a2a.js";
import {renderSlackPreview} from "../src/slack-preview.js";
import {personalInterpretationPrompt} from "../src/personal.js";

const read = async name => JSON.parse(await readFile(new URL("../examples/"+name+".json",import.meta.url),"utf-8"));
const fresh = x => structuredClone(x);
const auth = {verifyGrant:async()=>true,verifyAudience:async()=>true,verifySourceAccess:async()=>true,principalId:"demo:bob"};
test("fixture briefs and private proposal pass reference checks",async()=>{
  assert.equal(validateEnvelope(await read("brief")).valid,true);
  assert.equal(validateEnvelope(await read("reply-proposal")).valid,true);
});
test("schema is parseable, versioned and requires authorization reference",async()=>{
  const schema=JSON.parse(await readFile(new URL("../schema/h2h-envelope.schema.json",import.meta.url),"utf-8"));
  assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.protocol.const,"h2h/0.1");
  assert(schema.properties.policy.required.includes("grant_ref"));
});
test("link only never becomes source-backed evidence",async()=>{
  const e=fresh(await read("brief"));e.artifact.sources[0].coverage="link_only";
  const v=validateEnvelope(e);assert.equal(v.valid,false);assert(v.errors.some(x=>x.includes("link-only")));
});
test("no invented source IDs or duplicate IDs",async()=>{
  const e=fresh(await read("brief"));e.artifact.claims[0].evidence_refs=["missing"];
  assert.equal(validateEnvelope(e).valid,false);
  e.artifact.claims[0].evidence_refs=["s1"];e.artifact.sources.push({...e.artifact.sources[0]});
  assert.equal(validateEnvelope(e).valid,false);
});
test("human receipt cannot be invented by agent",async()=>{
  const e=fresh(await read("brief"));e.kind="receipt";delete e.artifact;
  e.receipt={target_message_id:"a",stage:"seen_by_human",at:e.sent_at,actor_id:"agent:bob"};
  assert.equal(validateEnvelope(e).valid,false);
  e.receipt.human_confirmed=true;
  assert.equal(validateEnvelope(e).valid,true); // still requires authenticated UI proof, not enforced by schema alone
});
test("reply proposal needs relation; deny directly posting direct audience to channel",async()=>{
  const e=fresh(await read("reply-proposal"));delete e.relation;
  assert.equal(validateEnvelope(e).valid,false);
  const a=fresh(await read("brief"));a.policy.classification="direct";
  assert.equal(validateEnvelope(a).valid,false);
});
test("A2A v1.x message wrapping is a data part, not old kind discriminator",async()=>{
  const e=await read("brief"),a=toA2AMessage(e);
  assert.equal(a.role,"ROLE_USER");
  assert(a.extensions.includes(H2H_EXTENSION_URI));
  assert.deepEqual(a.parts,[{data:e}]);
  assert.deepEqual(fromA2AMessage(a),e);
  const bad=fresh(a);bad.messageId="other";
  assert.throws(()=>fromA2AMessage(bad));
});
test("Slack channel preview requires explicit verified authorization",async()=>{
  const e=await read("brief");
  assert.throws(()=>renderSlackPreview(e));
  const blocks=renderSlackPreview(e,{verifiedChannelAuthorization:true});
  assert.equal(blocks[1].elements[0].action_id,"h2h_personal_interpretation");
  assert(blocks[1].elements[0].agent_prompt.includes("untrusted external data"));
  assert(blocks[1].elements[0].agent_prompt.length<=4000);
  const proposal=await read("reply-proposal");
  assert.throws(()=>renderSlackPreview(proposal,{verifiedChannelAuthorization:true}));
});
test("Slack preview encodes user-supplied markup and limits content",async()=>{
  const e=fresh(await read("brief"));e.artifact.summary="<@U123> & <script>";
  const blocks=renderSlackPreview(e,{verifiedChannelAuthorization:true});
  assert(blocks[0].text.text.includes("&lt;@U123&gt; &amp; &lt;script&gt;"));
  assert(!blocks[0].text.text.includes("<script>"));
  assert(personalInterpretationPrompt(e).length<4000);
});
test("missing authority callbacks, failed source rights and expiry fail closed",async()=>{
  const e=await read("brief");
  assert.deepEqual((await authorizeOperation(e,{operation:"read",principalId:"demo:bob"})).allowed,false);
  assert.equal((await authorizeOperation(e,{...auth,operation:"read",verifySourceAccess:()=>false})).reason,"SOURCE_ACCESS_DENIED");
  assert.equal((await authorizeOperation(e,{...auth,operation:"read",now:new Date("2099-01-01T00:00:00Z")})).reason,"EXPIRED");
  assert.equal((await authorizeOperation(e,{...auth,operation:"read",revokedIds:new Set([e.message_id])})).reason,"REVOKED");
  assert.equal((await authorizeOperation(e,{...auth,operation:"read"})).allowed,true);
});
test("forward is denied and reply publication requires human-approved exact revision",async()=>{
  const e=fresh(await read("brief"));e.policy.forwarding="human_approval";e.policy.permitted_operations.push("forward");
  const base={...auth,operation:"forward"};
  assert.equal((await authorizeOperation(e,base)).reason,"APPROVAL_REQUIRED");
  assert.equal((await authorizeOperation(e,{...base,humanApproval:{destination:"slack:channel:DEMO",artifact_sha256:"bad"},verifyHumanApproval:()=>true})).reason,"APPROVAL_REQUIRED");
  const approval={destination:"slack:channel:DEMO",artifact_sha256:artifactSha256(e.artifact)};
  assert.equal((await authorizeOperation(e,{...base,humanApproval:approval,verifyHumanApproval:()=>false})).reason,"APPROVAL_DENIED");
  assert.equal((await authorizeOperation(e,{...base,humanApproval:approval,verifyHumanApproval:()=>true})).allowed,true);
  const deny=fresh(e);deny.policy.forwarding="deny";
  assert.equal(validateEnvelope(deny).valid,false); // scope and deny are contradictory
});
test("unknown versions and unsupported extra fields fail validation",async()=>{
  const e=fresh(await read("brief"));e.protocol="h2h/99";e.secret="never";
  const result=validateEnvelope(e);
  assert.equal(result.valid,false);
  assert(result.errors.some(x=>x.includes("unsupported")));
});
