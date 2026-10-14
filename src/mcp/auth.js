// OAuth resource-server JWT verification. No token passed to tool callbacks, logs or URLs.
import {createRemoteJWKSet,jwtVerify} from "jose";
import {OAuthError,OAuthErrorCode} from "@modelcontextprotocol/server";
function secureUrl(text){const url=new URL(text);if(url.protocol!=="https:")throw new Error("OAuth configuration must use HTTPS");return url;}
export function parseScopes(scope){
  return typeof scope==="string"?[...new Set(scope.split(/\s+/).filter(Boolean))]:[];
}
export function createJwtAccessVerifier({issuer,audience,jwksUrl,verifyKey}){
  const expectedIssuer=secureUrl(issuer).href.replace(/\/$/,"");
  const resource=new URL(audience);
  if(resource.protocol!=="https:"&&!["127.0.0.1","localhost"].includes(resource.hostname))throw new Error("MCP resource URL must be HTTPS");
  const key=verifyKey||(jwksUrl?createRemoteJWKSet(secureUrl(jwksUrl)):null);
  if(!key)throw new Error("Trusted JWKS URL or verification key required");
  return {
    async verifyAccessToken(token) {
      try {
        const {payload}=await jwtVerify(token,key,{
          issuer:expectedIssuer,
          audience:resource.href,
          algorithms:["RS256","PS256","ES256"],
          clockTolerance:"5s"
        });
        if(typeof payload.sub!=="string"||!payload.sub||!Number.isInteger(payload.exp))throw new Error("JWT requires subject and exp");
        const scopes=parseScopes(payload.scope);
        if(!scopes.includes("h2h:read"))throw new Error("Required scope absent");
        const clientId=typeof payload.client_id==="string"?payload.client_id:
          typeof payload.azp==="string"?payload.azp:"h2h-oauth-client";
        return {
          token,clientId,scopes,expiresAt:payload.exp,resource,
          extra:{issuer:expectedIssuer,subject:payload.sub}
        };
      }catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken,"Invalid or unauthorized H2H access token");
      }
    }
  };
}
export async function loadIssuerMetadata({issuer,metadataUrl,fetchImpl=globalThis.fetch}){
  const expected=secureUrl(issuer).href.replace(/\/$/,"");
  const url=secureUrl(metadataUrl);
  const result=await fetchImpl(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(8000),redirect:"error"});
  if(!result.ok)throw new Error("Unable to load configured OAuth authorization-server metadata");
  const text=await result.text();
  if(text.length>20000)throw new Error("Authorization-server metadata too large");
  const info=JSON.parse(text);
  if(info.issuer!==expected)throw new Error("OAuth metadata issuer mismatch");
  for(const prop of ["authorization_endpoint","token_endpoint","jwks_uri"])secureUrl(info[prop]);
  if(!Array.isArray(info.response_types_supported)||!info.response_types_supported.includes("code"))throw new Error("OAuth issuer must support authorization-code flow");
  if(!Array.isArray(info.code_challenge_methods_supported)||!info.code_challenge_methods_supported.includes("S256"))throw new Error("OAuth issuer must advertise PKCE S256");
  return info;
}
