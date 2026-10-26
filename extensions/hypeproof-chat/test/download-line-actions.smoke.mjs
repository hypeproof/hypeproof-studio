// CGP-KNOW-D-021 (DES-KNOW-38): the real provider (task-workspace harness). A running download line is
// posted under the id its final line takes and never stored; 열기 / 폴더에서 보기 on a stored done line
// reach vscode.open / revealFileInOS only for that file inside the activity's downloads/ folder now.
// Only VS Code APIs and the cohort profile are fixtures.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskHarness } from './task-workspace-harness.mjs';

const root = await realpath(await mkdtemp(join(tmpdir(), 'download-line-host-')));
try {
  const work = join(root, 'work'), outside = join(root, 'outside');
  await mkdir(join(work, 'downloads'), { recursive: true }); await mkdir(outside);
  const f = await createTaskHarness(root);
  f.h.resolveCoachCwd = () => work;
  f.h.cachedProfile = { profile_id: 'personal-fixture' };
  const taskId = f.store.getView().activeTaskId;
  const dest = f.h.downloadDestination();
  assert.equal(dest.taskId, taskId);
  const notices = () => f.posts.filter((m) => m.type === 'downloadNotice');
  const stored = () => JSON.parse(JSON.stringify(f.store.getHistory().filter((m) => m.id.startsWith('download-'))));

  // Running: posted, not stored; the final line keeps its id and is stored.
  await f.h.postDownloadNotice({ state: 'running', label: '다운로드 중: a.txt — 받는 중', key: 'k1' }, dest);
  await f.h.postDownloadNotice({ state: 'running', label: '다운로드 중: a.txt — 받는 중 1.0KB', key: 'k1' }, dest);
  assert.equal(notices().length, 2);
  assert.equal(notices()[0].id, notices()[1].id, 'one row per download');
  assert.equal(stored().length, 0, 'a running line is never stored');
  await writeFile(join(work, 'downloads', 'a.txt'), 'hello');
  await f.h.postDownloadNotice({ state: 'done', label: '다운로드 완료: downloads/a.txt (5B)', key: 'k1' }, dest);
  const doneId = notices().at(-1).id;
  assert.equal(doneId, notices()[0].id, 'the done line replaces the running row');
  assert.deepEqual(stored().map((m) => [m.id, m.tool.state]), [[doneId, 'done']]);
  // A second download gets its own row.
  await f.h.postDownloadNotice({ state: 'running', label: '다운로드 중: b.txt — 받는 중', key: 'k2' }, dest);
  assert.notEqual(notices().at(-1).id, doneId);
  // Another task open: the running line is not shown there.
  const before = notices().length;
  await f.h.postDownloadNotice({ state: 'running', label: '다운로드 중: c.txt — 받는 중', key: 'k3' }, { ...dest, taskId: 'other-task' });
  assert.equal(notices().length, before, 'a running line only reaches its own task');

  // 열기 / 폴더에서 보기.
  const lineNotices = () => f.posts.filter((m) => m.type === 'downloadLineNotice');
  const cmds = () => f.browserState.commandArgs ?? [];
  await f.handle(f.scoped({ type: 'downloadLineAction', id: doneId, action: 'open' }));
  assert.deepEqual(cmds().at(-1), ['vscode.open', { fsPath: join(work, 'downloads', 'a.txt'), scheme: 'file' }], '열기 opens in a Studio editor tab');
  await f.handle(f.scoped({ type: 'downloadLineAction', id: doneId, action: 'reveal' }));
  assert.deepEqual(cmds().at(-1), ['revealFileInOS', { fsPath: join(work, 'downloads', 'a.txt'), scheme: 'file' }]);
  assert.deepEqual([lineNotices().at(-1).id, lineNotices().at(-1).notice], [doneId, null], 'a press that went through clears an earlier refusal');

  const count = cmds().length;
  // Unknown id, bad action, a running id: nothing.
  for (const msg of [{ id: 'download-nope', action: 'open' }, { id: doneId, action: 'run' }, { id: '../x', action: 'open' }, { id: 7, action: 'open' }])
    await f.handle(f.scoped({ type: 'downloadLineAction', ...msg }));
  assert.equal(cmds().length, count, 'nothing opened for an unknown line');

  // A stored done line whose name climbs out, is absolute or names a folder (.app bundle): refused.
  await writeFile(join(outside, 'secret.txt'), 's');
  await mkdir(join(work, 'downloads', 'Evil.app', 'Contents'), { recursive: true });
  for (const name of ['../../outside/secret.txt', '../work/downloads/a.txt', root + '/outside/secret.txt', '..', 'Evil.app']) {
    await f.h.postDownloadNotice({ state: 'done', label: `다운로드 완료: downloads/${name} (1B)` }, dest);
    const forged = notices().at(-1).id;
    await f.handle(f.scoped({ type: 'downloadLineAction', id: forged, action: 'open' }));
    await f.handle(f.scoped({ type: 'downloadLineAction', id: forged, action: 'reveal' }));
    assert.equal(cmds().length, count, `nothing opened or revealed for ${name}`);
    assert.equal(lineNotices().at(-1).id, forged);
  }

  // The file swapped for a link to outside: refused with a line, nothing opened.
  await writeFile(join(outside, 'secret.txt'), 's');
  await rm(join(work, 'downloads', 'a.txt')); await symlink(join(outside, 'secret.txt'), join(work, 'downloads', 'a.txt'));
  await f.handle(f.scoped({ type: 'downloadLineAction', id: doneId, action: 'open' }));
  await f.handle(f.scoped({ type: 'downloadLineAction', id: doneId, action: 'reveal' }));
  assert.equal(cmds().length, count, 'a link is never opened or revealed');
  assert.equal(lineNotices().at(-1).notice, 'downloads 폴더에서 이 파일을 찾지 못했어요. 옮겨졌거나 이름이 바뀌었을 수 있어요.');

  // Back to a real file, but no cohort profile is loaded (it may be a minor one): refused.
  await rm(join(work, 'downloads', 'a.txt')); await writeFile(join(work, 'downloads', 'a.txt'), 'hello');
  f.h.cachedProfile = null;
  await f.handle(f.scoped({ type: 'downloadLineAction', id: doneId, action: 'open' }));
  assert.equal(cmds().length, count, 'no profile: nothing opened');
  assert.equal(lineNotices().at(-1).notice, '지금은 이 파일을 열 수 없어요.');
  f.h.cachedProfile = { profile_id: 'personal-fixture' };
  await f.handle(f.scoped({ type: 'downloadLineAction', id: doneId, action: 'open' }));
  assert.equal(cmds().length, count + 1, 'restored: opens again');

  console.log('download-line-actions.smoke: ok');
} finally {
  await rm(root, { recursive: true, force: true });
}
