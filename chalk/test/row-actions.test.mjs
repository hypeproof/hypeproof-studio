// REQ-CHALK-ROW-ACTIONS (CGP-DS-R-021 / REQ-CGP-DS-23): row actions in Chalk lists and the
// sidebar are visible and operable without hover — touch, keyboard and screen readers.
// Static lock on the shipped HTML/CSS in src/ui:
//   1. nothing is hover-revealed: no :hover / :focus-within rule changes visibility,
//      no opacity:0 / visibility:hidden anywhere, no mouse/pointer enter/over handlers;
//   2. focus stays visible: no outline:none/0, and manage.html keeps a global
//      *:focus-visible ring of at least 2px;
//   3. named row actions keep a 44px target (DES-06): every rule that sizes them says
//      >= 44px, and one rule (or the generic button rule) guarantees it;
//   4. the seat-row action has a text label and a 3:1 boundary (DES-11).
// Negative controls inject each failure into a copy of the page and prove the checker
// reports it, so a passing run means the checks can fail.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const UI = new URL('../src/ui/', import.meta.url);
const pages = Object.fromEntries(
  readdirSync(UI).filter((f) => f.endsWith('.html')).sort().map((f) => [f, readFileSync(new URL(f, UI), 'utf8')]),
);
assert.ok(Object.keys(pages).length >= 9, 'all Chalk pages are read');

// ---------- tiny CSS reader (inline <style> only; Chalk ships no stylesheet files) ----------
function styles(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}
function scripts(html) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}
// Split on a top-level separator, ignoring separators inside (), [] and strings.
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
    else if (/^@keyframes\b|^@font-face\b/.test(prelude)) { /* animation frames never gate an action */ }
    else if (prelude) {
      const decls = splitTop(body, ';').map((d) => {
        const k = d.indexOf(':');
        return [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).replace(/!important/g, '').trim()];
      }).filter(([k]) => k);
      out.push({ selectors: splitTop(prelude, ','), decls, context });
    }
    i = j;
  }
  return out;
}
const px = (v) => {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1);
};
const where = (page, r, sel) => `${page}: ${r.context ? r.context + ' ' : ''}${sel}`;

