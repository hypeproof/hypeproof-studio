// CGP-LEARN-D-003 (DES-CGP-LEARN-03): the learning block's live text equivalent is a visible caption, measured on the
// CASCADE in headless Chromium.
//   node --experimental-strip-types test/learning-block-caption-computed.smoke.mjs
//
// The real webview entry (main.tsx: the real stylesheet order and the real ChatPanel markup) is bundled and gets a host
// config whose confirmed lesson attaches `criterion_form` to step 1 and `decision_form` to step 2. Personal and classroom
// seat, dark and light, at 100 % (800 and 1420 panes) and at 200 % zoom (device scale 2 with half the CSS width: the 480px
// rail, the 640px WCAG reflow width, and the 800 and 1420 panes). With the card open, on every change:
//   the caption (the block's polite status line) sits under the work surface (its top is at or below the body's bottom)
//   and inside the card; it is drawn (a hit test at its centre lands on it); 14px or more; 4.5:1 or more against the
//   background actually behind it; it shows the whole sentence (no ellipsis, nothing clipped: scrollWidth <= clientWidth,
//   every line box inside the viewport) and the page never scrolls sideways; its words change in the same mounted node
//   within 500 ms of the input event (typing, a host save, a cleared field).
// With the card closed (a step switch lands on a closed card) the caption is still drawn at 14px in the card.
// Self-test: injected later stylesheets (caption above the body, caption kept on one clipped line, a 12px caption, grey
// text under 4.5:1, a caption wider than the rail, a screen-reader-only caption) must each be caught.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
// LEARN_CAPTION_PNG_DIR=<dir> also saves one PNG per combination for a person to look at.
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { MATERIAL_TEXT } from '../src/lessonFocus.ts';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('learning-block-caption-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('learning-block-caption-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');
const pngDir = process.env.LEARN_CAPTION_PNG_DIR;
if (pngDir) mkdirSync(pngDir, { recursive: true });

const temp = mkdtempSync(path.join(tmpdir(), 'hps-block-caption-'));
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
const LESSON = { course_id: 'c1', version: 'm2026.10.29-1', sha256: 'c'.repeat(64),
  content: { schema: 'hps-session-design/1', title: '자료 수업', audience: '초등', duration_minutes: 40, objective: '', prerequisites: '', starter: '', steps: [step('s1', '기준 정하기', 'criterion_form'), step('s2', '결정하기', 'decision_form')] } };
const config = (surface) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: LESSON, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
});
// Pane widths in device pixels and the zoom: the CSS viewport is width / zoom, as Chromium's page zoom lays it out.
const VIEWS = [[800, 1], [1420, 1], [480, 2], [640, 2], [800, 2], [1420, 2]];

// Page helpers. `change` performs one change and records, from that moment, when the caption's words change.
const HELPERS = `
window.change=(act)=>{const live=document.querySelector('[data-block-card] .hp-material-state');window.__live=live;window.__m=null;
  if(!live){window.__m={missing:true};return}const before=live.textContent,t0=performance.now();
  const mo=new MutationObserver(()=>{if(live.textContent!==before&&!window.__m)window.__m={ms:performance.now()-t0}});
  mo.observe(live,{subtree:true,childList:true,characterData:true});setTimeout(()=>{mo.disconnect();if(!window.__m)window.__m={ms:1e9}},1500);act()};
window.typeInto=(sel,value)=>window.change(()=>{const el=document.querySelector(sel);const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))});
window.hostSaved=(work)=>window.change(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'lessonWorkState',sha256:${JSON.stringify(LESSON.sha256)},work}})));
window.pickStep=(id)=>window.change(()=>document.querySelector('button[data-step-id="'+id+'"]').click());
window.openCard=()=>{const b=document.querySelector('[data-block-card] [data-block-toggle][aria-expanded="false"]');if(b)b.click();return !!b};
window.caption=()=>{const live=document.querySelector('[data-block-card] .hp-material-state');if(!live)return {missing:true};
  const card=live.closest('[data-block-card]'),body=card.querySelector('.hp-block-card-body');card.scrollIntoView({block:'center'});
  const shows=(e)=>{for(let n=e;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return false}return e.getClientRects().length>0};
  const bgOf=(n)=>{for(;n;n=n.parentElement){const b=getComputedStyle(n).backgroundColor;if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent')return b}return getComputedStyle(document.body).backgroundColor};
  const r=live.getBoundingClientRect(),c=card.getBoundingClientRect(),s=getComputedStyle(live),vw=document.documentElement.clientWidth;
  live.scrollIntoView({block:'center'});
  const r2=live.getBoundingClientRect(),hit=document.elementFromPoint(r2.left+Math.min(8,r2.width/2),r2.top+r2.height/2);
  const range=document.createRange();range.selectNodeContents(live);const lines=[...range.getClientRects()];
  return {same:live===window.__live,text:live.textContent,key:live.dataset.materialState,role:live.getAttribute('role'),live:live.getAttribute('aria-live'),
    open:card.querySelector('[data-block-toggle]').getAttribute('aria-expanded')==='true',shown:shows(live)&&r.width>=2&&r.height>=2&&!live.closest('[hidden]'),
    hit:!!hit&&live.contains(hit),font:parseFloat(s.fontSize),color:s.color,bg:bgOf(live),
    clipped:live.scrollWidth>live.clientWidth+1,ellipsis:s.textOverflow==='ellipsis'&&s.whiteSpace==='nowrap',
    linesOut:lines.filter(l=>l.right>vw+0.5||l.left<-0.5).length,lineCount:new Set(lines.map(l=>Math.round(l.top))).size,
    top:r.top,bottom:r.bottom,left:r.left,right:r.right,card:{top:c.top,bottom:c.bottom,left:c.left,right:c.right,h:c.height},
    bodyBottom:body&&shows(body)?body.getBoundingClientRect().bottom:null,vw,docScroll:document.documentElement.scrollWidth}};`;

