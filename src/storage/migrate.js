import {readFile} from "node:fs/promises";
import {createDurableRuntime} from "./runtime.js";
const {pool}=await createDurableRuntime();
try{
  const sql=await readFile(new URL("../../sql/001_init.sql",import.meta.url),"utf8");
  await pool.query(sql);console.log("H2H migration 001 applied");
}finally{await pool.end();}
