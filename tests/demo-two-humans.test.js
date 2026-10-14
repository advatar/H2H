import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";

test("synthetic two-human demo posts one approved brief and no automatic personal reply",()=>{
  const source=new URL("../scripts/demo-two-humans.js",import.meta.url);
  const output=execFileSync(process.execPath,[source.pathname],{encoding:"utf-8",timeout:10000});
  const data=JSON.parse(output);
  assert.equal(data.status,"synthetic_demo_success");
  assert.equal(data.shared_briefs,1);
  assert.equal(data.automatically_published_personal_replies,0);
  assert.equal(data.live_slack_calls,0);
  assert.equal(data.live_model_calls,0);
  assert.equal(data.privately_retained_context,true);
  assert.notEqual(data.mock_personal_interpretations.alice,data.mock_personal_interpretations.bob);
  assert(data.shared_summary.length>30);
});
