import {createDurableRuntime} from "./runtime.js";
const {pool}=await createDurableRuntime();
try {
  const a=await pool.query("DELETE FROM h2h_drafts WHERE expires_at < now()");
  const b=await pool.query("DELETE FROM h2h_briefs WHERE expires_at < now() OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '1 day')");
  const c=await pool.query("DELETE FROM h2h_audit WHERE event_at < now() - interval '30 days'");
  console.log(JSON.stringify({expired_drafts:a.rowCount,expired_briefs:b.rowCount,old_audit_events:c.rowCount}));
}finally{await pool.end();}
