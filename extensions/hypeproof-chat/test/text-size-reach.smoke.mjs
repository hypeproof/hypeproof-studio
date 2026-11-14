// CGP-SHELL-R-017 (REQ-SHELL-17, DES-SHELL-16): the learner's text size reaches every surface the row names,
// measured on the CASCADE of the built webview in headless Chromium:
//   node --experimental-strip-types test/text-size-reach.smoke.mjs
//
// Surfaces: the start page, its 설정 sheet, the classroom chat, the personal chat, and the help sheet
// (키보드 단축키) in both chat seats; the classroom help request draws in the classroom seat. Each is
// rendered at base, 크게 and 아주 크게, dark and light, in a 320 and an 800 px pane and at 200% zoom
// (pane / zoom CSS pixels, deviceScaleFactor 2: a 640 px pane and the 320 px pane itself).
// Read, never rule text:
//   - every visible line of text computes to its base size plus the step (2px / 4px), so nothing on the
//     surface stays behind (chat message body and composer: 16 / 18 / 20px);
//   - at 320 and 800 CSS px: no horizontal page or shell scroll, every control is inside the viewport and
//     shows its whole label (no clipping except deliberate ellipsis), and no control gets shorter;
//   - at 160 CSS px (the 320 px pane at 200%): a larger size adds no problem the base size does not have.
// Self-test: negative controls are injected on top of the cascade; each must be caught.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES, KIND_CLASS } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('text-size-reach: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('text-size-reach NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const out = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'reach-assets', write: false, jsx: 'automatic',
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' });
const css = out.outputFiles.find((f) => f.path.endsWith('.css')).text, js = out.outputFiles.find((f) => f.path.endsWith('.js')).text;

const SIZES = { base: 0, large: 2, xlarge: 4 };
const BODY = { base: 16, large: 18, xlarge: 20 };
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const chatConfig = (seat, textSize) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: seat, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: seat === 'personal' ? { id: 'a-personal', name: '내 작업', kind: 'personal', workspace: '/synthetic', verified: true } : { id: 'a-class', name: '수업', kind: 'classroom', workspace: '/synthetic', verified: true },
  ...(seat === 'personal' ? { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } } : {}),
  textSize,
});
// Every row the sheet can draw today (START_SETTING_ROWS_AVAILABLE), so each grows and fits at 320px.
const startSettings = (textSize) => ({ rows: ['textSize', 'theme', 'reduceMotion', 'notices', 'export'], textSize, theme: 'dark', reduceMotion: 'auto', notices: false, advanced: true });
const HELP = { generation: 1, draft_key: null, availability: { state: 'unknown' }, seat: null, draft: { question: '', turnId: null, duration: 30, updated_at: 0 },
  turns: [], envelope: null, current: [], history: [], refresh: { state: 'never', at: null }, note: null };
const MESSAGE = '글자 크기를 바꾸어도 긴 한국어 문장을 편안하게 읽고 다음 질문을 보낼 수 있어요.';
// REACH_ONLY=<surface>[,…] narrows a local rerun; CI runs every surface.
const SURFACES = ['start', 'start-settings', 'classroom', 'classroom-shortcuts', 'personal', 'personal-shortcuts'].filter((x) => !process.env.REACH_ONLY || process.env.REACH_ONLY.split(',').includes(x));

