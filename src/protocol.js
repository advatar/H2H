// H2H 0.1 reference contract checks (NOT a substitute for JSON Schema or authentication).
import { createHash } from "node:crypto";

export const H2H_VERSION = "h2h/0.1";
export const H2H_EXTENSION_URI = "https://github.com/advatar/H2H/blob/main/spec/0.1/PROTOCOL.md";
const KINDS = ["brief","assessment","reply_proposal","reply","receipt","revoke"];
const OPERATIONS = ["read","private_interpret","draft_reply","post_reply","forward"];
const CLASSIFICATIONS = ["direct","workspace","public"];
const BASIS = ["source","inference","unverified"];
const RECEIPTS = ["accepted_by_relay","delivered_to_agent","interpreted_by_agent","seen_by_human","reply_approved_by_human"];
const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);
const has = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const timestamp = x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const nonempty = x => typeof x === "string" && x.length > 0;
function checkKeys(obj, allowed, path, errors) {
  if (isObj(obj)) for (const key of Object.keys(obj)) if (!allowed.includes(key)) errors.push(path + "." + key + " is unknown");
}
function requireText(obj, key, path, errors) {
  if (!nonempty(obj[key])) errors.push(path + "." + key + " must be a nonempty string");
}
function requireEnum(obj, key, values, path, errors) {
  if (!values.includes(obj[key])) errors.push(path + "." + key + " must be one of " + values.join(", "));
}
function requireDate(obj, key, path, errors) {
  if (!timestamp(obj[key])) errors.push(path + "." + key + " must be an ISO 8601 timestamp");
}
function uniqueStrings(value, path, errors, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.some(v => !nonempty(v)) || new Set(value).size !== value.length) {
    errors.push(path + " must be an array of unique nonempty strings with at least " + min + " entries");
    return false;
  }
  return true;
}
export function validateEnvelope(e) {
  const errors = [];
  if (!isObj(e)) return {valid:false, errors:["envelope must be an object"]};
  checkKeys(e, ["protocol","message_id","thread_id","kind","sent_at","sender","audience","intent","policy","artifact","relation","receipt"], "envelope", errors);
  if (e.protocol !== H2H_VERSION) errors.push("unsupported protocol version");
  requireText(e,"message_id","envelope",errors);
  requireText(e,"thread_id","envelope",errors);
  requireEnum(e,"kind",KINDS,"envelope",errors);
  requireDate(e,"sent_at","envelope",errors);
  if (!isObj(e.sender)) errors.push("sender must be an object");
  else {
    checkKeys(e.sender,["human_id","agent_id"],"sender",errors);
    requireText(e.sender,"human_id","sender",errors);
    requireText(e.sender,"agent_id","sender",errors);
  }
  if (!isObj(e.audience)) errors.push("audience must be an object");
  else {
    checkKeys(e.audience,["kind","ids"],"audience",errors);
    requireEnum(e.audience,"kind",["humans","channel"],"audience",errors);
    uniqueStrings(e.audience.ids,"audience.ids",errors,1);
  }
  if (!isObj(e.intent)) errors.push("intent must be an object");
  else {
    checkKeys(e.intent,["type","prompt"],"intent",errors);
    requireEnum(e.intent,"type",["inform","feedback","decision"],"intent",errors);
    if (has(e.intent,"prompt") && typeof e.intent.prompt !== "string") errors.push("intent.prompt must be text");
  }
  if (!isObj(e.policy)) errors.push("policy must be an object");
  else {
    checkKeys(e.policy,["classification","permitted_operations","forwarding","grant_ref","expires_at"],"policy",errors);
    requireEnum(e.policy,"classification",CLASSIFICATIONS,"policy",errors);
    requireEnum(e.policy,"forwarding",["deny","human_approval"],"policy",errors);
    requireText(e.policy,"grant_ref","policy",errors);
    requireDate(e.policy,"expires_at","policy",errors);
    if (uniqueStrings(e.policy.permitted_operations,"policy.permitted_operations",errors)) for (const op of e.policy.permitted_operations) if (!OPERATIONS.includes(op)) errors.push("unknown operation: " + op);
    if (e.policy.forwarding === "deny" && Array.isArray(e.policy.permitted_operations) && e.policy.permitted_operations.includes("forward")) errors.push("forward forbidden by forwarding=deny");
  }
  if (e.audience?.kind === "channel" && e.policy?.classification === "direct") errors.push("direct classification must not target channel");
  const needsArtifact = ["brief","assessment","reply_proposal","reply"].includes(e.kind);
  if (needsArtifact || has(e,"artifact")) {
    if (!isObj(e.artifact)) errors.push("artifact must be an object");
    else {
      checkKeys(e.artifact,["summary","claims","questions","limitations","sources"],"artifact",errors);
      requireText(e.artifact,"summary","artifact",errors);
      if (e.artifact.summary?.length > 12000) errors.push("artifact.summary exceeds 12000 characters");
      for (const prop of ["questions","limitations"]) if (has(e.artifact,prop) && (!Array.isArray(e.artifact[prop]) || e.artifact[prop].some(x=>!nonempty(x)))) errors.push("artifact." + prop + " must be an array of text");
      if (!Array.isArray(e.artifact.sources)) errors.push("artifact.sources must be an array");
      const sources = Array.isArray(e.artifact.sources) ? e.artifact.sources : [];
      const sourceIds = new Set();
      for (const [i,s] of sources.entries()) {
        if (!isObj(s)) { errors.push("source " + i + " must be an object"); continue; }
        checkKeys(s,["id","provider","uri","coverage","supplied_by","sha256"],"source[" + i + "]",errors);
        for (const field of ["id","provider","uri"]) requireText(s,field,"source[" + i + "]",errors);
        requireEnum(s,"coverage",["full","partial","link_only"],"source[" + i + "]",errors);
        requireEnum(s,"supplied_by",["human","authorized_connector"],"source[" + i + "]",errors);
        if (sourceIds.has(s.id)) errors.push("duplicate source ID " + s.id);
        sourceIds.add(s.id);
        if (s.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(s.sha256)) errors.push("invalid source.sha256");
      }
      if (has(e.artifact,"claims") && !Array.isArray(e.artifact.claims)) errors.push("artifact.claims must be an array");
      const claimIds = new Set();
      const claims = Array.isArray(e.artifact.claims) ? e.artifact.claims : [];
      if (claims.length > 100) errors.push("too many claims");
      for (const [i,c] of claims.entries()) {
        if (!isObj(c)) { errors.push("claim " + i + " must be an object"); continue; }
        checkKeys(c,["id","text","basis","evidence_refs"],"claim[" + i + "]",errors);
        for (const field of ["id","text"]) requireText(c,field,"claim[" + i + "]",errors);
        requireEnum(c,"basis",BASIS,"claim[" + i + "]",errors);
        if (claimIds.has(c.id)) errors.push("duplicate claim ID " + c.id);
        claimIds.add(c.id);
        if (uniqueStrings(c.evidence_refs,"claim[" + i + "].evidence_refs",errors,c.basis === "source" ? 1 : 0)) {
          for (const ref of c.evidence_refs) {
            const s = sources.find(x=>x?.id===ref);
            if (!s) errors.push("unknown evidence reference " + ref);
            if (c.basis === "source" && s?.coverage === "link_only") errors.push("link-only source " + ref + " cannot support a source claim");
          }
        }
      }
    }
  }
  const needsRelation = ["reply_proposal","reply","revoke"].includes(e.kind);
  if (needsRelation || has(e,"relation")) {
    if (!isObj(e.relation)) errors.push("relation must be an object");
    else {
      checkKeys(e.relation,["message_id","type"],"relation",errors);
      requireText(e.relation,"message_id","relation",errors);
      requireEnum(e.relation,"type",["responds_to","revokes"],"relation",errors);
      if (e.kind === "revoke" && e.relation.type !== "revokes") errors.push("revoke must have relation.type=revokes");
      if (["reply_proposal","reply"].includes(e.kind) && e.relation.type !== "responds_to") errors.push("reply must have relation.type=responds_to");
    }
  }
  if (e.kind === "receipt" || has(e,"receipt")) {
    if (!isObj(e.receipt)) errors.push("receipt must be an object");
    else {
      checkKeys(e.receipt,["target_message_id","stage","at","actor_id","human_confirmed"],"receipt",errors);
      requireText(e.receipt,"target_message_id","receipt",errors);
      requireText(e.receipt,"actor_id","receipt",errors);
      requireDate(e.receipt,"at","receipt",errors);
      requireEnum(e.receipt,"stage",RECEIPTS,"receipt",errors);
      if (["seen_by_human","reply_approved_by_human"].includes(e.receipt.stage) && e.receipt.human_confirmed !== true) errors.push("human stage requires explicit human_confirmed=true");
      if (has(e.receipt,"human_confirmed") && typeof e.receipt.human_confirmed !== "boolean") errors.push("receipt.human_confirmed must be boolean");
    }
  }
  return {valid:errors.length===0,errors};
}
export function assertEnvelope(e) {
  const result = validateEnvelope(e);
  if (!result.valid) throw new TypeError("Invalid H2H envelope: " + result.errors.join("; "));
  return e;
}
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v !== null && typeof v === "object") return "{" + Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
export function artifactSha256(artifact) {
  if (!isObj(artifact)) throw new TypeError("artifact required");
  return createHash("sha256").update(stable(artifact)).digest("hex");
}

