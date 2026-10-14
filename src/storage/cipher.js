// Application-level AES-256-GCM for short-lived H2H records.
// AAD binds encrypted data to the table, tenant and record identity.
import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
const KEY_LENGTH=32;
export function parseEncryptionKey(encoded) {
  if(!/^[A-Za-z0-9+/]{43}=$/.test(String(encoded??""))) throw new Error("H2H_ENCRYPTION_KEY must be canonical base64 of exactly 32 random bytes");
  const key=Buffer.from(encoded,"base64");
  if(key.length!==KEY_LENGTH||key.toString("base64")!==encoded) throw new Error("Invalid H2H_ENCRYPTION_KEY");
  return key;
}
export class EnvelopeCipher {
  constructor(key){if(!Buffer.isBuffer(key)||key.length!==KEY_LENGTH)throw new TypeError("256-bit encryption key required");this.key=key;}
  encrypt(value,aad){
    if(typeof aad!=="string"||!aad)throw new TypeError("AAD required");
    const iv=randomBytes(12);
    const cipher=createCipheriv("aes-256-gcm",this.key,iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value),"utf8")),cipher.final()]);
    return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),ciphertext]).toString("base64");
  }
  decrypt(encoded,aad){
    if(typeof aad!=="string"||!aad)throw new TypeError("AAD required");
    const parts=Buffer.from(encoded,"base64");
    if(parts.length<29||parts[0]!==1)throw new Error("Unsupported encrypted record");
    const decipher=createDecipheriv("aes-256-gcm",this.key,parts.subarray(1,13));
    decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(parts.subarray(13,29));
    return JSON.parse(Buffer.concat([decipher.update(parts.subarray(29)),decipher.final()]).toString("utf8"));
  }
}
