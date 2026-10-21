// CSS guards for the board status chips: contrast, dashed unknown, 44px targets, 14px text,
// focus ring and forced colours. Values come from the shipped boardStatusCss, not a copy.
// CGP-DS-D-004 (DES-CGP-DS-05): 16px icon, 14px label, 4px radius, 8px inline padding and a soft
// fill of each state's colour; every check is a function over the CSS so the mutated copies at the
// end must fail it.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boardStatusCss} from '../src/lib/board-status.ts';
import {staticTokens} from '../../extensions/hypeproof-chat/test/lib/expand-design-tokens.mjs';

// CGP-DS-R-001: the shipped rules reference shared tokens; expand only the static --ds-* aliases.
const expand = staticTokens(readFileSync(new URL('../../extensions/hypeproof-chat/webview-ui/src/designTokens.css', import.meta.url), 'utf8'));
const parse = (css) => {
  const rules = new Map();
  for (const m of css.matchAll(/(^|\n)([^@{}\n][^{}]*)\{([^{}]*)\}/g)) {
    for (const sel of m[2].split(',').map((s) => s.trim())) {
      rules.set(sel, {...(rules.get(sel) || {}), ...Object.fromEntries(m[3].split(';').filter(Boolean).map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      }))});
    }
  }
  return (sel) => { assert.ok(rules.has(sel), 'rule exists: ' + sel); return rules.get(sel); };
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (v) => { assert.match(v ?? '', /^#[0-9a-f]{6}$/i, 'hex colour ' + v); return v.toLowerCase(); };
/** A colour value: a hex, or `color-mix(in srgb, #top N%, #under)` evaluated to its hex. */
const colour = (v) => {
  const m = /^color-mix\(in srgb, (#[0-9a-f]{6}) (\d+(?:\.\d+)?)%, (#[0-9a-f]{6})\)$/i.exec(v ?? '');
  if (!m) return hex(v);
  const a = Number(m[2]) / 100, rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return '#' + rgb(m[1]).map((t, i) => Math.round(t * a + rgb(m[3])[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
};
const px = (v) => { assert.match(v ?? '', /^\d+px$/, 'a px length: ' + v); return parseInt(v, 10); };

// Page backgrounds the chips sit on (board.html --bg, manage.html --ink-bg / --ink-panel).
const pages = ['#0f1115', '#0f1418', '#151c22'];
const STATES = ['working', 'blocked', 'review', 'idle', 'done', 'unknown'];

const checks = {
  // Text 4.5:1 on the chip fill and 3:1 for the chip boundary against its fill and every page.
  'contrast': (css) => {
    const rule = parse(css), base = rule('.cgp-state');
    for (const key of STATES) {
      const r = {...base, ...rule('.cgp-' + key)};
      const bg = colour(r.background);
      assert.ok(ratio(hex(r.color), bg) >= 4.5, key + ' text contrast ' + ratio(r.color, bg));
      const border = hex(r['border-color']);
      assert.ok(ratio(border, bg) >= 3, key + ' boundary vs fill ' + ratio(border, bg));
      for (const p of pages) assert.ok(ratio(border, p) >= 3, key + ' boundary vs page ' + p + ' ' + ratio(border, p));
    }
  },
  // CGP-DS-D-004 soft background: each state's own colour mixed 8-20% into the neutral chip
  // surface, so the fill is tinted, never solid and never the same plain surface for every state.
  'soft fill': (css) => {
    const rule = parse(css), surface = hex(rule('.cgp-state').background);
    const fills = STATES.map((key) => {
      const r = rule('.cgp-' + key);
      const m = /^color-mix\(in srgb, (#[0-9a-f]{6}) (\d+(?:\.\d+)?)%, (#[0-9a-f]{6})\)$/i.exec(r.background ?? '');
      assert.ok(m, key + ' fill is a colour-mix: ' + r.background);
      assert.equal(m[1].toLowerCase(), hex(r['border-color']), key + ' fill is tinted by its own colour');
      assert.ok(Number(m[2]) >= 8 && Number(m[2]) <= 20, key + ' tint ' + m[2] + '% is soft (8-20%)');
      assert.equal(m[3].toLowerCase(), surface, key + ' tint sits on the chip surface');
      return colour(r.background);
    });
    assert.equal(new Set(fills).size, STATES.length, 'every state has its own fill');
  },
  // CGP-DS-D-004 geometry.
  'geometry': (css) => {
    const rule = parse(css), base = rule('.cgp-state'), icon = rule('.cgp-state-icon');
    assert.equal(px(base['border-radius']), 4, 'chip radius');
    const [block, inline] = (base.padding ?? '').split(/\s+/);
    assert.equal(px(inline), 8, 'chip inline padding');
    assert.ok(px(block) <= 4, 'chip block padding stays small');
    assert.equal(px(base['font-size']), 14, 'chip label');
    assert.equal(px(icon.width), 16, 'icon width'); assert.equal(px(icon.height), 16, 'icon height');
    assert.equal(icon.flex, 'none', 'the icon never shrinks beside a long label');
  },
  // A short Korean state word in a narrow seat column wraps between eojeol and is never cut.
  'no truncation': (css) => {
    const base = parse(css)('.cgp-state');
    assert.equal(base['white-space'], 'normal', 'chip text may wrap instead of being cut');
    assert.equal(base['word-break'], 'keep-all', 'Hangul wraps at eojeol');
    assert.equal(base['overflow-wrap'], 'anywhere');
    assert.equal(base['max-width'], '100%');
    for (const k of ['text-overflow', 'overflow']) assert.equal(base[k], undefined, 'chip has no ' + k);
  },
  'filters': (css) => {
    const rule = parse(css), filter = rule('.cgp-state-filter'), chipBg = hex(rule('.cgp-state').background);
    // Neutral base border also clears 3:1 (filter buttons use it).
    for (const p of pages.concat(chipBg)) assert.ok(ratio('#94a3b8', p) >= 3, 'base border vs ' + p);
    assert.equal(filter['border'], '1px solid #94a3b8');
    assert.ok(ratio(hex(filter.color), hex(filter.background)) >= 4.5, 'filter text contrast');
    assert.ok(ratio(hex(rule('.cgp-state-filter[aria-pressed="true"]')['border-color']), hex(filter.background)) >= 3, 'pressed border contrast');
    // Targets and text size.
    assert.ok(parseInt(filter['min-height'], 10) >= 44, 'filter target height');
    assert.equal(filter.width, 'auto');
    assert.ok(parseInt(filter['font-size'], 10) >= 14, 'filter font size');
    assert.equal(rule('.cgp-filters')['flex-wrap'], 'wrap');
    // Focus ring.
    const focus = rule('.cgp-state-filter:focus-visible');
    assert.match(focus.outline, /^[2-9]px solid #[0-9a-f]{6}$/i);
    assert.ok(ratio(hex(focus.outline.split(' ')[2]), chipBg) >= 3, 'focus ring contrast');
    assert.ok(parseInt(focus['outline-offset'], 10) >= 1);
  },
  // Done is the only green; unknown is dashed, neutral and never green.
  'hues': (css) => {
    const rule = parse(css);
    const green = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return g > r + 40 && g > b; };
    assert.ok(green(rule('.cgp-done')['border-color']), 'done border is green');
    for (const key of ['working', 'blocked', 'review', 'idle', 'unknown']) assert.ok(!green(rule('.cgp-' + key)['border-color']), key + ' is not green');
    assert.equal(rule('.cgp-unknown')['border-style'], 'dashed');
    assert.ok(!green(rule('.cgp-unknown').color), 'unknown text is not green');
    assert.equal(rule('.cgp-state-filter:has(.cgp-unknown)')['border-style'], 'dashed');
    assert.ok(!green(rule('.cgp-state-filter:has(.cgp-unknown)')['border-color']));
  },
  'forced colours': (css) => {
    const forced = css.match(/@media\(forced-colors:active\)\{([\s\S]*)\}\s*$/)?.[1] || '';
    assert.match(forced, /\.cgp-state,\.cgp-state-filter \{[^}]*border-color:CanvasText[^}]*color:CanvasText[^}]*background:Canvas/);
    assert.match(forced, /\.cgp-state-icon\{color:CanvasText\}/);
    assert.match(forced, /outline-color:Highlight/);
  },
};
const real = expand(boardStatusCss);
for (const [name, fn] of Object.entries(checks)) fn(real);

// Negative controls: each mutation of the shipped CSS must fail its check.
const mutate = (from, to) => {
  assert.ok(boardStatusCss.includes(from), 'negative control is stale: ' + from.slice(0, 60));
  return expand(boardStatusCss.split(from).join(to));
};
const negatives = [
  ['geometry', 'radius back to 6px', mutate('border-radius:var(--ds-c-status-chip-radius)', 'border-radius:var(--ds-c-chalk-board-status-radius-3)')],
  ['geometry', 'inline padding back to 7px', mutate('var(--ds-c-chalk-board-status-space-11) var(--ds-c-status-chip-pad-inline)', 'var(--ds-c-chalk-board-status-space-11) var(--ds-c-chalk-board-status-space-12)')],
  ['geometry', '13px label', mutate('font-size:var(--ds-c-status-chip-label)', 'font-size:var(--ds-c-studio-styles-type-9)')],
  ['geometry', '14px icon', mutate('width:var(--ds-c-status-chip-icon);height:var(--ds-c-status-chip-icon)', 'width:var(--ds-c-status-chip-label);height:var(--ds-c-status-chip-label)')],
  ['geometry', 'icon can shrink', mutate('.cgp-state-icon {flex:none;', '.cgp-state-icon {')],
  ['soft fill', 'blocked fill back to the plain surface', mutate('background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-92) 14%, var(--ds-c-chalk-board-status-surface-127))', 'background:var(--ds-c-chalk-board-status-surface-127)')],
  ['soft fill', 'working tint solid (100%)', mutate('var(--ds-c-chalk-board-status-boundary-91) 14%', 'var(--ds-c-chalk-board-status-boundary-91) 100%')],
  ['soft fill', 'review tinted by another state', mutate('background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-93) 14%', 'background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-92) 14%')],
  ['no truncation', 'ellipsis', mutate('white-space:normal;word-break:keep-all;', 'white-space:nowrap;text-overflow:ellipsis;overflow:hidden;word-break:keep-all;')],
  ['no truncation', 'Hangul split mid-word', mutate('word-break:keep-all;overflow-wrap:anywhere}', 'overflow-wrap:anywhere}')],
  ['forced colours', 'forced icon colour removed', mutate('.cgp-state-icon{color:CanvasText}', '')],
];
for (const [name, label, css] of negatives) assert.throws(() => checks[name](css), undefined, `negative control passed ${name}: ${label}`);

// Shipped pages carry the CSS exactly once.
for (const page of ['board', 'manage']) {
  const html = readFileSync(new URL('../src/ui/' + page + '.html', import.meta.url), 'utf8');
  assert.equal(html.split('/* BOARD_STATUS_CSS */').length, 2, page + ' has one CSS slot');
}
console.log(`board status CSS guards PASS (${Object.keys(checks).length} checks, ${negatives.length} negative controls fail)`);
