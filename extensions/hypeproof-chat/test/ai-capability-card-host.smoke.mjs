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
Object.assign(h, {
  context: { secrets: { get: async () => undefined }, workspaceState: { get: (_key, fallback) => fallback } },
  loadAccess: async () => {}, ensureProfile: async () => profile, refreshCrDirectorContext: async () => {},
  _instructorMode: { checkInstructorMode: async () => false, reset() {} },
  prepareTaskWorkspace: async () => {}, currentTaskStore: () => null,
  getCoach: () => ({ name: 'HypeProof' }), sitePublisher: () => ({ available: () => false }),
  post: async m => posts.push(JSON.parse(JSON.stringify(m))),
});
const publish = async () => { await h.postConfig(); return posts.filter(p => p.type === 'config').at(-1).config; };
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
