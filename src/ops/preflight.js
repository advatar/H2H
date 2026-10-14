// H2H static operator preflight, zero network calls or printing of secrets.
import {pathToFileURL} from "node:url";
import {pilotConfiguration} from "../slack/access.js";
import {parseEncryptionKey} from "../storage/cipher.js";

const parseUrl=(raw,name,allowedSchemes)=>{
  const u=new URL(String(raw||""));
  if(!allowedSchemes.includes(u.protocol))throw new Error(name+" uses the wrong URL scheme");
  if(u.username||u.password)throw new Error(name+" must not contain URL-embedded credentials");
  return u;
};
export function checkPilotEnvironment(env,mode="slack"){
  const failures=[],checks=[];
  const check=(name,fn)=>{
    try{fn();checks.push(name+": configured");}
    catch{failures.push(name+": missing or invalid");}
  };
  check("Slack workspace and channel allowlist",()=>pilotConfiguration(env));
  check("PostgreSQL DSN",()=>{
    const u=new URL(String(env.DATABASE_URL||""));
    if(!["postgres:","postgresql:"].includes(u.protocol))throw new Error("invalid postgres");
    if(!["localhost","127.0.0.1","::1"].includes(u.hostname)&&env.H2H_DB_TLS!=="true")throw new Error("remote DB TLS required");
    if(!["localhost","127.0.0.1","::1"].includes(u.hostname)&&u.searchParams.has("sslmode"))throw new Error("ambiguous DB TLS");
  });
  check("Encryption key",()=>parseEncryptionKey(env.H2H_ENCRYPTION_KEY));
  check("Slack bot token",()=>{
    if(!/^xoxb-/.test(env.SLACK_BOT_TOKEN||""))throw new Error("invalid");
  });
  if(mode==="slack") {
    check("Slack Socket Mode app token",()=>{
      if(!/^xapp-/.test(env.SLACK_APP_TOKEN||""))throw new Error("invalid");
    });
  }else if(mode==="mcp"){
    check("MCP URL",()=>{
      const u=parseUrl(env.H2H_MCP_PUBLIC_URL,"MCP URL",["https:"]);
      if(u.pathname!=="/mcp"||u.search||u.hash)throw new Error("invalid path");
    });
    check("OAuth issuer",()=>parseUrl(env.H2H_OAUTH_ISSUER,"OAuth issuer",["https:"]));
    check("OAuth metadata URL",()=>parseUrl(env.H2H_OAUTH_METADATA_URL,"OAuth metadata",["https:"]));
  }else failures.push("Mode: must be slack or mcp");
  return {mode,ready:failures.length===0,checks,failures};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const mode=process.argv[2]||"slack";
  const result=checkPilotEnvironment(process.env,mode);
  console.log(JSON.stringify(result,null,2));
  if(!result.ready)process.exitCode=1;
}
