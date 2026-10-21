import { staticTokens } from "../../extensions/hypeproof-chat/test/lib/expand-design-tokens.mjs";
// CGP-DS-R-005 (REQ-CGP-DS-04, DES-11) on the instructor surface: hover and pressed fills derive from
// the foreground via color-mix; boundaries that identify a control never do.
//   1. every custom property a page names *-hover / *-pressed is a foreground (a text colour or the
//      control's own currentColor) mixed into transparent: hover 8%, pressed 12–20%;
//   2. every :hover/:active fill on every served page is one of those layers (as the fill, or as a
//      gradient over the control's own fill) or transparent; no fixed "-hi" colour, no opacity or
//      filter. One documented exception: a seat row promotes its action button to the Primary
//      style while the row is current or under the pointer (an emphasis, not a state layer);
//   3. every painted hover has a pressed rule of the same shape, later on the same page;
//   4. no border on any page is a color-mix (control-boundary.test.mjs measures them ≥3:1).
// The page CSS is read as served (injected CSS modules spliced in, --ds-* aliases expanded).
// Negative controls inject each failure into a copy and prove the checker reports it.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderBoardStatusPage } from '../src/lib/board-status.ts';
import { renderSafetySignal } from '../src/lib/safety-signal.ts';

const expandTokens = staticTokens(readFileSync(new URL('../../extensions/hypeproof-chat/webview-ui/src/designTokens.css', import.meta.url), 'utf8'));
const UI = new URL('../src/ui/', import.meta.url);
const SERVED = { 'board.html': renderBoardStatusPage, 'manage.html': (h) => renderSafetySignal(renderBoardStatusPage(h)) };
const raw = Object.fromEntries(readdirSync(UI).filter((f) => f.endsWith('.html')).sort().map((f) => [f, (SERVED[f] ?? ((h) => h))(readFileSync(new URL(f, UI), 'utf8'))]));
assert.ok(Object.keys(raw).length >= 9, 'all Chalk pages are read');

// ---------- CSS reader (as in control-boundary.test.mjs) ----------
const styles = (html) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
function splitTop(text, sep) {
  const out = []; let depth = 0, quote = '', cur = '';
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
function rules(css, context = '') {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = []; let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (/^@(media|container|supports|layer)\b/.test(prelude)) out.push(...rules(body, (context + ' ' + prelude).trim()));
    else if (prelude && !prelude.startsWith('@')) {
      const decls = splitTop(body, ';').map((d) => { const k = d.indexOf(':'); return [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).replace(/!important/g, '').trim()]; }).filter(([k]) => k);
      out.push({ selectors: splitTop(prelude, ',').map((s) => s.replace(/\s+/g, ' ')), decls, context });
    }
    i = j;
  }
  return out;
}
const pageRules = (html) => rules(expandTokens(styles(html))).map((r, index) => ({ ...r, index }));

// ---------- 1. state tokens ----------
const MIX = /^color-mix\(in srgb,\s*(var\(--[\w-]+\)|currentColor)\s+(\d+(?:\.\d+)?)%,\s*transparent\)$/;
function checkTokens(pages) {
  const bad = [];
  for (const [page, html] of Object.entries(pages)) {
    for (const r of pageRules(html)) for (const [k, v] of r.decls) {
      if (!/^--[\w-]*-(hover|pressed)$/.test(k)) continue;
      const m = MIX.exec(v);
      if (!m) { bad.push(`${page}: ${k} is "${v}", not a foreground mixed into transparent`); continue; }
      if (/layer-/.test(k) && m[1] !== 'currentColor') bad.push(`${page}: ${k} mixes ${m[1]}, not the control's own foreground`);
      const share = Number(m[2]);
      if (k.endsWith('-hover') && share !== 8) bad.push(`${page}: ${k} is ${share}% (hover is 8%)`);
      if (k.endsWith('-pressed') && (share < 12 || share > 20)) bad.push(`${page}: ${k} is ${share}% (pressed is 12–20%)`);
    }
  }
  return bad;
}

