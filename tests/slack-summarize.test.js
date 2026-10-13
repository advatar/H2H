import test from "node:test";
import assert from "node:assert/strict";
import {buildBrief,createOpenAICompatibleSummarizer,configuredSummarizer,validateSubmittedText,wordLimit} from "../src/slack/summarize.js";
import {assertEnvelope} from "../src/protocol.js";
const base={
  teamId:"TTEST",userId:"UTEST",channelId:"CTEST",sourceTs:"123.456",threadTs:"123.456",grantRef:"test-grant",
  text:"The proposal recommends event-driven processing for the next product release. This is one architectural idea. The performance benefit is not proven, and we need a scoped pilot before deciding."
};
test("source texts must be substantive and never only links",()=>{
  assert.throws(()=>validateSubmittedText("https://claude.ai/share/abc"));
  assert.throws(()=>validateSubmittedText("short"));
  assert.equal(validateSubmittedText(base.text),base.text);
  assert(wordLimit(base.text,5).split(" ").length<=5);
});
test("extractive fallback yields an explicit unverified and partial brief <=100 words",async()=>{
  const e=await buildBrief(base);
  assertEnvelope(e);
  assert(e.artifact.summary.split(/\s+/).length<=100);
  assert.equal(e.artifact.sources[0].coverage,"partial");
  assert.equal(e.artifact.claims.length,0);
  assert(e.artifact.limitations.some(s=>s.includes("Extractive")));
});
test("AI-proposed paraphrase cannot become source-grounded based only on a quote",async()=>{
  const exact="The proposal recommends event-driven processing for the next product release.";
  const e=await buildBrief({...base,modelSummarizer:async()=>({
    summary:"An event-driven pipeline was proposed; test before deploying.",
    claims:[{text:"This is 5x faster",quote:exact},{text:"Guaranteed breakthrough",quote:"does not exist"}],
    questions:["What tests are needed?"]
  }),sourceUrl:"https://claude.ai/share/abc123"});
  assert.equal(e.artifact.claims[0].basis,"source");
  assert.equal(e.artifact.claims[0].text,exact);
  assert.deepEqual(e.artifact.claims[0].evidence_refs,["submitted"]);
  assert.equal(e.artifact.claims[1].basis,"unverified");
  assert.equal(e.artifact.sources[1].coverage,"link_only");
});
test("model failure degrades to clearly marked extractive text",async()=>{
  const e=await buildBrief({...base,modelSummarizer:async()=>{throw Error("offline");}});
  assert(e.artifact.limitations.some(x=>x.includes("fallback")));
});
test("untrusted model providers cannot be non-HTTPS unless loopback opt-in",()=>{
  assert.throws(()=>createOpenAICompatibleSummarizer({url:"http://example.com/v1/chat/completions",key:"key",model:"test"}));
  assert.throws(()=>createOpenAICompatibleSummarizer({url:"http://127.0.0.1:7890/v1/chat/completions",model:"test"}));
  assert.equal(typeof createOpenAICompatibleSummarizer({url:"http://127.0.0.1:7890/v1/chat/completions",model:"test",allowLoopback:true}),"function");
  assert.equal(configuredSummarizer({}),null);
});
test("compatible provider sends only submitted text and parses structured JSON",async()=>{
  const requests=[];
  const summarize=createOpenAICompatibleSummarizer({
    url:"https://approved.example/v1/chat/completions",key:"TEST_DO_NOT_USE",model:"test",
    fetchImpl:async(endpoint,opts)=>{
      requests.push({endpoint:String(endpoint),...opts});
      return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        summary:"A narrowly scoped test was proposed.",claims:[{text:"Claim",quote:"This is one architectural idea."}],questions:["Pilot?"]
      })}}]})};
    }
  });
  const output=await summarize(base.text);
  assert.equal(output.mode,"model");
  assert(requests[0].body.includes(base.text));
  assert(output.claims.length===1);
  assert(requests[0].headers.authorization.startsWith("Bearer "));
  assert(!JSON.stringify(output).includes("TEST_DO_NOT_USE"));
});
