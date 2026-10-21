// DES-CGP-LEARN-13 — CSS guards for the pinned safety item on /manage: amber (never red), a
// readable label that is never cut, 44px targets, 14px text, a hugging focus ring and forced
// colours. Values come from the shipped safetySignalCss; each check also runs against a mutated
// copy that must fail (negative controls).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safetySignalCss as tokenized} from '../src/lib/safety-signal.ts';
import {staticTokens} from '../../extensions/hypeproof-chat/test/lib/expand-design-tokens.mjs';
// CGP-DS-R-001: the shipped rules reference shared tokens; expand only the static --ds-* aliases.
const safetySignalCss = staticTokens(readFileSync(new URL('../../extensions/hypeproof-chat/webview-ui/src/designTokens.css', import.meta.url), 'utf8'))(tokenized);

function parse(css) {
  const rules = new Map();
  for (const m of css.matchAll(/(^|\n)([^@{}\n][^{}]*)\{([^{}]*)\}/g)) {
    for (const sel of m[2].split(',').map((s) => s.trim())) {
      rules.set(sel, {...(rules.get(sel) || {}), ...Object.fromEntries(m[3].split(';').filter(Boolean).map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      }))});
    }
  }
  return rules;
}
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (v) => { assert.match(v || '', /^#[0-9a-f]{6}$/i, 'hex colour ' + v); return v; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Amber: red ≥ green > blue, green well above blue and close to red (not red, not green). */
const amber = (h) => { const [r, g, b] = rgb(h); return r >= g && g > b + 60 && r - g < 80; };
const pages = ['#0f1418', '#151c22'];

const checks = {
  'pinned item: amber border, 2px, readable on the page': (css) => {
    const r = parse(css).get('.safety-pin'); assert.ok(r, 'rule .safety-pin');
    const m = /^(\d+)px solid (#[0-9a-f]{6})$/i.exec(r.border || ''); assert.ok(m, 'border ' + r.border);
    assert.ok(Number(m[1]) >= 2, 'border width');
    assert.ok(amber(m[2]), 'amber border ' + m[2]);
    for (const p of pages) assert.ok(ratio(m[2], p) >= 3, 'border vs page ' + p);
    assert.ok(ratio(hex(r.color), hex(r.background)) >= 4.5, 'body text contrast');
  },
  'label chip: amber, not red, 4.5:1 text, 14px, never cut': (css) => {
    const r = parse(css).get('.safety-flag'); assert.ok(r, 'rule .safety-flag');
    const border = hex(/#[0-9a-f]{6}/i.exec(r.border || '')?.[0]);
    assert.ok(amber(border), 'amber chip border');
    assert.ok(amber(hex(r.color)), 'amber chip text');
    assert.ok(ratio(r.color, hex(r.background)) >= 4.5, 'chip text contrast');
    assert.ok(parseInt(r['font-size'], 10) >= 14, 'chip font size');
    assert.equal(r['white-space'], 'nowrap', 'the label is never broken mid-word');
    assert.ok(!('overflow' in r) && !('text-overflow' in r) && !('max-width' in r), 'the label is never truncated');
  },
  'item text 14px and wraps as a row': (css) => {
    const rules = parse(css);
    const item = rules.get('.safety-item'); assert.ok(item);
    assert.ok(parseInt(item['font-size'], 10) >= 14, 'item font size');
    assert.equal(item['flex-wrap'], 'wrap');
    assert.ok(parseInt(rules.get('.safety-note')?.['font-size'], 10) >= 14, 'note font size');
  },
  'buttons: 44px targets, 14px text, hugging focus ring': (css) => {
    const rules = parse(css);
    const b = rules.get('.safety-item button'); assert.ok(b);
    assert.ok(parseInt(b['min-height'], 10) >= 44, 'target height');
    assert.ok(parseInt(b['min-width'], 10) >= 44, 'target width');
    assert.ok(parseInt(b['font-size'], 10) >= 14, 'button font size');
    assert.ok(ratio(hex(b.color), hex(b.background)) >= 4.5, 'button text contrast');
    const f = rules.get('.safety-item button:focus-visible'); assert.ok(f);
    const m = /^([2-9])px solid (#[0-9a-f]{6})$/i.exec(f.outline || ''); assert.ok(m, 'outline ' + f.outline);
    assert.ok(ratio(m[2], b.background) >= 3, 'focus ring contrast');
    const off = parseInt(f['outline-offset'], 10); assert.ok(off >= 1 && off <= 3, 'ring hugs the button');
  },
  'forced colours keep border, text and focus': (css) => {
    const forced = css.match(/@media\(forced-colors:active\)\{([\s\S]*)\}\s*$/)?.[1] || '';
    assert.match(forced, /\.safety-pin,\.safety-flag,\.safety-item button \{[^}]*border-color:CanvasText[^}]*color:CanvasText[^}]*background:Canvas/);
    assert.match(forced, /\.safety-item button:focus-visible\{outline-color:Highlight\}/);
  },
};
const mutations = {
  'pinned item: amber border, 2px, readable on the page': [['border:2px solid #f5c36b', 'border:2px solid #ff8686'], ['border:2px solid #f5c36b', 'border:1px solid #f5c36b']],
  'label chip: amber, not red, 4.5:1 text, 14px, never cut': [['color:#fde68a', 'color:#fecaca'], ['font-size:14px;font-weight:600', 'font-size:12px;font-weight:600'], ['white-space:nowrap}', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'], ['border:1px solid #f5c36b;border-radius:6px', 'border:1px solid #fca5a5;border-radius:6px']],
  'item text 14px and wraps as a row': [['gap:8px;padding:6px 0;font-size:14px', 'gap:8px;padding:6px 0;font-size:13px'], ['flex-wrap:wrap;align-items:center;gap:8px', 'flex-wrap:nowrap;align-items:center;gap:8px']],
  'buttons: 44px targets, 14px text, hugging focus ring': [['min-height:44px', 'min-height:32px'], ['min-width:44px', 'min-width:20px'], ['outline:2px solid #93c5fd', 'outline:none'], ['outline-offset:2px', 'outline-offset:8px']],
  'forced colours keep border, text and focus': [['outline-color:Highlight', 'outline-color:inherit']],
};
let passed = 0;
for (const [name, fn] of Object.entries(checks)) {
  fn(safetySignalCss);
  for (const [from, to] of mutations[name]) {
    assert.ok(safetySignalCss.includes(from), 'mutation source present: ' + from);
    assert.throws(() => fn(safetySignalCss.replace(from, to)), undefined, 'negative control must fail: ' + name + ' ← ' + to);
  }
  passed++;
  console.log('  ok   ' + name + ' (' + mutations[name].length + ' negative controls)');
}
const html = readFileSync(new URL('../src/ui/manage.html', import.meta.url), 'utf8');
assert.equal(html.split('/* SAFETY_SIGNAL_CSS */').length, 2, 'manage.html has one safety CSS slot');
assert.equal(html.split('// SAFETY_SIGNAL_SCRIPT').length, 2, 'manage.html has one safety script slot');
console.log(`PASS safety-signal-css: ${passed + 1} checks`);
