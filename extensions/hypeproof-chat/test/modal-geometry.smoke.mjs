// CGP-DS-D-020 (DES-CGP-DS-25): dialog geometry, measured on the CASCADE in headless Chromium.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/modal-geometry.smoke.mjs
//
// The real WriteApprovalDialog, OutboundDialog, ChatPreferences and the ActivityTrashPanel purge
// dialog are bundled with the real webview stylesheets in main.tsx order (tokens.css, focusGeometry.css,
// then every component sheet, styles.css, chatDetails.css) and mounted open. Chalk's sharing.html
// outbound dialog is loaded with the transport it is served with. For each (theme, dialog) the
// viewport is resized through 12 widths and computed styles are read: width (480 / viewport-24 /
// never below 320), the four radii, the four paddings, the ::backdrop dim per theme (dark .4, light
// .3), the bottom sheet at <=390px and the card at 391px, the enter and exit animation, reduced
// motion (no animation) and forced colours (geometry unchanged, system colours). Nothing is read from
// rule text, so a later override, a 3-class selector or an @media rule cannot hide: the negative
// controls at the end inject exactly those and the same check must go red.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = resolve(root, 'extensions/hypeproof-chat/webview-ui/src');

const bin = findChromium();
if (!bin || process.env.FOCUS_STATIC_ONLY) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('modal-geometry: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('modal-geometry: NOT RUN (no headless Chromium; set HEADLESS_CHROMIUM or FOCUS_REQUIRE_BROWSER=1)');
  process.exit(0);
}

// ---------- the webview as shipped: main.tsx imports, then the four dialogs ----------
const entry = `
import "./tokens.css";
import "./focusGeometry.css";
import { LocalReview } from "./LocalReview";
import { StartPage } from "./StartPage";
import { App } from "./App";
import "./styles.css";
import "./chatDetails.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { WriteApprovalDialog } from "./WriteApprovalDialog";
import { OutboundDialog } from "./OutboundDialog";
import { ChatPreferences } from "./ChatPreferences";
import { ActivityTrashPanel } from "./ActivityTrashPanel";
window.__keep = [LocalReview, StartPage, App];
const which = window.__kind;
const outbound = { id: 'r1', public: true, notes: [], excluded: '포함하지 않는 것: 비밀번호, 다른 파일', sections: [{ recipient: '갤러리 · site.invalid', items: [{ id: 'a', label: '아주아주긴이름의한글파일이름이어서줄바꿈이필요한파일.html', bytes: 1200 }] }] };
const write = { id: 'w', title: '파일을 바꿔도 될까요?', verb: '바꿈', files: ['a.html', '긴이름'.repeat(20) + '.md'], changes: [{ kind: 'measured', percent: '82%', ratio: 0.82, changedLines: 9, addedLines: 4, rewrite: true, almostAll: true, spacingOnly: false }, { kind: 'unknown', reason: 'no-match' }] };
function Prefs() { const [o, s] = useState(true); return <ChatPreferences open={o} onClose={() => s(false)}><p>설정 내용</p><details open><summary>사용량</summary><p>내용</p></details></ChatPreferences>; }
function Page() {
  if (which === 'write') return <WriteApprovalDialog prompt={write} onAnswer={() => {}} />;
  if (which === 'outbound') return <OutboundDialog prompt={outbound} onAnswer={() => {}} />;
  if (which === 'trash') return <ActivityTrashPanel files={null} scopeKey="s" />;
  return <Prefs />;
}
createRoot(document.getElementById('r')).render(<Page />);
`;
const built = await build({
  stdin: { contents: entry, resolveDir: SRC, sourcefile: 'modal-geometry-entry.tsx', loader: 'tsx' },
  bundle: true, write: false, outdir: 'out', jsx: 'automatic', logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
});
const js = built.outputFiles.find((o) => o.path.endsWith('.js')).text.replace(/<\/script/g, '<\\/script');
const studioCss = built.outputFiles.find((o) => o.path.endsWith('.css')).text;
assert.ok(studioCss.indexOf('.hp-modal.hp-modal') > studioCss.indexOf('--hp-dur-modal-enter'), 'bundle carries tokens.css before modalSurface.css');
assert.ok(studioCss.lastIndexOf('.hps-preferences') > studioCss.indexOf('.hp-modal.hp-modal'), 'chatDetails.css/styles.css come after modalSurface.css, as in main.tsx');

