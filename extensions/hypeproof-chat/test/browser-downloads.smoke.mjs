// CGP-KNOW-R-021 (REQ-STUDIO-BROWSER-DOWNLOADS): where Studio-browser downloads may go and
// what the timeline line says, against a real temp workspace (symlinks included). The browser
// half (real Chromium writing the file) is browser-downloads-browser.smoke.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  downloadPolicy, DownloadTracker, displayFileName, plainBaseName, isDownloadNoticeLabel,
  downloadBehaviorCommand, downloadFailedNotice, downloadDoneNotice,
} from '../src/browserDownloads.ts';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';
import { BrowserDownloadWatcher } from '../src/browserDownloadWatcher.ts';

const cp = (n) => String.fromCodePoint(n);
const base = realpathSync(mkdtempSync(join(tmpdir(), 'hp-dl-smoke-')));
const outside = join(base, 'outside'); mkdirSync(outside);
const ws = (name) => { const d = join(base, name); mkdirSync(d); return d; };

try {
  // ── policy ────────────────────────────────────────────────────────────────
  const root = ws('activity');
  assert.deepEqual(downloadPolicy({ safeSession: false, workspaceRoot: root }), { behavior: 'allow', dir: join(root, 'downloads') }, 'missing downloads/ is allowed (Chromium creates it)');
  mkdirSync(join(root, 'downloads'));
  assert.deepEqual(downloadPolicy({ safeSession: false, workspaceRoot: root }), { behavior: 'allow', dir: join(root, 'downloads') });
  assert.deepEqual(downloadPolicy({ safeSession: true, workspaceRoot: root }), { behavior: 'deny', cause: 'safe-session' }, 'safe session: never');
  assert.deepEqual(downloadPolicy({ profileKnown: false, safeSession: false, workspaceRoot: root }), { behavior: 'deny', cause: 'profile-unknown' }, 'no profile loaded: the cohort may be a minor one');
  assert.equal(downloadFailedNotice('a.txt', 'profile-unknown').label, '다운로드 막힘: a.txt — 이용 정보를 아직 확인하지 못해 받을 수 없어요. 잠시 뒤 다시 받아 보세요.');
  for (const bad of [undefined, null, '', 'relative/dir', join(base, 'nope')])
    assert.deepEqual(downloadPolicy({ safeSession: false, workspaceRoot: bad }), { behavior: 'deny', cause: 'no-workspace' }, String(bad));
  const fileRoot = join(base, 'afile'); writeFileSync(fileRoot, 'x');
  assert.deepEqual(downloadPolicy({ safeSession: false, workspaceRoot: fileRoot }), { behavior: 'deny', cause: 'no-workspace' });

  const linked = ws('linked'); symlinkSync(outside, join(linked, 'downloads'));
  assert.deepEqual(downloadPolicy({ safeSession: false, workspaceRoot: linked }), { behavior: 'deny', cause: 'bad-folder' }, 'downloads -> outside is refused');
  const dangling = ws('dangling'); symlinkSync(join(base, 'gone'), join(dangling, 'downloads'));
  assert.deepEqual(downloadPolicy({ safeSession: false, workspaceRoot: dangling }), { behavior: 'deny', cause: 'bad-folder' }, 'a dangling symlink is refused, not created through');
  const asFile = ws('asfile'); writeFileSync(join(asFile, 'downloads'), 'x');
  assert.deepEqual(downloadPolicy({ safeSession: false, workspaceRoot: asFile }), { behavior: 'deny', cause: 'bad-folder' });
  // A symlinked workspace root is canonicalized: the path given to Chromium is the real one.
  const rootLink = join(base, 'root-link'); symlinkSync(root, rootLink);
  assert.deepEqual(downloadPolicy({ safeSession: false, workspaceRoot: rootLink }), { behavior: 'allow', dir: join(root, 'downloads') });

  assert.deepEqual(downloadBehaviorCommand({ behavior: 'allow', dir: '/w/downloads' }), { behavior: 'allow', downloadPath: '/w/downloads' });
  assert.deepEqual(downloadBehaviorCommand({ behavior: 'deny', cause: 'safe-session' }), { behavior: 'deny' });

  // ── names ─────────────────────────────────────────────────────────────────
  assert.equal(displayFileName(`evil${cp(0x202e)}txt.exe${cp(0x2028)}\n`), 'eviltxt.exe', 'bidi/line separators/controls are dropped');
  assert.equal(displayFileName(''), '이름 없는 파일');
  assert.equal(displayFileName(undefined), '이름 없는 파일');
  assert.equal(Array.from(displayFileName('가'.repeat(200))).length, 80);
  assert.ok(displayFileName('가'.repeat(200)).endsWith('…'));
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', `a${cp(0)}b`, 'x'.repeat(256), 7]) assert.equal(plainBaseName(bad), null, String(bad));
  assert.equal(plainBaseName('report.pdf'), 'report.pdf');

  // ── labels: what the store and webview accept ────────────────────────────
  const done = downloadDoneNotice('a.txt', 2048);
  assert.deepEqual(done, { state: 'done', label: '다운로드 완료: downloads/a.txt (2.0KB)' });
  assert.ok(isDownloadNoticeLabel(done.label, 'done'));
  assert.ok(!isDownloadNoticeLabel(done.label, 'error'), 'state must match');
  assert.ok(!isDownloadNoticeLabel(done.label, 'running'));
  const blocked = downloadFailedNotice('a.txt', 'safe-session');
  assert.equal(blocked.label, '다운로드 막힘: a.txt — 수업용 안전 브라우저에서는 파일을 내려받을 수 없어요.');
  assert.ok(isDownloadNoticeLabel(blocked.label, 'error'));
  assert.ok(!isDownloadNoticeLabel(`다운로드 완료: downloads/a${cp(0x202e)}.txt`, 'done'), 'a forged label with bidi is refused');
  assert.ok(!isDownloadNoticeLabel('파일을 열었어요', 'done'));
  assert.ok(!isDownloadNoticeLabel('x'.repeat(500), 'error'));

  // ── tracker: one honest line per download ─────────────────────────────────
  const dir = join(root, 'downloads');
  let applied = { behavior: 'allow', dir };
  const lines = [];
  let dest = 'task-1';
  const tracker = new DownloadTracker({ policy: () => applied, capture: () => dest, notify: (n, d) => lines.push({ ...n, dest: d }) });
  const begin = (guid, name) => tracker.handle({ method: 'Page.downloadWillBegin', params: { guid, suggestedFilename: name, url: 'https://example.test/x' } });
  const end = (guid, state) => tracker.handle({ method: 'Page.downloadProgress', params: { guid, state, receivedBytes: 1, totalBytes: 1 } });

  begin('g1', 'notes.txt'); dest = 'task-2'; // the learner switches tasks mid-download
  tracker.handle({ method: 'Page.downloadProgress', params: { guid: 'g1', state: 'inProgress' } });
  assert.equal(lines.length, 0, 'no line while in progress');
  writeFileSync(join(dir, 'notes.txt'), 'hello');
  end('g1', 'completed');
  assert.deepEqual(lines.pop(), { state: 'done', label: '다운로드 완료: downloads/notes.txt (5B)', dest: 'task-1' }, 'the line goes to the task where it began');
  end('g1', 'completed');
  assert.equal(lines.length, 0, 'one line per download');

  begin('g2', 'big.bin'); end('g2', 'canceled');
  assert.deepEqual(lines.pop(), { state: 'error', label: '다운로드 실패: big.bin — 받는 중에 멈췄어요(취소되었거나 연결이 끊겼어요). 다시 받아 보세요.', dest: 'task-2' });

  begin('g3', 'ghost.txt'); end('g3', 'completed');
  assert.equal(lines.pop().label, '다운로드 실패: ghost.txt — 받은 파일을 downloads 폴더에서 찾지 못했어요.', 'completed but absent is not a success');

  // A file that is a symlink to outside is not reported as saved.
  writeFileSync(join(outside, 'secret.txt'), 's'); symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'));
  begin('g4', 'link.txt'); end('g4', 'completed');
  assert.equal(lines.pop().state, 'error');

  // Same name again: the size is read from the file on disk at completion.
  begin('g5', 'notes.txt'); writeFileSync(join(dir, 'notes.txt'), 'hello again'); end('g5', 'completed');
  assert.equal(lines.pop().label, '다운로드 완료: downloads/notes.txt (11B)');

  // downloads/ swapped for a symlink while the download ran: refuse to claim where it went.
  const swapRoot = ws('swap'); const swapDir = join(swapRoot, 'downloads'); mkdirSync(swapDir);
  applied = { behavior: 'allow', dir: swapDir };
  begin('g6', 'a.txt'); rmSync(swapDir, { recursive: true }); symlinkSync(outside, swapDir); writeFileSync(join(outside, 'a.txt'), 'a'); end('g6', 'completed');
  assert.equal(lines.pop().label, '다운로드 실패: a.txt — 받는 동안 downloads 폴더가 바뀌어 저장된 곳을 확인하지 못했어요.');

  // Denied: one blocked line at begin, nothing for the browser's own cancel.
  applied = { behavior: 'deny', cause: 'safe-session' };
  begin('g7', 'game.exe'); end('g7', 'canceled');
  assert.deepEqual(lines.map((l) => l.label), ['다운로드 막힘: game.exe — 수업용 안전 브라우저에서는 파일을 내려받을 수 없어요.']);
  lines.length = 0;

  // No behaviour in force yet (attach still running / refused): not ours to report.
  applied = null;
  begin('g8', 'x.txt'); end('g8', 'completed');
  assert.equal(lines.length, 0);

  // The session goes away mid-download: one line that says it could not be followed.
  applied = { behavior: 'allow', dir };
  begin('g9', 'half.zip'); tracker.flush(); tracker.flush(); end('g9', 'completed');
  assert.deepEqual(lines.splice(0).map((l) => l.label), ['다운로드 실패: half.zip — 탭이 닫혀 끝까지 확인하지 못했어요. downloads 폴더에서 파일을 확인해 보세요.']);

  // Hostile event shapes are ignored.
  applied = { behavior: 'allow', dir };
  for (const params of [{}, { guid: 5 }, { guid: '' }, { guid: 'x'.repeat(200) }]) tracker.handle({ method: 'Page.downloadWillBegin', params });
  assert.equal(lines.length, 0);

  // ── watcher lifecycle with a scripted session ─────────────────────────────
  const fakeSession = (log, { failApply = 0, onEnable, applyDelays = [] } = {}) => {
    let listener = () => {}, closer = () => {};
    return {
      log, emit: (e) => listener(e), drop: () => closer(),
      onEvent: (l) => { listener = l; return { dispose() {} }; },
      onDidClose: (l) => { closer = l; return { dispose() {} }; },
      send: async (method, params) => {
        log.push([method, params]);
        if (method === 'Page.enable' && onEnable) await onEnable();
        if (method === 'Page.setDownloadBehavior' && failApply-- > 0) throw new Error('boom');
        if (method === 'Page.setDownloadBehavior') await new Promise((r) => setTimeout(r, applyDelays.shift() ?? 0));
        return {};
      },
      close: async () => { log.push(['close']); },
    };
  };
  {
    // Disposed while Page.enable is in flight: the session is closed and never used.
    const log = []; let w;
    const s = fakeSession(log, { onEnable: async () => { await w.dispose(); } });
    w = new BrowserDownloadWatcher({ policy: () => ({ behavior: 'allow', dir }), capture: () => 't', notify: () => {}, isOpen: () => true, attach: async () => s });
    await w.watch('tab');
    assert.deepEqual(log.map((l) => l[0]), ['Page.enable', 'close'], 'no behaviour sent after dispose');
    assert.equal(w.appliedFor('tab'), undefined);
  }
  {
    // One failed apply is retried; a session drop flushes its running downloads.
    const log = [], got = [];
    const s = fakeSession(log, { failApply: 1 });
    const w = new BrowserDownloadWatcher({ policy: () => ({ behavior: 'allow', dir }), capture: () => 't', notify: (n) => got.push(n.label), isOpen: () => true, attach: async () => s });
    await w.watch('tab');
    assert.deepEqual(w.appliedFor('tab'), { behavior: 'allow', dir });
    assert.equal(log.filter((l) => l[0] === 'Page.setDownloadBehavior').length, 2);
    s.emit({ method: 'Page.downloadWillBegin', params: { guid: 'z', suggestedFilename: 'run.zip' } });
    s.drop();
    assert.deepEqual(got, ['다운로드 실패: run.zip — 탭이 닫혀 끝까지 확인하지 못했어요. downloads 폴더에서 파일을 확인해 보세요.']);
    assert.equal(w.appliedFor('tab'), undefined, 'a dropped session is forgotten');
  }
  {
    // Overlapping reapply calls, the first one slow: the browser ends on the latest policy.
    const log = []; let policy = { behavior: 'allow', dir };
    const s = fakeSession(log, { applyDelays: [0, 120, 0] });
    const w = new BrowserDownloadWatcher({ policy: () => policy, capture: () => 't', notify: () => {}, isOpen: () => true, attach: async () => s });
    await w.watch('tab');
    const a = w.reapply(); await new Promise((r) => setTimeout(r, 20)); policy = { behavior: 'deny', cause: 'safe-session' }; const b = w.reapply();
    await Promise.all([a, b]);
    assert.deepEqual(log.filter((l) => l[0] === 'Page.setDownloadBehavior').at(-1)[1], { behavior: 'deny' });
    assert.deepEqual(w.appliedFor('tab'), { behavior: 'deny', cause: 'safe-session' });
  }

  // ── store: only a real download line is persisted ─────────────────────────
  const store = new TaskWorkspaceStore(ws('store'), 'downloads-smoke');
  await store.initialize();
  const taskId = store.getView().activeTaskId;
  const msg = (label, state) => ({ id: `download-${label.length}-${state}`, role: 'tool', content: '', createdAt: 1, tool: { icon: 'x', label, state } });
  await store.appendDownloadNotice(taskId, msg(done.label, 'done'));
  await store.appendDownloadNotice(taskId, msg(blocked.label, 'error'));
  assert.deepEqual(store.getActiveTask().messages.map((m) => [m.tool.icon, m.tool.label, m.tool.state]), [['📄', done.label, 'done'], ['📄', blocked.label, 'error']], 'stored with the host icon, in order');
  await assert.rejects(store.appendDownloadNotice(taskId, msg('아무 말', 'done')));
  await assert.rejects(store.appendDownloadNotice(taskId, msg(done.label, 'error')));
  await assert.rejects(store.appendDownloadNotice(taskId, { ...msg(done.label, 'done'), content: 'x' }));
  assert.equal(store.getActiveTask().messages.length, 2);

  console.log('browser-downloads.smoke: ok');
} finally {
  rmSync(base, { recursive: true, force: true });
}
