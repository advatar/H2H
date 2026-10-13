// Local-only demo: no credentials, network calls or Slack posts.
import { readFile } from "node:fs/promises";
import { assertEnvelope } from "./protocol.js";
import { toA2AMessage } from "./a2a.js";
import { renderSlackPreview } from "./slack-preview.js";

const filename=new URL("../examples/brief.json",import.meta.url);
const brief=JSON.parse(await readFile(filename,"utf-8"));
assertEnvelope(brief);
console.log("EXPERIMENTAL H2H 0.1 — fictional brief; no network calls");
console.log("A2A Message:\n",JSON.stringify(toA2AMessage(brief),null,2));
console.log("Slack preview (authorization simulated ONLY in local demo):\n",JSON.stringify(renderSlackPreview(brief,{verifiedChannelAuthorization:true}),null,2));