// ---------- 2/3. pointer-state fills ----------
/** The seat row's action button takes the Primary style while its row is current or hovered. */
const EXEMPT = new Set(['.ops-seat:hover>td.c-act button']);
const LAYER_VAR = { hover: /^var\(--[\w-]*(state|layer)-hover\)$/, active: /^var\(--[\w-]*(state|layer)-pressed\)$/ };
const gradientOf = (v) => /^linear-gradient\((var\(--[\w-]+\)),\s*(var\(--[\w-]+\))\)$/.exec(v);
const stateOf = (sels) => {
  const h = sels.some((s) => /:hover\b/.test(s)), a = sels.some((s) => /:active\b/.test(s));
  return h && a ? 'both' : h ? 'hover' : a ? 'active' : null;
};
/** "layer" when the rule paints a state layer, "clear" when it only clears the fill, null when it
 *  paints nothing; throws the offending declaration otherwise. */
function paintOf(r, state) {
  let kind = null;
  for (const [k, v] of r.decls) {
    if (k === 'background' || k === 'background-color') {
      if (/^(transparent|none)$/.test(v)) { kind ??= 'clear'; continue; }
      if (LAYER_VAR[state].test(v)) { kind = 'layer'; continue; }
      throw new Error(`${k}:${v}`);
    }
    if (k === 'background-image') {
      if (v === 'none') { kind ??= 'clear'; continue; }
      const g = gradientOf(v);
      if (g && g[1] === g[2] && LAYER_VAR[state].test(g[1])) { kind = 'layer'; continue; }
      throw new Error(`${k}:${v}`);
    }
  }
  return kind;
}
function checkFills(pages) {
  const bad = [];
  for (const [page, html] of Object.entries(pages)) {
    const list = pageRules(html).filter((r) => !/forced-colors/.test(r.context));
    for (const r of list) {
      const sels = r.selectors.filter((s) => !EXEMPT.has(s));
      const state = stateOf(sels);
      if (!state) continue;
      const where = `${page}: ${sels.join(',').slice(0, 90)}`;
      const paints = r.decls.some(([k]) => /^background(-color|-image)?$/.test(k));
      if (state === 'both') { if (paints) bad.push(`${where} paints :hover and :active with one fill`); continue; }
      if (r.selectors.length !== sels.length && paints) { bad.push(`${where} shares a rule with the exempt seat action`); continue; }
      try { paintOf(r, state); } catch (e) { bad.push(`${where} ${state} paints ${e.message}`); }
      for (const [k, v] of r.decls) {
        if (k === 'filter') bad.push(`${where} changes filter on ${state}`);
        if (k === 'opacity' && Number(v) < 1) bad.push(`${where} fades to opacity ${v} on ${state}`);
      }
    }
  }
  return bad;
}
function checkPressed(pages) {
  const bad = [];
  for (const [page, html] of Object.entries(pages)) {
    const list = pageRules(html).filter((r) => !/forced-colors/.test(r.context));
    for (const r of list) {
      if (stateOf(r.selectors) !== 'hover') continue;
      let kind; try { kind = paintOf(r, 'hover'); } catch { continue; } // checkFills reports it
      if (kind !== 'layer') continue;
      for (const s of r.selectors.filter((x) => /:hover\b/.test(x))) {
        const want = s.replace(/:hover\b/g, ':active');
        const ok = list.some((a) => a.index > r.index && a.context === r.context && a.selectors.includes(want) && (() => { try { return paintOf(a, 'active') === 'layer'; } catch { return false; } })());
        if (!ok) bad.push(`${page}: ${s} has no later ${want} painting the pressed layer`);
      }
    }
  }
  return bad;
}

// ---------- 4. boundaries never derive ----------
function checkBoundaries(pages) {
  const bad = [];
  for (const [page, html] of Object.entries(pages)) for (const r of pageRules(html)) for (const [k, v] of r.decls) {
    if (/^(border|outline)(-[\w-]+)?$/.test(k) && /color-mix/.test(v)) bad.push(`${page}: ${r.selectors[0]} ${k} is derived from the foreground (${v})`);
    if (/^--[\w-]*(control-line|line|boundary)[\w-]*$/.test(k) && /color-mix/.test(v)) bad.push(`${page}: ${k} is a color-mix boundary`);
  }
  return bad;
}

const CHECKS = { tokens: checkTokens, fills: checkFills, pressed: checkPressed, boundaries: checkBoundaries };
for (const [name, fn] of Object.entries(CHECKS)) { const bad = fn(raw); assert.deepEqual(bad, [], `${name}: ${bad.join('; ')}`); }

