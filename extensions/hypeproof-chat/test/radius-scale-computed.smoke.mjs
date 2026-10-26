// CGP-DS-R-011 (REQ-CGP-DS-12, REQ-STUDIO-RADIUS-SCALE): radii come from one scale; nested radii are computed.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/radius-scale-computed.smoke.mjs
//
// Measured on the CASCADE in headless Chromium, never from rule text:
//  - the real App (main.tsx, driven by host messages like the extension does) in the personal and the classroom
//    seat, dark and light, 1420 and 800 px: the composer card and its Send button, the user bubble, the tools
//    menu and (personal) the chat menu with their items, the first-screen suggestion chips and citation chips;
//  - the real WriteApprovalDialog (dialog + file chip), OutboundDialog, StatusChip and the trash purge dialog
//    bundled with the webview stylesheets;
//  - Chalk's sharing dialog and manage menu, loaded with the token transport Chalk serves.
// Each radius is read at the global multiplier 1 and again at 1.5 (`--ds-p-radius-scale` on <html>): a radius
// that comes from the scale moves by exactly 1.5x, so a literal, a spacing token or any other token fails.
// A round control or pill must sit on the full step; the second pass also moves that step (999 -> 1000px).
// A nested radius (menu item, Send button inside the composer) must equal the outer radius minus the measured
// inset at both multipliers, so it has to be a calc() of the outer token, not a step that happens to match.
// Negative controls at the end inject a later literal override and a hard-coded nested step; both must be caught.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES as VSCODE_THEMES } from './lib/vscode-default-themes.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('radius-scale-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('radius-scale-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(extension, '../..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');
const nodePaths = [path.join(webview, 'node_modules')];
const alias = { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') };
const loader = { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' };

// ---------- fixture A: the real App ----------
const temp = mkdtempSync(path.join(tmpdir(), 'hps-radius-scale-'));
await build({ entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error', nodePaths, alias, loader });
// ---------- fixture B: dialogs and chips with the webview stylesheets in main.tsx order ----------
const entry = `
import "./tokens.css";
import "./focusGeometry.css";
import { LocalReview } from "./LocalReview";
import { StartPage } from "./StartPage";
import { App } from "./App";
import "./styles.css";
import "./chatDetails.css";
import { createRoot } from "react-dom/client";
import { WriteApprovalDialog } from "./WriteApprovalDialog";
import { OutboundDialog } from "./OutboundDialog";
import { ActivityTrashPanel } from "./ActivityTrashPanel";
import { StatusChip } from "./StatusChip";
import { CitationRack } from "./CitationPreview";
import { ComposerTools } from "./ComposerTools";
window.__keep = [LocalReview, StartPage, App];
const which = window.__kind;
const outbound = { id: 'r1', public: true, notes: [], excluded: '포함하지 않는 것: 비밀번호', sections: [{ recipient: '갤러리 · site.invalid', items: [{ id: 'a', label: 'index.html', bytes: 1200 }] }] };
const write = { id: 'w', title: '파일을 바꿔도 될까요?', verb: '바꿈', files: ['a.html'], changes: [{ kind: 'unknown', reason: 'no-match' }] };
function Page() {
  if (which === 'write') return <WriteApprovalDialog prompt={write} onAnswer={() => {}} />;
  if (which === 'outbound') return <OutboundDialog prompt={outbound} onAnswer={() => {}} />;
  if (which === 'trash') return <ActivityTrashPanel files={null} scopeKey="s" />;
  // A classroom seat draws its tools menu only with an attachment or sketch item; the App fixture has neither.
  if (which === 'tools') return <div className="hps-input" style={{ marginTop: '400px' }}><ComposerTools mode="auto" onMode={() => {}} locked={false} onAttachFile={() => {}} webSearchItem={false} /></div>;
  // Chips and cards the real-App pass does not reach (verifier addition): plain markup on the shipped classes, so the cascade decides.
  if (which === 'chips') return <div dangerouslySetInnerHTML={{ __html: '<div class="hps-header"><div class="hps-access-header"><button type="button" class="hps-access-chip">이용권</button></div></div>'
    + '<span class="tw-provenance-chip"><strong>내가 만듦</strong></span>'
    + '<div class="hps-task-activity"><div class="hps-task-activity-chips"><button type="button" class="hps-task-activity-chip" data-verb="x">고침</button></div></div>'
    + '<section class="hps-goal-status"><div><button type="button">목표</button></div></section>'
    + '<span class="hps-style-tweak-chip"></span>'
    + '<dialog class="hps-preferences" open>설정</dialog>' }} />;
  // The personal seat's CitationRack chip under both seat shells (the classroom answer's own pill is measured in the App fixture).
  return <><StatusChip state="verified" /><CitationRack citations={[{ kind: 'web', url: 'https://example.org/a', title: '예시 자료', domain: 'example.org', tier: 1 }]} /></>;
}
createRoot(document.getElementById('r')).render(<Page />);
`;
const built = await build({ stdin: { contents: entry, resolveDir: src, sourcefile: 'radius-scale-entry.tsx', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', jsx: 'automatic', logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, nodePaths, alias, loader });
const fixtureJs = built.outputFiles.find((o) => o.path.endsWith('.js')).text.replace(/<\/script/g, '<\\/script');
const fixtureCss = built.outputFiles.find((o) => o.path.endsWith('.css')).text;
// ---------- fixture C: Chalk pages with the transport they are served with ----------
const transport = readFileSync(path.join(repo, 'chalk/src/lib/design-tokens.ts'), 'utf8');
const chalkTokens = JSON.parse(transport.split('\n').find((l) => l.startsWith('export const DESIGN_TOKENS = ')).slice('export const DESIGN_TOKENS = '.length, -1));
const chalkPage = (file, extraCss) => readFileSync(path.join(repo, 'chalk/src/ui', file), 'utf8')
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<head\b[^>]*>/i, (h) => `${h}<style data-design-tokens>${chalkTokens}</style>`)
  .replace('</head>', `<style>${extraCss}</style></head>`);

let extraCss = '';
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"><style>${extraCss}</style></head><body><div id="root"></div><script src="/ui.js"></script></body></html>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEMES = Object.fromEntries([['dark', 'Dark+'], ['light', 'Light+']].map(([key, name]) => [key,
  '--vscode-font-size:13px;--vscode-font-family:sans-serif;' + Object.entries(VSCODE_THEMES[name]).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => '--vscode-' + k.replaceAll('.', '-') + ':' + v).join(';')]));
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [{ text: '페이지 만들기', style: 'good' }, { text: '색 바꾸기', style: 'good' }], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (seat) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: seat, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + seat, name: seat === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: seat, workspace: '/synthetic', verified: true },
  // A move rule gives the task row its menu (TaskMenu), which is measured too.
  ...(seat === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null }, taskMove: { allowed: true, destinations: [{ ref: 'ref-b', name: '그림 연습' }] } }),
});
const HISTORY = [
  { id: 'u', role: 'user', content: '반 소개 페이지를 만들어 주세요.', createdAt: 1 },
  { id: 'a', role: 'assistant', content: '자료를 찾아 정리했어요.', createdAt: 2, citations: [{ kind: 'web', url: 'https://example.org/a', title: '예시 자료', domain: 'example.org', tier: 1 }] },
  // Enough prompts for the "내 질문" header list to draw.
  ...[3, 5, 7].flatMap((n) => [{ id: 'u' + n, role: 'user', content: `${n}번째 질문이에요.`, createdAt: n }, { id: 'a' + n, role: 'assistant', content: '답했어요.', createdAt: n + 1 }]),
];

