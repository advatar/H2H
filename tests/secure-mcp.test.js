import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,generateKeyPairSync} from "node:crypto";
import {SignJWT} from "jose";
import {EnvelopeCipher,parseEncryptionKey} from "../src/storage/cipher.js";
import {createJwtAccessVerifier,loadIssuerMetadata} from "../src/mcp/auth.js";
import {getAuthorizedBrief,recipientPrivatePrompt,recipientView} from "../src/mcp/briefs.js";
import {createBriefMcpHandler} from "../src/mcp/server.js";
import {buildBrief} from "../src/slack/summarize.js";
import {pilotConfiguration} from "../src/slack/access.js";

const issuer="https://issuer.example";const audience="https://h2h.example/mcp";
const T="T123TEST",C="C123TEST",A="U111ALICE",B="U222BOB",BOT="U333BOT";
const config=pilotConfiguration({SLACK_TEAM_ID:T,SLACK_ALLOWED_CHANNEL_IDS:C});
const source="The shared proposal adds an agent-mediated discussion flow. The recipient interprets one short knowledge artifact privately. No private recipient memory is posted to Slack without approval.";
const base={text:source,teamId:T,userId:A,channelId:C,sourceTs:"100.1",threadTs:"100.1",grantRef:"test-grant"};
const mockSlack=members=>({
  auth:{test:async()=>({ok:true,team_id:T,user_id:BOT})},
  conversations:{
    info:async()=>({ok:true,channel:{id:C,is_channel:true,is_private:false,is_ext_shared:false,is_archived:false,is_shared:false,is_org_shared:false,is_member:true}}),
    members:async()=>({ok:true,members,response_metadata:{next_cursor:""}})
  }
});
function mockStore(envelope,linked=true) {
  let revoked=false;
  return {
    revoke:()=>{revoked=true;},
    getPrincipalLink:async(iss,sub)=>linked&&iss===issuer&&sub==="bob"?
      {teamId:T,slackUserId:B}:null,
    getPublished:async id=>!revoked&&id===envelope.message_id?
      {messageId:id,teamId:T,userId:A,channelId:C,consentAt:Date.now(),
        grantRef:envelope.policy.grant_ref,envelope}:null
  };
}
test("AES-GCM encrypted records are randomized and bound to tenant/row AAD",()=>{
  const encoded=randomBytes(32).toString("base64");
  const cipher=new EnvelopeCipher(parseEncryptionKey(encoded));
  const one=cipher.encrypt({text:"sensitive author submission"},"h2h:draft:T1:x");
  const two=cipher.encrypt({text:"sensitive author submission"},"h2h:draft:T1:x");
  assert.notEqual(one,two);
  assert.deepEqual(cipher.decrypt(one,"h2h:draft:T1:x"),{text:"sensitive author submission"});
  assert.throws(()=>cipher.decrypt(one,"h2h:draft:T2:x"));
  assert.throws(()=>parseEncryptionKey("AAAAAAAA"));
});
test("JWT: issuer, exact audience, expiry and scope checked before identity mapping",async()=>{
  const pair=generateKeyPairSync("rsa",{modulusLength:2048});
  const verify=createJwtAccessVerifier({issuer,audience,verifyKey:pair.publicKey});
  const sign=async({iss=issuer,aud=audience,scope="h2h:read",exp="10m"}={})=>
    new SignJWT({scope,client_id:"test-client"}).setProtectedHeader({alg:"RS256",typ:"at+jwt"})
      .setIssuer(iss).setAudience(aud).setSubject("bob").setIssuedAt().setExpirationTime(exp)
      .sign(pair.privateKey);
  const pass=await verify.verifyAccessToken(await sign());
  const idToken=await new SignJWT({scope:"h2h:read",client_id:"test-client"})
    .setProtectedHeader({alg:"RS256",typ:"JWT"})
    .setIssuer(issuer).setAudience(audience).setSubject("bob")
    .setIssuedAt().setExpirationTime("10m").sign(pair.privateKey);
  await assert.rejects(verify.verifyAccessToken(idToken));
  const insufficient=await verify.verifyAccessToken(await sign({scope:"profile:read"}));
  assert(!insufficient.scopes.includes("h2h:read")); // OAuth gate responds 403 insufficient_scope
  assert.equal(pass.extra.subject,"bob");
  assert.equal(pass.resource.href,audience);
  assert.equal(pass.expiresAt>Math.floor(Date.now()/1000),true);
  for(const opts of [{iss:"https://rogue.example"},{aud:"https://other.example/mcp"},{exp:"-30s"}]){
    await assert.rejects(verify.verifyAccessToken(await sign(opts)));
  }
  const evil=generateKeyPairSync("rsa",{modulusLength:2048});
  const forged=await new SignJWT({scope:"h2h:read"}).setProtectedHeader({alg:"RS256"})
    .setIssuer(issuer).setAudience(audience).setSubject("bob").setExpirationTime("10m").sign(evil.privateKey);
  await assert.rejects(verify.verifyAccessToken(forged));
  const anonymousClient=await new SignJWT({scope:"h2h:read"})
    .setProtectedHeader({alg:"RS256",typ:"at+jwt"})
    .setIssuer(issuer).setAudience(audience).setSubject("bob")
    .setIssuedAt().setExpirationTime("10m").sign(pair.privateKey);
  await assert.rejects(verify.verifyAccessToken(anonymousClient));
});
test("issuer discovery is pinned to configured issuer and requires PKCE",async()=>{
  const metadata={
    issuer,authorization_endpoint:issuer+"/authorize",token_endpoint:issuer+"/token",
    jwks_uri:issuer+"/jwks",response_types_supported:["code"],code_challenge_methods_supported:["S256"]
  };
  const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify(metadata)});
  assert.deepEqual(await loadIssuerMetadata({issuer,metadataUrl:issuer+"/.well-known/oauth-authorization-server",fetchImpl}),metadata);
  await assert.rejects(loadIssuerMetadata({issuer:"https://other.example",metadataUrl:issuer+"/.well-known/oauth-authorization-server",fetchImpl}));
  await assert.rejects(loadIssuerMetadata({issuer,metadataUrl:"http://issuer.example/metadata",fetchImpl}));
});
test("private recipient gets only shared artifact after principal binding and fresh Slack membership",async()=>{
  const env=await buildBrief(base);
  const store=mockStore(env);
  const params={store,config,slackClient:mockSlack([A,B,BOT]),issuer,subject:"bob",messageId:env.message_id};
  const found=await getAuthorizedBrief(params);
  assert(found);
  const publicView=recipientView(found);
  assert.equal(publicView.artifact.summary,env.artifact.summary);
  assert(!JSON.stringify(publicView).includes("personal memory"));
  assert(recipientPrivatePrompt(found).includes("END UNTRUSTED H2H DATA"));
  assert.equal(await getAuthorizedBrief({...params,subject:"unknown"}),null);
  assert.equal(await getAuthorizedBrief({...params,slackClient:mockSlack([A,BOT])}),null);
  store.revoke();
  assert.equal(await getAuthorizedBrief(params),null);
});
test("MCP SDK v2 exposes two read-only tools, never grants unseen identity access",async()=>{
  const env=await buildBrief(base);
  const store=mockStore(env);
  const handler=createBriefMcpHandler({store,slackClient:mockSlack([A,B,BOT]),config});
  const auth={clientId:"client-x",scopes:["h2h:read"],expiresAt:Math.floor(Date.now()/1000)+600,
    extra:{issuer,subject:"bob"},resource:new URL(audience)};
  const call=async(method,params)=>{
    const request=new Request(audience,{method:"POST",headers:{
      "content-type":"application/json",accept:"application/json, text/event-stream"
    },body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
    const response=await handler.fetch(request,{authInfo:auth});
    const body=await response.text();
    assert.equal(response.ok,true,body);
    return body.startsWith("event:")?JSON.parse(body.split("data: ")[1]):JSON.parse(body);
  };
  try{
    const tools=await call("tools/list",{});
    const names=tools.result.tools.map(x=>x.name);
    assert.deepEqual(names.sort(),["h2h_get_brief","h2h_prepare_private_assessment"].sort());
    const ok=await call("tools/call",{name:"h2h_get_brief",arguments:{message_id:env.message_id}});
    assert.equal(ok.result.isError,undefined);
    assert(ok.result.content[0].text.includes(env.artifact.summary));
    const missing=await call("tools/call",{name:"h2h_get_brief",arguments:{message_id:"unknown"}});
    assert.equal(missing.result.isError,true);
  }finally{await handler.close();}
});
