// CGP-KNOW-R-021 (REQ-STUDIO-BROWSER-DOWNLOADS): the real BrowserDownloadWatcher and CdpSession
// against headless Chromium. Each fake tab's startCDPSession() opens its own browser-level CDP
// connection, which is what the integrated browser's proxy gives the extension (flat
// Target.attachToTarget, then page commands by sessionId). Checks: a completed download lands
// in the activity's downloads/ with its server name and one done line; a path-traversal name
// stays inside; an interrupted download gives one failure line naming the file; a safe-session
// cohort, a symlinked downloads/ and a missing workspace are denied (no file, a blocked line);
// a Korean (RFC 5987) name; a workspace change re-points the folder; closing one of two sessions keeps the other's folder,
// and so does another feature's short-lived session; a tab closed mid-download says so.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser, prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChromium } from './lib/headless-chromium.mjs';
import { BrowserDownloadWatcher } from '../src/browserDownloadWatcher.ts';
import { downloadPolicy } from '../src/browserDownloads.ts';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('browser-downloads-browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('browser-downloads-browser NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)'); process.exit(0);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/file') {
    const disposition = u.searchParams.get('kname') ? `attachment; filename*=UTF-8''${encodeURIComponent('수업자료 1주차.txt')}` : `attachment; filename="${u.searchParams.get('name') ?? 'a.txt'}"`;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': disposition });
    res.end(u.searchParams.get('body') ?? 'hello'); return;
  }
  if (u.pathname === '/traversal') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''..%2F..%2Fescape.txt" });
    res.end('nope'); return;
  }
  if (u.pathname === '/slow') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="slow.bin"', 'Content-Length': '100000' });
    res.write('x'.repeat(10)); const t = setTimeout(() => res.end('x'.repeat(99990)), 3000); res.on('close', () => clearTimeout(t)); return;
  }
  if (u.pathname === '/broken') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="big.bin"', 'Content-Length': '100000' });
    res.write('x'.repeat(10)); setTimeout(() => res.destroy(), 200); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>page</p>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const base = realpathSync(mkdtempSync(join(tmpdir(), 'hp-dl-browser-')));
const profile = join(base, 'profile'); mkdirSync(profile);
const headless = /chrome-headless-shell$/.test(bin) ? [] : ['--headless=new'];
const child = spawn(bin, [...headless, '--remote-debugging-port=0', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

// One raw browser-level connection per startCDPSession(), like the integrated browser's proxy.
let browserWs = '';
function rawSession() {
  const ws = new WebSocket(browserWs);
  const listeners = new Set(), closers = new Set();
  const open = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); for (const l of [...listeners]) l(m); };
  ws.onclose = () => { for (const c of [...closers]) c(); };
  return open.then(() => ({
    onDidReceiveMessage: (l) => { listeners.add(l); return { dispose: () => listeners.delete(l) }; },
    onDidClose: (l) => { closers.add(l); return { dispose: () => closers.delete(l) }; },
    sendMessage: async (m) => { ws.send(JSON.stringify(m)); },
    close: async () => { ws.close(); },
  }));
}
const tab = () => ({ startCDPSession: () => rawSession() });

const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

