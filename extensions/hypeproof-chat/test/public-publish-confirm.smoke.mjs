// CGP-KNOW-R-007 / REQ-KNOW-10: the public-audience step, through the real host gate, the real in-panel approval and
// every public producer (gallery, test-version publish, share link). VS Code is replaced at the bundle boundary and every
// network call is intercepted; nothing leaves the machine and no window opens.
//   P1  public: content step, then a separate "public" step; only an explicit second yes publishes
//   P2  panel hidden: public is refused with a Korean explanation and NO native modal (a native default button confirms
//       on Enter); a cohort-only send keeps the native fallback
//   P3  the in-panel approval: the public step is its own prompt with one acknowledgement id; a content item set never
//       answers it, and the acknowledgement never answers a content checklist
//   P4  every producer sends public: true and nothing leaves when the second step is cancelled or the panel is hidden
//   P5  single flight, frozen recipient, control and bidi characters
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const ext = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = `export { confirmOutbound, setOutboundPresenter, PUBLIC_NEEDS_PANEL, OUTBOUND_BUSY } from './src/outboundConsentHost.ts';
export { OutboundApproval, PUBLIC_AUDIENCE_ACK, outboundPromptItemIds } from './src/outboundApproval.ts';
export { PublishSession } from './src/publishSession.ts';
export { publishWorldConfirmed } from './src/galleryPublish.ts';`;
const out = await build({ stdin: { contents: entry, resolveDir: ext, sourcefile: 'public-publish-entry.ts', loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'], logLevel: 'silent' });
const modals = [], infos = []; let modalAnswer;
const vscode = { window: {
  showWarningMessage: async (title, options, ...actions) => { modals.push({ title, ...options, actions }); return modalAnswer; },
  showInformationMessage: async (message, ...rest) => { infos.push({ message, rest }); return undefined; },
} };
const mod = { exports: {} };
vm.runInNewContext(out.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? vscode : require(id), TextEncoder, TextDecoder, structuredClone, setTimeout, clearTimeout, URL, Response, Request, Headers, fetch: async () => { throw Error('no network'); }, console: { log() {}, warn() {}, error() {} }, Buffer, process, crypto: globalThis.crypto, AbortController, AbortSignal });
const { confirmOutbound, setOutboundPresenter, PUBLIC_NEEDS_PANEL, OUTBOUND_BUSY, OutboundApproval, PUBLIC_AUDIENCE_ACK, outboundPromptItemIds, PublishSession, publishWorldConfirmed } = mod.exports;
const yes = '확인하고 보내기';
const manifest = (publicAudience = true) => ({ recipient: '갤러리 · destination.invalid', public: publicAudience, items: [{ name: 'index.html', bytes: 12 }] });
const reset = () => { modals.length = 0; infos.length = 0; modalAnswer = undefined; };
let pass = 0; const ok = label => { pass++; console.log('  ok   ' + label); };

// ── P1 public: two separate in-panel decisions ────────────────────────────────────────────────────────────────────
{
  for (const second of [false, null, true]) {
    reset(); const steps = [];
    const reg = setOutboundPresenter(async (m, step) => { steps.push([step, m.recipient, m.public]); return step === 'content' ? true : second; });
    modalAnswer = yes; // a native modal answered yes must never be enough
    assert.equal(await confirmOutbound(manifest()), second === true, `second answer ${second}`);
    assert.deepEqual(steps, [['content', '갤러리 · destination.invalid', true], ['public', '갤러리 · destination.invalid', true]], 'content first, then its own public step');
    assert.equal(modals.length, 0, 'the public step is never a native modal');
    assert.equal(infos.length, second === null ? 1 : 0); if (second === null) assert.equal(infos[0].message, PUBLIC_NEEDS_PANEL);
    reg.dispose();
  }
  for (const first of [async () => false, async () => { throw Error('closed'); }]) {
    reset(); const steps = []; const reg = setOutboundPresenter(async (m, step) => { steps.push(step); return first(); });
    assert.equal(await confirmOutbound(manifest()), false); assert.deepEqual(steps, ['content'], 'a cancelled checklist never reaches the public step'); reg.dispose();
  }
  reset(); const steps = []; const reg = setOutboundPresenter(async (m, step) => { steps.push(step); return true; });
  assert.equal(await confirmOutbound(manifest(false)), true); assert.deepEqual(steps, ['content'], 'class-only skips the public step'); reg.dispose();
  ok('P1 public needs a separate in-panel yes; cancel/hidden/dismiss at either step publishes nothing; class-only skips it');
}

// ── P2 panel hidden ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  for (const presenter of [undefined, async () => null]) {
    const reg = presenter && setOutboundPresenter(presenter);
    reset(); modalAnswer = yes;
    assert.equal(await confirmOutbound(manifest()), false, 'public with no visible panel is refused');
    assert.equal(modals.length, 0, 'no native modal whose default button could publish on Enter');
    assert.deepEqual(infos.map(i => i.message), [PUBLIC_NEEDS_PANEL]); assert.deepEqual(infos[0].rest, [], 'a plain notice: no button to press');
    assert.match(PUBLIC_NEEDS_PANEL, /채팅 창/); assert.match(PUBLIC_NEEDS_PANEL, /인터넷의 누구나/);
    reset(); modalAnswer = yes;
    assert.equal(await confirmOutbound(manifest(false)), true, 'a cohort-only send keeps the native fallback');
    assert.equal(modals.length, 1); assert.equal(modals[0].title, '보내기 전에 확인해 주세요');
    reset(); assert.equal(await confirmOutbound(manifest(false)), false, 'dismissed native fallback sends nothing');
    reg?.dispose();
  }
  ok('P2 panel hidden: public refused with a Korean notice and no native modal; class-only keeps its native fallback');
}

