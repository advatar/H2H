import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {validateEnvelope} from "../src/protocol.js";

const load=async p=>JSON.parse(await readFile(new URL("../"+p,import.meta.url),"utf-8"));
const ajv=new Ajv2020({allErrors:true,strict:false});
addFormats(ajv);
const schema=await load("schema/h2h-envelope.schema.json");
const validate=ajv.compile(schema);
const brief=await load("examples/brief.json");
const proposal=await load("examples/reply-proposal.json");
const modified=changes=>({...structuredClone(brief),...changes});
test("published examples satisfy actual JSON Schema and semantic validation",()=>{
  for(const obj of [brief,proposal]) {
    assert.equal(validate(obj),true,JSON.stringify(validate.errors));
    assert.equal(validateEnvelope(obj).valid,true);
  }
});
test("schema fails unknown version and foreign fields",()=>{
  assert.equal(validate(modified({protocol:"h2h/98"})),false);
  assert.equal(validate(modified({unknown:"value"})),false);
});
test("schema requires grant and audience and rejects duplicate audience ids",()=>{
  const e=structuredClone(brief);delete e.policy.grant_ref;
  assert.equal(validate(e),false);
  const f=structuredClone(brief);f.audience.ids=["x","x"];
  assert.equal(validate(f),false);
});
test("schema prevents sourced claims with zero evidence refs",()=>{
  const e=structuredClone(brief);e.artifact.claims[0].evidence_refs=[];
  assert.equal(validate(e),false);
});
test("schema prevents channel disclosure for direct classification",()=>{
  const e=structuredClone(brief);e.policy.classification="direct";
  assert.equal(validate(e),false);
});
test("schema prevents forward in explicit deny policy",()=>{
  const e=structuredClone(brief);e.policy.permitted_operations.push("forward");
  assert.equal(validate(e),false);
});
test("schema requires reply relation and correct type",()=>{
  const e=structuredClone(proposal);delete e.relation;
  assert.equal(validate(e),false);
  const f=structuredClone(proposal);f.relation.type="revokes";
  assert.equal(validate(f),false);
});
test("schema forbids fake human-stage receipts without explicit acknowledgment claim",()=>{
  const e=structuredClone(brief);
  e.kind="receipt";
  delete e.artifact;
  e.receipt={target_message_id:brief.message_id,stage:"seen_by_human",at:brief.sent_at,actor_id:"demo:bob"};
  assert.equal(validate(e),false);
  e.receipt.human_confirmed=true;
  assert.equal(validate(e),true,JSON.stringify(validate.errors));
  // A true flag in content is still not proof; production verifier MUST authenticate UI event.
});
test("schema cannot determine source identity or authorization: semantic checks still required",()=>{
  const e=structuredClone(brief);
  e.artifact.sources[0].coverage="link_only";
  assert.equal(validate(e),true,JSON.stringify(validate.errors)); // cross-reference invariant not expressible in this schema
  assert.equal(validateEnvelope(e).valid,false);
});