try {
  let port = 0;
  for (let i = 0; i < 300 && !port; i++) { await new Promise((r) => setTimeout(r, 100)); try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* not yet */ } }
  if (!port) throw new Error('headless Chromium did not start');
  browserWs = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;

  const wsA = join(base, 'activity-a'); mkdirSync(wsA);
  const wsB = join(base, 'activity-b'); mkdirSync(wsB);
  const linked = join(base, 'linked'); mkdirSync(linked);
  const outside = join(base, 'outside'); mkdirSync(outside); symlinkSync(outside, join(linked, 'downloads'));

  let state = { safeSession: false, workspaceRoot: wsA };
  const lines = [], runs = [];
  const open = new Set();
  const watcher = new BrowserDownloadWatcher({
    policy: () => downloadPolicy(state),
    capture: () => 'task',
    // CGP-KNOW-D-021: running lines (never stored) apart from the final ones; keys checked in 1.
    notify: ({ key, ...n }) => { if (n.state === 'running') runs.push({ ...n, key }); else lines.push(n.label.startsWith('다운로드 완료: downloads/report.txt') ? { ...n, key } : n); },
    isOpen: (t) => open.has(t),
  });
  const t1 = tab(); open.add(t1);
  await watcher.watch(t1);
  assert.deepEqual(watcher.appliedFor(t1), { behavior: 'allow', dir: join(wsA, 'downloads') }, 'the session accepted the folder');

  // A control session that only navigates (like the learner clicking a link).
  const nav = await (await import('../src/cdpSession.ts')).CdpSession.attach(tab());
  const go = (path) => nav.send('Page.navigate', { url: origin + path });
  const take = async (n = 1) => { assert.ok(await until(() => lines.length >= n), `expected ${n} line(s), got ${JSON.stringify(lines)}`); await new Promise((r) => setTimeout(r, 150)); return lines.splice(0); };

  // 1. Completed → file in downloads/ with its name, one done line, nothing opened.
  await go('/file?name=report.txt&body=hello');
  const [report] = await take();
  assert.deepEqual(runs[0] && { state: runs[0].state, label: runs[0].label }, { state: 'running', label: '다운로드 중: report.txt — 받는 중' }, 'real Chromium: a running line first');
  assert.equal(report.key, runs[0].key, 'the done line takes the running line\'s place');
  delete report.key;
  assert.deepEqual([report], [{ state: 'done', label: '다운로드 완료: downloads/report.txt (5B)' }]);
  assert.equal(readFileSync(join(wsA, 'downloads', 'report.txt'), 'utf8'), 'hello');

  // 1b. A Korean name (RFC 5987) is found on disk as Chromium wrote it.
  await go('/file?kname=1');
  assert.deepEqual(await take(), [{ state: 'done', label: '다운로드 완료: downloads/수업자료 1주차.txt (5B)' }]);
  // 2. A traversal name stays inside downloads/.
  await go('/traversal');
  const [trav] = await take();
  assert.equal(trav.state, 'done', JSON.stringify(trav));
  assert.ok(!existsSync(join(base, 'escape.txt')) && !existsSync(join(wsA, 'escape.txt')));
  assert.ok(readdirSync(join(wsA, 'downloads')).some((f) => f.endsWith('escape.txt')));

  // 3. Interrupted → one failure line that names the file and the cause.
  await go('/broken');
  assert.deepEqual(await take(), [{ state: 'error', label: '다운로드 실패: big.bin — 받는 중에 멈췄어요(취소되었거나 연결이 끊겼어요). 다시 받아 보세요.' }]);

  // 4. Workspace change → the folder follows after reapply.
  state = { safeSession: false, workspaceRoot: wsB };
  await watcher.reapply();
  await go('/file?name=second.txt');
  assert.equal((await take())[0].label, '다운로드 완료: downloads/second.txt (5B)');
  assert.ok(existsSync(join(wsB, 'downloads', 'second.txt')) && !existsSync(join(wsA, 'downloads', 'second.txt')));

  // 5. Denied cases: no file anywhere, one blocked line.
  for (const [s, cause] of [
    [{ safeSession: true, workspaceRoot: wsB }, '수업용 안전 브라우저에서는 파일을 내려받을 수 없어요.'],
    [{ safeSession: false, workspaceRoot: linked }, '작업 폴더의 downloads가 폴더가 아니거나 다른 곳을 가리켜요. 그 항목의 이름을 바꾼 뒤 다시 받아 보세요.'],
    [{ safeSession: false, workspaceRoot: undefined }, '열린 작업 폴더가 없어 저장할 곳이 없어요.'],
  ]) {
    state = s; await watcher.reapply();
    await go('/file?name=blocked.txt');
    assert.deepEqual(await take(), [{ state: 'error', label: `다운로드 막힘: blocked.txt — ${cause}` }]);
  }
  assert.ok(!existsSync(join(outside, 'blocked.txt')), 'nothing written through the symlink');
  assert.ok(!existsSync(join(wsB, 'downloads', 'blocked.txt')));

  // 6. Two tabs; one closes. The other keeps sending downloads to the folder.
  state = { safeSession: false, workspaceRoot: wsA }; await watcher.reapply();
  const t2 = tab(); open.add(t2); await watcher.watch(t2);
  open.delete(t1); await watcher.unwatch(t1);
  await go('/file?name=after-close.txt');
  assert.equal((await take())[0].label, '다운로드 완료: downloads/after-close.txt (5B)');
  assert.ok(existsSync(join(wsA, 'downloads', 'after-close.txt')));

  // 7. Another feature's short session (page capture, browser control) opens and closes: the
  //    folder holds, since that session never set a download behaviour.
  const other = await (await import('../src/cdpSession.ts')).CdpSession.attach(tab());
  await other.send('Page.enable'); await other.close();
  await new Promise((r) => setTimeout(r, 200));
  await go('/file?name=after-other.txt');
  assert.equal((await take())[0].label, '다운로드 완료: downloads/after-other.txt (5B)');
  assert.ok(existsSync(join(wsA, 'downloads', 'after-other.txt')));

  // 8. The tab closes while a download runs: one line says it could not be followed.
  await go('/slow');
  assert.ok(await until(() => watcher.appliedFor(t2) && lines.length === 0));
  await new Promise((r) => setTimeout(r, 300));
  open.delete(t2); await watcher.unwatch(t2);
  assert.deepEqual(await take(), [{ state: 'error', label: '다운로드 실패: slow.bin — 탭이 닫혀 끝까지 확인하지 못했어요. downloads 폴더에서 파일을 확인해 보세요.' }]);

  await nav.close();
  await watcher.dispose();
  console.log('browser-downloads-browser.smoke: ok');
} finally {
  child.kill();
  server.close();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
