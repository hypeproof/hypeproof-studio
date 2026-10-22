// CGP-SHELL-D-028 — the remaining-requests chip in the real chat header, measured in headless Chromium.
// The real webview entry (main.tsx: tokens.css, styles.css, chatDetails.css, App) receives a host config,
// on the personal surface (task heading) and the classroom surface (class-funded seat), dark and light,
// at 1420, 800 and 320 px, with a long model label:
//   G1  at 1420 and 800 the header keeps main's height (58px personal task heading, 57px classroom header since CGP-DS-R-010)
//       and equals the same header rendered without the chip
//   G2  "남은 요청 N회" has one line box; at 1420 and 800 the chip is no taller than 44px (its parts may take two
//       text lines inside it); at 320 it may grow, never cut
//   G3  at 320 the model label yields first (ellipsis) while "남은 요청 N회" stays whole, even for the largest safe
//       count; no page scroll
//   G4  the classroom coach name is never truncated by the line
//   G5  the chip's focus ring (its computed outline width and offset) is not clipped by the viewport or any clipping ancestor
//   G6  the whole balance text is visibly rendered and untruncated at every width: the count, the confirmation time,
//       the reservation/unconfirmed parts (AB-15) and the class source name are each present, no narrower than
//       their own text (scrollWidth <= clientWidth), not clipped by the chip, and never a sliver; only the model
//       label may give way (DES-SHELL-28, REQ-SHELL-29). Funding variants: personal account, shared class funding,
//       unknown balance, on both seats.
//   G7  classroom: the coach name and the model label do not touch
// HPS_SHOT_DIR=<dir> also saves one screenshot per run. HPS_WEBVIEW_SRC=<dir> measures another copy of
// webview-ui/src (used to show this guard fails on the pre-fix layout).
// Run: node e2e/access-chip-geometry.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(root, 'extensions/hypeproof-chat/webview-ui');
const src = process.env.HPS_WEBVIEW_SRC ? path.resolve(process.env.HPS_WEBVIEW_SRC) : path.join(webview, 'src');
const shots = process.env.HPS_SHOT_DIR;
if (shots) await mkdir(shots, { recursive: true });
// Header heights on main before D-028 (same fixture, headless Chromium): the chip must not change them.
const MAIN_HEIGHT = { personal: 58, classroom: 57 };