// Chalk: the transport it serves as <style data-design-tokens> ahead of the page's own rules.
const transport = readFileSync(resolve(root, 'chalk/src/lib/design-tokens.ts'), 'utf8');
const chalkTokens = JSON.parse(transport.split('\n').find((l) => l.startsWith('export const DESIGN_TOKENS = ')).slice('export const DESIGN_TOKENS = '.length, -1));
const chalkHtml = readFileSync(resolve(root, 'chalk/src/ui/sharing.html'), 'utf8').replace(/<head\b[^>]*>/i, (h) => `${h}<style data-design-tokens>${chalkTokens}</style>`);

const THEMES = {
  dark: { cls: 'vscode-dark', id: 'HypeProof Studio', dim: 'rgba(0, 0, 0, 0.4)', v: { focusBorder: '#D5F279', 'editor-background': '#151D19', 'quickInput-background': '#202C24', foreground: '#F2F4E8' } },
  light: { cls: 'vscode-light', id: 'Light Modern', dim: 'rgba(0, 0, 0, 0.3)', v: { focusBorder: '#005fb8', 'editor-background': '#ffffff', 'quickInput-background': '#f8f8f8', foreground: '#3b3b3b' } },
};
// personal: the task workspace shell (data-chat-detail=personal around .tw-workspace); classroom: the plain shell.
const SEATS = ['personal', 'classroom'];
const studioPage = (theme, kind, seat, extraCss = '') => `<!doctype html><html><head><meta charset="utf-8"><style>:root{${Object.entries(theme.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';')}}${studioCss}${extraCss}</style></head>
<body class="${theme.cls}" data-vscode-theme-id="${theme.id}" style="background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)">${seat === 'personal' ? '<div class="hps-shell" data-chat-detail="personal"><div class="tw-workspace"><div id="r"></div></div></div>' : '<div class="hps-shell"><div id="r"></div></div>'}
<script>window.__kind=${JSON.stringify(kind)}</script><script>${js}</script></body></html>`;
const chalkPage = (extraCss = '') => chalkHtml.replace('</head>', `<style>${extraCss}</style></head>`);

// 504 is where the card first reaches its 480 cap; 391/390 is the sheet breakpoint; 320 the floor.
const WIDTHS = [1420, 800, 600, 504, 503, 480, 420, 392, 391, 390, 360, 320];
const expectedWidth = (vw, cw = vw) => (vw <= 390 ? cw : Math.min(480, cw - 24));

const MEASURE = `(() => {
  const d = document.querySelector(window.__sel);
  if (!d) return null;
  const s = getComputedStyle(d), r = d.getBoundingClientRect();
  const bd = window.__sel.startsWith('dialog') || d.tagName === 'DIALOG' ? getComputedStyle(d, '::backdrop') : getComputedStyle(d.parentElement);
  const side = (el, p) => ['top', 'right', 'bottom', 'left'].map((k) => getComputedStyle(el).getPropertyValue(p + '-' + k));
  const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((k) => s.getPropertyValue('border-' + k + '-radius'));
  const header = d.querySelector(':scope > header'), body = d.querySelector('.hps-preferences-body');
  return {
    open: d.tagName === 'DIALOG' ? d.open : true,
    w: Math.round(r.width * 10) / 10, cw: document.documentElement.clientWidth, left: Math.round(r.left), right: Math.round(document.documentElement.clientWidth - r.right), bottom: Math.round(innerHeight - r.bottom),
    corners, pad: side(d, 'padding'), headerPad: header ? side(header, 'padding') : null, bodyPad: body ? side(body, 'padding') : null,
    backdrop: bd.backgroundColor, anim: s.animationName, dur: s.animationDuration, pos: s.position,
    pageScroll: document.documentElement.scrollWidth > innerWidth, innerOverflow: d.scrollWidth > d.clientWidth,
    bg: s.backgroundColor, color: s.color, borderW: s.borderTopWidth, borderStyle: s.borderTopStyle,
    top: Math.round(r.top), h: Math.round(r.height), vh: innerHeight,
  };
})()`;

