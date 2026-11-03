import { staticTokens } from "../../extensions/hypeproof-chat/test/lib/expand-design-tokens.mjs";
// CGP-DS-D-003 (DES-CGP-DS-04, classroom-design DES-11) on the instructor surface:
//   1. every boundary that identifies a Chalk control (button, field, summary toggle, a.btn) is
//      ≥3:1 against every dark surface the page paints, after the page's own custom properties
//      resolve; a control whose border is its own fill must instead have that fill at ≥3:1;
//   2. the state layers: each page declares hover = text at 8% and pressed = text at 12–20% over
//      the surface (all Chalk pages are dark), and its quiet controls paint them on :hover/:active.
// The page CSS is read as served: the route's injected CSS modules are spliced in, and the
// --ds-* transport aliases are expanded to their values. Negative controls inject each failure
// into a copy and prove the checker reports it.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderBoardStatusPage } from '../src/lib/board-status.ts';
import { renderSafetySignal } from '../src/lib/safety-signal.ts';

const expandTokens = staticTokens(readFileSync(new URL('../../extensions/hypeproof-chat/webview-ui/src/designTokens.css', import.meta.url), 'utf8'));
const UI = new URL('../src/ui/', import.meta.url);
const SERVED = { 'board.html': renderBoardStatusPage, 'manage.html': (h) => renderSafetySignal(renderBoardStatusPage(h)) };
const raw = Object.fromEntries(readdirSync(UI).filter((f) => f.endsWith('.html')).sort().map((f) => [f, (SERVED[f] ?? ((h) => h))(readFileSync(new URL(f, UI), 'utf8'))]));
assert.ok(Object.keys(raw).length >= 9, 'all Chalk pages are read');

// ---------- CSS reader ----------
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
      out.push({ selectors: splitTop(prelude, ','), decls, context });
    }
    i = j;
  }
  return out;
}

