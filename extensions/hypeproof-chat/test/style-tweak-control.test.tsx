// CGP-ART-R-006 — BrowserControl's page side of the style tweak, on the real class (bundled with
// esbuild, VS Code and the CDP session faked): the node is resolved in an isolated world, the
// document generation and the preview origin are checked, a restore works with the switch off while
// a preview does not, a tab switch takes the preview off the old tab before its session closes, and
// a page that never answers cannot hold the call.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';

async function main() {
  // A promise that never settles would let node exit 0 with checks unrun: fail instead.
  setTimeout(() => { console.error(`${process.argv[1]}: a call hung`); process.exit(1); }, 20000).unref?.();
  const keepAlive = setInterval(() => {}, 1000);
  const require = createRequire(process.cwd() + '/package.json');
  const { build } = require('esbuild');
  const vscode: any = { window: { browserTabs: [], activeBrowserTab: undefined }, workspace: { getConfiguration: () => ({ get: (_k: string, f: unknown) => f }) } };
  const bundle = await build({ stdin: { contents: `export {BrowserControl} from './src/browserControl';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod: any = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id: string) => id === 'vscode' ? vscode : require(id), console, Buffer, process, URL, TextEncoder, TextDecoder, AbortSignal, crypto: webcrypto, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, performance });
  const { BrowserControl } = mod.exports;

  const fakeSession = (name: string, page: { loaderId: string; url: string; hang?: boolean }, log: any[]) => ({
    send: async (method: string, params: any) => {
      log.push([name, method, params]);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F', loaderId: page.loaderId, url: page.url } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 77 };
      if (method === 'DOM.resolveNode') return params.executionContextId === 77 ? { object: { objectId: `obj-${params.backendNodeId}` } } : null;
      if (method === 'Runtime.callFunctionOn') {
        if (page.hang) return new Promise(() => {});
        return { result: { value: params.functionDeclaration.includes('getComputedStyle') ? { current: { color: 'rgb(0, 0, 0)' }, styleAttr: null, pageColors: [] } : true } };
      }
      return {};
    },
    close: async () => { log.push([name, 'close']); },
  });
  let on = true;
  const control = new BrowserControl({ enabled: () => on, allowedOrigins: () => ['http://127.0.0.1:5173'], artifactVersion: async () => ({ id: 'v', entry: 'index.html', files: [] }) });
  const tabA = { url: 'http://127.0.0.1:5173/index.html', title: 'A' }, tabB = { url: 'http://127.0.0.1:5173/b.html', title: 'B' };
  const log: any[] = [];
  const pageA = { loaderId: 'gen-1', url: tabA.url };
  const sA = fakeSession('A', pageA, log);
  vscode.window.browserTabs = [tabA, tabB];
  control.setTargetTab(tabA);
  control.session = sA; control.tabForSession = tabA;

  // Read and apply resolve the node in the isolated world, never the page's main world.
  const facts = await control.styleTweakRead(5, 'gen-1');
  assert.equal(facts.current.color, 'rgb(0, 0, 0)');
  await control.styleTweakApply(5, 'gen-1', 'margin: 1px', { color: 'rgb(200, 30, 30)' });
  const resolves = log.filter((e) => e[1] === 'DOM.resolveNode');
  assert.ok(resolves.length === 2 && resolves.every((e) => e[2].executionContextId === 77 && e[2].backendNodeId === 5), 'resolved in the isolated world');
  const calls = log.filter((e) => e[1] === 'Runtime.callFunctionOn');
  assert.ok(calls.every((e) => e[2].objectId === 'obj-5'));
  assert.equal(JSON.stringify(calls[1][2].arguments), JSON.stringify([{ value: 'margin: 1px' }, { value: { color: 'rgb(200, 30, 30)' } }]));
  console.log('✓ control: read and preview run on the picked node in an isolated world');

  // A changed document or another origin refuses before any page call.
  log.length = 0;
  pageA.loaderId = 'gen-2';
  await assert.rejects(control.styleTweakApply(5, 'gen-1', null, { color: 'rgb(200, 30, 30)' }), /화면이 바뀌었어요/);
  pageA.loaderId = 'gen-1'; pageA.url = 'https://example.com/';
  await assert.rejects(control.styleTweakApply(5, 'gen-1', null, { color: 'rgb(200, 30, 30)' }), /범위 밖/);
  pageA.url = tabA.url;
  assert.ok(!log.some((e) => e[1] === 'Runtime.callFunctionOn'), 'no page call on a changed or foreign page');
  console.log('✓ control: a changed document or a foreign origin is refused before any page call');

  // Switch off: a preview is refused, a restore still runs.
  on = false;
  await assert.rejects(control.styleTweakApply(5, 'gen-1', null, { color: 'rgb(200, 30, 30)' }), /스타일 바꿔 보기/);
  await assert.rejects(control.styleTweakRead(5, 'gen-1'), /스타일 바꿔 보기/);
  log.length = 0;
  await control.styleTweakApply(5, 'gen-1', 'margin: 1px', {});
  assert.equal(JSON.stringify(log.find((e) => e[1] === 'Runtime.callFunctionOn')[2].arguments), JSON.stringify([{ value: 'margin: 1px' }, { value: {} }]), 'restore runs with the switch off');
  on = true;
  console.log('✓ control: with the switch off a preview is refused and a restore still runs');

  // Tab switch: the preview leaves the old tab before its session closes.
  await control.styleTweakApply(5, 'gen-1', 'margin: 1px', { 'font-size': '20px' });
  log.length = 0;
  control.setTargetTab(tabB);
  await new Promise((r) => setTimeout(r, 10));
  const restoreIdx = log.findIndex((e) => e[0] === 'A' && e[1] === 'Runtime.callFunctionOn' && JSON.stringify(e[2].arguments) === JSON.stringify([{ value: 'margin: 1px' }, { value: {} }]));
  const closeIdx = log.findIndex((e) => e[0] === 'A' && e[1] === 'close');
  assert.ok(restoreIdx >= 0 && closeIdx > restoreIdx, `restored on tab A, then closed: ${JSON.stringify(log.map((e) => e[0] + ':' + e[1]))}`);
  console.log('✓ control: a tab switch takes the preview off the old tab before closing its session');

  // A page that never answers: the call gives up instead of holding every later restore.
  const hung = { loaderId: 'gen-1', url: tabB.url, hang: true };
  control.session = fakeSession('B', hung, log); control.tabForSession = tabB;
  const t0 = Date.now();
  await assert.rejects(control.styleTweakApply(5, 'gen-1', null, { color: 'rgb(200, 30, 30)' }), /응답하지 않아요/);
  assert.ok(Date.now() - t0 < 5000);
  console.log('✓ control: a page that never answers cannot hold the call');
  clearInterval(keepAlive);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
