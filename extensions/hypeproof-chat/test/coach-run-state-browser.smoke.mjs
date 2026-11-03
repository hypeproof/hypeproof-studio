// REQ-STUDIO-COACH-RUN-STATE (CGP-LEARN-R-016 / CGP-LEARN-D-016) — the coach run state on the mounted ChatPanel
// with the shipped stylesheet in headless Chromium. Personal seat (header drawn into the task workspace heading)
// and classroom lesson seat, dark and light, 320, 390, 800 and 1420 px, all seven states: exactly one state in the header,
// a 20px icon and its words at the 14px floor, fully visible (not clipped, not covered, inside the viewport), no
// animation or transition on it, no second visible run state (the personal heading's run note), a polite live region, and readable words under forced colours.
// CGP-LEARN-D-016: a state change is announced, so the live region is one node that stays mounted while its words
// change in place (a region that is replaced on each change is a new region and screen readers stay silent). Fails under
// FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise. COACH_RUN_STATE_EVIDENCE=<dir> saves PNGs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';import{TaskWorkspaceFrame}from'./src/TaskWorkspace';
const root=createRoot(document.getElementById('root'));
window.mount=(config,messages,view,extra)=>root.render(<TaskWorkspaceFrame view={view} messages={messages} busy={!!extra.streaming} error={null} onDismissError={()=>{}}><ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={messages} {...extra}/></TaskWorkspaceFrame>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture-assets', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: coach-run-state browser unavailable'); process.exit(0); }
const browser = await launch(bin), evidence = process.env.COACH_RUN_STATE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
// Wait on a condition in the page, never on a fixed delay.
const waitFor = async (expr, what, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) { if (await browser.evaluate(`!!(${expr})`)) return; if (Date.now() > end) throw Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 16)); }
};
// The first region of a page load is kept with an observer that counts in-place changes to its words.
const LIVE = `(()=>{const el=document.querySelector('.hps-run-state');if(!window.__liveNode){window.__liveNode=el;window.__liveChanges=0;new MutationObserver(()=>{window.__liveChanges++}).observe(el,{subtree:true,childList:true,characterData:true})}
  return {same:el===window.__liveNode&&el.isConnected,changes:window.__liveChanges,live:el.getAttribute('aria-live'),atomic:el.getAttribute('aria-atomic')}})()`;

const user = { id: 'u1', role: 'user', content: '홈페이지 제목을 바꿔 줘', createdAt: 1 };
const line = (icon, label) => ({ id: `t-${icon}`, role: 'tool', content: '', createdAt: 2, tool: { id: `t-${icon}`, icon, label, state: 'running' } });
const STATES = {
  ready: { label: '준비됨', messages: [user, { id: 'a1', role: 'assistant', content: '바꿨어요.', createdAt: 3 }], extra: { streaming: false, lastOutcome: 'done' } },
  thinking: { label: '생각 중', messages: [user], extra: { streaming: true, streamingId: null } },
  searching: { label: '찾는 중', messages: [user, line('📖', '파일 읽기 index.html')], extra: { streaming: true, streamingId: null } },
  creating: { label: '만드는 중', messages: [user, line('✍️', '파일 고치기 index.html')], extra: { streaming: true, streamingId: null } },
  approval: { label: '확인이 필요해요', messages: [user, line('✍️', '파일 고치기 index.html')], extra: { streaming: true, streamingId: null, progressApprovalPending: true } },
  paused: { label: '멈춤', messages: [user], extra: { streaming: false, lastOutcome: 'stopped', stopNotice: '멈췄어요.' } },
  error: { label: '문제가 생겼어요', messages: [user], extra: { streaming: false, lastOutcome: 'error', error: '연결이 끊겼어요' } },
};
const view = { scope: 's', revision: 1, activeTaskId: 't1', sourceSelection: null, tasks: [{ id: 't1', title: '내 작업', createdAt: 1, updatedAt: 1, messageCount: 2 }] };
const seats = {
  personal: { config: chatConfig(3, { profile: { ...chatConfig().profile, lesson: null }, activity: { id: 'a1', name: '내 작업', kind: 'personal', workspace: '/w', verified: true }, taskWorkspace: view }), view, header: '.tw-heading' },
  classroom: { config: chatConfig(), view: undefined, header: 'header.hps-header' },
};
const MEASURE = (header) => `(()=>{const all=[...document.querySelectorAll('.hps-run-state')];if(all.length!==1)return {count:all.length};const el=all[0],r=el.getBoundingClientRect(),s=getComputedStyle(el);
  const icon=el.querySelector('svg'),ir=icon.getBoundingClientRect(),lab=el.querySelector('.hps-run-state-label'),lr=lab.getBoundingClientRect(),ls=getComputedStyle(lab);
  const hd=el.closest(${JSON.stringify(header)});const hr=hd?hd.getBoundingClientRect():null;
  let clipped=false;for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const ps=getComputedStyle(p);if(ps.overflow!=='visible'||ps.overflowX!=='visible'){const pr=p.getBoundingClientRect();if(r.left<pr.left-0.5||r.right>pr.right+0.5||r.top<pr.top-0.5||r.bottom>pr.bottom+0.5)clipped=true}}
  const hit=document.elementFromPoint((lr.left+lr.right)/2,(lr.top+lr.bottom)/2);
  const moving=[el,...el.querySelectorAll('*')].some(n=>{const c=getComputedStyle(n);return c.animationName!=='none'||(parseFloat(c.transitionDuration)||0)>0});
  return {count:1,key:el.dataset.runState,text:el.textContent,inHeader:!!hd,live:el.getAttribute('aria-live'),role:el.getAttribute('role'),
    iconW:ir.width,iconH:ir.height,iconHidden:icon.getAttribute('aria-hidden'),font:parseFloat(ls.fontSize),
    labelW:lr.width,labelFull:lab.scrollWidth<=lab.clientWidth+0.5,inView:r.left>=0&&r.right<=innerWidth&&r.top>=0,inHeaderBox:!!hr&&r.left>=hr.left-0.5&&r.right<=hr.right+0.5,
    clipped,covered:!(hit&&el.contains(hit)),moving,controlRows:hd?(()=>{const cs=[...hd.querySelectorAll('button')].map(b=>b.getBoundingClientRect()).filter(q=>q.width>1&&q.height>1);const mid=cs.map(q=>(q.top+q.bottom)/2);return {spread:mid.length?Math.max(...mid)-Math.min(...mid):0,below:cs.filter(q=>q.top>=r.bottom-1).length}})():null,otherStates:[...document.querySelectorAll('.tw-heading .tw-run-note, .tw-heading .tw-run-chip, header.hps-header .hp-status-chip')].filter(n=>{const b=n.getBoundingClientRect();if(b.width<=1||b.height<=1)return false;const h=document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);return !!h&&n.contains(h)}).map(n=>n.textContent),pageScroll:document.documentElement.scrollWidth>innerWidth,color:ls.color}})()`;

