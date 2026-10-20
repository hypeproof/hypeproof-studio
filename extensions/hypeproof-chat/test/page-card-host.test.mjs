// REQ-STUDIO-PAGE-CARD / CGP-ART-R-010 — the real provider (task-workspace harness): a coach turn that changes
// a page posts one card from the turn-end folder diff; 열기 / 폴더에서 보기 reach the preview and revealFileInOS
// only for the card's own rows inside the work folder. Only VS Code APIs are fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskHarness } from './task-workspace-harness.mjs';

test('a page change posts a card; buttons reach preview and revealFileInOS; outside paths are refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'page-card-host-'));
  try {
    const work = join(root, 'work');
    const outside = join(root, 'outside');
    await mkdir(work); await mkdir(outside);
    await writeFile(join(outside, 'secret.html'), '<html>secret</html>');
    const f = await createTaskHarness(root);
    f.h.resolveCoachCwd = () => work;
    const shown = [];
    f.h.preview = { show: async (html, base) => { shown.push({ html, base: base.fsPath }); }, watchForReload: () => {} };
    const cards = () => f.posts.filter((m) => m.type === 'pageCardsState').at(-1)?.cards;

    // Negative control first: a turn that changes only a non-page file posts no card.
    let point = await f.h.beginTurnRestore('turn-css');
    await writeFile(join(work, 'style.css'), 'body{}');
    await f.h.endTurnRestore(point, 'turn-css', 'msg-css');
    assert.equal(cards(), undefined, 'no card for a non-HTML change');
    assert.ok(f.h.turnReview, 'the review bar is still offered');

    point = await f.h.beginTurnRestore('turn-page');
    await writeFile(join(work, 'index.html'), '<!doctype html><title>내 게임</title>');
    await symlink(join(outside, 'secret.html'), join(work, 'escape.html'));
    await f.h.endTurnRestore(point, 'turn-page', 'msg-page');
    assert.deepEqual(cards(), [{ turnId: 'turn-page', anchorId: 'msg-page', pages: [{ path: 'index.html', kind: 'added' }] }]);

    await f.handle(f.scoped({ type: 'pageCardOpen', turnId: 'turn-page', path: 'index.html' }));
    const real = await realpath(work);
    assert.deepEqual(shown, [{ html: '<!doctype html><title>내 게임</title>', base: real }]);
    await f.handle(f.scoped({ type: 'pageCardReveal', turnId: 'turn-page', path: 'index.html' }));
    assert.deepEqual(f.browserState.commandArgs.at(-1), ['revealFileInOS', { fsPath: join(real, 'index.html'), scheme: 'file' }]);

    const before = f.browserState.commands.length;
    for (const path of ['../outside/secret.html', join(outside, 'secret.html'), 'escape.html']) {
      await f.handle(f.scoped({ type: 'pageCardReveal', turnId: 'turn-page', path }));
      await f.handle(f.scoped({ type: 'pageCardOpen', turnId: 'turn-page', path }));
    }
    assert.equal(f.browserState.commands.length, before, 'no reveal for a refused path');
    assert.equal(shown.length, 1, 'no preview for a refused path');
    assert.equal(cards()[0].notice, '이 페이지를 열 수 없어요. 작업 폴더 안에 그대로 있는지 확인해 주세요.');

    // A remount asks again and gets the same card back.
    await f.handle(f.scoped({ type: 'pageCardsRequest' }));
    assert.equal(cards()[0].turnId, 'turn-page');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
