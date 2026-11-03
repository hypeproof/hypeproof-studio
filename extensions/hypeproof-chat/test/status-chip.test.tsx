// CGP-DS-D-004 (DES-CGP-DS-05) — the status chip, rendered: one 16px stroke icon in currentColor
// beside one label, for each of real / simulated / self_reported / unverified / blocked, and the
// evidence drawer drawing its source-state label as that chip. The grayscale half of the
// acceptance: with colour removed, the five states still differ by icon shape and by wording.
// The CSS half (sizes, radius, padding, soft fill, forced colours) is test/status-chip.smoke.mjs.
import { mountPoint } from './fixtures/mini-dom.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { StatusChip } from '../webview-ui/src/StatusChip';
import { STATUS_CHIPS, statusChipState } from '../webview-ui/src/statusChipLogic';
import { SOURCE_STATE_LABELS } from '../webview-ui/src/evidenceDrawerLogic';
import { EvidenceDrawer } from '../webview-ui/src/EvidenceDrawer';
for (const name of ['Node', 'Element']) (globalThis as any)[name] ??= (window as any)[name];
(globalThis as any).HTMLElement ??= (window as any).Element;

const STATES = ['real', 'simulated', 'self_reported', 'unverified', 'blocked'] as const;
const WORDS = { real: '실제로 있었던 일', simulated: '가상으로 해 본 것', self_reported: '내가 그렇다고 적은 것', unverified: '아직 확인 전', blocked: '막힘' };

async function run() {
  const host = mountPoint(), root = createRoot(host);
  const signatures: string[] = [];
  for (const state of STATES) {
    await act(() => root.render(<StatusChip state={state} />));
    const chip = host.querySelector('.hp-status-chip');
    assert.ok(chip, `${state}: a chip is drawn`);
    assert.equal(chip.getAttribute('data-status'), state);
    assert.equal(chip.getAttribute('data-intent'), STATUS_CHIPS[state].intent);
    // The label is the only text: no glyph rides along as a character.
    assert.equal(chip.textContent, WORDS[state], `${state}: label`);
    const svg = chip.querySelector('svg');
    assert.equal(chip.children[0], svg, `${state}: the icon comes first`);
    for (const [k, v] of [['width', '16'], ['height', '16'], ['stroke', 'currentColor'], ['fill', 'none'], ['aria-hidden', 'true']]) assert.equal(svg.getAttribute(k), v, `${state}: icon ${k}`);
    assert.equal(svg.getAttribute('data-icon'), STATUS_CHIPS[state].icon);
    assert.equal(chip.children[1].getAttribute('class'), 'hp-status-chip-label');
    // Grayscale signature: the drawn shape (every path/circle/rect) and the words.
    const shape = svg.children.map((c: any) => `${c.tagName}:${['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height'].map((a) => c.getAttribute(a) ?? '').join(',')}`).join('|');
    assert.ok(shape.length > 10, `${state}: the icon draws something`);
    signatures.push(shape, `label:${WORDS[state]}`);
  }
  assert.equal(new Set(signatures).size, signatures.length, 'grayscale: no two states share an icon shape or a label');

  // Every intent has its own fill and icon colour in styles.css (test/status-chip.smoke.mjs).
  assert.deepEqual([...new Set(Object.values(STATUS_CHIPS).map((c) => c.intent))].sort(), ['caution', 'danger', 'info', 'neutral', 'success']);
  // The source states take their words from the one SX-21 table.
  for (const s of ['real', 'simulated', 'self_reported', 'unverified'] as const) assert.equal(STATUS_CHIPS[s].label, SOURCE_STATE_LABELS[s]);
  // Unknown values fall to unverified, never real; blocked only by exact match.
  for (const odd of [undefined, '', 'REAL', 'Blocked', 'constructor', '__proto__', 'real‮', 3, null]) assert.equal(statusChipState(odd), 'unverified', String(odd));
  assert.equal(statusChipState('blocked'), 'blocked');
  await act(() => root.render(<StatusChip state="toString" />));
  assert.equal(host.querySelector('.hp-status-chip').getAttribute('data-status'), 'unverified');
  assert.equal(host.querySelector('.hp-status-chip').textContent, WORDS.unverified);
  await act(() => root.render(<StatusChip state="real" className="extra" />));
  assert.equal(host.querySelector('.hp-status-chip').getAttribute('class'), 'hp-status-chip extra');

  // The evidence drawer draws each row's source state as the chip, in the row's meta line.
  // (Server markup: the drawer's <select> is beyond the mini DOM.)
  const row = (id: string, source_state: string) => ({ id, kind: 'external_feedback_received', evidence_type: 'intent', at: 1, text: `${id} 문장`, actor: 'external_user', source_kind: 'interview', source_state, provenance: null, adopted_from: null });
  const rows = [row('r', 'real'), row('s', 'simulated'), row('m', 'self_reported'), row('u', 'unverified'), row('x', '모르는_값')];
  const html = renderToStaticMarkup(<EvidenceDrawer open rows={rows as any} verification={{ state: 'none', source_state: 'unverified', line: '아직 고쳐 달라고 한 것이 없어요' } as any} onSubmit={() => {}} onToggle={() => {}} />);
  const items = [...html.matchAll(/<li class="hp-evidence-row[^"]*" data-source-state="([^"]+)">([\s\S]*?)<\/li>/g)];
  assert.equal(items.length, rows.length, 'every row is drawn');
  const want: Record<string, string> = { r: 'real', s: 'simulated', m: 'self_reported', u: 'unverified', x: 'unverified' };
  for (const r of rows) {
    const item = items.find((m) => m[2].includes(`${r.id} 문장`));
    assert.ok(item, `row ${r.id} drawn`);
    const state = want[r.id]!;
    assert.equal(item[1], state, `row ${r.id}: row state`);
    const meta = /<p class="hp-evidence-meta">([\s\S]*?)<\/p>/.exec(item[2])?.[1] ?? '';
    const chip = new RegExp(`<span class="hp-status-chip hp-evidence-state" data-status="${state}" data-intent="${STATUS_CHIPS[state as keyof typeof STATUS_CHIPS].intent}"><svg[^>]*width="16" height="16"[^>]*stroke="currentColor"[^>]*aria-hidden="true"[^>]*>[\\s\\S]*?</svg><span class="hp-status-chip-label">${WORDS[state as keyof typeof WORDS]}</span></span>`);
    assert.match(meta, chip, `row ${r.id}: its state is a 16px-icon chip in the meta line`);
  }
  await act(() => root.unmount());
  console.log(`status-chip: ${STATES.length} states, grayscale signatures distinct, evidence drawer rows drawn as chips`);
}
run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