// ── P3 the in-panel approval, as chatPanelProvider wires it ─────────────────────────────────────────────────────────
{
  const presented = [];
  const approval = new OutboundApproval({ scope: () => 's', id: (() => { let n = 0; return () => `p${++n}`; })(), present: async p => { if (p) presented.push(p); return true; } });
  const reg = setOutboundPresenter((m, step) => approval.confirm(m, step));
  const settle = () => new Promise(r => setTimeout(r, 5));
  // Content approved, then the public prompt is answered with the content item set: refused.
  presented.length = 0;
  let run = confirmOutbound(manifest()); await settle();
  approval.respond(presented[0].id, outboundPromptItemIds(presented[0])); await settle();
  assert.equal(presented.length, 2); assert.equal(presented[1].step, 'public');
  assert.deepEqual({ ...presented[1], id: 'x' }, { id: 'x', step: 'public', audience: '인터넷의 누구나', notAudience: '우리 반', recipient: '갤러리 · destination.invalid' });
  assert.equal(presented[1].sections, undefined, 'the public step carries no checklist');
  approval.respond(presented[1].id, outboundPromptItemIds(presented[0])); assert.equal(await run, false, 'item ids never answer the public step');
  // The acknowledgement never answers a content checklist.
  presented.length = 0; run = confirmOutbound(manifest()); await settle();
  approval.respond(presented[0].id, [PUBLIC_AUDIENCE_ACK]); assert.equal(await run, false); assert.equal(presented.length, 1);
  // Only the explicit acknowledgement on the public prompt publishes.
  presented.length = 0; run = confirmOutbound(manifest()); await settle();
  approval.respond(presented[0].id, outboundPromptItemIds(presented[0])); await settle();
  approval.respond(presented[1].id, [PUBLIC_AUDIENCE_ACK]); assert.equal(await run, true);
  presented.length = 0; run = confirmOutbound(manifest()); await settle();
  approval.respond(presented[0].id, outboundPromptItemIds(presented[0])); await settle();
  approval.respond(presented[1].id, null); assert.equal(await run, false, 'Cancel/Escape on the public step');
  reg.dispose();
  ok('P3 the panel asks the public step as its own prompt; only its single acknowledgement publishes');
}

