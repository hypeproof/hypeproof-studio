// CGP-KNOW-D-010 fix round 1: the host half of the restricted-mode chip, through the real
// ChatPanelProvider (no regex on source).
//   C1  postConfig publishes folderRestricted === true only for a stored "read" in a personal seat:
//       full, none, unanswered and classroom each publish false (kills `tag !== "skip"`).
//   C2  a choice saved through the panel presenter refreshes the config and ends task command
//       allows (kills removal of the onFolderConsentChanged subscription).
// Run: node --experimental-strip-types test/folder-consent-config.smoke.mjs
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ext = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const FC = await import('../src/folderConsent.ts');
const bundle = await build({ stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider'; export { folderConsentProfile } from './src/folderConsentHost';", resolveDir: ext, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'folder-consent-config-')));
const home = path.join(tmp, 'home'), outside = path.join(tmp, 'outside');
fs.mkdirSync(home); fs.mkdirSync(outside);
const toUri = p => ({ fsPath: p, path: p, scheme: 'file' });
const ws = { folder: outside };
const inert = { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, inert)), apply: () => new Proxy(function () {}, inert), construct: () => new Proxy({}, inert) };
const vscode = new Proxy({
  env: { appName: 'HypeProof Studio' },
  window: { showWarningMessage: async () => { throw new Error('native modal must not open'); } },
  workspace: { getConfiguration: () => ({ get: (_k, fallback) => fallback }), get workspaceFolders() { return [{ uri: toUri(ws.folder), name: 'w' }]; } },
  Uri: { joinPath: () => toUri('/ext'), file: toUri },
  ViewColumn: { One: 1 },
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
}, inert);
const unref = fn => (...a) => { const t = fn(...a); t?.unref?.(); return t; };
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval, AbortSignal, AbortController, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone });
const { ChatPanelProvider, folderConsentProfile } = mod.exports;
const state = new Map();
const memento = () => ({ get: k => state.get(k), update: async (k, v) => { state.set(k, v); }, keys: () => [...state.keys()] });
const context = { subscriptions: [], extensionUri: toUri('/ext'), extensionPath: '/ext', extension: { packageJSON: {} }, globalState: memento(), workspaceState: { get: (_k, f) => f, update: async () => {} }, globalStorageUri: toUri(tmp), storageUri: toUri(tmp), secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) } };
const personal = { profile_id: 'p', activity_id: 'a'.repeat(64), activity_kind: 'personal', sdk_tools: { read: true, write: true, shell: true }, tools: {}, learning_wiki: { enabled: true } };
const classroom = { ...personal, activity_id: 'c'.repeat(64), activity_kind: 'classroom' };
const store = (profile, level) => { state.delete(FC.FOLDER_CONSENT_KEY); if (level) state.set(FC.FOLDER_CONSENT_KEY, FC.writeFolderConsent(undefined, profile.activity_id, FC.canonicalFolder(outside), level)); };
let passed = 0; const ok = n => { passed++; console.log('✓ ' + n); };

// C1 real postConfig, a plain provider object (the shape of ai-capability-card-host)
{
  let profile = personal; const posts = [];
  const h = Object.create(ChatPanelProvider.prototype);
  Object.assign(h, {
    context, loadAccess: async () => {}, ensureProfile: async () => profile, refreshCrDirectorContext: async () => {},
    _instructorMode: { checkInstructorMode: async () => false, reset() {} }, prepareTaskWorkspace: async () => {}, currentTaskStore: () => null,
    getCoach: () => ({ name: 'HypeProof' }), sitePublisher: () => ({ available: () => false }), servedWorkspaceRoot: home,
    post: async m => { posts.push(JSON.parse(JSON.stringify(m))); return true; },
  });
  const flag = async (p, level) => { profile = p; store(p, level); await h.postConfig(); const c = posts.filter(m => m.type === 'config').at(-1).config; return c.folderRestricted; };
  assert.equal(await flag(personal, 'read'), true, 'stored read shows the chip');
  assert.equal(await flag(personal, 'full'), false, 'full does not');
  assert.equal(await flag(personal, 'none'), false, 'none does not');
  assert.equal(await flag(personal, undefined), false, 'unanswered does not');
  assert.equal(await flag(classroom, 'read'), false, 'classroom never shows it, even with a stored read');
  ok('postConfig: folderRestricted is true only for a stored read on a personal seat');
}

// C2 the real constructor's subscription: saving through the panel refreshes config and ends allows
{
  const h = new ChatPanelProvider(context, {}, {});
  const events = [];
  h.postConfig = async () => { events.push('config'); };
  h.endTaskCommandAllows = () => { events.push('allows'); };
  const prompts = []; h.post = async m => { if (m.type === 'folderConsentPrompt' && m.prompt) prompts.push(m.prompt); return true; };
  h.view = { visible: true };
  store(personal, undefined);
  const turn = folderConsentProfile(context, personal, { servedRoot: home, instructor: false });
  for (let i = 0; i < 20 && !prompts.length; i++) await new Promise(r => setImmediate(r));
  assert.equal(prompts.length, 1, 'the panel is asked, not a native modal');
  await h.handleMessage({ type: 'folderConsentAnswer', id: prompts[0].id, level: 'read' });
  const narrowed = await turn;
  assert.equal(narrowed.sdk_tools.write, false); assert.equal(narrowed.sdk_tools.shell, false);
  assert.equal(FC.readFolderConsent(state.get(FC.FOLDER_CONSENT_KEY), personal.activity_id, FC.canonicalFolder(outside)), 'read');
  assert.deepEqual([...events].sort(), ['allows', 'config'], 'selection saved, then config refreshed and task allows ended');
  ok('panel answer: stored choice triggers postConfig and endTaskCommandAllows');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${passed} checks passed`);
process.exit(0);