// MUST NOT treat envelope policy as a self-proving capability. Always require
// application-owned, independently verifiable checks and fail closed.
export async function authorizeOperation(e, request) {
  const check = validateEnvelope(e);
  if (!check.valid) return {allowed:false, reason:"MALFORMED_MESSAGE",errors:check.errors};
  const {operation,principalId,verifyGrant,verifyAudience,verifySourceAccess,verifyHumanApproval,humanApproval,revokedIds=new Set(),now=new Date()} = request ?? {};
  if (!OPERATIONS.includes(operation) || !nonempty(principalId)) return {allowed:false,reason:"MALFORMED_REQUEST"};
  if (revokedIds.has(e.message_id)) return {allowed:false,reason:"REVOKED"};
  if (Date.parse(e.policy.expires_at) <= +new Date(now)) return {allowed:false,reason:"EXPIRED"};
  if (!e.policy.permitted_operations.includes(operation)) return {allowed:false,reason:"SCOPE_DENIED"};
  if (operation === "forward" && e.policy.forwarding === "deny") return {allowed:false,reason:"FORWARD_DENIED"};
  if (typeof verifyGrant !== "function" || typeof verifyAudience !== "function" || typeof verifySourceAccess !== "function") return {allowed:false,reason:"AUTHORITY_UNAVAILABLE"};
  try {
    if (!await verifyGrant({grantRef:e.policy.grant_ref,principalId,operation,envelope:e})) return {allowed:false,reason:"GRANT_DENIED"};
    if (!await verifyAudience({principalId,audience:e.audience,envelope:e})) return {allowed:false,reason:"AUDIENCE_DENIED"};
    if (!await verifySourceAccess({principalId,sources:e.artifact?.sources ?? [],envelope:e})) return {allowed:false,reason:"SOURCE_ACCESS_DENIED"};
    if (["post_reply","forward"].includes(operation)) {
      if (!isObj(humanApproval) || !nonempty(humanApproval.destination) || humanApproval.artifact_sha256 !== artifactSha256(e.artifact) || typeof verifyHumanApproval !== "function") return {allowed:false,reason:"APPROVAL_REQUIRED"};
      if (!await verifyHumanApproval({principalId,operation,envelope:e,humanApproval})) return {allowed:false,reason:"APPROVAL_DENIED"};
    }
  } catch {
    return {allowed:false,reason:"AUTHORITY_CHECK_FAILED"};
  }
  return {allowed:true};
}
