// CGP-CHAT-D-025 (CGP-CHAT-D77, REQ-STUDIO-TASK-ARCHIVE): the task menu's 보관하기 in the real App bundle,
// measured in headless Chromium. test/task-archive-layout.smoke.mjs measures the 보관함 view and 다시 열기;
// this one measures the menu entry that leads there:
//   - personal task: 보관하기 is a menuitem, a 44px target, text >= 14px, inside the window
//   - it is drawn like the neutral, unfocused 설정 item (the menu focuses 활동 변경 on open), never in the error colour: nothing is deleted
//   - one press posts exactly one taskArchive; while an answer streams it is disabled
//   - classroom seats have no 보관하기
// Dark and light at 320, 800 and 1420 px, and forced colours.
//   node --experimental-strip-types test/task-archive-menu-browser.smoke.mjs
// No Chromium: prints NOT RUN, or fails when FOCUS_REQUIRE_BROWSER=1 (CI sets it).
// ARCHIVE_EVIDENCE=<dir> also saves one PNG of the open menu per case.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('task-archive-menu: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('task-archive-menu: NOT RUN (no headless Chromium; set HEADLESS_CHROMIUM)');
  process.exit(0);
}
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'archive-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const b = await launch(bin), evidence = process.env.ARCHIVE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const host = `window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});`;
const page = (vars, dark) => `<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${host}</script><script>${script}</script></body></html>`;
const item = (label) => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
const ARCHIVE = item('보관하기');
const openMenu = async () => { await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu-toggle');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();})()`); await settle(); };
const workspace = { scope: 'archive-menu', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '고양이 페이지', createdAt: 1, updatedAt: 1, messageCount: 2 }, { id: 'other', title: '다른 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const configFor = (seat) => chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? workspace : undefined });
const history = [{ id: 'u1', role: 'user', content: '고양이 소개 페이지를 만들고 싶어요', createdAt: 1 }, { id: 'a1', role: 'assistant', content: '좋아요.', createdAt: 2 }];
// Rest look of an item, and the theme's error colour resolved the same way, for the "no red" clause.
const look = (sel) => `(()=>{const e=${sel};const s=getComputedStyle(e);return [s.color,s.backgroundColor,s.borderTopColor,s.borderTopStyle].join(' / ')})()`;
const danger = `(()=>{const p=document.createElement('i');p.style.color='var(--vscode-errorForeground)';document.body.append(p);const c=getComputedStyle(p).color;p.remove();return c})()`;

async function measureMenu(name) {
  await openMenu();
  const g = await b.evaluate(`(()=>{const e=${ARCHIVE};if(!e)return null;const r=e.getBoundingClientRect();return {role:e.getAttribute('role'),w:r.width,h:r.height,font:parseFloat(getComputedStyle(e).fontSize),inView:r.left>=-0.5&&r.right<=innerWidth+0.5&&r.top>=-0.5&&r.bottom<=innerHeight+0.5,disabled:e.disabled}})()`);
  assert.ok(g, `${name}: the task menu offers 보관하기`);
  assert.equal(g.role, 'menuitem', `${name}: 보관하기 is a menu item`);
  assert.ok(g.w >= 44 && g.h >= 44, `${name}: 보관하기 target ${g.w}x${g.h}`);
  assert.ok(g.font >= 14, `${name}: 보관하기 text ${g.font}px`);
  assert.equal(g.inView, true, `${name}: 보관하기 inside the window`);
  assert.equal(g.disabled, false, `${name}: 보관하기 is enabled on an idle task`);
  return g;
}

let cases = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [320, 800, 1420]) {
    const name = `${seat}/${dark ? 'dark' : 'light'}/${width}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';')
      // The fixture leaves errorForeground out; VS Code's registry defaults stand in for the "no red" probe.
      + `;--vscode-errorForeground:${dark ? '#f85149' : '#e51400'}`;
    await b.load(page(vars, dark), { width, height: 900, dark });
    await send({ type: 'config', config: configFor(seat) });
    await send({ type: 'history', messages: history });
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', `${name}: requested seat branch is mounted`);
    if (seat === 'classroom') {
      await openMenu();
      assert.equal(await b.evaluate(`!!(${ARCHIVE})`), false, `${name}: classroom seats have no 보관하기`);
      cases++; continue;
    }
    await measureMenu(name);
    // No destructive styling: drawn exactly like the neutral 설정 item, and not in the error colour.
    const archiveLook = await b.evaluate(look(ARCHIVE)), neutralLook = await b.evaluate(look(item('설정'))), red = await b.evaluate(danger);
    assert.equal(archiveLook, neutralLook, `${name}: 보관하기 looks like the neutral 설정`);
    assert.ok(!archiveLook.includes(red), `${name}: no error colour on 보관하기 (${archiveLook} vs ${red})`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/menu-${dark ? 'dark' : 'light'}-${width}.png`, Buffer.from(shot.data, 'base64')); }
    // One press, one request; the host decides what opens next.
    await b.evaluate(`window.__posted.length=0`);
    await b.evaluate(`(${ARCHIVE}).click()`); await settle();
    const sent = await b.evaluate(`window.__posted.filter(m=>m.type==='taskArchive')`);
    assert.equal(sent.length, 1, `${name}: one press posts one taskArchive`);
    assert.equal(sent[0].taskId, 'task', `${name}: the request names the open task`);
    // A running task must be stopped first: disabled while an answer streams.
    await send({ type: 'streamStart', streamId: 's', messageId: 'live' });
    await send({ type: 'streamChunk', streamId: 's', delta: '작성 중' });
    await openMenu();
    assert.equal(await b.evaluate(`(${ARCHIVE}).disabled`), true, `${name}: 보관하기 is disabled while an answer streams`);
    cases++;
  }
  // Forced colours: still a 44px target, and the same system colours as its neutral neighbour.
  await b.load(page('', true), { width: 800, height: 900, forcedColors: true });
  await send({ type: 'config', config: configFor('personal') });
  await send({ type: 'history', messages: history });
  await measureMenu('forced/800');
  assert.equal(await b.evaluate(look(ARCHIVE)), await b.evaluate(look(item('설정'))), 'forced: 보관하기 looks like 설정');
  if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/menu-forced-800.png`, Buffer.from(shot.data, 'base64')); }
  cases++;
} finally { await b.close(); }
console.log(`task-archive-menu: ${cases} computed cases (menuitem, 44px, 14px, neutral colour, one taskArchive, streaming disabled, classroom absent, forced colours) PASS`);
