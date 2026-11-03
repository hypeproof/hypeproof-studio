// CGP-LEARN-D-001 (DES-CGP-LEARN-01): the confirmed step's learning block as a collapsible 자료 card in the coach rail,
// measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/learning-block-card-computed.smoke.mjs
//
// The real webview entry (main.tsx: the real stylesheet order and the real ChatPanel markup) is bundled and gets a host
// config whose confirmed lesson attaches `criterion_form` to the first step. Personal and classroom seat, dark and light,
// rail widths 280 and 480 (the supported range) plus the 800 and 1420 panes. On the card:
//   closed: at most 72px tall; the thumbnail is 48x48; the title and 열어 보기 show; 열어 보기 is a 44px target; every
//           text at least 14px; the card's background is the Panel token and its text the Ink token of that theme
//   open:   the body shows inside the card, nothing in it is positioned out of flow, nothing is wider than the card or
//           the viewport, the page never scrolls sideways, the step report that follows sits below the card (pushed
//           down, not covered), and no element outside the card covers any point of it (elementFromPoint)
// Closed-card live line (R-003 kept): with the card closed, a host lessonWorkState save and a header step switch each change
// the words of the same mounted polite status line within 500 ms, and that line is drawn (non-zero box, not inside
// [hidden], not display:none) inside the closed card, which stays <= 72px.
// Self-test: injected later stylesheets (a positioned body, a shrunken thumbnail, a taller closed card, an @media rule
// shrinking the target, a background that is not the Panel token, a body wider than the rail) must each be caught.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
// LEARN_CARD_PNG_DIR=<dir> also saves one PNG per combination (closed and open) for a person to look at.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('learning-block-card-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('learning-block-card-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');
const pngDir = process.env.LEARN_CARD_PNG_DIR;
if (pngDir) mkdirSync(pngDir, { recursive: true });

const temp = mkdtempSync(path.join(tmpdir(), 'hps-block-card-'));
await build({
  entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEMES = {
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-quickInput-background:#222222;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-quickInput-background:#f3f3f3;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const step = (id, title, ui) => ({ id, title, instructions: `${title} 하기`, hint: '', acceptance: `${title} 확인`, ...(ui ? { ui } : {}) });
const LESSON = { course_id: 'c1', version: 'm2026.10.29-1', sha256: 'a'.repeat(64),
  content: { schema: 'hps-session-design/1', title: '자료 수업', audience: '초등', duration_minutes: 40, objective: '', prerequisites: '', starter: '', steps: [step('s1', '기준 정하기', 'criterion_form'), step('s2', '결정하기', 'decision_form')] } };
const config = (surface) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: LESSON, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
});

const measure = `(() => {
  const vw = document.documentElement.clientWidth;
  const card = document.querySelector('[data-block-card]');
  if (!card) return { missing: true };
  card.scrollIntoView({ block: 'center' });
  const shows = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return e.getClientRects().length > 0; };
  const r = card.getBoundingClientRect(), cs = getComputedStyle(card);
  const thumb = card.querySelector('.hp-block-card-thumb').getBoundingClientRect();
  const btn = card.querySelector('[data-block-toggle]'), bb = btn.getBoundingClientRect();
  const body = card.querySelector('.hp-block-card-body');
  const probe = (v, prop) => { const p = document.createElement('span'); p.style[prop] = 'var(' + v + ')'; card.parentElement.append(p); const c = getComputedStyle(p)[prop]; p.remove(); return c; };
  const out = { vw, docScroll: document.documentElement.scrollWidth, h: r.height, w: r.width, left: r.left, right: r.right, thumb: [thumb.width, thumb.height],
    btn: { text: btn.textContent, w: bb.width, h: bb.height }, title: card.querySelector('.hp-block-card-name')?.textContent ?? '', titleShown: shows(card.querySelector('.hp-block-card-name')),
    bg: cs.backgroundColor, color: cs.color, panel: probe('--hp-bg-panel-default', 'backgroundColor'), ink: probe('--hp-text-primary-default', 'color'),
    bodyShown: shows(body), texts: [], outOfFlow: [], wide: [], below: null, covered: [] };
  for (const e of card.querySelectorAll('*')) {
    if (!shows(e)) continue;
    const b = e.getBoundingClientRect(), s = getComputedStyle(e);
    if ([...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) out.texts.push({ name: e.localName + '.' + e.className + ':' + e.textContent.slice(0, 16), size: parseFloat(s.fontSize) });
    if (s.position === 'absolute' || s.position === 'fixed' || s.position === 'sticky') out.outOfFlow.push(e.localName + '.' + e.className + ' ' + s.position);
    if (b.right > Math.min(r.right, vw) + 0.5 || b.left < r.left - 0.5) out.wide.push(e.localName + '.' + e.className + ' ' + Math.round(b.left) + '..' + Math.round(b.right) + ' outside ' + Math.round(r.left) + '..' + Math.round(Math.min(r.right, vw)));
  }
  if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky') out.outOfFlow.push('card ' + cs.position);
  const next = document.querySelector('.hp-rail-step-report');
  if (next) out.below = next.getBoundingClientRect().top - r.bottom;
  // Nothing outside the card is drawn over it: sample a grid of points inside the card's visible part.
  const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
  for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
    const x = r.left + (r.width * i) / 6, y = top + ((bottom - top) * j) / 6;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== card && !card.contains(hit)) out.covered.push(Math.round(x) + ',' + Math.round(y) + ' ' + hit.localName + '.' + hit.className);
  }
  return out;
})()`;

// Performs one change while the card is closed and reports how the live line took it.
const LIVE = `window.liveChange=(act)=>{const live=document.querySelector('[data-block-card] .hp-material-state');window.__live=live;window.__lm=null;
  if(!live){window.__lm={missing:true};return}const before=live.textContent,t0=performance.now();
  const mo=new MutationObserver(()=>{if(live.textContent!==before&&!window.__lm){window.__lm={ms:performance.now()-t0}}});
  mo.observe(live,{subtree:true,childList:true,characterData:true});setTimeout(()=>{mo.disconnect();if(!window.__lm)window.__lm={ms:1e9}},1500);act()};
window.liveRead=()=>{const live=window.__live,card=live&&live.closest('[data-block-card]');if(!live)return {missing:true};
  const shown=(e)=>{for(let n=e;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return false}return e.getClientRects().length>0};
  card.scrollIntoView({block:'center'});const r=live.getBoundingClientRect(),c=card.getBoundingClientRect();
  return {...window.__lm,same:live.isConnected&&live===document.querySelector('[data-block-card] .hp-material-state'),text:live.textContent,
    shown:shown(live)&&r.width>=2&&r.height>=2&&r.top>=c.top-0.5&&r.bottom<=c.bottom+0.5,inHidden:!!live.closest('[hidden]'),
    polite:live.closest('[aria-live]')?.getAttribute('aria-live')==='polite',status:live.getAttribute('role'),
    closed:card.querySelector('[data-block-toggle]').getAttribute('aria-expanded')==='false',cardH:c.height,font:parseFloat(getComputedStyle(live).fontSize)}};`;
async function liveClosed(b, act) {
  await b.evaluate(`window.liveChange(()=>{${act}})`);
  for (let i = 0; i < 40 && !(await b.evaluate('!!window.__lm')); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 50));
  return b.evaluate('window.liveRead()');
}