// What each surface must draw at multiplier 1 (top-left, top-right, bottom-right, bottom-left), or a nested rule.
//   step  : every corner comes from the scale and moves with the multiplier
//   nested: { outer, inset } the corner equals the outer element's radius minus that element's padding
const corners = (el) => `(e=>{if(!e)return null;const s=getComputedStyle(e);return ['top-left','top-right','bottom-right','bottom-left'].map(k=>parseFloat(s.getPropertyValue('border-'+k+'-radius')))})(${el})`;
const pad = (el) => `(e=>e?parseFloat(getComputedStyle(e).paddingTop):null)(${el})`;
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;

const findings = [];
let checked = 0;
// A control the fixture needs that is missing is a finding, not a crash.
const click = async (b, label, sel) => { if (!await b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`)) findings.push(`${label}: ${sel} not rendered`); };
const near = (a, b) => Math.abs(a - b) < 0.51;
async function readAt(b, probes) {
  const out = {};
  for (const scale of [1, 1.5]) {
    // The second pass also moves the full step, so a circle drawn from a literal or another 999px token is caught.
    await b.evaluate(`document.documentElement.style.setProperty('--ds-p-radius-scale','${scale}');document.documentElement.style.setProperty('--ds-p-radius-full','${scale === 1 ? 999 : 1000}px')`);
    await new Promise((r) => setTimeout(r, 30));
    out[scale] = await b.evaluate(`({${probes.map((p) => `${JSON.stringify(p.name)}:{c:${corners(q(p.sel))},o:${p.outer ? corners(q(p.outer)) : 'null'},i:${p.outer ? pad(q(p.outer)) : 'null'}}`).join(',')}})`);
  }
  await b.evaluate(`document.documentElement.style.removeProperty('--ds-p-radius-scale');document.documentElement.style.removeProperty('--ds-p-radius-full')`);
  return out;
}
function judge(label, probes, m) {
  for (const p of probes) {
    const one = m[1][p.name], big = m[1.5][p.name];
    if (!one || !one.c) { findings.push(`${label}: ${p.name} (${p.sel}) not rendered`); continue; }
    checked++;
    if (p.full) {
      // A circle or pill: the scale's full step (the multiplier leaves it alone; the second pass moves it to 1000px).
      for (const [scale, r, want] of [[1, one, 999], [1.5, big, 1000]]) if (r.c.some((c) => !near(c, want))) findings.push(`${label}: ${p.name} at x${scale} is ${r.c.join('/')}px, want the full step (${want}px)`);
    } else if (p.nested) {
      for (const [scale, r] of [[1, one], [1.5, big]]) {
        const want = r.o[0] - r.i;
        if (!(want > 0) || r.c.some((c) => !near(c, want))) findings.push(`${label}: ${p.name} at x${scale} is ${r.c.join('/')}px, want outer ${r.o[0]} - inset ${r.i} = ${want}px`);
      }
      if (p.want && one.c.some((c) => !near(c, p.want))) findings.push(`${label}: ${p.name} is ${one.c.join('/')}px, want ${p.want}px`);
    } else {
      if (one.c.some((c, i) => !near(c, p.want[i]))) findings.push(`${label}: ${p.name} is ${one.c.join('/')}px, want ${p.want.join('/')}px`);
      if (big.c.some((c, i) => !near(c, one.c[i] * 1.5))) findings.push(`${label}: ${p.name} does not follow the radius scale (x1 ${one.c.join('/')} -> x1.5 ${big.c.join('/')})`);
    }
  }
}
const all = (v) => [v, v, v, v];

async function run(b, { evidence } = {}) {
  findings.length = 0; checked = 0;
  for (const seat of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const width of [1420, 800]) {
    const label = `${seat}/${theme}@${width}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.sent.push(m),getState:()=>undefined,setState:()=>{}});` });
    try {
      await b.send('Page.navigate', { url: base });
      for (let i = 0; i < 100 && !await b.evaluate(`window.sent?.some(m=>m.type==='ready')`).catch(() => false); i++) await new Promise((r) => setTimeout(r, 50));
      await b.evaluate(`document.documentElement.style.cssText=${JSON.stringify(THEMES[theme])};document.body.classList.add(${JSON.stringify(theme === 'dark' ? 'vscode-dark' : 'vscode-light')});window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config(seat))}}}));`);
      await new Promise((r) => setTimeout(r, 150));
      // First screen: suggestion chips.
      judge(label, [{ name: 'suggestion chip', sel: '.hps-chip', want: all(8) }], await readAt(b, [{ name: 'suggestion chip', sel: '.hps-chip' }]));
      await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'history',messages:${JSON.stringify(HISTORY)}}}))`);
      await new Promise((r) => setTimeout(r, 150));
      const bubble = seat === 'personal' ? [18, 18, 6, 18] : [16, 16, 4, 16];
      const restProbes = [
        { name: 'composer', sel: '.hps-input', want: all(20) },
        seat === 'personal'
          ? { name: 'composer send (round)', sel: '.hps-input .hps-btn-send', full: true }
          : { name: 'composer send (nested)', sel: '.hps-input .hps-btn-send', outer: '.hps-input', nested: true, want: 8 },
        { name: 'user bubble', sel: '.hps-msg-user .hps-msg-body', want: bubble },
        ...(seat === 'personal'
          ? [{ name: 'citation chip', sel: '.cp-citation', want: all(8) }, { name: 'tools trigger (round)', sel: '.hps-tool-trigger', full: true }]
          : [{ name: 'classroom citation pill', sel: '.hps-cit-chip', full: true }, { name: 'composer field (nested)', sel: '.hps-input textarea', outer: '.hps-input', nested: true, want: 8 }]),
      ];
      judge(label, restProbes, await readAt(b, restProbes));
      if (evidence) { const png = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(evidence, `${seat}-${theme}-${width}-conversation.png`), Buffer.from(png.data, 'base64')); }
      if (seat === 'personal') {
      await click(b, label, '.hps-tool-trigger');
      await new Promise((r) => setTimeout(r, 60));
      const tools = [
        { name: 'tools menu', sel: '.hps-tools-menu', want: all(12) },
        { name: 'tools menu item (nested)', sel: '.hps-tools-menu > button', outer: '.hps-tools-menu', nested: true, want: 8 },
      ];
      judge(label, tools, await readAt(b, tools));
      if (evidence && width === 1420) { const png = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(evidence, `${seat}-${theme}-${width}-tools.png`), Buffer.from(png.data, 'base64')); }
      await click(b, label, '.hps-tool-trigger');
      }
      if (seat === 'personal') {
        await click(b, label, '.tw-chat-menu-toggle');
        await new Promise((r) => setTimeout(r, 60));
        const chat = [
          { name: 'chat menu', sel: '.tw-chat-menu-panel', want: all(12) },
          { name: 'chat menu item (nested)', sel: '.tw-chat-menu-panel > button', outer: '.tw-chat-menu-panel', nested: true, want: 8 },
        ];
        judge(label, chat, await readAt(b, chat));
        if (evidence) { const png = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(evidence, `${seat}-${theme}-${width}-chat-menu.png`), Buffer.from(png.data, 'base64')); }
        await click(b, label, '.tw-chat-menu-toggle');
        await click(b, label, '.tw-task-menu-toggle');
        await new Promise((r) => setTimeout(r, 60));
        const task = [
          { name: 'task menu', sel: '.tw-task-menu-panel', want: all(12) },
          { name: 'task menu item (nested)', sel: '.tw-task-menu-panel button[role="menuitem"]', outer: '.tw-task-menu-panel', nested: true, want: 6 },
        ];
        judge(label, task, await readAt(b, task));
        await click(b, label, '.tw-task-menu-toggle');
        await click(b, label, '.hps-myq-toggle');
        await new Promise((r) => setTimeout(r, 60));
        const myq = [
          { name: 'my questions popover', sel: '.hps-myq-panel', want: all(12) },
          { name: 'my questions item (nested)', sel: '.hps-myq-panel .hps-myq-item', outer: '.hps-myq-panel', nested: true, want: 6 },
        ];
        judge(label, myq, await readAt(b, myq));
      }
    } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  }
  // Dialogs and chips: the real components, both seats and themes.
  for (const seat of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const kind of ['write', 'outbound', 'trash', 'status', 'tools', 'chips']) {
    if (kind === 'trash' && seat === 'classroom') continue; // the 내 작품 panel exists only in the personal workspace
    const label = `${seat}/${theme}/${kind}`;
    await b.load(`<!doctype html><html style="${THEMES[theme]}"><head><meta charset="utf-8"><style>${fixtureCss}${extraCss}</style></head><body class="${theme === 'dark' ? 'vscode-dark' : 'vscode-light'}">${seat === 'personal' ? '<div class="hps-shell" data-chat-detail="personal"><div class="tw-workspace"><div id="r"></div></div></div>' : '<div class="hps-shell"><div id="r"></div></div>'}<script>window.__kind=${JSON.stringify(kind)}</script><script>${fixtureJs}</script></body></html>`, { width: 1420, height: 800, dark: theme === 'dark' });
    await new Promise((r) => setTimeout(r, 150));
    if (kind === 'trash') {
      await b.evaluate(`window.postMessage({ type: 'activityTrashState', view: { scope: 's', entries: [{ id: 'e1', path: 'index.html', at: 1760000000000 }], damaged: 0 } }, '*')`);
      await new Promise((r) => setTimeout(r, 150));
      await click(b, label, '.tw-trash-entry');
      await new Promise((r) => setTimeout(r, 100));
      await b.evaluate(`[...document.querySelectorAll('.tw-trash-actions button')].find((x) => /영구 삭제/.test(x.textContent)).click()`);
      await new Promise((r) => setTimeout(r, 200));
    }
    if (kind === 'tools') { await click(b, label, '.hps-tool-trigger'); await new Promise((r) => setTimeout(r, 60)); }
    const probes = {
      write: [{ name: 'write dialog', sel: '.hps-write-approval', want: all(12) }, { name: 'write file chip', sel: '.hps-write-chip', want: all(6) }],
      outbound: [{ name: 'outbound dialog', sel: '.hps-outbound', want: all(12) }],
      trash: [{ name: 'trash dialog', sel: '.tw-trash-dialog', want: all(12) }],
      status: [{ name: 'status chip', sel: '.hp-status-chip', want: all(4) }, { name: 'citation chip', sel: '.cp-citation', want: all(8) }],
      tools: [{ name: 'tools menu', sel: '.hps-tools-menu', want: all(12) }, { name: 'tools menu item (nested)', sel: '.hps-tools-menu > button', outer: '.hps-tools-menu', nested: true, want: 8 }],
      chips: [
        { name: 'access chip', sel: '.hps-access-chip', want: all(4) },
        { name: 'task activity chip', sel: '.hps-task-activity-chip', want: all(8) },
        { name: 'goal status chip', sel: '.hps-goal-status button', want: all(4) },
        { name: 'style swatch', sel: '.hps-style-tweak-chip', want: all(6) },
        { name: 'settings card', sel: '.hps-preferences', want: all(12) },
        ...(seat === 'personal' ? [{ name: 'provenance chip', sel: '.tw-provenance-chip', want: all(8) }] : []),
      ],
    }[kind];
    judge(label, probes, await readAt(b, probes));
    if (kind === 'write') {
      // At 390px and below the dialog is a bottom sheet: the top corners stay on the scale, the bottom ones are square.
      await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
      await new Promise((r) => setTimeout(r, 60));
      const sheet = [{ name: 'write dialog as a sheet', sel: '.hps-write-approval', want: [12, 12, 0, 0] }];
      judge(label + '@390', sheet, await readAt(b, sheet));
    }
  }
  // Chalk: the instructor surface draws its dialog and menu from the same scale.
  {
    await b.load(chalkPage('sharing.html', extraCss), { width: 1420, height: 800, dark: true });
    await b.evaluate(`document.getElementById('outbound').showModal()`);
    await new Promise((r) => setTimeout(r, 200));
    const dialog = [{ name: 'Chalk sharing dialog', sel: 'dialog#outbound', want: all(12) }];
    judge('chalk/sharing', dialog, await readAt(b, dialog));
    await b.load(chalkPage('manage.html', extraCss), { width: 1420, height: 800, dark: true });
    await b.evaluate(`for (const d of [document.getElementById('ops-bulk'), document.getElementById('ops-tools'), document.getElementById('ops-pick-by')]) { d.hidden = false; if (d.tagName === 'DETAILS') d.open = true; }`);
    await new Promise((r) => setTimeout(r, 60));
    const menu = [{ name: 'Chalk manage menu', sel: '#ops-pick-by .menu-body', want: all(8) }];
    judge('chalk/manage', menu, await readAt(b, menu));
  }
  return { findings: [...findings], checked };
}

