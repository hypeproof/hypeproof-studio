// #4099 — a subscription rehearsal turn stays on the local runtime and makes no server call of its own.
// Pure checks plus a source-order check on handleSend. A fake host is not used: handleSend depends on the whole panel.
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

// Why not a fake host: see the header. The checks below read the source order of handleSend.
const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
const sendStart = src.indexOf('  private async handleSend(');
const GUARD = 'if (rehearsalSubscription && !(localRuntimeConfig(vscode.env.appName, vscode.workspace.getConfiguration(\'hypeproofChat\')';
const guardAt = src.indexOf(GUARD, sendStart);
const pre = src.slice(sendStart, guardAt);
const at = (needle) => src.indexOf(needle, sendStart);

check('RR-3 the guard sits before the turn lock, the learning-wiki call and the local branch, and before the server branches', () => {
  if (sendStart < 0) throw new Error('handleSend missing');
  if (guardAt < 0) throw new Error('guard line missing');
  if (src.indexOf(GUARD, guardAt + 1) >= 0) throw new Error('guard appears twice');
  const lock = at('const previousTurn = this.turnSettling');
  const wiki = at('const brainCall = mode');
  const localBranch = src.indexOf('      if (local) {\n        if (this._instructorMode.isInstructor === true) {', guardAt);
  const serverBranch = src.indexOf('} else if (runtime === "agent-sdk") {', guardAt);
  if (!(guardAt < lock)) throw new Error('guard is not before the turn lock');
  if (!(guardAt < wiki)) throw new Error('guard is not before the learning-wiki call');
  if (!(guardAt < localBranch)) throw new Error('guard is not before the local branch');
  if (!(guardAt < serverBranch)) throw new Error('guard is not before the server branch');
});

check('RR-4 nothing before the guard calls a conversation route or a runner (static)', () => {
  for (const token of ['fetch(', 'proxyChat(', 'runProxy()', 'runSdkCoach(', 'runLocalCoach(', 'runBrowserLoop(', 'runProxyRuntime(', '/v1/messages', '/v1/chat/completions', 'answerBrainCall(', 'prepareObservation(', 'openPrebuiltWorldForTurn(', 'verifyActivity(', 'loadAccess(']) {
    if (pre.includes(token)) throw new Error(`found ${token} before the guard`);
  }
});

check('RR-5 without a local runtime the guard throws the existing no-local-runtime sentence, and the sentence is unchanged', () => {
  const line = src.slice(guardAt, src.indexOf('\n', guardAt));
  if (!line.includes('throw new Error(NO_LOCAL_RUNTIME_MESSAGE);')) throw new Error('guard does not throw NO_LOCAL_RUNTIME_MESSAGE');
  const chalkContract = readFileSync(new URL('../src/chalkContract.ts', import.meta.url), 'utf8');
  if (!chalkContract.includes('export const NO_LOCAL_RUNTIME_MESSAGE = "강사 채팅은 지금 내 Claude 구독 연결에서만 됩니다.";')) throw new Error('sentence changed');
});

check('RR-6 the learning-wiki call is skipped for a subscription rehearsal turn (the guard already decided the local runtime)', () => {
  const line = src.slice(at('const brainCall = mode'), src.indexOf('\n', at('const brainCall = mode')));
  if (!line.includes('!rehearsalSubscription')) throw new Error('brainCall does not exclude subscription rehearsal');
});

check('RR-7 the server reads after the guard are skipped for a subscription rehearsal: activity check, access view, prebuilt world, observation context', () => {
  const pairs = [
    ['await verifyActivity({token:token!', 'if (!rehearsalSubscription) await verifyActivity'],
    ['await this.loadAccess();', 'if (!rehearsalSubscription) await this.loadAccess();'],
    ['await this.openPrebuiltWorldForTurn(', 'rehearsalSubscription ? null : await this.openPrebuiltWorldForTurn('],
    ['await this.prepareObservation(proxyUrl, token, profile);', 'rehearsalSubscription ? null : await this.prepareObservation(proxyUrl, token, profile);'],
  ];
  for (const [, guarded] of pairs) {
    if (!src.includes(guarded)) throw new Error(`missing guard: ${guarded.slice(0, 70)}`);
  }
});

if (failed) { console.error(`rehearsal-route: ${failed} failed`); process.exit(1); }
console.log('rehearsal-route: all checks passed.');