const temp = await mkdtemp(path.join(os.tmpdir(), 'hps-access-chip-geometry-'));
await build({
  entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') }, loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(await readFile(path.join(temp, u))); return; }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const THEMES = {
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const MODEL = 'Claude Sonnet 5 (긴 모델 이름 확인용 레이블)';
// Funding variants: the seat's own source (account on personal, shared class funding on classroom), the other
// source on the same seat, and an unknown balance (Service unreachable).
const EXPECT = {
  account: ['남은 요청 37회', '확인', '예약 3회', '미확인 2건'],
  class: ['수업·기관 지원', '함께 쓰는 남은 요청 37회', '확인'],
  unknown: ['남은 요청 미확인'],
};
function config(surface, withAccess, remaining = 37, funding = surface === 'classroom' ? 'class' : 'account') {
  const cls = funding === 'class';
  const resource = { meter: 'requests:count', remaining, held: 3, unresolved: 2, spent: 10, limit: 400, overrun: 0, shared: cls };
  const choice = { id: 'src-1', label: cls ? '3반 수업 지원' : '개인 이용권', source_kind: cls ? 'cohort' : 'account', mode: 'included', active: true, available: true, state: 'ready', ends_at: 1, can_request: false,
    allowed: { models: [], efforts: [], features: [], runtimes: [] }, resources: [resource] };
  return {
    proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
    ...(withAccess && funding === 'unknown' ? { access: { status: 'unavailable' } } : {}),
    ...(withAccess && funding !== 'unknown' ? { access: { status: 'ready', selected: 'src-1', view: { schema: 'hps-access-view/1', configured: true, as_of: '2026-10-20T06:42:00Z', choices: [choice] } } } : {}),
    profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface === 'classroom' ? 'classroom' : 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' },
      model_selection: { choices: [{ alias: 'sonnet', label: MODEL, id: 'm1' }] }, ux: UX },
    activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface === 'classroom' ? 'classroom' : 'personal', workspace: '/synthetic', verified: true, ...(surface === 'classroom' ? {} : { pass: { request_limit: 400, requests_used: 363 } }) },
    ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }),
  };
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  // The largest safe count (dark, 320 px) checks that even an extreme ledger value stays whole in the chip.
  // Each seat: its own funding in dark and light, the other funding and an unknown balance in dark, and the
  // largest safe count at 320 px.
  const own = surface => surface === 'classroom' ? 'class' : 'account';
  const RUNS = ['personal', 'classroom'].flatMap(surface => [
    ...Object.keys(THEMES).flatMap(theme => [1420, 800, 320].map(width => [surface, theme, width, 37, own(surface)])),
    ...[surface === 'classroom' ? 'account' : 'class', 'unknown'].flatMap(funding => [1420, 800, 320].map(width => [surface, 'dark', width, 37, funding])),
    [surface, 'dark', 320, Number.MAX_SAFE_INTEGER, own(surface)]]);
  for (const [surface, theme, width, remaining, funding] of RUNS) {
    const where = `${surface}/${funding}/${theme}/${width}${remaining === 37 ? '' : '/extreme'}`;
    const measure = async withAccess => {
      const ctx = await browser.newContext({ viewport: { width, height: 700 }, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ vars, theme }) => {
        window.sent = [];
        window.acquireVsCodeApi = () => ({ postMessage: m => window.sent.push(m), getState: () => undefined, setState: () => {} });
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.setAttribute('style', vars); document.body.setAttribute('style', vars + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-' + theme); });
      }, { vars: THEMES[theme], theme });
      await page.goto(base);
      await page.waitForFunction(() => window.sent.some(m => m.type === 'ready'), null, { timeout: 10000 }).catch(e => { throw new Error(`${where}: webview never said ready (${errors.join('; ') || e.message})`); });
      await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), { type: 'config', config: config(surface, withAccess, remaining, funding) });
      await page.locator('.hps-input textarea').waitFor();
      if (withAccess) await page.locator('.hps-access-header').first().waitFor();
      await page.waitForTimeout(50);
      const m = await page.evaluate(surface => {
        const heading = surface === 'personal' ? document.querySelector('.tw-heading') : document.querySelector('.hps-header');
        const box = e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; };
        const coach = surface === 'classroom' ? document.querySelector('.hps-header .hps-coach-name') : null;
        const out = { header: heading ? box(heading).h : null, hscroll: document.documentElement.scrollWidth > innerWidth, coachTruncated: coach ? coach.scrollWidth > coach.clientWidth + 0.5 : false };
        const chip = document.querySelector('.hps-access-chip');
        if (!chip) return out;
        // The count's whole unit: "남은 요청 N회" (a "함께 쓰는" prefix may sit before it on the line).
        const count = chip.querySelector('.hps-access-count') ?? [...chip.querySelectorAll('.hps-access-part')].find(e => e.textContent.includes('남은 요청'));
        const model = document.querySelector('.hps-access-model');
        const lines = el => { const range = document.createRange(); range.selectNodeContents(el); const rects = [...range.getClientRects()].filter(r => r.width > 0); return new Set(rects.map(r => Math.round(r.bottom))).size; };
        chip.focus({ focusVisible: true });
        const os = getComputedStyle(chip);
        const reach = (parseFloat(os.outlineWidth) || 0) + (parseFloat(os.outlineOffset) || 0);
        const ringStyle = { style: os.outlineStyle, width: parseFloat(os.outlineWidth) || 0, reach };
        const ring = (() => { const r = chip.getBoundingClientRect(); return { top: r.top - reach, bottom: r.bottom + reach, left: r.left - reach, right: r.right + reach }; })();
        const clipped = [];
        if (ring.top < 0 || ring.left < 0 || ring.right > innerWidth) clipped.push('viewport');
        for (let p = chip.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p); if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
          const b = box(p); if (ring.top < b.top - 0.5 || ring.bottom > b.bottom + 0.5 || ring.left < b.left - 0.5 || ring.right > b.right + 0.5) clipped.push(p.className || p.localName);
        }
        const text = chip.querySelector('.hps-access-chip-text') ?? chip;
        // G6: every balance part, measured where a sighted learner sees it.
        const em = parseFloat(getComputedStyle(chip).fontSize);
        const tb = box(text), cb = box(chip);
        // Each whole unit: a part, or for the count the "남은 요청 N회" unit (its prefix is plain wrapping text).
        const units = [...chip.querySelectorAll('.hps-access-part')].map(e => e.dataset.part === 'count' && e.querySelector('.hps-access-count') ? e.querySelector('.hps-access-count') : e);
        const parts = units.map(e => {
          const part = e.closest('.hps-access-part');
          const b = box(e), s = getComputedStyle(e);
          const ps = getComputedStyle(part);
          return { kind: part.dataset.part, text: part.textContent, w: Math.round(b.w), sw: e.scrollWidth, cw: e.clientWidth,
            hidden: [s, ps].some(x => x.display === 'none' || x.visibility === 'hidden' || x.opacity === '0'),
            inside: b.left >= tb.left - 0.5 && b.right <= tb.right + 0.5 && b.top >= tb.top - 0.5 && b.bottom <= tb.bottom + 0.5 && b.right <= cb.right + 0.5 && b.bottom <= cb.bottom + 0.5,
            sliver: b.w < em };
        });
        const textClipped = text.scrollWidth > text.clientWidth + 0.5 || text.scrollHeight > text.clientHeight + 0.5;
        // Only on the same row: at 320 the line has its own row under the coach name.
        const coachGap = coach && model && box(model).top < box(coach).bottom && box(coach).top < box(model).bottom ? Math.round(box(model).left - box(coach).right) : null;
        const countWhole = !!count && box(count).right <= box(text).right + 0.5 && box(count).left >= box(text).left - 0.5 && box(text).right <= box(chip).right + 0.5;
        return { ...out, countWhole, chip: box(chip), chipFont: getComputedStyle(chip).fontSize, countText: count?.textContent ?? null, countLines: count ? lines(count) : null,
          modelTruncated: model ? model.scrollWidth > model.clientWidth + 0.5 : null, modelW: model ? box(model).w : null, ringClipped: clipped, ringStyle, parts, textClipped, coachGap, chipText: text.textContent };
      }, surface);
      if (withAccess && shots) await page.screenshot({ path: path.join(shots, `${surface}-${funding}-${theme}-${width}${remaining === 37 ? "" : "-extreme"}.png`), clip: { x: 0, y: 0, width, height: 200 } });
      await ctx.close();
      return m;
    };
    const m = await measure(true);
    const plain = await measure(false);
    results.push({ where, surface, width, remaining, funding, ...m, plainHeader: plain.header });
    console.log(where, JSON.stringify({ header: m.header, plainHeader: plain.header, chipH: m.chip && Math.round(m.chip.h), chipW: m.chip && Math.round(m.chip.w), modelW: m.modelW && Math.round(m.modelW), coachGap: m.coachGap, ring: m.ringClipped, hscroll: m.hscroll,
      parts: m.parts?.map(p => `${p.text.trim()}=${p.w}${p.sw > p.cw + 0.5 ? 'T' : ''}${p.inside ? '' : 'C'}${p.hidden ? 'H' : ''}`).join(' | ') }));
  }
} finally { await browser.close(); server.close(); await rm(temp, { recursive: true, force: true }); }

