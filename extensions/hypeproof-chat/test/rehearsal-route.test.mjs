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
// Why not a fake host: handleSend reads the panel, the profile, consent, the preview and the observation recorder before
// its turn, so a fake `this` would have to stand in for all of them. The checks below read the source order instead.
const GUARD = 'if (mustStayLocal(profile?.rehearsal) && !(localRuntimeConfig(vscode.env.appName, proxyUrl) ?? instructorLocalRuntime(';
const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
const sendStart = src.indexOf('  private async handleSend(');
const guardAt = src.indexOf(GUARD, sendStart);
const pre = src.slice(sendStart, guardAt);

check('RR-3 the guard sits after the profile is known and before the local branch, the server branches and the observation', () => {
  if (sendStart < 0) throw new Error('handleSend missing');
  if (guardAt < 0) throw new Error('guard line missing');
  if (src.indexOf(GUARD, guardAt + 1) >= 0) throw new Error('guard appears twice');
  const profileAt = src.indexOf('const profile=resolvedProfile?await folderConsentProfile(', sendStart);
  const localBranch = src.indexOf('      if (local) {\n        if (this._instructorMode.isInstructor === true) {', guardAt);
  const serverBranch = src.indexOf('} else if (runtime === "agent-sdk") {', guardAt);
  const observation = src.indexOf('const observation = await this.prepareObservation(proxyUrl, token, profile);', sendStart);
  if (!(profileAt > 0 && profileAt < guardAt)) throw new Error('guard is not after the profile');
  if (!(guardAt < localBranch)) throw new Error('guard is not before the local branch');
  if (!(guardAt < serverBranch)) throw new Error('guard is not before the server branch');
  if (!(observation > guardAt)) throw new Error('guard is not before the observation recorder');
});

check('RR-4 nothing before the guard calls a conversation route or a runner (static: no fetch, proxy, SDK, local coach or browser loop)', () => {
  for (const token of ['fetch(', 'proxyChat(', 'runProxy()', 'runSdkCoach(', 'runLocalCoach(', 'runBrowserLoop(', 'runProxyRuntime(', '/v1/messages', '/v1/chat/completions']) {
    if (pre.includes(token)) throw new Error(`found ${token} before the guard`);
  }
});

check('RR-5 without a local runtime the guard throws the existing no-local-runtime sentence, and the sentence is unchanged', () => {
  const line = src.slice(guardAt, src.indexOf('\n', guardAt));
  if (!line.includes('throw new Error(NO_LOCAL_RUNTIME_MESSAGE);')) throw new Error('guard does not throw NO_LOCAL_RUNTIME_MESSAGE');
  const chalkContract = readFileSync(new URL('../src/chalkContract.ts', import.meta.url), 'utf8');
  if (!chalkContract.includes('export const NO_LOCAL_RUNTIME_MESSAGE = "강사 채팅은 지금 내 Claude 구독 연결에서만 됩니다.";')) throw new Error('sentence changed');
});

if (failed) { console.error(`rehearsal-route: ${failed} failed`); process.exit(1); }
console.log('rehearsal-route: all checks passed.');
