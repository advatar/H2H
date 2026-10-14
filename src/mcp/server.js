// Authenticated read-only remote MCP resource server (SDK v2).
// Provides shared H2H briefs, NEVER pulls recipients' personal memories.
import {createMcpHandler,McpServer} from "@modelcontextprotocol/server";
import {createMcpExpressApp,getOAuthProtectedResourceMetadataUrl,mcpAuthMetadataRouter,requireBearerAuth} from "@modelcontextprotocol/express";
import {toNodeHandler} from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import {WebClient} from "@slack/web-api";
import {createDurableRuntime} from "../storage/runtime.js";
import {pilotConfiguration} from "../slack/access.js";
import {createJwtAccessVerifier,loadIssuerMetadata} from "./auth.js";
import {getAuthorizedBrief,recipientView,recipientPrivatePrompt} from "./briefs.js";

const unavailable=()=>({isError:true,content:[{type:"text",text:"Brief unavailable or caller not authorized."}]});
function canonicalMcpUrl(url,{allowLocalHttp=false}={}){
  const u=new URL(url);
  if(u.username||u.password||u.search||u.hash||u.pathname!=="/mcp")throw new Error("Public MCP URL must be canonical /mcp without query or credentials");
  if(u.protocol!=="https:"&&!(allowLocalHttp&&u.protocol==="http:"&&["localhost","127.0.0.1"].includes(u.hostname)))throw new Error("MCP requires public HTTPS, except explicitly allowed local-only testing");
  return u;
}
export function createBriefMcpHandler({store,slackClient,config}){
  return createMcpHandler(({authInfo})=>{
    const server=new McpServer({name:"advatar-h2h",version:"0.1.0"});
    const lookup=async messageId=>{
      const issuer=authInfo?.extra?.issuer;
      const subject=authInfo?.extra?.subject;
      if(typeof issuer!=="string"||typeof subject!=="string")return null;
      return getAuthorizedBrief({store,slackClient,config,issuer,subject,messageId});
    };
    server.registerTool("h2h_get_brief",{
      description:"Retrieve an H2H shared brief only if your mapped Slack identity currently has access. This does not access or disclose personal memory.",
      inputSchema:z.object({message_id:z.string().min(1).max(200)})
    },async ({message_id})=>{
      const envelope=await lookup(message_id);
      return envelope?{content:[{type:"text",text:JSON.stringify(recipientView(envelope))}]}:unavailable();
    });
    server.registerTool("h2h_prepare_private_assessment",{
      description:"Get a safe prompt for YOUR OWN AI to interpret a permitted brief privately. H2H does not submit or publish your answer.",
      inputSchema:z.object({message_id:z.string().min(1).max(200)})
    },async ({message_id})=>{
      const envelope=await lookup(message_id);
      return envelope?{content:[{type:"text",text:recipientPrivatePrompt(envelope)}]}:unavailable();
    });
    return server;
  },{responseMode:"json"});
}
export function assembleMcpApp({store,slackClient,config,publicUrl,oauthMetadata,verifier,listenHost="127.0.0.1",allowLocalHttp=false}){
  const mcpUrl=canonicalMcpUrl(publicUrl,{allowLocalHttp});
  if(!oauthMetadata||!verifier?.verifyAccessToken)throw new TypeError("Trusted OAuth metadata and verifier required");
  const handler=createBriefMcpHandler({store,slackClient,config});
  const app=createMcpExpressApp({
    host:listenHost,
    allowedHosts:[mcpUrl.host,mcpUrl.hostname]
  });
  app.disable("x-powered-by");
  app.use(mcpAuthMetadataRouter({
    oauthMetadata,resourceServerUrl:mcpUrl,
    scopesSupported:["h2h:read"],resourceName:"H2H Shared Knowledge"
  }));
  app.get("/healthz",(_req,res)=>res.status(200).json({status:"ok",service:"h2h-mcp"}));
  const auth=requireBearerAuth({
    verifier,requiredScopes:["h2h:read"],
    resourceMetadataUrl:getOAuthProtectedResourceMetadataUrl(mcpUrl),
    expectedResource:mcpUrl
  });
  const node=toNodeHandler(handler);
  app.all("/mcp",auth,(req,res)=>void node(req,res,req.body));
  return {app,handler,mcpUrl};
}
export async function startMcpServer(env=process.env){
  const config=pilotConfiguration(env);
  const publicUrl=env.H2H_MCP_PUBLIC_URL;
  const issuer=env.H2H_OAUTH_ISSUER;
  const metadataUrl=env.H2H_OAUTH_METADATA_URL;
  if(!publicUrl||!issuer||!metadataUrl||!env.SLACK_BOT_TOKEN)throw new Error("MCP public URL, OAuth issuer/metadata and Slack bot token required");
  const metadata=await loadIssuerMetadata({issuer,metadataUrl});
  const verifier=createJwtAccessVerifier({
    issuer,audience:publicUrl,jwksUrl:metadata.jwks_uri
  });
  const {pool,store}=await createDurableRuntime(env);
  const slackClient=new WebClient(env.SLACK_BOT_TOKEN);
  const listenHost=env.H2H_LISTEN_HOST||"127.0.0.1";
  const {app,handler}=assembleMcpApp({
    store,slackClient,config,publicUrl,oauthMetadata:metadata,verifier,listenHost,
    allowLocalHttp:env.H2H_ALLOW_LOCAL_HTTP_MCP==="true"
  });
  const port=Number(env.H2H_MCP_PORT||3000);
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error("Invalid H2H_MCP_PORT");
  const server=await new Promise((resolve,reject)=>{
    const s=app.listen(port,listenHost,()=>resolve(s));s.once("error",reject);
  });
  const stop=async()=>{
    await handler.close();
    await new Promise(resolve=>server.close(resolve));
    await pool.end();
  };
  return {port,server,stop};
}
