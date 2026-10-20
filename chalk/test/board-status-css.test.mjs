// CSS guards for the board status chips: contrast, dashed unknown, 44px targets, 14px text,
// focus ring and forced colours. Values come from the shipped boardStatusCss, not a copy.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boardStatusCss} from '../src/lib/board-status.ts';

const css = boardStatusCss;
const rules = new Map();
for (const m of css.matchAll(/(^|\n)([^@{}\n][^{}]*)\{([^{}]*)\}/g)) {
  for (const sel of m[2].split(',').map((s) => s.trim())) {
    rules.set(sel, {...(rules.get(sel) || {}), ...Object.fromEntries(m[3].split(';').filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }))});
  }
}
const rule = (sel) => { assert.ok(rules.has(sel), 'rule exists: ' + sel); return rules.get(sel); };
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (v) => { assert.match(v, /^#[0-9a-f]{6}$/i, 'hex colour ' + v); return v; };

// Page backgrounds the chips sit on (board.html --bg, manage.html --ink-bg / --ink-panel).
const pages = ['#0f1115', '#0f1418', '#151c22'];
const base = rule('.cgp-state');
const chipBg = hex(base.background);

// Text 4.5:1 on the chip fill and 3:1 for the chip boundary against its fill and every page.
for (const key of ['working', 'blocked', 'review', 'idle', 'done', 'unknown']) {
  const r = {...base, ...rule('.cgp-' + key)};
  const bg = hex(r.background);
  assert.ok(ratio(hex(r.color), bg) >= 4.5, key + ' text contrast ' + ratio(r.color, bg));
  const border = hex(r['border-color']);
  assert.ok(ratio(border, bg) >= 3, key + ' boundary vs fill ' + ratio(border, bg));
  for (const p of pages) assert.ok(ratio(border, p) >= 3, key + ' boundary vs page ' + p + ' ' + ratio(border, p));
}
// Neutral base border also clears 3:1 (filter buttons use it).
const filter = rule('.cgp-state-filter');
for (const p of pages.concat(chipBg)) assert.ok(ratio('#94a3b8', p) >= 3, 'base border vs ' + p);
assert.equal(filter['border'], '1px solid #94a3b8');
assert.ok(ratio(hex(filter.color), hex(filter.background)) >= 4.5, 'filter text contrast');
assert.ok(ratio(hex(rule('.cgp-state-filter[aria-pressed="true"]')['border-color']), hex(filter.background)) >= 3, 'pressed border contrast');

// Done is the only green; unknown is dashed, neutral and never green.
const green = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return g > r + 40 && g > b; };
assert.ok(green(rule('.cgp-done')['border-color']), 'done border is green');
for (const key of ['working', 'blocked', 'review', 'idle', 'unknown']) assert.ok(!green(rule('.cgp-' + key)['border-color']), key + ' is not green');
assert.equal(rule('.cgp-unknown')['border-style'], 'dashed');
assert.ok(!green(rule('.cgp-unknown').color), 'unknown text is not green');
assert.equal(rule('.cgp-state-filter:has(.cgp-unknown)')['border-style'], 'dashed');
assert.ok(!green(rule('.cgp-state-filter:has(.cgp-unknown)')['border-color']));

// Targets and text size.
assert.ok(parseInt(filter['min-height'], 10) >= 44, 'filter target height');
assert.equal(filter.width, 'auto');
assert.ok(parseInt(filter['font-size'], 10) >= 14, 'filter font size');
assert.ok(parseInt(base['font-size'], 10) >= 14, 'chip font size');
assert.equal(base['white-space'], 'normal', 'chip text may wrap instead of being cut');
assert.equal(rule('.cgp-filters')['flex-wrap'], 'wrap');

// Focus ring and forced colours.
const focus = rule('.cgp-state-filter:focus-visible');
assert.match(focus.outline, /^[2-9]px solid #[0-9a-f]{6}$/i);
assert.ok(ratio(hex(focus.outline.split(' ')[2]), chipBg) >= 3, 'focus ring contrast');
assert.ok(parseInt(focus['outline-offset'], 10) >= 1);
const forced = css.match(/@media\(forced-colors:active\)\{([\s\S]*)\}\s*$/)?.[1] || '';
assert.match(forced, /\.cgp-state,\.cgp-state-filter \{[^}]*border-color:CanvasText[^}]*color:CanvasText[^}]*background:Canvas/);
assert.match(forced, /outline-color:Highlight/);

// Shipped pages carry the CSS exactly once.
for (const page of ['board', 'manage']) {
  const html = readFileSync(new URL('../src/ui/' + page + '.html', import.meta.url), 'utf8');
  assert.equal(html.split('/* BOARD_STATUS_CSS */').length, 2, page + ' has one CSS slot');
}
console.log('board status CSS guards PASS');
