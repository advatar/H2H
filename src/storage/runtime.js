import {readFile} from "node:fs/promises";
import pg from "pg";
import {EnvelopeCipher,parseEncryptionKey} from "./cipher.js";
import {PostgresPilotStore} from "./postgres.js";
function isLoopback(x){return ["localhost","127.0.0.1","::1"].includes(x);}
export async function createDurableRuntime(env=process.env) {
  if(!env.DATABASE_URL)throw new Error("DATABASE_URL required");
  const u=new URL(env.DATABASE_URL);
  if(!["postgres:","postgresql:"].includes(u.protocol))throw new Error("DATABASE_URL must use PostgreSQL");
  const local=isLoopback(u.hostname);
  if(!local&&env.H2H_DB_TLS!=="true")throw new Error("Remote PostgreSQL requires H2H_DB_TLS=true");
  if(!local&&u.searchParams.has("sslmode"))throw new Error("Remove sslmode from remote DATABASE_URL; H2H enforces TLS certificate verification itself");
  const ssl=!local?{
    rejectUnauthorized:true,
    ...(env.H2H_DB_CA_FILE?{ca:await readFile(env.H2H_DB_CA_FILE,"utf8")}:{})
  }:undefined;
  const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:8,connectionTimeoutMillis:5000,
    idleTimeoutMillis:30000,...(ssl?{ssl}:{})});
  const cipher=new EnvelopeCipher(parseEncryptionKey(env.H2H_ENCRYPTION_KEY));
  return {pool,store:new PostgresPilotStore({pool,cipher})};
}
