// CGP-ART-D-013: the two stat tiles under a test version, with real React events.
// Designed behavior: tiles show the last-7-day count in tabular figures and the change as an arrow plus words; each
// tile is a 44px button that expands exactly the sessions it counted; a source row opens that experiment's evidence;
// no pseudonym appears; no traffic shows the empty sentence instead of tiles, an unreadable count says so, never 0.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { VersionStatsTiles } from '../webview-ui/src/VersionStatsTiles';
import type { VersionStats } from '../src/versionStats';

const act = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const src = (id: string, completed: boolean) => ({ session_id: id, experiment_id: 'e1', at: 1_800_000_000_000, pages: 2, clicks: 5, completed });
const ok: VersionStats = { state: 'ok', opened: { last: 3, prev: 1, sources: [src('ps_aaaaaa1', true), src('ps_bbbbbb2', false), src('ps_cccccc3', false)] }, completed: { last: 1, prev: 2, sources: [src('ps_aaaaaa1', true)] } };
const byTest = (host: any, id: string) => host.findAll((e: any) => e.getAttribute?.('data-testid') === id)[0];

async function main() {
  const host = mountPoint() as any, root = createRoot(host), opened: string[] = [];
  const render = (stats: VersionStats | undefined) => act(async () => root.render(<VersionStatsTiles stats={stats} onOpenEvidence={(id) => opened.push(id)} />));

  await render(ok);
  assert.equal(byTest(host, 'stat-opened-value').textContent, '3');
  assert.equal(byTest(host, 'stat-opened-change').textContent, '▲ 지난주보다 +2');
  assert.equal(byTest(host, 'stat-completed-change').textContent, '▼ 지난주보다 -1');
  assert.ok(host.textContent.includes('열어 본 횟수 · 지난 7일') && host.textContent.includes('끝까지 한 횟수 · 지난 7일'));
  assert.equal(byTest(host, 'stat-sources'), undefined, 'closed by default');
  await act(async () => { click(byTest(host, 'stat-completed')); });
  assert.equal(byTest(host, 'stat-completed').getAttribute('aria-expanded'), 'true');
  let rows = host.findAll((e: any) => e.localName === 'li');
  assert.deepEqual(rows.map((r: any) => r.getAttribute('data-session')), ['ps_aaaaaa1'], 'the completed tile opens exactly what it counted');
  await act(async () => { click(byTest(host, 'stat-opened')); });
  rows = host.findAll((e: any) => e.localName === 'li');
  assert.equal(rows.length, 3);
  assert.ok(rows[0].textContent.includes('참가 세션 aaaaaa'), rows[0].textContent);
  assert.ok(!host.textContent.includes('pp_'), 'no pseudonym');
  await act(async () => { click(rows[1].findAll((e: any) => e.tagName === 'BUTTON')[0]); });
  assert.deepEqual(opened, ['e1'], 'a source row opens that experiment\'s evidence');
  await act(async () => { click(byTest(host, 'stat-opened')); });
  assert.equal(byTest(host, 'stat-opened').getAttribute('aria-expanded'), 'false');

  await render({ state: 'empty' });
  assert.equal(byTest(host, 'stat-empty').textContent, '아직 연 사람이 없어요');
  assert.equal(byTest(host, 'stat-opened'), undefined, 'the empty state replaces the tiles');
  await render({ state: 'unknown' });
  assert.equal(byTest(host, 'stat-unknown').textContent, '횟수를 확인하지 못했어요');
  assert.ok(!/\b0\b/.test(host.textContent), 'unknown is never drawn as 0');
  await render({ state: 'loading' });
  assert.equal(byTest(host, 'stat-loading').textContent, '횟수 확인 중');
  assert.equal(byTest(host, 'stat-loading').getAttribute('role'), null, 'quiet: not a live region');
  assert.equal(byTest(host, 'stat-opened'), undefined);
  await render(undefined);
  assert.equal(host.textContent, '');
  await act(async () => root.unmount());
  console.log('PASS version stats tiles: counts, change in words, expand sources, open evidence, empty, unknown');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
