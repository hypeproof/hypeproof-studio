// Disposable native fixture only. Reuse canonical migrations/admin session start;
// observe actual settled rows without creating request IDs or changing accounting policy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const ATTRIBUTION_MIGRATION='worker/migrations/0044-agent-attribution.sql';
export async function initializeAccounting({root,harness,cohort,profile,session}){
 const file=path.join(root,ATTRIBUTION_MIGRATION),stat=fs.lstatSync(file);
 assert(stat.isFile()&&!stat.isSymbolicLink(),'Canonical attribution migration must be a regular file');
 const sql=fs.readFileSync(file);harness.db.exec(sql.toString());
 assert.equal(harness.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1,'Fixture must enforce foreign keys');
 for(const name of ['usage_request_rows','usage_request_attribution'])assert(harness.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name),'Canonical attribution table missing');
 const response=await harness.request('/admin/cohorts/'+encodeURIComponent(cohort)+'/session',{method:'POST',body:{...session,profile_id:profile}});
 assert.equal(response.status,200,'Canonical admin session start must succeed');
 const parent=harness.db.prepare('SELECT id,cohort_id,profile_id FROM sessions WHERE id=?').get(session.session_id);
 assert.deepEqual({...parent},{id:session.session_id,cohort_id:cohort,profile_id:profile},'Canonical session D1 mirror missing');
 assert.deepEqual(harness.db.prepare('PRAGMA foreign_key_check').all(),[]);
 return {migration:{path:ATTRIBUTION_MIGRATION,sha256:createHash('sha256').update(sql).digest('hex')},session_parent_verified:true,foreign_keys:true};
}
export function settledUsage(db,requestId,expectedSession){
 const rows=db.prepare(`SELECT r.request_id,u.id AS usage_row_id,u.session_id,u.model,u.status,
   u.tokens_in,u.tokens_out,u.cache_read,u.cache_write
   FROM usage_request_rows r JOIN usage_log u ON u.id=r.usage_row_id WHERE r.request_id=?`).all(requestId);
 return {request_id:requestId,linked_rows:rows.length,session_matches:rows.length===1&&rows[0].session_id===expectedSession,rows};
}
export function accountingSummary(db){
 return {...db.prepare(`SELECT (SELECT count(*) FROM usage_log) AS usage_rows,
   (SELECT count(*) FROM usage_request_rows) AS request_links,
   (SELECT count(*) FROM usage_log WHERE session_id IS NULL) AS null_session_rows,
   (SELECT count(*) FROM usage_log u WHERE NOT EXISTS(SELECT 1 FROM usage_request_rows r WHERE r.usage_row_id=u.id)) AS unlinked_rows,
   (SELECT count(*) FROM usage_attempt_costs) AS attempts,
   (SELECT count(*) FROM usage_cost_evidence) AS evidence`).get()};
}
