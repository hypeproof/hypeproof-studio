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

// Why not a fake host: handleSend depends on the whole panel. The checks below read the source order of handleSend.
const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
const sendStart = src.indexOf('  private async handleSend(');
const EARLY = "if (rehearsalSubscriptionEarly && !(localRuntimeConfig(vscode.env.appName, vscode.workspace.getConfiguration('hypeproofChat')";
const LATE = "if (rehearsalSubscription && !(localRuntimeConfig(vscode.env.appName, vscode.workspace.getConfiguration('hypeproofChat')";
const earlyAt = src.indexOf(EARLY, sendStart);
const lateAt = src.indexOf(LATE, sendStart);
const pre = src.slice(sendStart, earlyAt);
const at = (needle) => src.indexOf(needle, sendStart);

check('RR-3 the early decision sits before the turn lock and the learning-wiki call; the late decision follows the resolved profile and precedes loadAccess', () => {
  if (sendStart < 0) throw new Error('handleSend missing');
  if (earlyAt < 0) throw new Error('early guard line missing');
  if (lateAt < 0) throw new Error('late guard line missing');
  if (src.indexOf(EARLY, earlyAt + 1) >= 0) throw new Error('early guard appears twice');
  const lock = at('const previousTurn = this.turnSettling');
  const wiki = at('const brainCall = mode');
  const resolved = at('const resolvedProfile = temporaryTurn');
  const access = at('await this.loadAccess();');
  // C-5: the legacy instructor branch inside 'if (local)' is removed; the local branch starts with its learner body.
  const localBranch = src.indexOf('      if (local) {\n', earlyAt);
  const serverBranch = src.indexOf('} else if (runtime === "agent-sdk") {', earlyAt);
  if (!(earlyAt < lock)) throw new Error('early decision is not before the turn lock');
  if (!(earlyAt < wiki)) throw new Error('early decision is not before the learning-wiki call');
  if (!(resolved < lateAt && lateAt < access)) throw new Error('late decision is not between the resolved profile and loadAccess');
  if (!(earlyAt < localBranch && earlyAt < serverBranch)) throw new Error('early decision is not before the branches');
});

check('RR-4 nothing before the early decision calls a conversation route, a runner, the wiki, observation, the world or the activity check (static)', () => {
  for (const token of ['fetch(', 'proxyChat(', 'runProxy()', 'runSdkCoach(', 'runLocalCoach(', 'runBrowserLoop(', 'runProxyRuntime(', '/v1/messages', '/v1/chat/completions', 'answerBrainCall(', 'prepareObservation(', 'openPrebuiltWorldForTurn(', 'verifyActivity(', 'loadAccess(', 'await this.ensureProfile']) {
    if (pre.includes(token)) throw new Error(`found ${token} before the early decision`);
  }
});

check('RR-5 without a local runtime both decisions throw the existing no-local-runtime sentence, and the sentence is unchanged', () => {
  for (const g of [earlyAt, lateAt]) {
    const line = src.slice(g, src.indexOf('\n', g));
    if (!line.includes('throw new Error(NO_LOCAL_RUNTIME_MESSAGE);')) throw new Error('a guard does not throw NO_LOCAL_RUNTIME_MESSAGE');
  }
  const chalkContract = readFileSync(new URL('../src/chalkContract.ts', import.meta.url), 'utf8');
  if (!chalkContract.includes('export const NO_LOCAL_RUNTIME_MESSAGE = "강사 채팅은 지금 내 Claude 구독 연결에서만 됩니다.";')) throw new Error('sentence changed');
});

check('RR-6 the learning-wiki call is skipped for a subscription rehearsal turn, decided from the cached profile (plan-first string kept)', () => {
  const line = src.slice(at('const brainCall = mode'), src.indexOf('\n', at('const brainCall = mode')));
  if (!line.includes("mode === 'auto' && !plan.planning && wikiSwitch?.enabled === true && !rehearsalSubscriptionEarly")) throw new Error('brainCall shape changed');
});

check('RR-7 server reads a subscription rehearsal turn must not make are skipped: activity check (early), access view (resolved), observation (inside prepareObservation)', () => {
  const pairs = [
    'if (!rehearsalSubscriptionEarly) await verifyActivity',
    'if (!rehearsalSubscription) await this.loadAccess();',
    'const observation = await this.prepareObservation(proxyUrl, token, profile);',
  ];
  for (const guarded of pairs) {
    if (!src.includes(guarded)) throw new Error(`missing: ${guarded.slice(0, 70)}`);
  }
  const prep = src.slice(src.indexOf('  private async prepareObservation('), src.indexOf('await this.observationWrites;', src.indexOf('  private async prepareObservation(')));
  if (!prep.includes('if (mustStayLocal(profile?.rehearsal)) return null;')) throw new Error('prepareObservation does not return null for a subscription rehearsal');
});

check('RR-8 the prebuilt world is opened for a subscription rehearsal turn too (GET /worlds is an authenticated static render, allowed)', () => {
  const call = 'const opened = await this.openPrebuiltWorldForTurn({';
  if (!src.includes(call)) throw new Error('openPrebuiltWorldForTurn call is missing or guarded');
  if (src.includes('rehearsalSubscription ? null : await this.openPrebuiltWorldForTurn')) throw new Error('world call is guarded by rehearsalSubscription');
});

if (failed) { console.error(`rehearsal-route: ${failed} failed`); process.exit(1); }
console.log('rehearsal-route: all checks passed.');