// Panes: [pane px, zoom]. CSS width = pane / zoom.
const PANES = [[320, 1], [800, 1], [640, 2], [320, 2]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-page read: every visible text line (keyed by its element path), the controls, overflow.
const MEASURE = `(()=>{
  const path=e=>{const p=[];for(let n=e;n&&n!==document.body;n=n.parentElement){const i=n.parentElement?[...n.parentElement.children].indexOf(n):0;p.push(n.tagName+':'+i);}return p.reverse().join('/');};
  const shown=e=>{const r=e.getBoundingClientRect();if(r.width<=1||r.height<=1)return false;
    // Moved off screen until focused (the skip link): not read on screen.
    if(r.bottom<=0||r.right<=0||r.top>=innerHeight*4)return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&parseFloat(s.opacity)>0;};
  // Chat seats: the chat shell (its sheets included). The task rail and heading of the personal workspace sit outside it
  // and keep their sizes by design (CGP-DS-R-009). The start page: the whole page.
  const scope=document.querySelector('.hps-shell')||document.body;
  const text={};const w=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);let n;
  while((n=w.nextNode())){const t=n.textContent.trim();if(!t)continue;const e=n.parentElement;if(!e||e.closest('script,style,svg')||!shown(e))continue;
    // Visually hidden text (1px clip) is announced, not read on screen.
    if(e.closest('.sr-only,.hps-sr-only,.visually-hidden'))continue;
    // A glyph with no letter or digit (the sheet's ×, a bullet) is decorative or a glyph-only button with an accessible name (DEC-29 exemption).
    if(!/[\\p{L}\\p{N}]/u.test(t))continue;
    text[path(e)]={px:parseFloat(getComputedStyle(e).fontSize),t:t.slice(0,40),cls:e.className&&String(e.className).slice(0,60)};}
  const controls=[];
  for(const e of document.querySelectorAll('button,select,input:not([type=hidden]),textarea,a[href],[role=button]')){if(!shown(e))continue;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
    const ellipsis=[e,...e.querySelectorAll('*')].some(x=>getComputedStyle(x).textOverflow==='ellipsis');
    const scrolls=e.tagName==='TEXTAREA'||e.tagName==='INPUT'||e.tagName==='SELECT';
    controls.push({k:path(e),label:(e.getAttribute('aria-label')||e.textContent||e.value||'').trim().slice(0,30),left:r.left,right:r.right,height:r.height,
      clipped:!scrolls&&!ellipsis&&(e.scrollWidth>e.clientWidth+1||(s.overflowY!=='visible'&&e.scrollHeight>e.clientHeight+1))});}
  const shell=document.querySelector('.hps-shell');
  // The widest elements past the right edge name what makes the page scroll.
  const wide=[...document.body.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+0.5).map(e=>({e,r:e.getBoundingClientRect().right})).filter(({e})=>![...e.children].some(c=>c.getBoundingClientRect().right>innerWidth+0.5)).slice(0,3).map(({e,r})=>(e.className&&String(e.className).slice(0,40)||e.tagName)+'@'+Math.round(r)).join(', ');
  return {text,controls,wide,width:innerWidth,page:document.documentElement.scrollWidth>innerWidth+0.5,
    shell:!!shell&&shell.scrollWidth>shell.clientWidth+0.5,shellSize:shell?.dataset.textSize||null,startSize:document.querySelector('.studio-start')?.dataset.textSize||null,
    body:(e=>e&&getComputedStyle(e).fontSize)(document.querySelector('.hps-msg-body')),composer:(e=>e&&getComputedStyle(e).fontSize)(document.querySelector('.hps-input textarea')),
    sheet:!!document.querySelector('.studio-settings'),shortcuts:!!document.querySelector('.hps-shortcut-list'),help:!!document.querySelector('details.hp-help[open]')};})()`;

const b = await launch(bin);
const ev = (expr) => b.evaluate(expr);
const waitFor = async (expr, what) => { for (let i = 0; i < 150; i++) { if (await ev(expr).catch(() => false)) return; await sleep(20); } throw new Error('timed out waiting for ' + what); };

async function render({ surface, theme, pane, zoom, size, inject }) {
  const t = THEMES[theme];
  const vars = Object.entries(t).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';')
    + ';--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif';
  const start = surface.startsWith('start');
  const html = `<!doctype html><html lang="ko"${start ? ' data-surface="start"' : ''} style='${vars}'><head><meta charset="utf-8"><style>${css}</style></head><body class="${KIND_CLASS[t.kind]}"><div id="root"></div><script>window.sent=[];window.acquireVsCodeApi=()=>({postMessage(m){window.sent.push(m)},getState(){},setState(){}});</script><script>${js}</script></body></html>`;
  await b.load(html, { width: 1000, height: 800, dark: t.kind === 'dark', appReady: !start });
  // Zoom: VS Code zooms the whole window, so a pane of N device px is N / zoom CSS px.
  await b.send('Emulation.setDeviceMetricsOverride', { width: Math.round(pane / zoom), height: Math.round(800 / zoom), deviceScaleFactor: zoom, mobile: false });
  if (start) {
    await ev(`window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{checking:false,version:'1.0.0',settings:${JSON.stringify(startSettings(size))}}}}))`);
    await waitFor(`!!document.querySelector('.studio-choice')`, 'the start choices');
    if (surface === 'start-settings') {
      await ev(`[...document.querySelectorAll('.studio-nav button')].find(x=>x.textContent.trim()==='설정').click()`);
      await waitFor(`!!document.querySelector('.studio-settings')`, 'the settings sheet');
    }
  } else {
    const seat = surface.split('-')[0];
    await ev(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(chatConfig(seat, size))}}}))`);
    await sleep(80);
    await ev(`window.dispatchEvent(new MessageEvent('message',{data:{type:'history',messages:[{id:'answer',role:'assistant',content:${JSON.stringify(MESSAGE)},createdAt:1}]}}))`);
    await waitFor(`!!document.querySelector('.hps-msg-body')`, 'the answer');
    if (seat === 'classroom') {
      // The classroom help request (a help panel in the seat): drawn from the host's help view, opened so its notes are read too.
      await ev(`window.dispatchEvent(new MessageEvent('message',{data:{type:'helpState',help:${JSON.stringify(HELP)}}}))`);
      await waitFor(`!!document.querySelector('details.hp-help')`, 'the help request');
      await ev(`document.querySelector('details.hp-help').open=true`);
    }
    if (surface.endsWith('shortcuts')) {
      await ev(`document.activeElement?.blur?.();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'?',bubbles:true,cancelable:true}))`);
      await waitFor(`!!document.querySelector('.hps-shortcut-list')`, 'the shortcut sheet');
    }
  }
  if (inject) await ev(`document.head.appendChild(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(inject)}}))`);
  await sleep(60);
  return ev(MEASURE);
}

// Problems of one state against its base twin (same surface, theme, pane and zoom).
function problems(r, base, { surface, size, absolute }) {
  const outList = [];
  const step = SIZES[size];
  const want = size === 'base' ? null : size;
  if (surface.startsWith('start')) { if (r.startSize !== want) outList.push(`start root text size ${r.startSize}, want ${want}`); }
  else {
    if (r.shellSize !== want) outList.push(`shell text size ${r.shellSize}, want ${want}`);
    if (r.body !== `${BODY[size]}px`) outList.push(`message body ${r.body}, want ${BODY[size]}px`);
    if (r.composer !== `${BODY[size]}px`) outList.push(`composer ${r.composer}, want ${BODY[size]}px`);
  }
  if (surface === 'start-settings' && !r.sheet) outList.push('settings sheet not open');
  if (surface.endsWith('shortcuts') && !r.shortcuts) outList.push('shortcut sheet not open');
  if (surface === 'classroom' && !r.help) outList.push('classroom help request not drawn');
  // Every line grows by the step.
  let lines = 0;
  for (const [k, v] of Object.entries(r.text)) {
    const b0 = base.text[k];
    if (!b0) continue;
    lines++;
    if (Math.abs(v.px - (b0.px + step)) > 0.05) outList.push(`"${v.t}" (${v.cls}) is ${v.px}px, want ${b0.px}+${step}px`);
  }
  if (lines < 3) outList.push(`only ${lines} text lines matched the base render`);
  const issues = (x) => {
    const list = [];
    if (x.page) list.push(`page scrolls horizontally [${x.wide}]`);
    if (x.shell) list.push('shell scrolls horizontally');
    for (const c of x.controls) {
      if (c.left < -0.5 || c.right > x.width + 0.5) list.push(`control "${c.label}" outside the viewport (${Math.round(c.left)}..${Math.round(c.right)} of ${x.width})`);
      if (c.clipped) list.push(`control "${c.label}" clips its label`);
    }
    return list;
  };
  const mine = issues(r);
  if (absolute) outList.push(...mine);
  else { const had = new Set(issues(base)); outList.push(...mine.filter((p) => !had.has(p)).map((p) => `${p} (not at the base size)`)); }
  const baseHeights = Object.fromEntries(base.controls.map((c) => [c.k, c.height]));
  for (const c of r.controls) if (baseHeights[c.k] !== undefined && c.height < baseHeights[c.k] - 0.5) outList.push(`control "${c.label}" shrank from ${baseHeights[c.k]} to ${c.height}px`);
  return outList;
}

let checked = 0;
// Every state's problems are collected first, so one run lists them all.
const failures = [];
try {
  for (const surface of SURFACES) for (const theme of ['Dark+', 'Light+']) for (const [pane, zoom] of PANES) {
    const absolute = pane / zoom >= 320;
    const base = await render({ surface, theme, pane, zoom, size: 'base' });
    const label0 = `${surface} ${theme} ${pane}px@${zoom * 100}%`;
    if (absolute) { const p = problems(base, base, { surface, size: 'base', absolute }); if (p.length) failures.push(`${label0} base: ${p.join('; ')}`); }
    for (const size of ['large', 'xlarge']) {
      const r = await render({ surface, theme, pane, zoom, size });
      const found = problems(r, base, { surface, size, absolute });
      if (found.length) failures.push(`${label0} ${size}: ${found.join('; ')}`);
      checked++;
    }
  }

  assert.deepEqual(failures, [], `text-size-reach:\n${failures.join('\n')}`);
  // Self-test at the tightest absolute state (320px, 아주 크게, light). Each override must be reported.
  const MUTATIONS = [
    ['start', 'the start page ignores the step', '.studio-start{--hp-font-step:0px !important}', /want .*\+4px/],
    ['start', 'one start line keeps its base size', '.studio-start .studio-nav button{font-size:12px !important}', /is 12px, want/],
    ['start', 'the start page is wider than the pane', '.studio-start{min-width:520px}', /page scrolls horizontally|outside the viewport/],
    ['start-settings', 'a settings button clips its label', '.studio-settings-advanced{width:40px !important;min-width:0 !important;overflow:hidden;white-space:nowrap}', /clips its label/],
    ['classroom', 'the classroom shell ignores the step', '.hps-shell{--hp-font-step:0px !important}', /message body 16px/],
    ['classroom-shortcuts', 'the help sheet keeps its base size', '.hps-shortcut-list td{font-size:14px !important}', /is 14px, want/],
    ['personal', 'a control target shrinks', '.hps-btn-send{height:20px !important;min-height:0 !important}', /shrank/],
  ];
  for (const [surface, label, inject, want] of MUTATIONS) {
    const base = await render({ surface, theme: 'Light+', pane: 320, zoom: 1, size: 'base' });
    const r = await render({ surface, theme: 'Light+', pane: 320, zoom: 1, size: 'xlarge', inject });
    const found = problems(r, base, { surface, size: 'xlarge', absolute: true }).join('; ');
    assert.match(found, want, `mutation not caught: ${label} (got: ${found || 'clean'})`);
  }
  console.log(`text-size-reach OK: ${checked} states (${SURFACES.length} surfaces x dark/light x 320/800px, 640px@200%, 320px@200% x 크게/아주 크게) against their base twins; ${MUTATIONS.length} negative controls caught`);
} finally {
  await b.close();
}