const find = (m, ctx) => {
  const out = [];
  const label = `${ctx.kind}/${ctx.theme}@${ctx.vw}`;
  const bad = (what, got, want) => out.push(`${label}: ${what} is ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  if (!m) { out.push(`${ctx.kind}/${ctx.theme}@${ctx.vw}: dialog not found`); return out; }
  if (!m.open) bad('open', m.open, true);
  const sheet = ctx.vw <= 390;
  // Layout width excludes a classic scrollbar (Linux/Windows CI); the media query still uses ctx.vw.
  const want = expectedWidth(ctx.vw, m.cw);
  if (Math.abs(m.w - want) > 0.6) bad('width', m.w, want);
  if (!sheet && (m.w < 320 || m.w > 480)) bad('card width range', m.w, '320..480');
  if (sheet) {
    if (m.left !== 0 || m.right !== 0 || m.bottom !== 0) bad('sheet left/right/bottom', [m.left, m.right, m.bottom], [0, 0, 0]);
    if (m.pos !== 'fixed') bad('sheet position', m.pos, 'fixed');
    if (m.corners.join(' ') !== '12px 12px 0px 0px') bad('sheet radii', m.corners.join(' '), '12px 12px 0px 0px');
    if (m.h > m.vh * 0.9 + 1) bad('sheet height cap 90%', m.h, m.vh * 0.9);
  } else {
    if (m.corners.some((c) => c !== '12px')) bad('card radii', m.corners.join(' '), '12px x4');
    if (m.pos === 'fixed' && m.bottom === 0) bad('card sits as a sheet at 391px+', m.bottom, '>0');
    if (m.left <= 0 || m.right <= 0) bad('card gutter', [m.left, m.right], '>0');
    if (Math.abs(m.left - m.right) > 1) bad('card centred', [m.left, m.right], 'equal');
  }
  if (m.pad.some((p) => p !== '20px')) bad('padding', m.pad.join(' '), '20px x4');
  if (ctx.kind === 'pref') {
    if (m.headerPad.join(' ') !== '0px 0px 20px 0px') bad('settings header padding', m.headerPad.join(' '), '0 0 20px');
    if (m.bodyPad.join(' ') !== '20px 0px 0px 0px') bad('settings body padding', m.bodyPad.join(' '), '20px 0 0');
  }
  if (!ctx.forced && m.backdrop !== ctx.dim) bad('backdrop', m.backdrop, ctx.dim);
  if (m.pageScroll) bad('horizontal page scroll', true, false);
  if (m.innerOverflow) bad('inner horizontal overflow', true, false);
  if (ctx.motion === 'reduce') { if (m.anim !== 'none') bad('animation under reduced motion', m.anim, 'none'); }
  else if (!ctx.forced) { if (m.anim !== 'hp-modal-enter' || m.dur !== '0.18s') bad('enter animation', `${m.anim} ${m.dur}`, 'hp-modal-enter 0.18s'); }
  return out;
};

const KINDS = [
  { kind: 'write', sel: 'dialog.hps-write-approval' },
  { kind: 'outbound', sel: 'dialog.hps-outbound' },
  { kind: 'pref', sel: 'dialog.hps-preferences' },
  { kind: 'trash', sel: '.tw-trash-dialog' },
];

async function sweep(b, { extraCss = '', widths = WIDTHS, themes = ['dark', 'light'], kinds = KINDS, chalk = true } = {}) {
  const findings = [];
  let states = 0;
  for (const seat of SEATS) for (const themeName of themes) for (const { kind, sel } of kinds) {
    if (kind === 'trash' && seat === 'classroom') continue; // the 내 작품 panel exists only in the personal workspace
    const theme = THEMES[themeName];
    await b.load(studioPage(theme, kind, seat, extraCss), { width: 1420, height: 800, dark: themeName === 'dark' });
    if (kind === 'trash') {
      // The panel asks the host for its list and shows the purge dialog after 휴지통 → 영구 삭제….
      await b.evaluate(`window.postMessage({ type: 'activityTrashState', view: { scope: 's', entries: [{ id: 'e1', path: '아주아주긴이름의한글파일이름이어서줄바꿈이필요한파일.html', at: 1760000000000 }], damaged: 0 } }, '*')`);
      await new Promise((r) => setTimeout(r, 150));
      await b.evaluate(`document.querySelector('.tw-trash-entry').click()`);
      await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`[...document.querySelectorAll('.tw-trash-actions button')].find((x) => /영구 삭제/.test(x.textContent)).click()`);
    }
    await new Promise((r) => setTimeout(r, 300));
    await b.evaluate(`window.__sel = ${JSON.stringify(sel)}`);
    for (const vw of widths) {
      await b.send('Emulation.setDeviceMetricsOverride', { width: vw, height: 800, deviceScaleFactor: 1, mobile: false });
      await new Promise((r) => setTimeout(r, 40));
      findings.push(...find(await b.evaluate(MEASURE), { vw, kind, theme: `${seat}/${themeName}`, dim: theme.dim }));
      states++;
    }
  }
  if (chalk) {
    // Chalk is always the dark surface. The dialog opens like the page opens it: showModal().
    await b.load(chalkPage(extraCss), { width: 1420, height: 800, dark: true });
    await b.evaluate(`document.getElementById('outbound').showModal(); window.__sel = 'dialog#outbound'`);
    await new Promise((r) => setTimeout(r, 300));
    for (const vw of widths) {
      await b.send('Emulation.setDeviceMetricsOverride', { width: vw, height: 800, deviceScaleFactor: 1, mobile: false });
      await new Promise((r) => setTimeout(r, 40));
      findings.push(...find(await b.evaluate(MEASURE), { vw, kind: 'chalk', theme: 'dark', dim: THEMES.dark.dim }));
      states++;
    }
  }
  return { findings, states };
}

const b = await launch(bin);
try {
  // 1. The shipped CSS: every width, both themes, all four Studio dialogs and Chalk's.
  const real = await sweep(b);
  assert.deepEqual(real.findings, [], `computed dialog geometry is wrong:\n${real.findings.slice(0, 12).join('\n')}${real.findings.length > 12 ? `\n... ${real.findings.length - 12} more` : ''}`);
  assert.ok(real.states >= 2 * 7 * WIDTHS.length + WIDTHS.length, `measured ${real.states} states`);

  // 2. Exit animation, reduced motion and forced colours on one dialog of each family.
  for (const { kind, sel } of [KINDS[0], KINDS[2], KINDS[3]]) {
    await b.load(studioPage(THEMES.dark, kind, 'personal'), { width: 800, height: 800, dark: true });
    if (kind === 'trash') {
      await b.evaluate(`window.postMessage({ type: 'activityTrashState', view: { scope: 's', entries: [{ id: 'e1', path: 'a.html', at: 1760000000000 }], damaged: 0 } }, '*')`);
      await new Promise((r) => setTimeout(r, 150));
      await b.evaluate(`document.querySelector('.tw-trash-entry').click()`);
      await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`[...document.querySelectorAll('.tw-trash-actions button')].find((x) => /영구 삭제/.test(x.textContent)).click()`);
    }
    await new Promise((r) => setTimeout(r, 300));
    const read = (expr) => b.evaluate(`(() => { const d = document.querySelector(${JSON.stringify(sel)}); ${expr} })()`);
    // exit: the attribute finishModal sets selects hp-modal-exit at 0.12s
    const exit = await read(`d.setAttribute('data-closing', ''); const s = getComputedStyle(d); const o = { name: s.animationName, dur: s.animationDuration }; d.removeAttribute('data-closing'); return o;`);
    assert.deepEqual(exit, { name: 'hp-modal-exit', dur: '0.12s' }, `${kind}: exit animation`);
    // reduced motion: no animation on the open dialog or while closing
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
    const reduced = await read(`const s = getComputedStyle(d); const a = s.animationName; d.setAttribute('data-closing', ''); const c = getComputedStyle(d).animationName; d.removeAttribute('data-closing'); return { open: a, closing: c, anims: d.getAnimations().length };`);
    assert.deepEqual(reduced, { open: 'none', closing: 'none', anims: 0 }, `${kind}: reduced motion plays no animation`);
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  }
  for (const vw of [1420, 391, 390, 320]) {
    for (const { kind, sel } of KINDS) {
      await b.load(studioPage(THEMES.dark, kind, 'personal'), { width: vw, height: 800, forcedColors: true, dark: true });
      if (kind === 'trash') {
        await b.evaluate(`window.postMessage({ type: 'activityTrashState', view: { scope: 's', entries: [{ id: 'e1', path: 'a.html', at: 1760000000000 }], damaged: 0 } }, '*')`);
        await new Promise((r) => setTimeout(r, 150));
        await b.evaluate(`document.querySelector('.tw-trash-entry').click()`);
        await new Promise((r) => setTimeout(r, 100));
        await b.evaluate(`[...document.querySelectorAll('.tw-trash-actions button')].find((x) => /영구 삭제/.test(x.textContent)).click()`);
      }
      await new Promise((r) => setTimeout(r, 300));
      await b.evaluate(`window.__sel = ${JSON.stringify(sel)}`);
      const m = await b.evaluate(MEASURE);
      const f = find(m, { vw, kind, theme: 'dark', dim: THEMES.dark.dim, forced: true });
      assert.deepEqual(f, [], `forced colours change the geometry:\n${f.join('\n')}`);
      // System colours only: the dialog is Canvas with CanvasText, and it has an edge the dim cannot supply.
      const sys = await b.evaluate(`(() => { const probe = (c) => { const e = document.createElement('i'); e.style.color = c; document.body.append(e); const v = getComputedStyle(e).color; e.remove(); return v; }; return { canvas: probe('Canvas'), text: probe('CanvasText') }; })()`);
      assert.equal(m.bg, sys.canvas, `${kind}@${vw}: forced-colours dialog background is Canvas`);
      assert.equal(m.color, sys.text, `${kind}@${vw}: forced-colours dialog text is CanvasText`);
    }
  }

  // 3. Negative controls: the same sweep must go red for each injected regression.
  const quick = { widths: [1420, 600, 420, 391, 390, 320], themes: ['dark', 'light'] };
  const mutations = [
    ['a 3-class radius/padding override on the settings dialog', '.hps-preferences.hps-preferences.hps-preferences{border-radius:0;padding:0 !important}'],
    ['a 3-class width/radius/padding override on the outbound dialog', '.hps-outbound.hps-outbound.hps-outbound{width:600px;border-radius:2px;padding:4px}'],
    ['a 3-class width/radius override on the write dialog', '.hps-write-approval.hps-write-approval.hps-write-approval{width:700px;border-radius:0}'],
    ['an @media override that resizes cards on mid widths', '@media (min-width: 500px) and (max-width: 700px){.hp-modal.hp-modal{width:520px;padding:8px}}'],
    ['an @media override that drops the sheet breakpoint to 360px', '@media (min-width: 361px) and (max-width: 390px){.hp-modal.hp-modal{position:static;inset:auto;width:min(480px,calc(100vw - 24px));border-radius:12px}}'],
    ['a stronger ::backdrop rule', '.hps-outbound.hps-outbound::backdrop{background:rgb(0 0 0 / 80%)}'],
    ['the trash purge card losing its radius', '.tw-trash-backdrop .tw-trash-dialog.tw-trash-dialog{border-radius:6px}'],
  ];
  for (const [name, css] of mutations) {
    const r = await sweep(b, { ...quick, extraCss: css, chalk: /outbound/.test(name) });
    assert.ok(r.findings.length > 0, `negative control not caught: ${name}`);
    console.log(`  caught ${name}: ${r.findings.length} states, e.g. ${r.findings[0]}`);
  }
  // Positive control: an unrelated rule changes nothing.
  const clean = await sweep(b, { ...quick, extraCss: '.hps-composer-unrelated{padding:1px}', chalk: false });
  assert.deepEqual(clean.findings, [], 'positive control flagged');
  console.log(`modal-geometry: PASS ${real.states} computed states (3 dialogs x 2 seats + trash purge, x 2 themes, + Chalk x ${WIDTHS.length} widths), exit animation, reduced motion, forced colours, ${mutations.length} negative controls caught`);
} finally {
  await b.close();
}
