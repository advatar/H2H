// A2A v1.0+ Message mapping: semantic wrapping only, not a network client.
import { assertEnvelope,H2H_EXTENSION_URI } from "./protocol.js";

export function toA2AMessage(envelope, {role="ROLE_USER"}={}) {
  assertEnvelope(envelope);
  if (!["ROLE_USER","ROLE_AGENT"].includes(role)) throw new TypeError("A2A role must be ROLE_USER or ROLE_AGENT");
  return {
    messageId:envelope.message_id,
    role,
    parts:[{data:envelope}],
    extensions:[H2H_EXTENSION_URI],
    metadata:{[H2H_EXTENSION_URI]:{protocol:envelope.protocol,kind:envelope.kind}}
  };
}

export function fromA2AMessage(message) {
  if (!message || !Array.isArray(message.extensions) || !message.extensions.includes(H2H_EXTENSION_URI)) throw new TypeError("A2A H2H extension not activated");
  const parts=message.parts ?? [];
  const part=parts.find(p=>p && p.data && p.data.protocol==="h2h/0.1");
  if (!part) throw new TypeError("missing H2H structured data part");
  assertEnvelope(part.data);
  if (message.messageId !== part.data.message_id) throw new TypeError("message ID mismatch");
  return part.data;
}
