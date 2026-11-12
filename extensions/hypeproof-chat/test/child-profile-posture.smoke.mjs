// Guardian child profile, app-side posture (docs/requirements/guardian-child-profile.md GRD-08, GRD-09,
// GRD-10, GRD-19 client part, GRD-23, GRD-24; Studio #3847). Locks two directions:
// - switch off (`hypeproofChat.guardianEnabled`, default false): `child_profile` changes nothing;
// - switch on and `child_profile: true`: every listed surface refuses, fail closed.
//
// Run: node --experimental-strip-types test/child-profile-posture.smoke.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';

const src = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
const child = await import('../src/childProfile.ts');
const { isMinorProfile } = await import('../src/sdkCoachHelpers.ts');
const { sitePublishAllowed, PUBLISH_STRATEGY } = await import('../src/publish/publishContract.ts');
const { galleryPublishAllowed } = await import('../src/galleryPublish.ts');
const { fetchProfileResult } = await import('../src/proxyClient.ts');

const SURFACES = ['publish', 'purchase', 'connections', 'store', 'invite', 'memory'];
const base = () => ({
  profile_id: 'studio-child-home', display_name: '아이', language: 'ko', series_index: 1, series_total: 1,
  activity_kind: 'personal', game: { template_tier: 'webapp' },
  publishing: { enabled: true, strategy: PUBLISH_STRATEGY },
  automations: { enabled: true, provider: 'gmail' },
  curriculum_runtime: { enabled: true },
  analytics: { upload_session_logs: true },
  notify_optin: { available: true, consent_version: 'v1' },
  sdk_tools: { read: true, write: true, browser: true, subagents: true, shell: true },
  coach_runtime: 'agent-sdk',
});

// ── Default: the switch is unbound, so it is off ───────────────────────────────
assert.equal(child.guardianSwitchOn(), false, 'an unbound switch is off');
{
  const p = { ...base(), child_profile: true };
  assert.equal(child.applyChildPosture(p), p, 'switch off: the profile object is returned unchanged');
  for (const s of SURFACES) assert.equal(child.childSurfaceRefusal(s, p), null, `switch off: ${s} keeps today's behaviour`);
  assert.equal(child.childGuardianNotice(p), undefined, 'switch off: no guardian notice');
}

// GRD-23 — only a literal true turns it on; a throwing reader is off.
for (const value of [false, 'true', 1, undefined, null]) {
  child.configureGuardianSwitch(() => value);
  assert.equal(child.guardianSwitchOn(), false, `setting ${JSON.stringify(value)} is off`);
}
child.configureGuardianSwitch(() => { throw new Error('unreadable'); });
assert.equal(child.guardianSwitchOn(), false, 'an unreadable setting is off');

// ── Switch on ──────────────────────────────────────────────────────────────────
child.configureGuardianSwitch(() => true);
assert.equal(child.guardianSwitchOn(), true);

// Not a child seat: unchanged, whatever else the profile says.
for (const value of [undefined, false, 'true', 1]) {
  const p = { ...base(), ...(value === undefined ? {} : { child_profile: value }) };
  assert.equal(child.applyChildPosture(p), p, `child_profile ${JSON.stringify(value)}: unchanged`);
  for (const s of SURFACES) assert.equal(child.childSurfaceRefusal(s, p), null);
}
assert.equal(child.childSurfaceRefusal('publish', null), null, 'no profile: no child refusal (the surface keeps its own gate)');

