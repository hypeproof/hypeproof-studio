// REQ-STUDIO-SECONDARY-SIDEBAR-HIDDEN (#2787): no empty native Chat side bar on the right.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

// 1. Packaged default: a first-opened workspace or empty window starts with the bar hidden.
const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const defaults = manifest.contributes.configurationDefaults;
assert.equal(defaults['workbench.secondarySideBar.defaultVisibility'], 'hidden', 'secondary side bar hidden by default');
assert.equal(defaults['chat.disableAIFeatures'], true, 'native AI features stay disabled (the reason the native Chat bar is empty)');
console.log('PASS packaged default hides the secondary side bar');

// 2. Real activate(), stopped at the activity-store boundary, with stubbed vscode APIs.
const bundle = await build({ stdin: { contents: "export {activate} from './src/extension';export {NATIVE_CHAT_BAR_CLOSED_KEY} from './src/studioNavigation';",
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const commands = [], config = new Map();
let rejectClose = false;
const vscode = {
  ViewColumn: { One: 1 }, Uri: { joinPath: () => ({}), file: fsPath => ({ fsPath }) },
  commands: { executeCommand: async c => { commands.push(c); if (rejectClose && c === 'workbench.action.closeAuxiliaryBar') throw Error('close rejected'); } },
  workspace: { workspaceFolders: [], getConfiguration: section => ({ get: key => config.get(section + '.' + key) }) },
  window: { browserTabs: [] },
};
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? vscode : require(id), process, console, Buffer, URL, TextEncoder, TextDecoder });
const { activate, NATIVE_CHAT_BAR_CLOSED_KEY } = mod.exports;
const profile = () => { const map = new Map(); return { map, get: (k, d) => map.has(k) ? map.get(k) : d, update: async (k, v) => { map.set(k, v); } }; };
const activateWith = async globalState => {
  commands.length = 0;
  const ctx = { globalState, get globalStorageUri() { throw Error('activity-store-test-boundary'); } };
  await assert.rejects(activate(ctx), /activity-store-test-boundary/, 'activation continues to the activity store');
  return commands.filter(c => c === 'workbench.action.closeAuxiliaryBar').length;
};

config.set('chat.disableAIFeatures', true);
const persisted = profile();
assert.equal(await activateWith(persisted), 1, 'a profile that persisted the native Chat bar open gets it closed');
assert.equal(persisted.map.get(NATIVE_CHAT_BAR_CLOSED_KEY), true);
assert.equal(await activateWith(persisted), 0, 'second activation does not close again (learner may have reopened the bar)');
assert.equal(await activateWith(persisted), 0, 'nor any later one');
console.log('PASS AI disabled: the restored bar closes exactly once per profile');

config.set('chat.disableAIFeatures', false);
const enabled = profile();
assert.equal(await activateWith(enabled), 0, 'AI features on: the native Chat bar has content, leave it alone');
assert.equal(enabled.map.has(NATIVE_CHAT_BAR_CLOSED_KEY), false, 'no marker while AI features are on');
config.delete('chat.disableAIFeatures');
assert.equal(await activateWith(profile()), 0, 'unset setting is not treated as disabled');
console.log('PASS AI enabled or unset: nothing is closed and no marker is written');

config.set('chat.disableAIFeatures', true);
rejectClose = true;
const failing = profile();
assert.equal(await activateWith(failing), 1, 'one attempt');
assert.equal(failing.map.get(NATIVE_CHAT_BAR_CLOSED_KEY), true, 'marker written before the command');
rejectClose = false;
assert.equal(await activateWith(failing), 0, 'a failed close is not retried on the next activation');
console.log('PASS a rejected close neither blocks activation nor repeats');
