// REQ-STUDIO-DECK-PDF (CGP-ART-R-023) — the real provider's "덱 PDF로 저장": the served deck.html in a background tab,
// deck.pdf written next to it, a notice before anything is awaited, the tab closed after. The tab's CDP channel is a
// headless Chromium page (test/lib/headless-chromium.mjs) navigated to the tab's URL; FOCUS_REQUIRE_BROWSER=1 fails
// without a browser, otherwise the browser cases print NOT RUN. Only VS Code APIs and the Service profile are fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createTaskHarness } from './task-workspace-harness.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { deckFixture, plantNotes, pdfPages } from './lib/deck-pdf-fixture.mjs';

const wiki = await import('../src/learningWiki.ts');
const { SERVICE_CONTRACT_FIXTURES } = await import('./fixtures/service-contracts/index.mjs');
const PLAN = SERVICE_CONTRACT_FIXTURES.plan;
const bin = findChromium();
if (!bin && process.env.FOCUS_REQUIRE_BROWSER === '1') throw new Error('FOCUS_REQUIRE_BROWSER=1 and no headless Chromium was found');

function serveDir(root) {
  const server = createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((c) => server.close(c)) })));
}

async function setup({ wikiOn = true, drafted = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hps-deck-pdf-')));
  const f = await createTaskHarness(root);
  const work = path.join(root, 'work');
  fs.mkdirSync(path.join(work, 'venture'), { recursive: true });
  fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><title>제품</title><p>제품</p>');
  const html = drafted ? plantNotes(deckFixture()) : '<!doctype html><title>덱</title><main></main>';
  fs.writeFileSync(path.join(work, 'venture', 'deck.html'), html);
  const state = { ...wiki.newState('A'), sessions: [1, 2] };
  if (drafted) state.deck = { '2': { headline: 'a' }, '3': { headline: 'b' }, '5': { headline: 'c' } };
  wiki.saveState(path.join(work, 'venture'), state);
  f.h.cachedProfile = { learning_wiki: { enabled: wikiOn, plan: PLAN } };
  f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: work } }];
  f.vscode.ProgressLocation = { Window: 10 };
  const srv = await serveDir(work);
  const ensured = [];
  f.h.liveServer = { currentRoot: () => undefined, ensure: async (r) => { ensured.push(r); return srv.base; } };
  f.h.folderWriteRefusalFor = () => null;
  f.h.postDenialNotice = async (src) => { f.posts.push({ type: 'denial', src }); };
  const notices = () => f.posts.filter((m) => m.type === 'pageAttached').map((m) => m.label);
  return { f, root, work, srv, ensured, notices, done: async () => { await srv.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('learning wiki off or no deck: no tab, no file, a reason', async () => {
  const s = await setup({ wikiOn: false });
  try {
    await s.f.h.deckPdf();
    assert.equal(s.f.opened.length, 0);
    assert.deepEqual(s.f.posts.filter((m) => m.type === 'denial').map((m) => m.src), ['lesson']);
    s.f.h.cachedProfile.learning_wiki.enabled = true;
    fs.rmSync(path.join(s.work, 'venture', 'deck.html'));
    await s.f.h.deckPdf();
    assert.equal(s.f.opened.length, 0);
    assert.match(s.notices().at(-1), /아직 덱이 없어요/);
    assert.equal(fs.existsSync(path.join(s.work, 'venture', 'deck.pdf')), false);
  } finally { await s.done(); }
});

test('a deck with no drafted slide and a refused folder write: nothing opened or written', async () => {
  const s = await setup({ drafted: false });
  try {
    await s.f.h.deckPdf();
    assert.match(s.notices().at(-1), /아직 만든 장이 없어서/);
    const t = await setup();
    try {
      t.f.h.folderWriteRefusalFor = () => '이 폴더에는 쓸 수 없어요.';
      await t.f.h.deckPdf();
      assert.equal(t.f.opened.length, 0);
      assert.equal(t.notices().at(-1), '이 폴더에는 쓸 수 없어요.');
    } finally { await t.done(); }
  } finally { await s.done(); }
});

test('a preview serving another folder is never replaced', async () => {
  const s = await setup();
  try {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-other-'));
    s.f.h.liveServer.currentRoot = () => other;
    s.f.h.liveServer.ensure = async () => { throw new Error('must not restart another preview'); };
    await s.f.h.deckPdf();
    assert.equal(s.f.opened.length, 0);
    assert.match(s.notices().at(-1), /다른 폴더를 보여 주고/);
    fs.rmSync(other, { recursive: true, force: true });
  } finally { await s.done(); }
});

test('export: background tab on the served deck, deck.pdf with one page per drafted slide, tab closed, busy press refused', { skip: !bin && 'NOT RUN: no headless Chromium' }, async () => {
  const s = await setup();
  const browser = await launch(bin);
  try {
    const attached = [];
    s.f.h.deckPdfAttach = async (tab) => {
      attached.push(tab.url);
      // The first notice is already on screen before the tab is even opened.
      assert.match(s.notices()[0], /덱을 PDF로 저장하고 있어요 \(0 \/ 3장\)/);
      await browser.send('Page.navigate', { url: tab.url });
      // A second press while this one runs is refused (pressed once: without the guard it would recurse).
      if (!attached.includes('pressed')) { attached.push('pressed'); await s.f.h.deckPdf(); }
      return { send: browser.send, close: async () => { attached.push('closed'); } };
    };
    await s.f.h.deckPdf();
    assert.deepEqual(s.ensured, [s.work], 'the work folder is served when nothing else is');
    assert.equal(s.f.opened.length, 1);
    assert.equal(s.f.opened[0].url, s.srv.base + 'venture/deck.html');
    assert.equal(s.f.opened[0].options.background, true, 'a background tab; the learner keeps focus');
    assert.equal(s.f.opened[0].options.preserveFocus, true);
    assert.deepEqual(attached, [s.srv.base + 'venture/deck.html', 'pressed', 'closed']);
    assert.equal(s.f.browserState.tabs.length, 0, 'the export tab is closed');
    const out = fs.readFileSync(path.join(s.work, 'venture', 'deck.pdf'));
    assert.equal(pdfPages(out), 3);
    const n = s.notices();
    assert.ok(n.includes('이미 덱을 PDF로 저장하고 있어요. 끝난 뒤 다시 눌러 주세요.'), 'the second press was refused');
    assert.ok(n.includes('덱을 PDF로 저장하고 있어요 (3 / 3장)'));
    assert.equal(n.at(-1), '덱을 PDF로 저장했어요: venture/deck.pdf (3장, 발표자 노트 없이)');
    assert.deepEqual(fs.readdirSync(path.join(s.work, 'venture')).filter((x) => x.endsWith('.tmp')), [], 'no temp file left');
    // After the run the command is free again.
    assert.equal(s.f.h.deckPdfBusy, false);
  } finally { await browser.close(); await s.done(); }
});

test('deck.html changed during export: no deck.pdf; a link at deck.pdf is replaced, not followed', { skip: !bin && 'NOT RUN: no headless Chromium' }, async () => {
  const s = await setup();
  const browser = await launch(bin);
  try {
    let shots = 0;
    s.f.h.deckPdfAttach = async (tab) => {
      await browser.send('Page.navigate', { url: tab.url });
      const send = async (m, p) => { const r = await browser.send(m, p); if (m === 'Page.captureScreenshot' && ++shots === 2) fs.appendFileSync(path.join(s.work, 'venture', 'deck.html'), '<!-- saved -->'); return r; };
      return { send, close: async () => {} };
    };
    await s.f.h.deckPdf();
    assert.equal(fs.existsSync(path.join(s.work, 'venture', 'deck.pdf')), false);
    assert.match(s.notices().at(-1), /저장하는 동안 덱이 바뀌어서/);
    // Second run: deck.pdf is a link to a file outside; the export replaces the link and leaves the target alone.
    const outside = path.join(s.root, 'outside.txt'); fs.writeFileSync(outside, 'keep');
    fs.symlinkSync(outside, path.join(s.work, 'venture', 'deck.pdf'));
    s.f.h.deckPdfAttach = async (tab) => { await browser.send('Page.navigate', { url: tab.url }); return { send: browser.send, close: async () => {} }; };
    await s.f.h.deckPdf();
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
    assert.equal(fs.lstatSync(path.join(s.work, 'venture', 'deck.pdf')).isSymbolicLink(), false);
    assert.equal(pdfPages(fs.readFileSync(path.join(s.work, 'venture', 'deck.pdf'))), 3);
  } finally { await browser.close(); await s.done(); }
});

test('a slide that cannot be captured: no file, the notice names deck/NN.md', { skip: !bin && 'NOT RUN: no headless Chromium' }, async () => {
  const s = await setup();
  const browser = await launch(bin);
  try {
    let shots = 0;
    s.f.h.deckPdfAttach = async (tab) => {
      await browser.send('Page.navigate', { url: tab.url });
      return { send: async (m, p) => { if (m === 'Page.captureScreenshot' && ++shots === 3) throw new Error('gone'); return browser.send(m, p); }, close: async () => {} };
    };
    await s.f.h.deckPdf();
    assert.equal(fs.existsSync(path.join(s.work, 'venture', 'deck.pdf')), false);
    assert.equal(s.notices().at(-1), 'deck/05.md 장을 PDF로 옮기지 못해 저장하지 않았어요. 덱 미리보기가 열리는지 확인한 뒤 다시 해 주세요.');
  } finally { await browser.close(); await s.done(); }
});

// DES-ART-23 (CGP-ART-D-023): "PDF export progress is shown within 300 ms. Failure says why." The progress line must
// not wait on the preview server, the tab or the capture, so each of those is held open or failed here. No browser.
test('DES-ART-23: progress within 300 ms while the preview server has not answered; each failure says why', async () => {
  const s = await setup();
  try {
    const started = '덱을 PDF로 저장하고 있어요 (0 / 3장)';
    const shownWithin = async (label, ms) => {
      const t0 = performance.now();
      while (!s.notices().includes(label)) {
        if (performance.now() - t0 > ms) return null;
        await new Promise((r) => setImmediate(r));
      }
      return performance.now() - t0;
    };
    // The preview server never answers until released: the line is already shown, nothing is opened yet.
    let fail;
    s.f.h.liveServer.ensure = () => new Promise((_, reject) => { fail = reject; });
    const run = s.f.h.deckPdf();
    const at = await shownWithin(started, 300);
    assert.notEqual(at, null, `the progress line was not shown within 300 ms (notices: ${JSON.stringify(s.notices())})`);
    assert.equal(s.f.opened.length, 0, 'shown before any tab is opened');
    fail(new Error('preview server down'));
    await run;
    assert.equal(s.notices().at(-1), '덱을 다 불러오지 못해 PDF를 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
    assert.equal(s.f.h.deckPdfBusy, false, 'a failed export frees the command');
    // The background tab cannot be opened: the reason names the window, no file is written.
    s.f.posts.length = 0;
    s.f.h.liveServer.ensure = async () => s.srv.base;
    s.f.vscode.window.openBrowserTab = async () => { throw new Error('no browser'); };
    const run2 = s.f.h.deckPdf();
    assert.notEqual(await shownWithin(started, 300), null);
    await run2;
    assert.equal(s.notices().at(-1), '덱을 그릴 창을 열지 못해 PDF를 만들지 못했어요. 잠시 뒤 다시 해 주세요.');
    assert.equal(fs.existsSync(path.join(s.work, 'venture', 'deck.pdf')), false);
  } finally { await s.done(); }
});