// GRD-08 — child seat without minor_cohort still counts as minor (fail closed).
{
  const served = { ...base(), child_profile: true };
  const frozen = structuredClone(served);
  const p = child.applyChildPosture(served);
  assert.deepEqual(served, frozen, 'the served profile is not mutated');
  assert.equal(p.minor_cohort, true, 'GRD-08: minor even without the flag');
  assert.equal(isMinorProfile(p), true, 'GRD-08: the existing minor gate sees a minor');
  assert.equal(p.coach_runtime, 'proxy', 'GRD-08: proxy runtime');
  // GRD-10 — publish (site and gallery) refused by the existing gates.
  assert.equal(sitePublishAllowed(p.publishing, isMinorProfile(p)).ok, false, 'GRD-10: site publish refused');
  assert.equal(galleryPublishAllowed({ ...p.publishing, strategy: 'hypeproof_gallery' }).ok, false, 'GRD-10: gallery publish refused');
  // GRD-09 — no mail automation; GRD-10/19 — no Curriculum Runtime (Foundry publish, server project memory).
  assert.equal(p.automations, undefined, 'GRD-09: no mail connection');
  assert.equal(p.curriculum_runtime.enabled, false, 'GRD-10/19: Curriculum Runtime off');
  // GRD-19 — nothing to team analytics, no email collection.
  assert.equal(p.analytics.upload_session_logs, false);
  assert.equal(p.notify_optin, undefined);
  assert.deepEqual(p.sdk_tools, { read: true, write: false, browser: false, subagents: false, shell: false }, 'GRD-08: classroom child tool posture');
  assert.equal(p.orchestrator, undefined);
  // Every surface refuses with plain 해요체 (GRD-24).
  for (const s of SURFACES) {
    const m = child.childSurfaceRefusal(s, p);
    assert.equal(m, child.CHILD_REFUSAL[s], `${s} refused`);
    assert.match(m, /^아이 프로필에서는 .+요\.( .+요\.)?$/u, `${s}: plain 해요체`);
    assert.doesNotMatch(m, /[0-9$₩원]|법정|대리인|동의서/u, `${s}: no amounts or legal terms`);
  }
  // GRD-24 — the always-visible notice.
  assert.equal(child.childGuardianNotice(p), '보호자가 이 기록을 볼 수 있어요');
  // Explicit `false` argument wins over the bound switch (tests and callers can pass it).
  assert.equal(child.applyChildPosture(served, false), served);
}

// minor_cohort already true and no sdk_tools: still closed, nothing invented.
{
  const p = child.applyChildPosture({ ...base(), sdk_tools: undefined, minor_cohort: true, child_profile: true });
  assert.equal(p.sdk_tools, undefined);
  assert.equal(p.minor_cohort, true);
}

// childRefusalNow reads the configured seat; a throwing reader is no seat.
child.configureChildSeat(() => ({ child_profile: true }));
for (const s of SURFACES) assert.equal(child.childRefusalNow(s), child.CHILD_REFUSAL[s]);
child.configureChildSeat(() => { throw new Error('gone'); });
assert.equal(child.childRefusalNow('store'), null);

// ── The profile chokepoint: every fetchProfileResult reader gets the posture ────
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ...base(), child_profile: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    child.configureGuardianSwitch(() => true);
    const on = await fetchProfileResult({ proxyUrl: 'https://service.invalid/v1', token: 't' });
    assert.equal(on.ok, true);
    assert.equal(on.profile.minor_cohort, true, 'switch on: fetched child profile is minor');
    assert.equal(on.profile.publishing.enabled, false, 'switch on: fetched child profile cannot publish');
    child.configureGuardianSwitch(() => false);
    const off = await fetchProfileResult({ proxyUrl: 'https://service.invalid/v1', token: 't' });
    assert.deepEqual(off.profile, { ...base(), child_profile: true }, 'switch off: fetched profile exactly as served');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── Host refusal helper (vscode mocked) ──────────────────────────────────────────
{
  const shown = [];
  const vscode = { window: { showInformationMessage: async (m) => { shown.push(m); } } };
  const out = await build({
    stdin: { contents: "export { refuseOnChildSeat } from './childProfileHost.ts'; export { configureGuardianSwitch, configureChildSeat, CHILD_REFUSAL } from './childProfile.ts';", resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'],
  });
  const mod = { exports: {} };
  const req = createRequire(import.meta.url);
  vm.runInNewContext(out.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === 'vscode' ? vscode : req(id)) });
  const host = mod.exports;
  host.configureChildSeat(() => ({ child_profile: true }));
  // Unbound switch: off, nothing refused, no message.
  for (const s of SURFACES) assert.equal(host.refuseOnChildSeat(s), false, `switch off: ${s} not refused`);
  assert.deepEqual(shown, [], 'switch off: no message');
  host.configureGuardianSwitch(() => true);
  for (const s of SURFACES) assert.equal(host.refuseOnChildSeat(s), true, `switch on: ${s} refused`);
  assert.deepEqual(shown, SURFACES.map((s) => host.CHILD_REFUSAL[s]), 'each refusal shows its 해요체 sentence');
  host.configureChildSeat(() => ({ child_profile: false }));
  assert.equal(host.refuseOnChildSeat('purchase'), false, 'switch on, not a child seat: not refused');
}