// ---------- colour ----------
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const norm = (h) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h).toUpperCase();
/** Page-local custom properties: the last top-level :root / html / body declaration wins. */
function env(list) {
  const e = new Map();
  for (const r of list) if (!r.context && r.selectors.some((s) => /^(:root|html|body)$/.test(s))) for (const [k, v] of r.decls) if (k.startsWith('--')) e.set(k, v);
  return e;
}
function resolve(v, e, seen = new Set()) {
  return v.replace(/var\((--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))*[^()]*))?\)/g, (m, name, fb) => {
    if (seen.has(name)) return m;
    if (e.has(name)) return resolve(e.get(name), e, new Set([...seen, name]));
    return fb != null ? resolve(fb, e, seen) : m;
  });
}
const hexIn = (v) => { const m = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(v ?? ''); return m ? norm(m[0]) : null; };
/** The last compound of a selector targets a control. Pseudo-elements are not controls. */
const CONTROL = /(?:^|[^\w-])(button|input|select|textarea|summary)(?![\w-])|\.(btn|reset|ghost|secondary|cgp-state-filter)(?![\w-])/;
/** The last compound selector: split on combinators outside (), so `:nth-of-type(n+2)` stays whole. */
const lastCompound = (s) => {
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  return s.slice(start);
};
/** Ids and classes the page's own markup puts on a control element. */
const markupControls = (html) => {
  const ids = new Set(), classes = new Set();
  for (const m of html.matchAll(/<(button|input|select|textarea|summary)\b([^>]*)>/gi)) {
    const id = /\bid="([^"]+)"/.exec(m[2])?.[1]; if (id) ids.add(id);
    for (const c of (/\bclass="([^"]+)"/.exec(m[2])?.[1] ?? '').split(/\s+/)) if (c) classes.add(c);
  }
  // Buttons the page's script creates: `x=document.createElement('button')` … `x.className='…'`.
  for (const m of html.matchAll(/\b([\w$]+)=document\.createElement\('(?:button|summary)'\)/g)) {
    for (const c of html.matchAll(new RegExp(`\\b${m[1].replace('$', '\\$')}\\.className='([^']+)'`, 'g'))) for (const k of c[1].split(/\s+/)) if (k) classes.add(k);
  }
  return { ids, classes };
};
let MARKUP = { ids: new Set(), classes: new Set() };
const isControl = (s) => {
  if (s.includes('::')) return false;
  const last = lastCompound(s);
  if (CONTROL.test(last)) return true;
  return [...last.matchAll(/#([\w-]+)/g)].some((m) => MARKUP.ids.has(m[1])) || [...last.matchAll(/\.([\w-]+)/g)].some((m) => MARKUP.classes.has(m[1]));
};
const BORDER = /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?$/;
const DARK = 0.03; // luminance: every Chalk page is a dark surface; light chips inside it are not surfaces

function check(pages) {
  const problems = [];
  for (const [page, html] of Object.entries(pages)) {
    MARKUP = markupControls(html);
    const list = rules(expandTokens(styles(html)));
    const e = env(list);
    // Every dark background the page paints outside its controls is a surface a control may sit on.
    const surfaces = new Set();
    for (const r of list) {
      if (/forced-colors/.test(r.context) || r.selectors.every(isControl)) continue;
      for (const [k, v] of r.decls) if (/^background(-color)?$/.test(k)) { const h = hexIn(resolve(v, e)); if (h && lum(h) < DARK) surfaces.add(h); }
    }
    for (const r of list) {
      if (/forced-colors/.test(r.context)) continue;
      // WCAG 1.4.11 exempts inactive controls.
      const sels = r.selectors.filter((s) => isControl(s) && !/:disabled|\[disabled\]|\[aria-disabled/.test(s));
      if (!sels.length) continue;
      const fill = hexIn(resolve(r.decls.filter(([k]) => /^background(-color)?$/.test(k)).map(([, v]) => v).pop() ?? '', e));
      for (const [k, v] of r.decls) {
        if (!BORDER.test(k)) continue;
        const value = resolve(v, e);
        if (/^(0|none)\b|\b(transparent|currentcolor|inherit)\b/i.test(value) && !hexIn(value)) continue;
        const colour = hexIn(value);
        if (!colour) { problems.push(`${page}: ${sels[0]} ${k}:${v} does not resolve to a colour`); continue; }
        if (colour === fill) {
          for (const s of surfaces) if (ratio(fill, s) < 3) problems.push(`${page}: ${sels[0]} is drawn by its fill ${fill}, ${ratio(fill, s).toFixed(2)}:1 on ${s}`);
          continue;
        }
        for (const s of [...surfaces, ...(fill && lum(fill) < DARK ? [fill] : [])]) {
          if (ratio(colour, s) < 3) problems.push(`${page}: ${sels[0]} ${k} ${colour} is ${ratio(colour, s).toFixed(2)}:1 on ${s}`);
        }
      }
    }
  }
  return problems;
}

// ---------- state layers ----------
// The quiet (secondary) controls of each page and the custom properties that carry the layers.
// The page's unclassed secondary buttons: a form's second and later buttons that are not its submit.
const FORM_QUIET = 'form:has(input,textarea,select) button:nth-of-type(n+2):not(.primary):not([type=submit])';
// /manage paints one layer for every non-primary control, !important so no control's fill shorthand erases it.
const MANAGE_LAYER = ':is(button:not(.primary),a.btn:not(.primary),summary)';
const QUIET = {
  'authoring.html': { text: '--hp-text', hover: '--hp-state-hover', pressed: '--hp-state-pressed', controls: ['button.ghost', 'button.reset', 'button.secondary', FORM_QUIET] },
  'budgets.html': { text: '--hp-text', hover: '--hp-state-hover', pressed: '--hp-state-pressed', controls: ['button.ghost', 'button.reset', 'button.secondary', FORM_QUIET] },
  'console.html': { text: '--hp-text', hover: '--hp-state-hover', pressed: '--hp-state-pressed', controls: ['button.ghost', 'button.reset', 'button.secondary', FORM_QUIET] },
  'issuer.html': { text: '--hp-text', hover: '--hp-state-hover', pressed: '--hp-state-pressed', controls: ['button.ghost', 'button.reset', 'button.secondary', FORM_QUIET] },
  'manage.html': { text: '--ink-text', hover: '--ink-state-hover', pressed: '--ink-state-pressed', controls: [MANAGE_LAYER], important: true },
  'sharing.html': { text: '--state-text', hover: '--state-hover', pressed: '--state-pressed', controls: ['button'] },
  'learn.html': { text: '--state-text', hover: '--state-hover', pressed: '--state-pressed', controls: ['button'] },
  'board.html': { text: '--fg', hover: '--state-hover', pressed: '--state-pressed', controls: ['button.ghost'] },
};
const LAYER = (text) => new RegExp(`^color-mix\\(in srgb,\\s*var\\(${text}\\) (\\d+(?:\\.\\d+)?)%,\\s*transparent\\)$`);
/** Selector specificity [ids, classes+attributes+pseudo-classes, types]; :not()/:is()/:has() count their argument. */
const specificity = (s) => {
  const inner = s.replace(/::[\w-]+/g, ' x').replace(/:(not|is|has)\(/g, ' (').replace(/:where\([^()]*\)/g, '');
  const ids = (inner.match(/#[\w-]+/g) ?? []).length;
  const cls = (inner.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const types = (inner.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^()]*\))?/g, ' ').match(/(^|[\s>+~(,])[a-z][\w-]*/gi) ?? []).length;
  return [ids, cls, types];
};
const wins = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
const paints = (decls, name) => decls.some(([k, v]) => /^background(-color|-image)?$/.test(k) && new RegExp(`var\\(${name}\\)`).test(v));
function checkLayers(pages) {
  const problems = [];
  for (const [page, q] of Object.entries(QUIET)) {
    const list = rules(styles(pages[page]));
    const e = env(list);
    const h = LAYER(q.text).exec(e.get(q.hover) ?? ''), p = LAYER(q.text).exec(e.get(q.pressed) ?? '');
    if (!h || Number(h[1]) !== 8) problems.push(`${page}: ${q.hover} is ${e.get(q.hover)} (want ${q.text} at 8% over the surface)`);
    if (!p || Number(p[1]) < 12 || Number(p[1]) > 20) problems.push(`${page}: ${q.pressed} is ${e.get(q.pressed)} (want ${q.text} at 12–20% on a dark surface)`);
    for (const c of q.controls) {
      for (const [state, name] of [[':hover', q.hover], [':active', q.pressed]]) {
        const hit = list.filter((r) => !r.context && r.selectors.some((s) => s.startsWith(c + state) && !s.slice(c.length).includes(' ')));
        if (!hit.some((r) => paints(r.decls, name))) problems.push(`${page}: ${c}${state} does not paint ${name}`);
        // A later shorthand that resets the layer on the same control in the same state.
        const last = hit.filter((r) => r.decls.some(([k]) => /^background(-color|-image)?$/.test(k))).pop();
        if (last && !paints(last.decls, name)) problems.push(`${page}: ${c}${state} is repainted after the layer`);
      }
    }
    // A generic `button:not(…):hover` rule that paints a fill and does not exclude the quiet class
    // reaches the quiet control too, and its shorthand resets the layer (found in a real render:
    // `button:not(.ghost):not(.reset):not(.danger):hover` erased the layer on button.secondary).
    for (const r of list) {
      if (r.context || paints(r.decls, q.hover) || paints(r.decls, q.pressed) || !r.decls.some(([k]) => /^background(-color|-image)?$/.test(k))) continue;
      for (const s of r.selectors) {
        if (!/:(hover|active)/.test(s) || !/^button(?::[\w-]+(?:\([^()]*\))?)*$/.test(s)) continue;
        for (const c of q.controls) {
          const cls = /^button\.([\w-]+)$/.exec(c)?.[1];
          if (!cls || s.includes(`:not(.${cls})`)) continue;
          const state = /:active/.test(s) ? ':active' : ':hover';
          const layer = list.filter((x) => !x.context && paints(x.decls, state === ':hover' ? q.hover : q.pressed)).flatMap((x) => x.selectors).filter((x) => x.startsWith(c + state));
          if (!layer.length || layer.every((x) => !wins(specificity(x), specificity(s)))) problems.push(`${page}: ${s} repaints button.${cls} over its state layer`);
        }
      }
    }
    if (q.important) for (const state of [':hover', ':active']) {
      if (!new RegExp(MANAGE_LAYER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + state + '[^{]*\\{background-image:[^}]*!important\\}').test(styles(pages[page]))) problems.push(`${page}: the ${state} layer is not !important, so a control's fill shorthand erases it`);
    }
    // An unconditional `background: … !important` on a quiet control would erase the layer.
    for (const m of styles(pages[page]).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      if (q.controls.some((c) => splitTop(m[1], ',').includes(c)) && /(^|;)\s*background\s*:[^;]*!important/.test(m[2])) problems.push(`${page}: ${m[1].trim().slice(0, 60)} sets background with !important, which erases the state layer`);
    }
  }
  return problems;
}

// Hover and pressed are the layers and nothing else: no :hover/:active rule on a non-primary control paints its
// own fill. Primary buttons (`.primary`, the pages' default accent button) and the seat row's accent action keep theirs.
const ACCENT = /\.primary\b|^button:not\(\.ghost\):not\(\.reset\)|td\.c-act\b/;
function checkNoOtherFill(pages) {
  const problems = [];
  for (const [page, html] of Object.entries(pages)) {
    MARKUP = markupControls(html);
    const q = QUIET[page];
    for (const r of rules(styles(html))) {
      if (/forced-colors/.test(r.context)) continue;
      for (const s of r.selectors) {
        if (!/:(hover|active)\b/.test(s) || !isControl(s.replace(/:(hover|active)\b/g, '')) || ACCENT.test(s)) continue;
        for (const [k, v] of r.decls) {
          if (!/^background(-color)?$/.test(k) || /^(transparent|none)$/.test(v)) continue;
          if (q && (new RegExp(`var\\(${q.hover}\\)|var\\(${q.pressed}\\)`)).test(v)) continue;
          problems.push(`${page}: ${s} paints ${k}:${v} instead of the state layer`);
        }
      }
    }
  }
  return problems;
}
const boundary = check(raw), layers = checkLayers(raw), fills = checkNoOtherFill(raw);
assert.deepEqual(fills, [], `hover/pressed fills other than the state layer:\n  ${fills.join('\n  ')}`);
assert.deepEqual(boundary, [], `control boundaries below 3:1:\n  ${boundary.join('\n  ')}`);
assert.deepEqual(layers, [], `state layers:\n  ${layers.join('\n  ')}`);

// ---------- negative controls ----------
const swap = (page, from, to) => {
  assert.ok(raw[page].includes(from), `negative control is stale: ${page} lacks ${from.slice(0, 80)}`);
  return { ...raw, [page]: raw[page].replace(from, to) };
};
const negatives = [
  ['the ink theme control line back to the #3A4855 divider', check, swap('manage.html', '--ink-control-line:var(--ds-c-chalk-manage-boundary-81)', '--ink-control-line:var(--ds-c-chalk-manage-boundary-60)')],
  ['a ghost button drawn with the console divider', check, swap('console.html', 'button.ghost { background: transparent; color: var(--muted); border: var(--ds-c-chalk-console-size-3) solid var(--hp-control-line); }', 'button.ghost { background: transparent; color: var(--muted); border: var(--ds-c-chalk-console-size-3) solid var(--line); }')],
  ['the secondary !important rule back on boundary-61', check, swap('budgets.html', 'border:var(--ds-c-chalk-budgets-size-3) solid var(--hp-control-line)!important', 'border:var(--ds-c-chalk-budgets-size-3) solid var(--ds-c-chalk-budgets-boundary-61)!important')],
  ['board fields back on the #2a2e36 line', check, swap('board.html', 'border: var(--ds-c-chalk-board-size-3) solid var(--control-line); bord', 'border: var(--ds-c-chalk-board-size-3) solid var(--line); bord')],
  ['the row\'s unverified example #6E8270 as a manage field line', check, swap('manage.html', '--ink-control-line:var(--ds-c-chalk-manage-boundary-81)', '--ink-control-line:#5E6E60')],
  ['hover at 12%', checkLayers, swap('manage.html', '--ink-state-hover:color-mix(in srgb,var(--ink-text) 8%,transparent)', '--ink-state-hover:color-mix(in srgb,var(--ink-text) 12%,transparent)')],
  ['pressed at 24%', checkLayers, swap('issuer.html', '--hp-state-pressed:color-mix(in srgb,var(--hp-text) 14%,transparent)', '--hp-state-pressed:color-mix(in srgb,var(--hp-text) 24%,transparent)')],
  ['hover from the muted ink', checkLayers, swap('board.html', '--state-hover: color-mix(in srgb, var(--fg) 8%, transparent)', '--state-hover: color-mix(in srgb, var(--muted) 8%, transparent)')],
  ['ghost hover removed', checkLayers, swap('console.html', 'button.ghost:hover:not(:disabled),', 'button.ghost:not(:disabled),')],
  ['manage pressed removed', checkLayers, swap('manage.html', ':is(button:not(.primary),a.btn:not(.primary),summary):active:not(:disabled){', ':is(button:not(.primary),a.btn:not(.primary),summary):focus:not(:disabled){')],
  ['manage layer without !important', checkLayers, swap('manage.html', 'var(--ink-state-hover))!important}', 'var(--ink-state-hover))}')],
  ['bulk actions fill accent on hover again', checkNoOtherFill, swap('manage.html', '#ops-bulk .actions button{background:var(--ink-panel-hi);', '#ops-bulk .actions button:hover:not(:disabled){background:var(--ink-accent)}#ops-bulk .actions button{background:var(--ink-panel-hi);')],
  ['seat card hover back to forest', checkNoOtherFill, swap('manage.html', '.seat-open .top{', '.seat-open:hover{background:var(--ds-c-chalk-manage-surface-108)}.seat-open .top{')],
  ['sharing hover removed', checkLayers, swap('sharing.html', 'button:hover:not(:disabled){background-image:linear-gradient(var(--state-hover),var(--state-hover))}', '')],
  ['learn pressed 30%', checkLayers, swap('learn.html', '--state-pressed:color-mix(in srgb,var(--state-text) 14%,transparent)', '--state-pressed:color-mix(in srgb,var(--state-text) 30%,transparent)')],
  ['the !important transparent background is back', checkLayers, swap('authoring.html', 'background-color:transparent!important', 'background:transparent!important')],
  ['the generic accent hover reaches .secondary again', checkLayers, swap('budgets.html', 'button:not(.ghost):not(.reset):not(.danger):not(.secondary):hover:not(:disabled){', 'button:not(.ghost):not(.reset):not(.danger):hover:not(:disabled){')],
  ['the form\'s quiet buttons lose their hover layer', checkLayers, swap('issuer.html', FORM_QUIET + ':hover:not(:disabled){background-color:transparent;background-image:linear-gradient(var(--hp-state-hover),var(--hp-state-hover))}', '')],
  ['manage hover layer removed', checkLayers, swap('manage.html', ':is(button:not(.primary),a.btn:not(.primary),summary):hover:not(:disabled){background-image:linear-gradient(var(--ink-state-hover),var(--ink-state-hover))!important}', '')],
];
for (const [label, fn, pages] of negatives) assert.notDeepEqual(fn(pages), [], `negative control did not fail: ${label}`);

console.log(`control-boundary: ${Object.keys(raw).length} pages, every control boundary ≥3:1, state layers on ${Object.keys(QUIET).length} pages and no other hover fill; ${negatives.length} negative controls fail`);
