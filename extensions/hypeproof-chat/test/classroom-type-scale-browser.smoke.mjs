// CGP-DS-R-008 (REQ-CGP-DS-09, REQ-STUDIO-TYPE-SCALE) — the classroom seat, measured on the CASCADE in headless
// Chromium. DEC-29 put the 14px floor on the personal chat; Jay extended it to the classroom on 2026-11-03
// (decisions.md DEC-29b). The real ChatPanel is mounted in the classroom lesson seat (week-3 lesson, mission header,
// lesson cards, an answer with code, a learner turn, the error, page, AI and stop notices, the composer) with the
// shipped stylesheet, dark and light, at 360x1400, 1280x1400 and 360x640 (the compact-height mission layout). Every visible text node in the panel is read with
// getComputedStyle, never rule text:
//   - no visible learner text computes below 14px;
//   - the answer and learner message bodies and the composer compute to 16px (the body step);
// Exempt, as in DEC-29: visually hidden text (clipped 1px boxes), aria-hidden decoration without letters or digits
// (aria-hidden words that are visible, such as the runner bar, are measured), and glyph-only buttons
// with an accessible name. The instructor seat is not mounted (instructor-only text is exempt).
// Self-test: an injected later rule that puts a learner line back at 12px must be caught.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: classroom type scale browser unavailable'); process.exit(0); }

const root = fileURLToPath(new URL('..', import.meta.url));
const ANSWER = '좋아요. 먼저 화면을 나누어 볼게요.\n\n```html\n<main>반 소개</main>\n```\n\n이제 미리보기에서 확인해 보세요.';
const props = chatPanelProps({
  messages: [
    { id: 'u1', role: 'user', content: '반 소개 페이지를 만들고 싶어요.', createdAt: 1 },
    { id: 'a1', role: 'assistant', content: ANSWER, createdAt: 2 },
  ],
  canRetryLast: true,
  error: '연결이 잠시 끊겼어요. 다시 시도해 주세요.',
  errorRequestId: 'req-synthetic-1',
  pageNotice: '미리보기 화면이 바뀌었어요.',
  aiNotice: 'AI는 틀릴 수 있어요. 중요한 내용은 직접 확인해 주세요.',
  stopNotice: '답변을 멈췄어요.',
});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';const root=createRoot(document.getElementById('root'));window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config}/>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture-assets', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

// Every visible text node under the shell: its element's computed size, unless DEC-29 exempts it.
const MEASURE = `(()=>{
  const shell=document.querySelector('.hps-shell');
  const hidden=(e)=>{for(let x=e;x&&x!==document.body;x=x.parentElement){const s=getComputedStyle(x);
    if(s.display==='none'||s.visibility==='hidden')return true;
    if(x.getAttribute('aria-hidden')==='true'&&!/[가-힣A-Za-z0-9]/.test(e.textContent))return true;
    const r=x.getBoundingClientRect();if(s.position==='absolute'&&r.width<=1&&r.height<=1)return true;
    if(/rect\\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\\)|inset\\(50%\\)/.test(s.clip+' '+s.clipPath))return true;}return false;};
  const glyphButton=(e)=>{const b=e.closest('button');return !!b&&b.hasAttribute('aria-label')&&!/[가-힣A-Za-z0-9]/.test(b.textContent.trim());};
  const out=[],seen=new Set();let texts=0;
  const walk=document.createTreeWalker(shell,NodeFilter.SHOW_TEXT);
  for(let n=walk.nextNode();n;n=walk.nextNode()){
    if(!n.textContent.trim())continue;const e=n.parentElement;if(seen.has(e))continue;seen.add(e);
    if(hidden(e)||glyphButton(e))continue;texts++;
    const px=parseFloat(getComputedStyle(e).fontSize);
    if(px<14-1e-6)out.push((e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).join('.'):e.tagName.toLowerCase())+' "'+n.textContent.trim().slice(0,24)+'" '+px+'px');
  }
  const size=(s)=>{const e=shell.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null;};
  return {seat:shell.dataset.chatDetail||'classroom',mission:!!shell.querySelector('.hp-mission'),texts,small:out,
    answer:size('.hps-msg-assistant .hps-msg-body'),learner:size('.hps-msg-user .hps-msg-body'),composer:size('.hps-input textarea')};
})()`;

const browser = await launch(bin);
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const classroom = chatConfig();
let cases = 0;
const render = async ({ dark, width, height = 1400, inject = '' }) => {
  const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await browser.load(`<html style="${vars};--vscode-font-size:13px"><style>${css}</style><style>${inject}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${js}</script></body></html>`);
  await browser.evaluate(`mount(${JSON.stringify(classroom)})`); await delay();
  return browser.evaluate(MEASURE);
};
try {
  // 360x640 puts the mission header in its compact-height layout (styles.css @media max-height:700px and max-width:560px).
  for (const dark of [false, true]) for (const [width, height] of [[360, 1400], [1280, 1400], [360, 640]]) {
    const m = await render({ dark, width, height });
    const tag = `${dark ? 'dark' : 'light'} ${width}x${height}`;
    assert.equal(m.seat, 'classroom', `${tag}: the classroom seat is mounted`);
    assert.ok(m.mission, `${tag}: the lesson mission header renders`);
    assert.ok(m.texts >= 25, `${tag}: only ${m.texts} visible text elements were read; the fixture is not rendering`);
    assert.deepEqual(m.small, [], `${tag}: classroom learner text below 14px:\n  ${m.small.join('\n  ')}`);
    assert.equal(m.answer, 16, `${tag}: answer body ${m.answer}px, want 16px`);
    assert.equal(m.learner, 16, `${tag}: learner message body ${m.learner}px, want 16px`);
    assert.equal(m.composer, 16, `${tag}: composer ${m.composer}px, want 16px`);
    cases++;
  }
  // Self-test: a later rule that drops a learner line back to 12px is reported.
  const bad = await render({ dark: true, width: 360, inject: '.hps-shell .hp-mission-week, .hps-shell .hps-msg-role { font-size: 12px !important; }' });
  assert.ok(bad.small.some((s) => /12px$/.test(s)), `negative control not caught: ${JSON.stringify(bad.small)}`);
  console.log(`classroom-type-scale OK: ${cases} classroom states (light/dark x 360x1400 / 1280x1400 / 360x640), every visible learner text >=14px, bodies and composer 16px; negative control caught`);
} finally { await browser.close(); }