// ── Wiring: each surface's handler checks the child seat first ───────────────────
const wiring = [
  ['extension.ts', /"hypeproof-chat\.showPasses".*refuseOnChildSeat\("purchase"\)/],
  ['extension.ts', /"hypeproof-chat\.publishSite".*refuseOnChildSeat\("publish"\)/],
  ['extension.ts', /"hypeproof-chat\.publishTestVersion".*refuseOnChildSeat\("publish"\)/],
  ['extension.ts', /"hypeproof-chat\.ventureMemory".*refuseOnChildSeat\("memory"\)/],
  ['extension.ts', /configureGuardianSwitch\(\(\) => vscode\.workspace\.getConfiguration\('hypeproofChat'\)\.get<boolean>\(GUARDIAN_SETTING, false\)\)/],
  ['extension.ts', /configureChildSeat\(\(\) => provider\.childGateProfile\)/],
  ['skillStorePanel.ts', /SKILL_STORE_COMMAND, \(\) => refuseOnChildSeat\("store"\)/],
  ['skillStorePanel.ts', /SKILL_STORE_PUBLISH_QUEST_COMMAND, \(\) => \{\n\s+if \(refuseOnChildSeat\("store"\)\) return;/],
  ['mobileConversationHost.ts', /MOBILE_CONVERSATION_COMMAND,async\(\)=>\{\n\s+if\(refuseOnChildSeat\('connections'\)\)return;/],
  ['companionWorkspaceHost.ts', /COMPANION_WORKSPACE_COMMAND, \(\) => refuseOnChildSeat\('connections'\)/],
  ['externalSkillCommands.ts', /if \(busy \|\| refuseOnChildSeat\('connections'\)\) return;/],
  ['automationHost.ts', /async function startConversation\(\) \{\n(?:\s*\/\/.*\n)?\s+if \(refuseOnChildSeat\('connections'\)\) return;/],
  ['startPage.ts', /childRefusalNow\("purchase"\)/],
  ['startPage.ts', /\.\.\.\(childSeat \? \{\} : \{ purchase: this\.purchaseView\(\) \}\)/],
  ['startPage.ts', /this\.storeOn && !childSeat/],
  ['chatPanelProvider.ts', /get activityMemoryBinding\(\)[^\n]*\n(?:\s*\/\/.*\n)?\s+if \(isChildSeat\(this\.cachedProfile\)\) return undefined;/],
  ['chatPanelProvider.ts', /childGuardianNotice\(profile\) \? \{ guardianNotice: childGuardianNotice\(profile\) \}/],
  ['proxyClient.ts', /profile: applyChildPosture\(\(await res\.json\(\)\) as ResolvedProfile\)/],
];
for (const [file, re] of wiring) assert.match(src(file), re, `${file}: ${re}`);
assert.match(readFileSync(fileURLToPath(new URL('../webview-ui/src/ChatPanel.tsx', import.meta.url)), 'utf8'), /config\.guardianNotice && <p className="hps-class-window" role="note" data-testid="guardian-notice">/, 'GRD-24: the chat panel draws the notice with no close button');

// ── Manifest: the switch exists, machine-scoped, default off ─────────────────────
{
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  const sections = Array.isArray(manifest.contributes.configuration) ? manifest.contributes.configuration : [manifest.contributes.configuration];
  const setting = sections.map((s) => s.properties[`hypeproofChat.${child.GUARDIAN_SETTING}`]).find(Boolean);
  assert.ok(setting, 'hypeproofChat.guardianEnabled is declared');
  assert.equal(setting.type, 'boolean');
  assert.equal(setting.default, false, 'GRD-23: default off');
  assert.equal(setting.scope, 'machine', 'a workspace cannot turn it on');
}

console.log('child-profile-posture: ok');
