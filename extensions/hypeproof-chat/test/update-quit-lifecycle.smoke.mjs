// Execute the real native contribution with fake platform services. No desktop input.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import path from 'node:path';
import fs from 'node:fs';
import { INSTALL_STAGED_UPDATE_COMMAND } from '../src/stagedUpdate.ts';
const source = '../../../scripts/patches/core/src/vs/workbench/contrib/hpsQuitGuard/electron-browser/hpsQuitGuard.contribution.ts';
const entry = new URL(source, import.meta.url).pathname;
async function contribution(isMacintosh) {
  const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }, plugins: [{ name: 'platform', setup(b) {
    b.onResolve({ filter: /\.js$/ }, args => {
      if (args.path.includes('hpsQuitGuardCore')) return { path: path.resolve(path.dirname(args.importer), '../common/hpsQuitGuardCore.ts') };
      return { path: args.path, namespace: 'service' };
    });
    b.onLoad({ filter: /.*/, namespace: 'service' }, () => ({ contents: `
      export const timeout = () => new Promise(() => {});
      export const isMacintosh = ${isMacintosh};
      export class Disposable { _register(value) { return value; } }
      export const ICommandService = () => {}, INativeHostService = () => {}, ILifecycleService = () => {};
      export const WorkbenchPhase = { AfterRestored: 1 };
      export function registerWorkbenchContribution2(id, ctor) { globalThis.Contribution = ctor; }
    `, loader: 'js' }));
  } }] });
  const sandbox = { module: { exports: {} } }; sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(bundle.outputFiles[0].text, sandbox);
  return sandbox.Contribution;
}
// Pinned VS Code: Cmd+Q / File > Exit = QUIT (2). Closing a window = CLOSE (1); on Windows
// the last window's close is the app exit (window-all-closed quits in the main process with
// no renderer left), so the handoff has to run on that CLOSE.
const installs = {
  darwin: { quit: 1, 'close-last': 0, 'close-other': 0 },
  win32: { quit: 1, 'close-last': 1, 'close-other': 0 },
};
for (const platform of ['darwin', 'win32']) {
  const Contribution = await contribution(platform === 'darwin');
  for (const scenario of ['idle', 'cancel', 'accept-active', 'other-veto', 'reload', 'close-last', 'close-other', 'cancel-close-last', 'failed-install']) {
    const before = [], will = [], calls = [], dialogs = [];
    const lifecycle = { onBeforeShutdown: cb => before.push(cb), onWillShutdown: cb => will.push(cb) };
    const command = { executeCommand: async id => {
      calls.push(id);
      if (id === INSTALL_STAGED_UPDATE_COMMAND) { if (scenario === 'failed-install') throw new Error('failed'); return; }
      assert.equal(id, '_hypeproof.quitGuard.prompt');
      return ['cancel', 'accept-active', 'cancel-close-last'].includes(scenario) ? { message: 'Studio를 끝낼까요?', detail: '지금 하고 있는 대답이 멈춰요.', continueLabel: '계속하기', quitLabel: '끝내기' } : null;
    } };
    const windows = scenario === 'close-other' ? 2 : 1;
    new Contribution(lifecycle, command, { getWindowCount: async () => windows, showMessageBox: async options => { dialogs.push(options); return { response: scenario.startsWith('cancel') ? 0 : 1 }; } });
    assert.equal(before.length, 1); assert.equal(will.length, 1);
    const reason = scenario === 'reload' ? 3 : scenario.includes('close') ? 1 : 2;
    const vetoes = []; for (const callback of before) callback({ reason, veto: promise => vetoes.push(promise) });
    const veto = (await Promise.all(vetoes)).some(Boolean) || scenario === 'other-veto';
    // Mimic the native contract: committed shutdown only after every veto has resolved.
    if (!veto) {
      const joins = []; for (const callback of will) callback({ reason, join: promise => joins.push(promise) });
      await Promise.all(joins);
    }
    const expected = ['idle', 'accept-active', 'failed-install'].includes(scenario) ? 1 : installs[platform][scenario] ?? 0;
    assert.equal(calls.filter(id => id === INSTALL_STAGED_UPDATE_COMMAND).length, expected, `${platform} ${scenario}`);
    if (scenario.startsWith('cancel')) { assert.equal(dialogs.length, 1); assert.equal(dialogs[0].buttons[0], '계속하기'); }
  }
  console.log(`PASS actual native contribution on ${platform}: ${platform === 'win32' ? 'last-window close and File > Exit hand off' : 'Cmd+Q hands off, window close does not'}`);
}
// Execute the exact local-host joiner from the generated patch, not a parallel implementation.
// Its deferred Last order must keep the host alive for the update command's Default joiner.
const patch = fs.readFileSync(new URL('../../../scripts/patches/core/hps-quit-guard.patch', import.meta.url), 'utf8');
const block = patch.split("+\t\t\t\tevent.join(() => this._doStopExtensionHosts(), {")[1]?.split('\n \t\t\t\t});')[0];
assert.ok(block, 'local-host shutdown is deferred');
const joins = []; let alive = true;
const joiner = vm.runInNewContext(`({${block.split('\n').map(l => l.startsWith('+') || l.startsWith(' ') ? l.slice(1) : l).join('\n')}})`, { WillShutdownJoinerOrder: { Last: 2 }, nls: { localize: (_key, text) => text } });
joins.push({ order: joiner.order, run: () => { alive = false; } });
joins.push({ order: 1, run: () => { assert.equal(alive, true, 'updater still has extension host'); } });
for (const join of joins.sort((a, b) => a.order - b.order)) join.run();
assert.equal(alive, false);
console.log('PASS actual native contribution: vetoes precede handoff, explicit quit only, extension teardown deferred');