async function runMatrix(b, extraCss, shots = false) {
  const results = [];
  for (const surface of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const width of [280, 480, 800, 1420]) {
    const where = `${surface}/${theme}/${width}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-color-scheme', value: theme }] });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.sent = [];
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
      document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEMES[theme])};
        document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-${theme}'); });` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(config(surface))} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('[data-block-card]')`)); i++) await new Promise((r) => setTimeout(r, 100));
      if (extraCss) await b.evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.append(s); })()`);
      await new Promise((r) => setTimeout(r, 50));
      const closed = await b.evaluate(measure);
      await b.evaluate(LIVE);
      const liveSave = closed.missing ? { missing: true } : await liveClosed(b, `window.dispatchEvent(new MessageEvent('message', { data: { type: 'lessonWorkState', sha256: ${JSON.stringify(LESSON.sha256)}, work: { s1: { kind: 'criterion', text: '예약 버튼이 첫 화면에 보인다', savedAt: 1 } } } }))`);
      if (shots && !closed.missing) await shot(b, `${surface}-${theme}-${width}-closed-saved`);
      if (shots && !closed.missing) await shot(b, `${surface}-${theme}-${width}-closed`);
      // The learner's own press (a DOM click on the real button; no OS input), then the open card.
      if (!closed.missing) await b.evaluate(`document.querySelector('[data-block-card] [data-block-toggle]').click()`);
      await new Promise((r) => setTimeout(r, 50));
      const open = closed.missing ? closed : await b.evaluate(measure);
      if (shots && !open.missing) await shot(b, `${surface}-${theme}-${width}-open`);
      const liveStep = open.missing ? { missing: true } : await liveClosed(b, `document.querySelector('button[data-step-id="s2"]').click()`);
      results.push({ where, closed, open, live: { 'host save': liveSave, 'step switch': liveStep } });
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
  return results;
}

async function shot(b, name) {
  if (!pngDir) return;
  const { data } = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(pngDir, `learning-block-card-${name}.png`), Buffer.from(data, 'base64'));
}

