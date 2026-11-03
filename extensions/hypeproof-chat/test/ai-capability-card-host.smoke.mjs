// CGP-AGENT-D-002: exercise real postConfig, including effective settings and fallback.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const built = await build({ stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const settings = { coachRuntime: 'agent-sdk', requireApprovalFor: ['writeFile', 'delegateAgent', 'webSearch'] };
const vscode = { env: { appName: 'HypeProof Studio' }, workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) }, commands: { executeCommand: async () => {} } };
const module = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, process, Buffer, URL, setTimeout, clearTimeout });
const h = Object.create(module.exports.ChatPanelProvider.prototype);
let profile = { activity_kind: 'personal', sdk_tools: { read: true, write: true, shell: true, subagents: true, browser: true }, tools: { web_search: true }, browser_control: { enabled: true } };
const posts = [];
let previewFileGrant;
Object.assign(h, {
  preview: { setAskAboutFileEnabled: enabled => { previewFileGrant = enabled; } },
  context: { secrets: { get: async () => undefined }, workspaceState: { get: (_key, fallback) => fallback } },
  loadAccess: async () => {}, ensureProfile: async () => profile, refreshCrDirectorContext: async () => {},
  _instructorMode: { checkInstructorMode: async () => false, reset() {} },
  prepareTaskWorkspace: async () => {}, currentTaskStore: () => null,
  getCoach: () => ({ name: 'HypeProof' }), sitePublisher: () => ({ available: () => false }),
  post: async m => posts.push(JSON.parse(JSON.stringify(m))),
});
const publish = async () => { await h.postConfig(); const config = posts.filter(p => p.type === 'config').at(-1).config; assert.equal(previewFileGrant, config.fileAttach === true, 'preview header follows the same narrowed grant'); return config; };
const states = c => Object.fromEntries(c.aiCapabilities.map(r => [r.key, !r.on ? 'off' : r.asks ? 'ask' : 'on']));
assert.deepEqual(states(await publish()), { read: 'on', write: 'ask', shell: 'ask', subagents: 'ask', browser: 'ask', web_search: 'ask' });
settings.requireApprovalFor = [];
const updated = await publish();
assert.deepEqual(states(updated), { read: 'on', write: 'on', shell: 'ask', subagents: 'on', browser: 'ask', web_search: 'on' });
assert.equal(updated.capabilityChange, undefined, 'approval setting is not a new grant');
settings.requireApprovalFor = ['writeFile', 'delegateAgent', 'webSearch'];
h.fallbackNoticeShown = true;
// After the fallback the browser loop runs on the proxy: it auto-runs and logs, with no per-action modal (browserControl.ts), so it must not say 물어봐요.
assert.deepEqual(states(await publish()), { read: 'off', write: 'off', shell: 'off', subagents: 'off', browser: 'on', web_search: 'on' });
h.fallbackNoticeShown = false;
// The proxy runtime chosen up front reads the same way; back on agent-sdk the browser asks again (control).
settings.coachRuntime = 'proxy';
assert.deepEqual(states(await publish()), { read: 'off', write: 'off', shell: 'off', subagents: 'off', browser: 'on', web_search: 'on' });
settings.coachRuntime = 'agent-sdk';
assert.equal(states(await publish()).browser, 'ask', 'control: the agent-sdk browser asks (browser_open approval)');
profile = { activity_kind: 'classroom', sdk_tools: { read: true } };
const narrowed = await publish();
assert.deepEqual(states(narrowed), { read: 'on', write: 'off', shell: 'off', subagents: 'off', browser: 'off', web_search: 'off' });
assert.ok(narrowed.aiCapabilities.filter(r => !r.on).every(r => r.asks === undefined), 'denied grants have no approval hint');
profile = null;
assert.equal((await publish()).aiCapabilities, undefined, 'unknown profile has no card');
// Execute the actual registered listener body with a fake configuration event.
const extension = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
const listener = extension.match(/onDidChangeConfiguration\(event => \{([\s\S]*?)\n  \}\)/)[1];
let refreshes = 0;
for (const changed of ['hypeproofChat.requireApprovalFor', 'workbench.reduceMotion', 'unrelated.setting']) {
  const before = refreshes;
  vm.runInNewContext(listener, { event: { affectsConfiguration: name => name === changed }, provider: { refreshConfig: () => { refreshes++; } } });
  assert.equal(refreshes - before, changed === 'unrelated.setting' ? 0 : 1, changed);
}
console.log('ai-capability-card-host OK');

// CGP-SHELL-R-015: real publication must distinguish cohort locks from local/instructor menus.
const fixed = { revision: 'hps-model-selection/1', source: 'profile', runtime: 'agent-sdk', provider: 'anthropic', default: 'fixed', choices: [{ alias: 'fixed', id: 'model-fixed', label: '수업 모델', effort: { default: 'high', allowed: ['high'] } }] };
profile = { profile_id: 'cohort', activity_kind: 'classroom', model_selection: fixed };
for (const runtime of ['proxy', 'agent-sdk']) {
  settings.coachRuntime = runtime;
  profile.model_selection = { ...fixed, runtime };
  const c = await publish();
  assert.deepEqual(c.cohortSettings, { model: true, effort: true }, runtime);
  assert.equal(c.model, 'fixed');
  assert.deepEqual(c.effort, { value: 'high', allowed: ['high'] });
}
profile.model_selection = { ...fixed, choices: [...fixed.choices, { alias: 'other', id: 'other', label: '다른 모델' }] };
profile.model_selection.choices[0] = { ...fixed.choices[0], effort: { default: 'high', allowed: ['low', 'high'] } };
assert.deepEqual((await publish()).cohortSettings, { model: false, effort: false }, 'refresh unlocks both controls');
profile.model_selection = fixed;
for (const kind of ['personal', 'trial', undefined]) {
  profile.activity_kind = kind;
  assert.equal((await publish()).cohortSettings, undefined, `no teacher attribution: ${kind}`);
}
profile.lesson = { sha256: 'lesson-a' };
assert.deepEqual((await publish()).cohortSettings, { model: true, effort: true }, 'legacy lesson without seat kind');
profile.lesson = undefined;
profile.activity_kind = 'classroom';
h._instructorMode.checkInstructorMode = async () => true;
assert.equal((await publish()).cohortSettings, undefined, 'instructor');
h._instructorMode.checkInstructorMode = async () => false;
profile = null;
assert.equal((await publish()).cohortSettings, undefined, 'profile cleared');
console.log('cohort settings host OK');

profile = { profile_id: 'cohort', activity_kind: 'classroom', model_selection: fixed };
vscode.env.appName = 'HypeProof Studio Dev';
settings.proxyUrl = 'http://127.0.0.1:8787/v1';
const savedEnv = { ...process.env };
try {
  Object.assign(process.env, { HPS_DEV_RUNTIME: '1', HPS_DEV_PROVIDER: 'codex', HPS_DEV_EXECUTABLE: '/tmp/codex.exe', HPS_DEV_MODEL: 'local-model' });
  const local = await publish();
  assert.equal(local.model, 'local-model');
  assert.equal(local.cohortSettings, undefined, 'local singleton must not claim teacher provenance');
} finally {
  for (const key of ['HPS_DEV_RUNTIME', 'HPS_DEV_PROVIDER', 'HPS_DEV_EXECUTABLE', 'HPS_DEV_MODEL']) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
}
