// CGP-ART-R-006 — the style tweak on the real ChatPanelProvider (bundled with esbuild, only VS Code
// I/O and the browser substituted): a pick is offered the five rows, a press is validated before any
// page write, page writes are ordered, a page change drops every choice, removal and a new pick take
// the preview off the page, the switch off refuses, and the queued turn text carries the request.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import type { ElementContext } from '../src/elementPick';

const ctx = (over: Partial<ElementContext> = {}): ElementContext => ({ ref: 'e1', backendNodeId: 5, tag: 'h1', text: '안녕', snippet: '<h1>안녕</h1>', snippetTruncated: false, style: {}, crop: null, source: 'unmapped', url: 'http://127.0.0.1:5173/index.html', route: '/index.html', documentGeneration: 'gen-1', artifact: { id: 'v1', entry: 'index.html', files: [] }, captureMs: 1, ...over });
const facts = { current: { color: 'rgb(0, 0, 0)', 'background-color': 'rgb(255, 255, 255)', 'font-size': '16px', padding: '0px', 'border-radius': '0px' }, styleAttr: 'margin: 1px', pageColors: ['rgb(0, 0, 0)', 'rgb(200, 30, 30)'] };
const flush = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  // A promise that never settles would let node exit 0 with checks unrun: fail instead.
  setTimeout(() => { console.error(`${process.argv[1]}: a call hung`); process.exit(1); }, 20000).unref?.();
  const keepAlive = setInterval(() => {}, 1000);
  const require = createRequire(process.cwd() + '/package.json');
  const { build } = require('esbuild');
  const vscode: any = {
    env: undefined,
    workspace: { getConfiguration: () => ({ get: (_k: string, fallback: unknown) => fallback }) },
    window: { createOutputChannel: () => ({ appendLine() {} }) },
    commands: { executeCommand: async () => {} },
  };
  const bundle = await build({ stdin: { contents: `export {ChatPanelProvider} from './src/chatPanelProvider'; export {ElementQueue} from './src/crHostWiring';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod: any = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id: string) => id === 'vscode' ? vscode : require(id), console, Buffer, process, URL, TextEncoder, TextDecoder, AbortSignal, crypto: webcrypto, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, performance });
  const { ChatPanelProvider, ElementQueue } = mod.exports;

  let posts: any[] = [];
  let applies: any[] = [];
  let switchOn = true;
  let generationOk = true;
  let reads = 0;
  let order: string[] = [];
  const host = () => {
    posts = []; applies = []; switchOn = true; generationOk = true; reads = 0; order = [];
    const h = Object.create(ChatPanelProvider.prototype);
    Object.assign(h, {
      elementQueue: new ElementQueue(),
      styleTweakChain: Promise.resolve(), // a class field; Object.create skips it
      post: async (m: any) => { posts.push(m); return true; },
      postPageNotice: (text: string) => { posts.push({ type: 'pageNotice', text }); },
      postDenialNotice: async (source: string) => { posts.push({ type: 'denial', source }); },
      isCurriculumRuntimeEnabled: () => switchOn,
      isImagePasteEnabled: () => false,
      mcpBrowser: {
        styleTweakRead: async (id: number, gen: string) => { reads++; order.push('read'); assert.equal(id, 5); assert.equal(gen, 'gen-1'); await flush(); return facts; },
        styleTweakApply: async (id: number, gen: string, attr: string | null, values: Record<string, string>) => {
          applies.push({ id, gen, attr, values: { ...values } }); order.push(Object.keys(values).length ? 'apply' : 'restore');
          await flush();
          if (!generationOk) throw new Error('화면이 바뀌었어요.');
        },
      },
    });
    return h;
  };
  const lastPreview = () => [...posts].reverse().find((m) => m.type === 'elementAttached')?.element;

  // Offer: a pick gets the five rows, read once from the picked node.
  let h = host();
  h.attachElementContext(ctx());
  await flush(); await flush(); await flush();
  const view = lastPreview().styleTweak;
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(view.rows.map((r: any) => r.label)), JSON.stringify(['색', '배경', '글자 크기', '간격', '모서리']));
  console.log('✓ host: a pick is offered the five rows from the picked node');

  // Outside the offered set: refused before any page write, nothing in the sent text.
  await h.handleStyleTweakMessage({ id: view.id, prop: 'color', value: 'rgb(1, 2, 3)' });
  await h.handleStyleTweakMessage({ id: view.id, prop: 'font-size', value: '17px' });
  assert.equal(applies.length, 0, 'no page write for a value outside the offer');
  assert.ok(posts.some((m) => m.type === 'pageNotice' && /고를 수 있는 값만/.test(m.text)));
  assert.equal(lastPreview().styleTweak.changes, 0);
  // A stale id (an earlier pick's panel) is ignored silently.
  posts = [];
  await h.handleStyleTweakMessage({ id: 'old', prop: 'color', value: 'rgb(200, 30, 30)' });
  assert.equal(applies.length, 0); assert.ok(!posts.some((m) => m.type === 'pageNotice'));
  console.log('✓ host: a value outside the offer or a stale panel never reaches the page');

  // Valid presses: the state changes before the page write; writes run in order, each the whole state.
  const p1 = h.handleStyleTweakMessage({ id: view.id, prop: 'color', value: 'rgb(200, 30, 30)' });
  const p2 = h.handleStyleTweakMessage({ id: view.id, prop: 'font-size', value: '20px' });
  assert.match(h.elementQueue.preview().styleTweak.requestText, /"property":"font-size","old":"16px","new":"20px"/, 'a send right after the press already carries it');
  await Promise.all([p1, p2]);
  assert.equal(JSON.stringify(applies.map((a) => a.values)), JSON.stringify([{ color: 'rgb(200, 30, 30)' }, { color: 'rgb(200, 30, 30)', 'font-size': '20px' }]));
  assert.ok(applies.every((a) => a.attr === 'margin: 1px' && a.id === 5 && a.gen === 'gen-1'), 'always the original attribute, the picked node, its document');
  console.log('✓ host: presses are validated, then previewed in order with the original style attribute');

  // Reset one property.
  await h.handleStyleTweakMessage({ id: view.id, prop: 'font-size', value: null });
  assert.equal(JSON.stringify(applies.at(-1).values), JSON.stringify({ color: 'rgb(200, 30, 30)' }));
  // Removal takes the preview off the page.
  applies = [];
  h.clearElementContext();
  await flush(); await flush(); await flush();
  assert.equal(JSON.stringify(applies.map((a) => a.values)), JSON.stringify([{}]), 'removal restores the page');
  assert.equal(h.elementQueue.preview(), null);
  console.log('✓ host: per-property reset, and removal restores the page');

  // A new pick replaces the old one: its preview leaves the page first, and the old panel is stale.
  h = host();
  h.attachElementContext(ctx());
  await flush(); await flush(); await flush();
  const first = lastPreview().styleTweak;
  await h.handleStyleTweakMessage({ id: first.id, prop: 'color', value: 'rgb(200, 30, 30)' });
  applies = [];
  h.attachElementContext(ctx({ backendNodeId: 5, ref: 'e2' }));
  await flush(); await flush(); await flush();
  assert.equal(JSON.stringify(applies[0]?.values), '{}', 'the old preview is restored');
  await h.handleStyleTweakMessage({ id: first.id, prop: 'font-size', value: '20px' });
  assert.equal(applies.length, 1, 'the old panel can no longer write');
  console.log('✓ host: a new pick restores the old preview and makes the old panel stale');

  // The page changed under the preview: every choice is dropped and the learner is told.
  h = host();
  h.attachElementContext(ctx());
  await flush(); await flush(); await flush();
  const v = lastPreview().styleTweak;
  generationOk = false;
  await h.handleStyleTweakMessage({ id: v.id, prop: 'color', value: 'rgb(200, 30, 30)' });
  assert.equal(h.elementQueue.preview().styleTweak.changes, 0, 'nothing chosen on a changed page is sent');
  assert.ok(posts.some((m) => m.type === 'pageNotice' && /화면이 바뀌어서 고른 스타일을 지웠어요/.test(m.text)));
  console.log('✓ host: a page change drops the choices and says so');

  // Re-pick of the same node while its preview is on: the restore runs before the read, so the
  // offer never reads the preview as the original.
  h = host();
  h.attachElementContext(ctx());
  await flush(); await flush(); await flush(); await flush();
  const r1 = lastPreview().styleTweak;
  void h.handleStyleTweakMessage({ id: r1.id, prop: 'color', value: 'rgb(200, 30, 30)' });
  order = [];
  h.attachElementContext(ctx());
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(JSON.stringify(order), JSON.stringify(['apply', 'restore', 'read']), `in-flight preview, then restore, then the new read: ${order}`);
  console.log('✓ host: a re-pick restores the page before reading it again');

  // A slow read for an earlier pick of the same node lands after a newer pick: refused.
  h = host();
  let release: () => void = () => {};
  let firstRead = true;
  h.mcpBrowser.styleTweakRead = async () => { if (firstRead) { firstRead = false; await new Promise<void>((r) => { release = r; }); } return facts; };
  h.attachElementContext(ctx());
  await flush();
  h.attachElementContext(ctx({ ref: 'e2' }));
  release();
  for (let i = 0; i < 6; i++) await flush();
  const offers = posts.filter((m) => m.type === 'elementAttached' && m.element?.styleTweak).map((m) => m.element.styleTweak.id);
  assert.equal(new Set(offers).size, 1, `only the newer pick's read is offered: ${offers}`);
  console.log('✓ host: a read for an earlier pick of the same node is never offered');

  // Switch off with a preview on the page: the preview is taken off (restore), nothing new previewed.
  h = host();
  h.attachElementContext(ctx());
  await flush(); await flush(); await flush(); await flush();
  const so = lastPreview().styleTweak;
  await h.handleStyleTweakMessage({ id: so.id, prop: 'color', value: 'rgb(200, 30, 30)' });
  switchOn = false; applies = [];
  await h.handleStyleTweakMessage({ id: so.id, prop: 'font-size', value: '20px' });
  await flush(); await flush(); await flush();
  assert.equal(JSON.stringify(applies.map((a) => a.values)), JSON.stringify([{}]), 'switch off: only the restore runs');
  console.log('✓ host: turning the switch off takes the preview off the page');

  // Switch off: refused, the element is removed.
  h = host();
  h.attachElementContext(ctx());
  await flush(); await flush(); await flush();
  const w = lastPreview().styleTweak;
  switchOn = false;
  await h.handleStyleTweakMessage({ id: w.id, prop: 'color', value: 'rgb(200, 30, 30)' });
  assert.equal(applies.length, 0); assert.ok(posts.some((m) => m.type === 'denial' && m.source === 'lesson'));
  assert.equal(h.elementQueue.preview(), null);
  console.log('✓ host: with the switch off nothing is previewed and the element is dropped');

  // A failed read offers nothing; the element itself stays.
  h = host();
  h.mcpBrowser.styleTweakRead = async () => { throw new Error('gone'); };
  h.attachElementContext(ctx());
  await flush(); await flush(); await flush();
  assert.ok(h.elementQueue.preview() && !h.elementQueue.preview().styleTweak);
  console.log('✓ host: a failed read leaves the element attached without rows');
  // The real handleSend: the preview leaves the page before the element (and its request) is taken
  // for the turn, and only the panel's own send text carries the {property, old, new} lines.
  vscode.env = { appName: 'HypeProof Studio' };
  for (const [label, sendText, carries] of [['panel send', null, true], ['ordinary message', '이 제목 좀 고쳐 줘', false]] as const) {
    h = host();
    h.attachElementContext(ctx());
    await flush(); await flush(); await flush(); await flush();
    const sv = lastPreview().styleTweak;
    await h.handleStyleTweakMessage({ id: sv.id, prop: 'font-size', value: '20px' });
    const text = sendText ?? lastPreview().styleTweak.sendText;
    applies = []; order = [];
    const taken: any[] = [];
    const queue = h.elementQueue;
    Object.assign(h, {
      pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(), getHistory: () => [],
      annotationScope: () => 'activity:task', annotationRuntimeAvailable: () => true, cachedProfile: { activity_kind: 'personal' },
      context: { secrets: { get: async () => 'token' }, workspaceState: { get: () => undefined } },
      ensureProfile: async () => null, loadAccess: async () => {}, getCoach: () => ({}), _instructorMode: { isInstructor: false },
      pullQuestResultFromPreview: async () => {}, takeAnnotationBatch: async () => null, rememberAnnotationTurn() {}, finishAnnotationSend() {}, dropPageAttachment() {},
      elementQueue: { take: (on: boolean, t: string | null) => { order.push('take'); taken.push(queue.take(on, t)); throw new Error('TAKEN'); }, get tweak() { return queue.tweak; } },
    });
    h.annotationBoundScope = 'activity:task';
    const err = await h.handleSend(text, []).then(() => null, (e: Error) => e);
    for (let i = 0; i < 4; i++) await flush();
    assert.equal(err?.message, 'TAKEN', `${label}: reached the element take (${err?.message})`);
    // The restore is queued before the take (which clears the tweak), then runs on the write chain.
    assert.ok(order.includes('restore') && order.includes('take'), `${label}: the send took the element and restored the page: ${order}`);
    assert.equal(JSON.stringify(applies.map((a) => a.values)), JSON.stringify([{}]), `${label}: the restore is the original attribute only`);
    assert.equal(/"property":"font-size","old":"16px","new":"20px"/.test(taken[0]?.text ?? ''), carries, `${label}: request lines ${carries ? 'ride' : 'do not ride'} on this send`);
  }
  console.log('✓ host: a send restores the page first; only the panel send carries the request');
  clearInterval(keepAlive);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