function check(results) {
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push(msg); };
  for (const r of results) {
    const { where, closed: c, open: o } = r;
    if (c.missing) { expect(false, `${where}: no 자료 card renders`); continue; }
    expect(c.h <= 72.5, `${where}: the closed card is ${Math.round(c.h)}px tall, over 72`);
    expect(Math.abs(c.thumb[0] - 48) < 0.5 && Math.abs(c.thumb[1] - 48) < 0.5, `${where}: thumbnail is ${c.thumb.map(Math.round).join('x')}, not 48x48`);
    expect(c.titleShown && c.title.length > 0, `${where}: the title does not show`);
    expect(c.btn.text === '열어 보기', `${where}: the closed card's button says "${c.btn.text}"`);
    expect(!c.bodyShown, `${where}: the card starts open`);
    expect(c.bg === c.panel, `${where}: card background ${c.bg} is not the Panel token ${c.panel}`);
    expect(c.color === c.ink, `${where}: card text ${c.color} is not the Ink token ${c.ink}`);
    for (const m of [c, o]) {
      const state = m === c ? 'closed' : 'open';
      expect(m.btn.w >= 43.5 && m.btn.h >= 43.5, `${where} ${state}: the toggle is ${Math.round(m.btn.w)}x${Math.round(m.btn.h)}px, under 44`);
      for (const t of m.texts) expect(t.size >= 14, `${where} ${state}: ${t.name} text is ${t.size}px, under 14`);
      expect(m.docScroll <= m.vw + 0.5, `${where} ${state}: the page scrolls sideways (${m.docScroll} > ${m.vw})`);
      expect(m.left >= -0.5 && m.right <= m.vw + 0.5, `${where} ${state}: the card ${Math.round(m.left)}..${Math.round(m.right)} leaves the ${m.vw}px rail`);
      for (const w of m.wide) expect(false, `${where} ${state}: ${w}`);
      for (const f of m.outOfFlow) expect(false, `${where} ${state}: ${f} is out of flow`);
      for (const v of m.covered) expect(false, `${where} ${state}: covered at ${v}`);
      expect(m.below !== null && m.below >= -0.5, `${where} ${state}: the step report is not below the card (gap ${m.below})`);
    }
    expect(o.bodyShown, `${where}: 열어 보기 did not open the card`);
    expect(o.btn.text === '닫기', `${where}: the open card's button says "${o.btn.text}"`);
    for (const [what, l] of Object.entries(r.live)) {
      if (l.missing) { expect(false, `${where} closed ${what}: no live state line`); continue; }
      expect(l.closed, `${where} closed ${what}: the card was not closed`);
      expect(l.ms <= 500, `${where} closed ${what}: the live line took ${Math.round(l.ms)} ms (limit 500)`);
      expect(l.same, `${where} closed ${what}: the live line was replaced instead of changing its words`);
      expect(l.shown && !l.inHidden, `${where} closed ${what}: the live line is not drawn in the closed card (inHidden ${l.inHidden})`);
      expect(l.polite && l.status === 'status', `${where} closed ${what}: the live line is not a polite status region`);
      expect(l.font >= 14, `${where} closed ${what}: the live line is ${l.font}px`);
      expect(l.cardH <= 72.5, `${where} closed ${what}: the closed card is ${Math.round(l.cardH)}px tall with the new sentence`);
    }
    expect(o.h > c.h + 40, `${where}: the open card (${Math.round(o.h)}px) did not grow in place from ${Math.round(c.h)}px`);
  }
  expect(results.length === 16, `ran ${results.length} of 16 combinations`);
  return failures;
}

const MUTANTS = {
  'a positioned body floats over what follows': '.hp-block-card-body { position: absolute !important; left: 0; right: 0; z-index: 5; }',
  'a smaller thumbnail': 'html body .hp-block-card-thumb { width: 32px !important; height: 32px !important; }',
  'a taller closed card': '.hp-block-card { padding-block: 20px !important; }',
  'an @media rule shrinks the target': '@media (max-width: 2000px) { .hp-block-card-head > button { min-height: 28px !important; min-width: 28px !important; height: 28px !important; padding: 0 !important; } }',
  'a background that is not the Panel token': '.hp-step-work .hp-block-card { background: rgb(1, 2, 3) !important; }',
  'a body wider than the rail': '.hp-block-card-body { width: 900px !important; }',
};

const b = await launch(bin);
let failures = [];
try {
  const results = await runMatrix(b, '', true);
  for (const r of results) console.log(r.where, r.closed.missing ? 'missing' : JSON.stringify({ closedH: Math.round(r.closed.h), openH: Math.round(r.open.h), thumb: r.closed.thumb, btn: [Math.round(r.closed.btn.w), Math.round(r.closed.btn.h)], minText: Math.min(...r.closed.texts.map((t) => t.size)), below: Math.round(r.open.below) }));
  failures = check(results);
  for (const [label, css] of Object.entries(MUTANTS)) {
    const caught = check(await runMatrix(b, css));
    if (caught.length === 0) failures.push(`self-test: "${label}" was not caught`);
    else console.log(`  self-test caught: ${label} (${caught.length}: ${caught[0]})`);
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
assert.ok(Array.isArray(failures));
if (failures.length) { console.error(failures.map((f) => '  FAIL ' + f).join('\n')); console.error(`learning-block-card-computed: ${failures.length} failed`); process.exit(1); }
console.log('PASS learning block card computed: closed <= 72px with a 48px thumbnail, title and a 44px 열어 보기; opens in place, in flow, never covered and never wider than the 280-480px rail; Panel/Ink tokens in dark and light; the polite state line of a closed card drawn and updated within 500 ms on a host save and a step switch; personal and classroom; six injected overrides caught');
