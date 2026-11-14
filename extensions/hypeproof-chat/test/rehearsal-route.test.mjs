// #4099 — a subscription rehearsal turn stays on the local runtime. Pure checks plus a source-order check on handleSend.
import { readFileSync } from 'node:fs';
import { rehearsalPathOf, mustStayLocal } from '../src/rehearsalRoute.ts';

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok -', name); } catch (err) { failed++; console.error('FAIL -', name, err.message); }
}
const eq = (a, b) => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

check('RR-1 subscription is the only value that stays local', () => {
  eq(rehearsalPathOf({ path: 'subscription' }), 'subscription');
  eq(mustStayLocal({ path: 'subscription' }), true);
});
check('RR-2 server, absent, unknown and missing rehearsal all route as server', () => {
  eq(rehearsalPathOf({ path: 'server' }), 'server');
  eq(rehearsalPathOf({}), 'server');
  eq(rehearsalPathOf({ path: 'SUBSCRIPTION' }), 'server');
  eq(rehearsalPathOf({ path: true }), 'server');
  eq(rehearsalPathOf(null), 'server');
  eq(rehearsalPathOf(undefined), 'server');
  eq(mustStayLocal({ path: 'server' }), false);
  eq(mustStayLocal(undefined), false);
});
check('RR-3 the guard sits before the local branch in handleSend and before any server route', () => {
  const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
  const guard = src.indexOf('if (mustStayLocal(profile?.rehearsal) && !local) throw new Error(NO_LOCAL_RUNTIME_MESSAGE);');
  const localBranch = src.indexOf('      if (local) {\n        if (this._instructorMode.isInstructor === true) {', guard);
  const serverBranch = src.indexOf('} else if (runtime === "agent-sdk") {', guard);
  if (guard < 0) throw new Error('guard line missing');
  if (!(guard < localBranch)) throw new Error('guard is not before the local branch');
  if (!(guard < serverBranch)) throw new Error('guard is not before the server branch');
});

if (failed) { console.error(`rehearsal-route: ${failed} failed`); process.exit(1); }
console.log('rehearsal-route: all checks passed.');
