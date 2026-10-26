// CGP-SHELL-R-028: the real App bundle in headless Chromium. The settings dialog lists
// "내 작업 내보내기" in the personal and the classroom seat (the classroom one opens from the access
// chip while access is unavailable, i.e. also after a pass has ended). Computed geometry: a 44px
// target, >=14px text, inside the dialog without horizontal overflow at 320/800/1420 in dark and light,
// a visible focus ring, and a real border in forced colours. Pressing it closes the dialog and posts
// exactly one { type: 'exportMyWork' } to the host.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN work export entry: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'work-export-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.WORK_EXPORT_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const host = `window.__posts=[];if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');}window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});`;
const page = (vars, dark) => `<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${host}</script><script>${script}</script></body></html>`;
const workspace = { scope: 'export-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '꽃집 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const configFor = (seat) => chatConfig(3, {
  activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null },
  taskWorkspace: seat === 'personal' ? workspace : undefined,
  access: seat === 'classroom' ? { status: 'unavailable' } : undefined,
});
const entry = `[...document.querySelectorAll('dialog.hps-preferences[open] button')].find(e=>e.textContent.trim()==='내 작업 내보내기')`;
async function openSettings(seat) {
  if (seat === 'personal') { await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu-toggle');t.focus();if(t.getAttribute('aria-expanded')!=='true')t.click();})()`); await settle(); }
  const settings = seat === 'personal' ? `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='설정')` : `document.querySelector('.hps-access-chip')`;
  assert.equal(await b.evaluate(`!!(${settings})`), true, `settings entry exists (${seat})`);
  await b.evaluate(`(()=>{const e=${settings};e.focus();e.click()})()`); await settle(160);
}
let states = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [320, 800, 1420]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(page(vars, dark), { width, height: 900, dark });
    await send({ type: 'config', config: configFor(seat) });
    await send({ type: 'history', messages: [] });
    const label = `${seat} ${dark ? 'dark' : 'light'} ${width}px`;
    await openSettings(seat);
    const g = await b.evaluate(`(()=>{const e=${entry};if(!e)return null;const d=e.closest('dialog');const r=e.getBoundingClientRect(),dr=d.getBoundingClientRect();const s=getComputedStyle(e);
      return {h:r.height,w:r.width,font:parseFloat(s.fontSize),inside:r.left>=dr.left-0.5&&r.right<=dr.right+0.5,overflow:d.scrollWidth<=d.clientWidth+1,clipped:e.scrollWidth>e.clientWidth+1,type:e.type}})()`);
    assert.ok(g, `settings dialog lists 내 작업 내보내기 (${label})`);
    assert.ok(g.h >= 44 && g.w >= 44, `44px target (${label}): ${JSON.stringify(g)}`);
    assert.ok(g.font >= 14, `>=14px text (${label}): ${g.font}`);
    assert.ok(g.inside && g.overflow && !g.clipped, `fits the dialog without overflow (${label}): ${JSON.stringify(g)}`);
    assert.equal(g.type, 'button');
    // Keyboard focus shows a ring.
    await b.evaluate(`(()=>{const all=[...document.querySelectorAll('dialog.hps-preferences[open] button, dialog.hps-preferences[open] summary, dialog.hps-preferences[open] input')];const e=${entry};const before=all[all.indexOf(e)-1];before.focus();})()`);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await settle();
    const ring = await b.evaluate(`(()=>{const e=${entry};const s=getComputedStyle(e);return {focused:document.activeElement===e,style:s.outlineStyle,width:parseFloat(s.outlineWidth),shadow:s.boxShadow}})()`);
    assert.equal(ring.focused, true, `Tab reaches the entry (${label})`);
    assert.ok((ring.style !== 'none' && ring.width >= 1) || (ring.shadow && ring.shadow !== 'none'), `visible focus ring (${label}): ${JSON.stringify(ring)}`);
    if (evidence) { await settle(400); const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${seat}-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }
    // Pressing it closes the dialog and posts one request.
    await b.evaluate(`window.__posts.length=0;(${entry}).click()`); await settle(300);
    assert.equal(await b.evaluate(`document.querySelectorAll('dialog.hps-preferences[open]').length`), 0, `dialog closes so the native picker is in front (${label})`);
    assert.equal(await b.evaluate(`window.__posts.filter(m=>m.type==='exportMyWork').length`), 1, `one exportMyWork post (${label})`);
    states++;
  }
  // Forced colours: the entry keeps a visible border.
  for (const seat of ['personal', 'classroom']) {
    await b.load(page('', true), { width: 800, height: 900, forcedColors: true });
    await send({ type: 'config', config: configFor(seat) }); await send({ type: 'history', messages: [] });
    await openSettings(seat);
    const fc = await b.evaluate(`(()=>{const s=getComputedStyle(${entry});return {style:s.borderTopStyle,width:parseFloat(s.borderTopWidth),h:(${entry}).getBoundingClientRect().height}})()`);
    assert.ok(fc.style !== 'none' && fc.width >= 1 && fc.h >= 44, `forced-colours border and size (${seat}): ${JSON.stringify(fc)}`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${seat}-800-forced-colors.png`, Buffer.from(shot.data, 'base64')); }
  }
  console.log(`PASS 내 작업 내보내기 entry in ${states} seat/theme/width states + forced colours`);
} finally { await b.close(); }