// ── P4 every public producer ─────────────────────────────────────────────────────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'hps-public-confirm-'));
  try {
    writeFileSync(join(root, 'index.html'), '<p>page</p>');
    const project = { id: 'prj-synthetic', title: 'project', members: ['synthetic'] };
    const state = { project, test_origin: null, versions: [{ id: 'v1', files: [{ path: 'index.html', bytes: 11, sha256: 'a' }] }], hypotheses: [], experiments: [{ id: 'exp-1', product_version_id: 'v1' }], links: [] };
    let calls = [];
    const ports = { switchOn: () => true, scopeKey: () => 'one', confirmOutbound, token: async () => 't', base: () => 'https://service.invalid/v1/curriculum', root: () => root, entry: () => '/index.html', events: async () => [], projectId: () => project.id, setProjectId: async () => {}, week: () => 1, defaultTitle: () => 'title', qr: u => u, privateDirectories: () => [],
      fetchImpl: async (u, i) => { calls.push([u, i?.method ?? 'GET']); if ((i?.method ?? 'GET') !== 'GET') return Response.json(new URL(u).pathname.endsWith('/experiments') ? { experiment: { id: 'exp-synthetic' } } : new URL(u).pathname.includes('/versions/') ? { version: { id: 'v' }, created: true } : { share_url: 'https://test.invalid/l/1' }); return Response.json(new URL(u).pathname.endsWith('/projects') ? { projects: [project] } : state); } };
    const form = { question: 'q', method: 'task_test', success_criteria: ['c'], hypothesis: 'h', expires_in_days: 1 };
    const session = new PublishSession(ports);
    const writes = () => calls.filter(([, m]) => m !== 'GET');
    const PATHS = {
      'test-version publish': async () => (await session.submit({ ...form })).ok,
      'share link': async () => (await session.link('exp-1', { expires_in_days: 1 })).ok,
      'gallery publish': async () => (await publishWorldConfirmed({ siteBase: 'https://gallery.invalid', token: 't', worldId: 'w', title: '작품', html: '<p>x</p>', fetchImpl: async (u, i) => { calls.push([u, i?.method ?? 'GET']); return Response.json({ ok: true, url: '/w/1' }); } }, confirmOutbound, async () => true, null)).ok,
    };
    for (const [name, run] of Object.entries(PATHS)) {
      for (const [label, presenter, sent] of [
        ['second step cancelled', async (m, step) => step === 'content', false],
        ['second step dismissed by a reload (panel gone)', async (m, step) => step === 'content' ? true : null, false],
        ['panel hidden', async () => null, false],
        ['both steps approved', async () => true, true],
      ]) {
        reset(); calls = []; modalAnswer = yes; const steps = [];
        const reg = setOutboundPresenter(async (m, step) => { steps.push(step); assert.equal(m.public, true, `${name}: the manifest declares a public audience`); return presenter(m, step); });
        assert.equal(await run(), sent, `${name}: ${label}`);
        reg.dispose();
        assert.equal(modals.length, 0, `${name}: never a native modal`);
        if (label !== 'panel hidden') assert.deepEqual(steps, ['content', 'public'], `${name}: ${label} asks the public step`);
        if (sent) assert.ok(writes().length > 0, `${name}: approved sends`); else assert.deepEqual(writes(), [], `${name}: ${label} sends nothing`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  ok('P4 test-version publish, share link and gallery: public step required; cancel, reload and hidden panel send nothing');
}

// ── P5 single flight, frozen recipient, hostile text ───────────────────────────────────────────────────────────────
{
  reset(); let release; const seen = [];
  const original = manifest();
  const reg = setOutboundPresenter((m, step) => { seen.push([step, m.recipient]); return step === 'content' ? new Promise(r => { release = r; }) : Promise.resolve(true); });
  const pending = confirmOutbound(original);
  original.recipient = 'changed.invalid'; original.public = false;
  assert.equal(await confirmOutbound(manifest()), false, 'a double press while a prompt is open is refused');
  assert.deepEqual(infos.map(i => i.message), [OUTBOUND_BUSY], 'and says why');
  release(true); assert.equal(await pending, true);
  assert.deepEqual(seen, [['content', '갤러리 · destination.invalid'], ['public', '갤러리 · destination.invalid']], 'both steps see the frozen manifest, still public');
  seen.length = 0; assert.equal(await Promise.race([confirmOutbound(manifest()), new Promise(r => setTimeout(() => r('stuck'), 200))]) === 'stuck', true, 'lock released (next call reaches the presenter)');
  release(false); reg.dispose();
  const approval = new OutboundApproval({ scope: () => 's', id: () => 'h1', present: async p => { if (p) seen.push(p); return true; } });
  seen.length = 0; const hostile = manifest(); hostile.recipient = 'host.invalid‮\nBAD';
  void approval.confirm(hostile, 'public'); await new Promise(r => setTimeout(r, 5));
  assert.equal(seen[0].recipient, 'host.invalid��BAD', 'control and bidi are not interpreted'); approval.cancel();
  ok('P5 single flight with a reason, frozen manifest across both steps, control/bidi neutralised');
}
console.log(`PASS public-publish-confirm (${pass} groups)`);