// Coverage: the families this row converted are still on the pages (a rename must not pass vacuously).
const hoverSelectors = (page) => pageRules(raw[page]).filter((r) => stateOf(r.selectors) === 'hover').flatMap((r) => r.selectors);
for (const page of ['authoring.html', 'budgets.html', 'console.html', 'issuer.html']) {
  for (const s of ['button:not(.ghost):not(.reset):not(.danger):not(.secondary):hover:not(:disabled)', '.hp-flowbar nav a:hover']) assert.ok(hoverSelectors(page).includes(s), `${page}: ${s} is gone`);
}
for (const s of ['button.primary:hover', 'a.btn.primary:hover', '.flow>a:hover', '.flow-more>a:hover', '.side .flow a:hover', '.ops-seat:hover>td']) assert.ok(hoverSelectors('manage.html').includes(s), `manage.html: ${s} is gone`);

// ---------- negative controls ----------
const mutate = (page, from, to) => {
  assert.equal(raw[page].split(from).length, 2, `negative control is stale: "${from.slice(0, 70)}" is not exactly once in ${page}`);
  return { ...raw, [page]: raw[page].replace(from, to) };
};
const NEG = [
  ['tokens', 'console own-foreground layer at 12%', mutate('console.html', '--hp-layer-hover:color-mix(in srgb,currentColor 8%,transparent)', '--hp-layer-hover:color-mix(in srgb,currentColor 12%,transparent)')],
  ['tokens', 'manage own-foreground layer from the page text', mutate('manage.html', '--ink-layer-hover:color-mix(in srgb,currentColor 8%,transparent)', '--ink-layer-hover:color-mix(in srgb,var(--ink-text) 8%,transparent)')],
  ['tokens', 'budgets pressed layer 30%', mutate('budgets.html', '--hp-layer-pressed:color-mix(in srgb,currentColor 14%,transparent)', '--hp-layer-pressed:color-mix(in srgb,currentColor 30%,transparent)')],
  ['fills', 'console primary back to the fixed accent-hi', mutate('console.html', 'button:not(.ghost):not(.reset):not(.danger):not(.secondary):hover:not(:disabled){background-image:linear-gradient(var(--hp-layer-hover),var(--hp-layer-hover));', 'button:not(.ghost):not(.reset):not(.danger):not(.secondary):hover:not(:disabled){background:var(--hp-accent-hi);')],
  ['fills', 'authoring flow link back to the panel-hi fill', mutate('authoring.html', '.hp-flowbar nav a:hover{background:var(--hp-state-hover);color', '.hp-flowbar nav a:hover{background:var(--hp-panel-hi);color')],
  ['fills', 'manage seat row back to a literal', mutate('manage.html', '.ops-seat:hover>td{background:var(--ink-state-hover)}.ops-seat:active', '.ops-seat:hover>td{background:#25303C}.ops-seat:active')],
  ['fills', 'manage primary back to an opacity hover', mutate('manage.html', 'button.primary:hover,a.btn.primary:hover{background-image:linear-gradient(var(--ink-layer-hover),var(--ink-layer-hover))}', 'button.primary:hover,a.btn.primary:hover{opacity:.85}')],
  ['fills', 'issuer pressed paints the hover layer', mutate('issuer.html', '.hp-flowbar nav a:active{background:var(--hp-state-pressed)}', '.hp-flowbar nav a:active{background:var(--hp-state-hover)}')],
  ['pressed', 'budgets primary pressed rule removed', mutate('budgets.html', 'button:not(.ghost):not(.reset):not(.danger):not(.secondary):active:not(:disabled){background-image:linear-gradient(var(--hp-layer-pressed),var(--hp-layer-pressed))}', '')],
  ['pressed', 'manage flow-more pressed rule removed', mutate('manage.html', '.flow-more>a:active{background:var(--ink-state-pressed)}', '')],
  ['pressed', 'manage seat row pressed rule removed', mutate('manage.html', '.ops-seat:active>td{background:var(--ink-state-pressed)}', '')],
  ['boundaries', 'manage control line derived from the text', mutate('manage.html', '--ink-control-line:var(--ds-c-chalk-manage-boundary-81);', '--ink-control-line:color-mix(in srgb,var(--ink-text) 45%,transparent);')],
];
for (const [name, label, pages] of NEG) assert.notDeepEqual(CHECKS[name](pages), [], `negative control: ${label} still passes ${name}`);

console.log(`hover-pressed-fills: ${Object.keys(raw).length} pages, every hover/pressed fill is a foreground layer with a pressed rule, no derived boundary; ${NEG.length} negative controls fail`);
