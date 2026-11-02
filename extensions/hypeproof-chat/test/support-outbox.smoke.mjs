import assert from 'node:assert/strict';
import { SupportOutbox } from '../src/supportOutbox.ts';
import { isAutomaticProblem } from '../src/problemReport.ts';
let disk = [], time = 0, calls = [];
const store = { load: async () => structuredClone(disk), save: async rows => { disk = structuredClone(rows); } };
const body = JSON.stringify({ description: '로그인 화면이 열리지 않아요', include_recent_turns: false });
const failed = new SupportOutbox(store, async item => { calls.push(item.body); return { ok: false, reason: 'offline' }; }, () => time);
const queued = await failed.enqueue('https://service.invalid/v1', body);
assert.equal(queued.queued, true); assert.equal(disk.length, 1);
assert.ok(JSON.parse(disk[0].body).client_report_id);
assert.equal(disk[0].endpoint, 'https://service.invalid/v1');
// A restarted app resends exact bytes, including the same client id, and clears only after receipt.
time = 120000;
const restarted = new SupportOutbox(store, async item => { calls.push(item.body); return { ok: true, reportId: 'rep_accepted' }; }, () => time);
await restarted.flush(false);
assert.equal(calls[0], calls[1]); assert.equal(disk.length, 0);
// Storage failure sends nothing, and concurrent enqueue/flush cannot lose a queued report.
let network = 0;
const broken = new SupportOutbox({ load: async () => [], save: async () => { throw Error('disk'); } }, async () => { network++; return { ok: true, reportId: 'rep_no' }; });
await assert.rejects(broken.enqueue('https://service.invalid/v1', body)); assert.equal(network, 0);
await Promise.all([failed.enqueue('https://service.invalid/v1', body), failed.enqueue('https://service.invalid/v1', body), failed.flush(false)]);
assert.equal(disk.length, 2); assert.notEqual(disk[0].id, disk[1].id);
// Permanent refusal is retained without an endless retry loop; automatic opt-out discards only auto items.
disk = [];
const refused = new SupportOutbox(store, async () => ({ ok: false, reason: 'invalid', httpStatus: 400 }), () => time);
await refused.enqueue('https://service.invalid/v1', body);
assert.equal((await refused.flush(true)).length, 0);
await failed.enqueue('https://service.invalid/v1', '{}', 'auto');
await failed.flush(false); assert.equal(disk.length, 1); assert.equal(disk[0].kind, 'manual');
for (const facts of [{step:'chat',status:503},{step:'access',code:'account_login_failed'},{step:'other',code:'renderer_failed'}]) assert.equal(isAutomaticProblem(facts),true);
for (const facts of [{step:'safety',status:403},{step:'access',code:'invalid_code',status:401},{step:'chat',code:'cancelled'},{step:'chat',code:'pass_expired'},{step:'other',code:'unknown'}]) assert.equal(isAutomaticProblem(facts),false);
console.log('PASS: durable offline/restart, exact retry, storage refusal, concurrent queue, permanent refusal, opt-out, fault classification');
// Two independent extension hosts share SecretStorage: the existing cross-process lock protects the full transaction.
const { accountLock } = await import('../src/accountLock.ts');
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const directory = mkdtempSync(join(tmpdir(), 'support-lock-'));
try {
  disk=[];
  const shared = {...store, lock:accountLock(directory)};
  const a=new SupportOutbox(shared,async()=>({ok:false,reason:'offline'}));
  const b=new SupportOutbox(shared,async()=>({ok:false,reason:'offline'}));
  const both=await Promise.all([a.enqueue('https://service.invalid/v1',body),b.enqueue('https://service.invalid/v1',body)]);
  assert(both.every(r=>r.queued)); assert.equal(disk.length,2);
} finally { rmSync(directory,{recursive:true,force:true}); }
let saves=0;
const accepted=new SupportOutbox({load:async()=>[],save:async()=>{if(++saves>1)throw Error('cleanup failed');}},async()=>({ok:true,reportId:'rep_confirmed'}));
assert.deepEqual(await accepted.enqueue('https://service.invalid/v1',body),{ok:true,reportId:'rep_confirmed'});
await refused.remove(disk[0].id); assert.equal(disk.length,1);
console.log('PASS: independent hosts preserve both reports, confirmed receipt survives cleanup failure, queue deletion frees capacity');