const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); };
for (const r of results) {
  expect(r.chip, `${r.where}: the chip renders`);
  if (!r.chip) continue;
  if (r.width !== 320) {
    expect(Math.round(r.header) === MAIN_HEIGHT[r.surface], `${r.where}: header ${Math.round(r.header)}px, main is ${MAIN_HEIGHT[r.surface]}px`);
    expect(Math.round(r.header) === Math.round(r.plainHeader), `${r.where}: header ${Math.round(r.header)}px with the chip, ${Math.round(r.plainHeader)}px without it`);
  }
  // Only a count wider than the whole chip may wrap (inside the chip); an ordinary count stays on one line.
  // The ordinary count, time and AB-15 parts fit one line at 1420/800; at 320 the chip may take extra lines.
  if (r.remaining === 37) expect(r.countLines === 1, `${r.where}: "${r.countText}" sits on ${r.countLines} lines`);
  expect(r.countWhole === true, `${r.where}: "${r.countText}" is cut off inside the chip`);
  if (r.remaining === 37 && r.width !== 320) expect(r.chip.h <= 44.5, `${r.where}: chip ${Math.round(r.chip.h)}px tall (more than one line)`);
  if (r.width === 320 && r.remaining === 37) expect(r.modelTruncated === true, `${r.where}: the model label is not truncated at 320px (it must yield before the count)`);
  expect(r.ringStyle.style !== 'none' && r.ringStyle.width >= 2, `${r.where}: keyboard focus draws no ring (outline ${r.ringStyle.style} ${r.ringStyle.width}px)`);
  expect(r.ringClipped.length === 0, `${r.where}: focus ring clipped by ${r.ringClipped.join(', ')}`);
  expect(!r.hscroll, `${r.where}: page scrolls horizontally`);
  // G6: the full balance text, each part whole and visible. Only the model label may give way.
  const shown = (r.parts ?? []).filter(p => !p.hidden && p.w > 0).map(p => p.text);
  for (const want of r.remaining === 37 ? EXPECT[r.funding] : []) expect(shown.some(t => t.includes(want)), `${r.where}: "${want}" is not visible in the chip (shows "${shown.join(' ')}")`);
  if (r.funding !== 'unknown' && r.remaining === 37) expect(shown.some(t => /\d{1,2}:\d{2} 확인/.test(t)), `${r.where}: the confirmation time is not shown`);
  for (const p of r.parts ?? []) {
    expect(!p.hidden && p.sw <= p.cw + 0.5, `${r.where}: "${p.text.trim()}" is truncated (${p.cw} of ${p.sw}px)`);
    expect(p.inside, `${r.where}: "${p.text.trim()}" is clipped by the chip`);
    expect(!p.sliver, `${r.where}: "${p.text.trim()}" renders as a ${p.w}px sliver`);
  }
  expect(!r.textClipped, `${r.where}: the chip text overflows its box`);
  if (r.surface === 'classroom' && r.coachGap !== null) expect(r.coachGap >= 4, `${r.where}: coach name and model label are ${r.coachGap}px apart`);
  expect(!r.coachTruncated, `${r.where}: the coach name is truncated (the line must give way first)`);
}
if (failures.length) { console.error(failures.map(f => '  FAIL ' + f).join('\n')); console.error(`access-chip-geometry: ${failures.length} failed`); process.exit(1); }
console.log('PASS access chip geometry: main header height at 1420/800, chip no taller than 44px there, full balance text visible and untruncated at 1420/800/320, model yields first, focus ring unclipped (personal, classroom × account, class, unknown funding × dark, light)');
