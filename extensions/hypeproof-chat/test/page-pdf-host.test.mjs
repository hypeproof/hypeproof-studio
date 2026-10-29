// #3221 part 2 — the real provider's "PDF로 저장" for an HTML page in the work folder: served in a background tab,
// <name>.pdf written next to it, the tab closed after, outside or non-HTML files refused. The tab's CDP channel is a
// headless Chromium page navigated to the tab's URL; FOCUS_REQUIRE_BROWSER=1 fails without a browser, otherwise the
// browser cases print NOT RUN. Only VS Code APIs are fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createTaskHarness } from './task-workspace-harness.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

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

async function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hps-page-pdf-')));
  const f = await createTaskHarness(root);
  const work = path.join(root, 'HypeProofTrial');
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'report-src.htm'), '<!doctype html><meta charset=utf-8><title>보고서</title><h1>CLOiD CES 작업 보고서</h1><p>본문</p>');
  fs.writeFileSync(path.join(work, 'notes.md'), '# notes');
  f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: work } }];
  f.h.resolveCoachCwd = () => work;
  const srv = await serveDir(work);
  const ensured = [];
  f.h.liveServer = { currentRoot: () => undefined, ensure: async (r) => { ensured.push(r); return srv.base; } };
  f.h.folderWriteRefusalFor = () => null;
  const notices = () => f.posts.filter((m) => m.type === 'pageAttached').map((m) => m.label);
  return { f, root, work, srv, ensured, notices, done: async () => { await srv.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('not HTML, outside the work folder, or a refused folder write: no tab, no file, a reason', async () => {
  const s = await setup();
  try {
    await s.f.h.savePagePdf({ fsPath: path.join(s.work, 'notes.md') });
    assert.equal(s.notices().at(-1), 'HTML 파일만 PDF로 저장할 수 있어요.');
    const outside = path.join(s.root, 'elsewhere.html'); fs.writeFileSync(outside, '<p>x</p>');
    await s.f.h.savePagePdf({ fsPath: outside });
    assert.equal(s.notices().at(-1), '작업 폴더 안의 파일만 PDF로 저장할 수 있어요.');
    s.f.h.folderWriteRefusalFor = () => '이 폴더에는 쓸 수 없어요.';
    await s.f.h.savePagePdf({ fsPath: path.join(s.work, 'report-src.htm') });
    assert.equal(s.notices().at(-1), '이 폴더에는 쓸 수 없어요.');
    assert.equal(s.f.opened.length, 0); assert.deepEqual(s.ensured, []);
    assert.equal(fs.existsSync(path.join(s.work, 'report-src.pdf')), false);
  } finally { await s.done(); }
});

test('export: background tab on the served page, report-src.pdf written beside it, tab closed', { skip: !bin && 'NOT RUN: no headless Chromium' }, async () => {
  const s = await setup();
  const browser = await launch(bin);
  try {
    const attached = [];
    s.f.h.deckPdfAttach = async (tab) => {
      attached.push(tab.url);
      assert.equal(s.notices()[0], 'report-src.htm을(를) PDF로 저장하고 있어요', 'the notice is up before the tab opens');
      await browser.send('Page.navigate', { url: tab.url });
      return { send: browser.send, close: async () => { attached.push('closed'); } };
    };
    await s.f.h.savePagePdf({ fsPath: path.join(s.work, 'report-src.htm') });
    assert.deepEqual(s.ensured, [s.work]);
    assert.equal(s.f.opened.length, 1); assert.equal(s.f.opened[0].url, s.srv.base + 'report-src.htm');
    assert.equal(s.f.opened[0].options.background, true); assert.equal(s.f.opened[0].options.preserveFocus, true);
    assert.deepEqual(attached, [s.srv.base + 'report-src.htm', 'closed']);
    const out = fs.readFileSync(path.join(s.work, 'report-src.pdf'));
    assert.equal(out.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal(s.notices().at(-1), 'PDF로 저장했어요: report-src.pdf');
    assert.deepEqual(fs.readdirSync(s.work).filter((x) => x.endsWith('.tmp')), [], 'no temp file left');
    assert.equal(s.f.h.pagePdfBusy, false);
  } finally { await browser.close(); await s.done(); }
});

test('the AI가 한 일 button message: a path relative to the work folder; ../ escapes are refused', async () => {
  const s = await setup();
  try {
    const calls = [];
    const real = s.f.h.savePagePdf.bind(s.f.h);
    s.f.h.savePagePdf = async (uri) => { calls.push(uri.fsPath); s.f.h.liveServer.ensure = async () => { throw new Error('no export in this test'); }; return real(uri); };
    await s.f.handle(s.f.scoped({ type: 'savePagePdf', path: 'report-src.htm' }));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(calls, [path.join(s.work, 'report-src.htm')]);
    const outside = path.join(s.root, 'elsewhere.html'); fs.writeFileSync(outside, '<p>x</p>');
    await s.f.handle(s.f.scoped({ type: 'savePagePdf', path: '../elsewhere.html' }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(s.notices().at(-1), '작업 폴더 안의 파일만 PDF로 저장할 수 있어요.');
    for (const bad of [42, '', 'x'.repeat(301)]) await s.f.handle(s.f.scoped({ type: 'savePagePdf', path: bad }));
    assert.equal(calls.length, 2, 'a malformed path is ignored');
  } finally { await s.done(); }
});