const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2] }; };
const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function changed(b, act) {
  await b.evaluate(act + ';0');
  for (let i = 0; i < 40 && !(await b.evaluate('!!window.__m')); i++) await wait(50);
  await wait(30);
  return { ...(await b.evaluate('window.__m')), ...(await b.evaluate('window.caption()')) };
}

async function runMatrix(b, extraCss, shots = false) {
  const results = [];
  for (const surface of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const [pane, zoom] of VIEWS) {
    const where = `${surface}/${theme}/${pane}@${zoom * 100}%`;
    await b.send('Emulation.setDeviceMetricsOverride', { width: Math.round(pane / zoom), height: Math.round(1000 / zoom), deviceScaleFactor: zoom, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-color-scheme', value: theme }] });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.sent = [];
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
      document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEMES[theme])};
        document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-${theme}'); });` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await wait(100);
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(config(surface))} } }))`);
      for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('[data-block-card] .hp-material-state')`)); i++) await wait(100);
      if (extraCss) await b.evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.append(s); })()`);
      await b.evaluate(HELPERS + ';0');
      const rows = [];
      if (!(await b.evaluate('openCard()'))) { results.push({ where, missing: true }); continue; }
      await wait(30);
      await b.evaluate('window.__live=document.querySelector("[data-block-card] .hp-material-state");0');
      rows.push({ what: 'criterion open', open: true, same: true, ms: 0, ...(await b.evaluate('window.caption()')) });
      rows.push({ what: 'criterion typed', open: true, ...(await changed(b, `typeInto('[data-surface="criterion_form"] textarea','예약 버튼이 첫 화면에 보인다')`)) });
      rows.push({ what: 'step to decision (closed)', closedCase: true, ...(await changed(b, `pickStep('s2')`)) });
      await b.evaluate('openCard()'); await wait(30);
      rows.push({ what: 'decision saved', open: true, ...(await changed(b, `hostSaved({s2:{kind:'decision',text:'토요일 진료시간을 고친다',reason:'원장님이 확인한 시간이라서',savedAt:1}})`)) });
      // The longest sentence in the catalog: the decision field cleared after a save.
      rows.push({ what: 'decision cleared', open: true, ...(await changed(b, `typeInto('[data-surface="decision_form"] input','')`)) });
      if (shots) await shot(b, `${surface}-${theme}-${pane}-${zoom * 100}`);
      results.push({ where, rows });
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
  return results;
}

async function shot(b, name) {
  if (!pngDir) return;
  // The caption scrolled to the middle of the view (an open card can be taller than the viewport at 200 %).
  await b.evaluate(`document.querySelector('[data-block-card] .hp-material-state').scrollIntoView({block:'center'});0`);
  const { data } = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(pngDir, `learning-block-caption-${name}.png`), Buffer.from(data, 'base64'));
}

const EXPECT = {
  'criterion open': ['empty', MATERIAL_TEXT.criterion_form.state({ text: '', reason: '' }).sentence],
  'criterion typed': ['written', MATERIAL_TEXT.criterion_form.state({ text: 'x', reason: '' }).sentence],
  'step to decision (closed)': ['empty', MATERIAL_TEXT.decision_form.state({ text: '', reason: '' }).sentence],
  'decision saved': ['saved', MATERIAL_TEXT.decision_form.state({ text: 'a', reason: 'b', saved: { text: 'a', reason: 'b' } }).sentence],
  'decision cleared': ['need-decision', MATERIAL_TEXT.decision_form.state({ text: '', reason: 'b', saved: { text: 'a', reason: 'b' } }).sentence],
};

function check(results) {
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push(msg); };
  for (const { where, missing, rows } of results) {
    if (missing) { expect(false, `${where}: no closed 자료 card with a caption`); continue; }
    for (const m of rows) {
      const at = `${where} ${m.what}`;
      if (m.missing) { expect(false, `${at}: no caption`); continue; }
      const [key, sentence] = EXPECT[m.what];
      expect(m.key === key && m.text === sentence, `${at}: caption says "${m.text}" (${m.key}), expected "${sentence}"`);
      expect(m.same, `${at}: the caption node was replaced instead of changing its words`);
      expect(m.ms <= 500, `${at}: the caption took ${Math.round(m.ms)} ms (limit 500)`);
      expect(m.role === 'status' && m.live === 'polite', `${at}: the caption is not a polite status region`);
      expect(m.shown && m.hit, `${at}: the caption is not drawn on screen (shown ${m.shown}, hit ${m.hit})`);
      expect(m.font >= 14, `${at}: the caption is ${m.font}px, under 14`);
      const ratio = contrast(parse(m.color), parse(m.bg));
      expect(ratio >= 4.5, `${at}: caption contrast ${ratio.toFixed(2)} under 4.5 (${m.color} on ${m.bg})`);
      expect(m.docScroll <= m.vw + 0.5, `${at}: the page scrolls sideways (${m.docScroll} > ${m.vw})`);
      expect(m.left >= m.card.left - 0.5 && m.right <= m.card.right + 0.5 && m.top >= m.card.top - 0.5 && m.bottom <= m.card.bottom + 0.5, `${at}: the caption leaves its card`);
      if (m.closedCase) { expect(!m.open, `${at}: the card was not closed`); expect(m.card.h <= 72.5, `${at}: the closed card is ${Math.round(m.card.h)}px tall`); continue; }
      expect(m.open, `${at}: the card was not open`);
      expect(m.bodyBottom !== null && m.top >= m.bodyBottom - 0.5, `${at}: the caption (top ${Math.round(m.top)}) is not under the work surface (bottom ${m.bodyBottom === null ? 'hidden' : Math.round(m.bodyBottom)})`);
      expect(!m.clipped && !m.ellipsis && m.linesOut === 0, `${at}: the caption is cut (clipped ${m.clipped}, ellipsis ${m.ellipsis}, ${m.linesOut} lines past the edge)`);
    }
  }
  expect(results.length === 2 * 2 * VIEWS.length, `ran ${results.length} of ${2 * 2 * VIEWS.length} combinations`);
  return failures;
}

const MUTANTS = {
  'caption above the work surface': '.hp-material.hp-block-card[data-block-open] { grid-template-areas: "thumb name toggle" "state state state" "body body body" !important; }',
  'caption kept on one clipped line': '.hp-block-card[data-block-open] .hp-block-card-state { white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }',
  'a 12px caption': 'html body .hp-block-card .hp-material-state { font-size: 12px !important; }',
  'grey caption under 4.5:1': 'html body .hp-block-card .hp-material-state { color: rgb(128, 128, 128) !important; }',
  'a caption wider than the rail': '.hp-block-card[data-block-open] .hp-block-card-state { width: 900px !important; white-space: nowrap !important; }',
  'a screen-reader-only caption': 'html body .hp-block-card .hp-material-state { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip-path: inset(50%) !important; }',
};

const b = await launch(bin);
let failures = [];
try {
  const results = await runMatrix(b, '', true);
  for (const r of results) console.log(r.where, r.missing ? 'missing' : JSON.stringify(r.rows.map((m) => [m.what, Math.round(m.font), m.lineCount, Math.round(m.ms)])));
  failures = check(results);
  for (const [label, css] of Object.entries(MUTANTS)) {
    const caught = check(await runMatrix(b, css));
    if (caught.length === 0) failures.push(`self-test: "${label}" was not caught`);
    else console.log(`  self-test caught: ${label} (${caught.length}: ${caught[0]})`);
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
if (failures.length) { console.error(failures.map((f) => '  FAIL ' + f).join('\n')); console.error(`learning-block-caption-computed: ${failures.length} failed`); process.exit(1); }
console.log('PASS learning block caption computed: the polite caption sits under the work surface, whole, at >= 14px and 4.5:1, updated in place within 500 ms, no sideways scroll at 100 % and 200 % zoom; drawn on a closed card; personal and classroom, dark and light; six injected overrides caught');