let cases = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [false, true]) for (const width of [320, 390, 800, 1420]) {
    const tag = `${seat} ${dark ? 'dark' : 'light'} ${width}`;
    const { config, view: frame, header } = seats[seat];
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k2, v]) => typeof v === 'string' && !['kind', 'file'].includes(k2)).map(([k2, v]) => `--vscode-${k2.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`, { width, height: 900, dark });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    // setDocumentContent keeps the window's globals: forget the previous document's region.
    await browser.evaluate('window.__liveNode=null');
    let before = null;
    for (const [key, s] of Object.entries(STATES)) {
      await browser.evaluate(`mount(${JSON.stringify(config)},${JSON.stringify(s.messages)},${JSON.stringify(frame)},${JSON.stringify(s.extra)})`);
      await waitFor(`document.querySelector('.hps-run-state')?.dataset.runState===${JSON.stringify(key)}`, `${tag} ${key}`);
      const m = await browser.evaluate(MEASURE(header));
      const t = `${tag} ${key}`;
      const live = await browser.evaluate(LIVE);
      assert.ok(live.same, `${t}: the live region stays the same mounted node across state changes`);
      assert.equal(live.atomic, 'true', `${t}: the whole state is read on a change`);
      if (before !== null) assert.ok(live.changes > before, `${t}: the words changed in place inside the live region (${before} -> ${live.changes})`);
      before = live.changes;
      assert.equal(m.count, 1, `${t}: exactly one run state`);
      assert.equal(m.key, key, `${t}: derived state`);
      assert.equal(m.text, s.label, `${t}: the words`);
      assert.ok(m.inHeader && m.inHeaderBox, `${t}: inside the chat header ${JSON.stringify(m)}`);
      assert.equal(m.live, 'polite'); assert.equal(m.role, 'status');
      assert.ok(Math.abs(m.iconW - 20) <= 0.5 && Math.abs(m.iconH - 20) <= 0.5 && m.iconHidden === 'true', `${t}: one 20px decorative icon ${JSON.stringify(m)}`);
      assert.ok(m.font >= 14, `${t}: label at the 14px floor (${m.font})`);
      assert.ok(m.labelW > 0 && m.labelFull, `${t}: the label is drawn in full ${JSON.stringify(m)}`);
      assert.ok(m.inView && !m.clipped && !m.covered, `${t}: visible, not clipped or covered ${JSON.stringify(m)}`);
      assert.equal(m.moving, false, `${t}: no animation or transition`);
      assert.ok(m.controlRows && m.controlRows.spread <= 4 && m.controlRows.below === 0, `${t}: the header controls stay on one row above or beside the run state ${JSON.stringify(m.controlRows)}`);
      assert.deepEqual(m.otherStates, [], `${t}: no second run state is visible in the heading`);
      assert.equal(m.pageScroll, false, `${t}: no horizontal page scroll`);
      if (evidence && (width === 800 || key === 'approval' || key === 'searching')) {
        const shot = await browser.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: 140, scale: 1 } });
        writeFileSync(`${evidence}/${seat}-${dark ? 'dark' : 'light'}-${width}-${key}.png`, Buffer.from(shot.data, 'base64'));
      }
      cases++;
    }
    if (width === 800) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
      await waitFor(`matchMedia('(forced-colors: active)').matches`, `${tag} forced colours`);
      const fc = await browser.evaluate(MEASURE(header));
      const bg = await browser.evaluate(`(()=>{let n=document.querySelector('.hps-run-state');while(n){const b=getComputedStyle(n).backgroundColor;if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent')return b;n=n.parentElement}return getComputedStyle(document.body).backgroundColor})()`);
      assert.ok(fc.count === 1 && fc.text === STATES.error.label && fc.color !== bg && !fc.clipped, `${tag}: forced colours keep the words readable ${JSON.stringify({ fc, bg })}`);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    }
  }
  console.log(`PASS coach-run-state-browser: ${cases} seat/theme/width/state cases, one state in the header, 20px icon + words >= 14px, one live region changed in place, visible, static, forced colours`);
} finally { await browser.close(); }
