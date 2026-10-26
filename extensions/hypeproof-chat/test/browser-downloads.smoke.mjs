// CGP-KNOW-R-021 (REQ-STUDIO-BROWSER-DOWNLOADS): where Studio-browser downloads may go and
// what the timeline line says, against a real temp workspace (symlinks included). The browser
// half (real Chromium writing the file) is browser-downloads-browser.smoke.mjs.
import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  downloadPolicy, DownloadTracker, displayFileName, plainBaseName, isDownloadNoticeLabel,
  downloadBehaviorCommand, downloadFailedNotice, downloadDoneNotice,
  downloadProgressNotice, downloadLineView, resolveDownloadedFile, PROGRESS_INTERVAL_MS,
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
  const lines = [], running = [];
  let dest = 'task-1', clock = 0;
  // Final lines go to `lines` (key dropped: checked on its own below); running lines to `running`.
  const tracker = new DownloadTracker({ policy: () => applied, capture: () => dest, now: () => clock,
    notify: ({ key, ...n }, d) => { assert.equal(typeof key, 'string', 'every line names its download'); (n.state === 'running' ? running : lines).push({ ...n, dest: d, key }); } });
  const finals = () => lines.map(({ key, ...l }) => l);
  const begin = (guid, name) => tracker.handle({ method: 'Page.downloadWillBegin', params: { guid, suggestedFilename: name, url: 'https://example.test/x' } });
  const end = (guid, state) => tracker.handle({ method: 'Page.downloadProgress', params: { guid, state, receivedBytes: 1, totalBytes: 1 } });

  begin('g1', 'notes.txt'); dest = 'task-2'; // the learner switches tasks mid-download
  tracker.handle({ method: 'Page.downloadProgress', params: { guid: 'g1', state: 'inProgress' } });
  assert.equal(lines.length, 0, 'no final line while in progress');
  // CGP-KNOW-D-021: a running line at once ("받는 중", no figures), bound to the task where it began.
  assert.deepEqual(running.map(({ key, ...r }) => r), [{ state: 'running', label: '다운로드 중: notes.txt — 받는 중', dest: 'task-1' }]);
  writeFileSync(join(dir, 'notes.txt'), 'hello');
  end('g1', 'completed');
  assert.equal(lines.at(-1).key, running[0].key, 'the final line replaces the running line (same key)');
  assert.deepEqual(finals().pop(), { state: 'done', label: '다운로드 완료: downloads/notes.txt (5B)', dest: 'task-1' }, 'the line goes to the task where it began');
  lines.length = 0; running.length = 0;
  end('g1', 'completed');
  assert.equal(lines.length, 0, 'one line per download');

  begin('g2', 'big.bin'); end('g2', 'canceled');
  assert.deepEqual((({ key, ...l }) => l)(lines.pop()), { state: 'error', label: '다운로드 실패: big.bin — 받는 중에 멈췄어요(취소되었거나 연결이 끊겼어요). 다시 받아 보세요.', dest: 'task-2' });

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

  // ── CGP-KNOW-D-021: the running line ─────────────────────────────────────
  {
    running.length = 0; lines.length = 0; clock = 10_000;
    const prog = (guid, receivedBytes, totalBytes) => tracker.handle({ method: 'Page.downloadProgress', params: { guid, state: 'inProgress', receivedBytes, totalBytes } });
    begin('p1', 'movie.mp4');
    clock += PROGRESS_INTERVAL_MS - 1; prog('p1', 1024, 0);
    assert.equal(running.length, 1, 'refreshed at most once per interval');
    clock += 1; prog('p1', 2 * 1024 * 1024, 0);
    assert.equal(running.at(-1).label, '다운로드 중: movie.mp4 — 받는 중 2.0MB', 'total unknown: what arrived, no percentage');
    clock += PROGRESS_INTERVAL_MS; prog('p1', 1024 * 1024, 4 * 1024 * 1024);
    assert.equal(running.at(-1).label, '다운로드 중: movie.mp4 — 받는 중 1.0MB / 4.0MB (25%)', 'total known: a percentage');
    clock += PROGRESS_INTERVAL_MS; prog('p1', 9 * 1024 * 1024, 4 * 1024 * 1024);
    assert.ok(!running.at(-1).label.includes('%'), 'received above the total: no invented share');
    clock += PROGRESS_INTERVAL_MS; prog('p1', -5, Number.NaN);
    assert.equal(running.at(-1).label, '다운로드 중: movie.mp4 — 받는 중', 'hostile counts: just 받는 중');
    assert.ok(running.every((r) => r.key === running[0].key && r.dest === 'task-2'));
    end('p1', 'canceled');
    assert.equal(lines.at(-1).key, running[0].key, 'a failure replaces the running line');
    assert.equal(lines.at(-1).state, 'error', 'and is a stored final line');
    const n = running.length; clock += 10 * PROGRESS_INTERVAL_MS; prog('p1', 1, 2);
    assert.equal(running.length, n, 'no running line after the end');
    // Denied: no running line, only the blocked one.
    applied = { behavior: 'deny', cause: 'safe-session' }; begin('p2', 'x.exe');
    assert.equal(running.length, n);
    applied = { behavior: 'allow', dir };
    // Two downloads keep apart.
    begin('p3', 'a.txt'); begin('p4', 'b.txt');
    assert.notEqual(running.at(-1).key, running.at(-2).key);
    tracker.flush();
    running.length = 0; lines.length = 0;
  }
  assert.equal(downloadProgressNotice(`a${cp(0x202e)}b`).label, '다운로드 중: ab — 받는 중', 'names are cleaned');
  assert.ok(isDownloadNoticeLabel('다운로드 중: a.txt — 받는 중', 'running'));
  assert.ok(!isDownloadNoticeLabel('다운로드 중: a.txt — 받는 중', 'done'));
  assert.ok(!isDownloadNoticeLabel('다운로드 중: a.txt', 'running'));

  // ── CGP-KNOW-D-021: the row reads the parts back ─────────────────────────
  assert.deepEqual(downloadLineView('다운로드 완료: downloads/a (1).txt (2.0KB)', 'done'), { kind: 'done', status: '다운로드 완료', name: 'a (1).txt', detail: '2.0KB' });
  assert.deepEqual(downloadLineView('다운로드 중: x — 받는 중.zip — 받는 중 1.0MB / 4.0MB (25%)', 'running'), { kind: 'running', status: '다운로드 중', name: 'x — 받는 중.zip', detail: '받는 중 · 1.0MB / 4.0MB (25%)' });
  assert.deepEqual(downloadLineView('다운로드 중: x.zip — 받는 중', 'running').detail, '받는 중');
  assert.deepEqual(downloadLineView(downloadFailedNotice('a — b.txt', 'safe-session').label, 'error'), { kind: 'blocked', status: '다운로드 막힘', name: 'a — b.txt', detail: '수업용 안전 브라우저에서는 파일을 내려받을 수 없어요.' });
  assert.equal(downloadLineView(downloadFailedNotice('a.txt', 'interrupted').label, 'error').kind, 'failed');
  assert.equal(downloadLineView('파일을 열었어요', 'done'), null);
  assert.equal(downloadLineView(downloadDoneNotice('a.txt', 1).label, 'error'), null);

  // ── CGP-KNOW-D-021: the file behind 열기 / 폴더에서 보기 ────────────────────
  {
    const act = ws('act'); const adir = join(act, 'downloads'); mkdirSync(adir);
    const allow = { behavior: 'allow', dir: adir };
    writeFileSync(join(adir, 'ok.txt'), 'ok');
    assert.deepEqual(resolveDownloadedFile(allow, downloadDoneNotice('ok.txt', 2).label), { ok: true, abs: join(adir, 'ok.txt') });
    assert.deepEqual(resolveDownloadedFile({ behavior: 'deny', cause: 'safe-session' }, downloadDoneNotice('ok.txt', 2).label), { ok: false, cause: 'denied' }, 'denied now: never opened');
    assert.deepEqual(resolveDownloadedFile(allow, downloadDoneNotice('gone.txt', 2).label), { ok: false, cause: 'missing' });
    assert.deepEqual(resolveDownloadedFile(allow, downloadFailedNotice('ok.txt', 'interrupted').label), { ok: false, cause: 'missing' }, 'only a done line');
    assert.deepEqual(resolveDownloadedFile(allow, '다운로드 완료: downloads/../outside/secret.txt (1B)'), { ok: false, cause: 'missing' }, 'no climbing');
    writeFileSync(join(outside, 'secret.txt'), 's'); symlinkSync(join(outside, 'secret.txt'), join(adir, 'lnk.txt'));
    assert.deepEqual(resolveDownloadedFile(allow, downloadDoneNotice('lnk.txt', 1).label), { ok: false, cause: 'missing' }, 'a link to outside is refused');
    writeFileSync(join(outside, 'hard.txt'), 'h'); linkSync(join(outside, 'hard.txt'), join(adir, 'hard.txt'));
    assert.deepEqual(resolveDownloadedFile(allow, downloadDoneNotice('hard.txt', 1).label), { ok: false, cause: 'missing' }, 'a hard link to a file outside is refused');
    mkdirSync(join(adir, 'sub.txt'));
    assert.deepEqual(resolveDownloadedFile(allow, downloadDoneNotice('sub.txt', 1).label), { ok: false, cause: 'missing' }, 'a folder is not a file');
    assert.deepEqual(resolveDownloadedFile(allow, downloadDoneNotice('가'.repeat(120), 1).label), { ok: false, cause: 'missing' }, 'a shortened name is not guessed');
    // downloads/ swapped for a link to outside after the line was written.
    const act2 = ws('act2'); const adir2 = join(act2, 'downloads'); symlinkSync(outside, adir2);
    assert.deepEqual(resolveDownloadedFile({ behavior: 'allow', dir: adir2 }, downloadDoneNotice('secret.txt', 1).label), { ok: false, cause: 'missing' }, 'a linked downloads folder is refused');
  }

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
    const w = new BrowserDownloadWatcher({ policy: () => ({ behavior: 'allow', dir }), capture: () => 't', notify: (n) => { if (n.state !== 'running') got.push(n.label); }, isOpen: () => true, attach: async () => s });
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