// ---------- the checker ----------
const REVEAL = new Set(['opacity', 'visibility', 'display', 'pointer-events', 'clip', 'clip-path', 'max-height', 'max-width', 'width', 'height', 'transform', 'content']);
// Row actions that must be 44px targets. `own` matches a selector whose last compound is the
// action; `base` names the generic rule the action inherits its 44px from when no own rule sizes it.
const TARGETS = [
  { page: 'manage.html', name: '좌석 행 「상세」 버튼', own: /td\.c-act\s+button[^\s>+~]*$/ },
  { page: 'manage.html', name: '사이드바 메뉴 링크', own: /\.flow(?:-more)?\s*>?\s*a(?=$|[:#.[])[^\s>+~]*$/ },
  { page: 'manage.html', name: '도움 요청 목록 버튼', own: /#ops-help-list\s+button[^\s>+~]*$/, base: /^button$/ },
  { page: 'authoring.html', name: '수업 단계 행 버튼', own: /#steps\s*>\s*\.step\s*>\s*button$/ },
  { page: 'authoring.html', name: '완료 기준 행 버튼', own: /#learning-completion\s+button$/ },
  { page: 'authoring.html', name: '회고 목록 행 버튼', own: /#retro-(?:sources|findings|decisions)\s+button$/ },
  { page: 'sharing.html', name: '자립 범위 행 삭제 버튼', own: /#reliance-rows\s+button$/, base: /^button$/ },
];

function check(all) {
  const problems = [];
  for (const [page, html] of Object.entries(all)) {
    const list = rules(styles(html));
    for (const r of list) for (const sel of r.selectors) {
      for (const [k, v] of r.decls) {
        if (/:hover|:focus-within/.test(sel) && REVEAL.has(k)) problems.push(`hover-only: ${where(page, r, sel)} sets ${k}:${v}`);
        if ((k === 'opacity' && px(v) === 0) || (k === 'visibility' && v === 'hidden')) problems.push(`hidden-until-revealed: ${where(page, r, sel)} sets ${k}:${v}`);
        if ((k === 'outline' || k === 'outline-style') && /^(none|0(px)?)\b/.test(v)) problems.push(`focus ring removed: ${where(page, r, sel)} sets ${k}:${v}`);
        if (k === 'outline-width' && px(v) === 0) problems.push(`focus ring removed: ${where(page, r, sel)} sets ${k}:${v}`);
      }
    }
    const js = scripts(html);
    for (const m of js.matchAll(/\b(?:on)?(mouseenter|mouseover|mouseleave|mouseout|pointerenter|pointerover|pointerleave|pointerout)\b/g)) problems.push(`hover handler: ${page} script uses ${m[1]}`);
  }
  // Focus ring on the page that carries the sidebar and the seat list.
  const manage = rules(styles(all['manage.html']));
  const ring = manage.find((r) => r.selectors.includes('*:focus-visible') && r.decls.some(([k, v]) => k === 'outline' && (px(v.split(/\s+/)[0]) ?? 0) >= 2));
  if (!ring) problems.push('focus ring: manage.html has no *:focus-visible outline of at least 2px');
  // 44px targets.
  for (const t of TARGETS) {
    const list = rules(styles(all[t.page]));
    let floor = false;
    for (const r of list) for (const sel of r.selectors) {
      const own = t.own.test(sel), base = Boolean(t.base && t.base.test(sel));
      if (!own && !base) continue;
      for (const [k, v] of r.decls) {
        if (k !== 'min-height' && k !== 'height') continue;
        const n = px(v);
        if (own && (n === null || n < 44)) problems.push(`target < 44px: ${t.name} — ${where(t.page, r, sel)} sets ${k}:${v}`);
        if (k === 'min-height' && n !== null && n >= 44 && !r.context) floor = true;
      }
    }
    if (!floor) problems.push(`target < 44px: ${t.name} — no rule guarantees min-height:44px on ${t.page}`);
  }
  // The seat-row action is a persistent, labelled button with a 3:1 boundary.
  const mjs = scripts(all['manage.html']);
  if (!/open\.className='seat-open';open\.textContent='상세';open\.setAttribute\('aria-label'/.test(mjs)) problems.push('label: the seat-row action lost its visible text or accessible name');
  const tokens = Object.fromEntries([...styles(all['manage.html']).matchAll(/(--ink-[a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
  const act = manage.filter((r) => !r.context && r.selectors.some((s) => /^\.ops-seat>td\.c-act button$/.test(s)));
  const border = act.flatMap((r) => r.decls).filter(([k]) => k === 'border' || k === 'border-color').map(([, v]) => v).pop() ?? '';
  const colour = (border.match(/#[0-9A-Fa-f]{6}/) ?? [])[0] ?? tokens[(border.match(/var\((--ink-[a-z0-9-]+)\)/) ?? [])[1]];
  if (!colour || contrast(colour, tokens['--ink-panel']) < 3) problems.push(`boundary: seat-row action border ${border || '(none)'} is under 3:1 on --ink-panel`);
  return problems;
}
function contrast(a, b) {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------- shipped pages pass ----------
const shipped = check(pages);
assert.deepEqual(shipped, [], 'shipped Chalk pages:\n' + shipped.join('\n'));

// ---------- negative controls: every failure mode is caught ----------
// Appended last so an injected rule also wins the cascade; pages differ in whether they close <head>.
const inject = (page, css, js = '') => ({ ...pages, [page]: pages[page] + (css ? `<style>${css}</style>` : '') + (js ? `<script>${js}</script>` : '') });
const mutate = (page, from, to) => { assert.ok(pages[page].includes(from), `control anchor present: ${from}`); return { ...pages, [page]: pages[page].replace(from, to) }; };
const controls = [
  ['hover-revealed seat action (opacity)', inject('manage.html', '.ops-seat>td.c-act button{opacity:0}.ops-seat:hover>td.c-act button{opacity:1}'), /hover-only: manage\.html: \.ops-seat:hover>td\.c-act button sets opacity/],
  ['hidden until hover (opacity:0 alone)', inject('manage.html', '.ops-seat>td.c-act button{opacity:0}'), /hidden-until-revealed/],
  ['focus-within reveal (visibility)', inject('authoring.html', '#retro-sources li button{visibility:hidden}#retro-sources li:focus-within button{visibility:visible}'), /hover-only: authoring\.html: #retro-sources li:focus-within button sets visibility/],
  ['hover reveal inside a media query', inject('console.html', '@media(min-width:600px){tr:hover .act{display:inline-flex}}'), /hover-only: console\.html: @media\(min-width:600px\) tr:hover \.act sets display/],
  ['mouseenter handler', inject('board.html', '', "row.addEventListener('mouseenter',()=>{})"), /hover handler: board\.html script uses mouseenter/],
  ['removed focus ring', inject('manage.html', '.ops-seat>td.c-act button:focus-visible{outline:none}'), /focus ring removed/],
  ['seat action back to 32px (the pre-fix value)', mutate('manage.html', '.ops-seat>td.c-act button{min-height:44px', '.ops-seat>td.c-act button{min-height:32px'), /target < 44px: 좌석 행 「상세」 버튼 — manage\.html: \.ops-seat>td\.c-act button sets min-height:32px/],
  ['sidebar link back to 34px (the pre-fix value)', mutate('manage.html', '.flow>a{min-height:44px', '.flow>a{min-height:34px'), /target < 44px: 사이드바 메뉴 링크/],
  ['sidebar shrunk in a breakpoint', inject('manage.html', '@media(max-width:600px){.flow-more>a{min-height:2rem!important}}'), /target < 44px: 사이드바 메뉴 링크 — manage\.html: @media\(max-width:600px\) \.flow-more>a sets min-height:2rem/],
  ['authoring row guard removed', mutate('authoring.html', '#retro-decisions button{min-height:44px}', '#retro-decisions button{margin:0}'), /no rule guarantees min-height:44px on authoring\.html/],
  ['seat action loses its label', mutate('manage.html', "open.textContent='상세';", "open.textContent='';"), /label: the seat-row action/],
  ['seat action boundary back to --ink-line-hi (1.8:1)', mutate('manage.html', 'border:1px solid var(--ink-mute);color:var(--ink-text-2)', 'border:1px solid var(--ink-line-hi);color:var(--ink-text-2)'), /boundary: seat-row action border/],
];
for (const [name, mutated, expected] of controls) {
  const found = check(mutated);
  assert.ok(found.some((p) => expected.test(p)), `negative control "${name}" was not caught:\n${found.join('\n') || '(no problems reported)'}`);
}
console.log(`row-actions: ${Object.keys(pages).length} pages, ${TARGETS.length} row-action targets clean; ${controls.length}/${controls.length} negative controls caught`);