const evidence = process.env.RADIUS_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
let b;
try {
  b = await launch(bin);
  const real = await run(b, { evidence });
  assert.deepEqual(real.findings, [], `radius scale findings:\n${real.findings.join('\n')}`);
  assert.ok(real.checked >= 80, `too few radii measured (${real.checked})`);
  // Negative controls: each must turn the same check red.
  const mutations = [
    ['a later literal radius on the composer', '.hps-shell .hps-input.hps-input{border-radius:20px}'],
    ['a hard-coded nested step on the menu items', '.hps-shell .hps-input .hps-tools-menu > button.x, .hps-shell .hps-tools-menu > button{border-radius:var(--hp-radius-8)!important}'],
    ['the bubble on a spacing token', '.hps-shell .hps-msg-user .hps-msg-body.hps-msg-body{border-radius:calc(var(--hp-space) * 4)}'],
    ['a Chalk dialog literal', 'dialog#outbound.hp-modal{border-radius:12px}'],
  ];
  for (const [name, css] of mutations) {
    extraCss = css;
    const r = await run(b);
    assert.ok(r.findings.length > 0, `negative control not caught: ${name}`);
  }
  extraCss = '';
  console.log(`radius-scale-computed: PASS ${real.checked} radii (App x 2 seats x 2 themes x 2 widths, dialogs/chips/menu x 2 seats x 2 themes, Chalk dialog + menu) at multipliers 1 and 1.5; ${mutations.length} negative controls caught`);
} finally {
  await b?.close();
  server.close();
  rmSync(temp, { recursive: true, force: true });
}
