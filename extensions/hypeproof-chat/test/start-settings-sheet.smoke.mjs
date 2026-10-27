// CGP-SHELL-R-014 (REQ-SHELL-14): the start page "설정" opens the learner settings sheet (never the
// VS Code settings editor directly). Mounts the real webview bundle on the start surface in headless
// Chromium and measures it: at most six rows, the host-named rows only, "고급 설정" only when the host
// allows it, each choice posted to the host, 44px targets, >=14px text, Escape closes and focus
// returns to "설정", no horizontal scroll, in both themes at 320/800/1420 px and in forced colours.
// CGP-SHELL-D-013 (DES-SHELL-13): the sheet is a modal right-side sheet (right edge, full height,
// 320–400px wide); every row is 48px with its name and its one control on the same line, at 320px too.
// HPS_SHOTS=<dir> also saves PNGs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN start settings sheet: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'start-assets', write: false, loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find((f) => f.path.endsWith('.css')).text, js = app.outputFiles.find((f) => f.path.endsWith('.js')).text;
const shots = process.env.HPS_SHOTS; if (shots) fs.mkdirSync(shots, { recursive: true });
const adultView = { rows: ['textSize', 'reduceMotion', 'notices'], textSize: 'base', reduceMotion: 'auto', notices: false, advanced: true };
const until = async (b, expr, what) => { for (let n = 0; n < 100; n++) { const v = await b.evaluate(expr); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw Error('timed out: ' + what); };
const b = await launch(bin);
try {
  const cases = [];
  for (const dark of [true, false]) for (const width of [320, 800, 1420]) cases.push({ dark, width, forced: false });
  cases.push({ dark: true, width: 800, forced: true });
  for (const { dark, width, forced } of cases) for (const seat of ['adult', 'minor']) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<!doctype html><html data-surface="start" style="${vars}"><style>${css}</style><style>/* a classic 15px scrollbar, as on Linux CI: macOS overlay bars hid #3091 */html{overflow-y:scroll}::-webkit-scrollbar{width:15px}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.sent=[];window.acquireVsCodeApi=()=>({postMessage(m){window.sent.push(m)},getState(){},setState(){}});</script><script>${js}</script></body></html>`, { width, height: 900, dark, forcedColors: forced });
    const view = seat === 'adult' ? adultView : { ...adultView, advanced: false };
    await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{checking:false,version:'1.0.0',settings:${JSON.stringify(view)}}}}))`);
    const label = `${width}px ${dark ? 'dark' : 'light'}${forced ? ' forced' : ''} ${seat}`;
    await until(b, `[...document.querySelectorAll('.studio-nav button')].some(x=>x.textContent==='설정')`, 'nav');
    await b.evaluate(`[...document.querySelectorAll('.studio-nav button')].find(x=>x.textContent==='설정').click()`);
    await until(b, `document.querySelector('dialog.studio-settings')?.open`, 'sheet opens');
    await until(b, `document.getAnimations().every(a=>a.playState!=='running')`, 'open animation done');
    const m = await b.evaluate(`(()=>{const d=document.querySelector('dialog.studio-settings'),r=d.getBoundingClientRect();
      const geo=[...d.querySelectorAll('.studio-settings-row')].map(row=>{const q=row.getBoundingClientRect(),name=(row.firstElementChild||row).getBoundingClientRect(),ctl=(row.querySelector('select, input')||row).getBoundingClientRect();
        return {t:row.textContent.trim().slice(0,12),h:q.height,inRow:row.tagName==='BUTTON'||(name.top>=q.top-0.5&&name.bottom<=q.bottom+0.5&&ctl.top>=q.top-0.5&&ctl.bottom<=q.bottom+0.5),sameLine:row.tagName==='BUTTON'||(Math.abs((name.top+name.bottom)/2-(ctl.top+ctl.bottom)/2)<=2&&ctl.left>=name.right),inside:q.left>=r.left-0.5&&q.right<=r.right+0.5}});
      const targets=[...d.querySelectorAll('label, button, select')].filter(e=>!e.closest('legend')).map(e=>{const q=e.getBoundingClientRect();return {t:e.textContent.trim().slice(0,20),h:q.height,w:q.width,inside:q.left>=r.left-0.5&&q.right<=r.right+0.5}});
      const texts=[...d.querySelectorAll('label, select, p, button, h2')].filter(e=>e.textContent.trim()).map(e=>({t:e.textContent.trim().slice(0,20),fs:parseFloat(getComputedStyle(e).fontSize)}));
      const probe=document.createElement('span');probe.style.color='var(--hp-text-primary-default)';document.querySelector('.studio-start').append(probe);const primary=getComputedStyle(probe).color;probe.remove();
      return {primary,colors:[...d.querySelectorAll('h2, .studio-settings-row > label:first-child')].map(e=>getComputedStyle(e).color),title:d.querySelector('h2').textContent,rows:[...d.querySelectorAll('.studio-settings-row > label:first-child')].map(l=>l.textContent),modal:d.matches(':modal'),top:r.top,height:r.height,vh:innerHeight,geo,advanced:[...d.querySelectorAll('button')].filter(x=>x.textContent==='고급 설정').length,
        sent:window.sent.map(x=>x.type),width:r.width,left:r.left,right:r.right,page:document.documentElement.scrollWidth,vw:document.documentElement.clientWidth,targets,texts,focus:document.activeElement?.getAttribute('aria-label')}})()`);
    const L = label + ' ' + JSON.stringify(m);
    assert.equal(m.title, '설정', L);
    if (!forced) assert.ok(m.colors.every((c) => c === m.primary), 'title, row names and choices use the start page text colour: ' + L);
    assert.ok(!m.sent.some((t) => /Settings$/.test(t)), 'opening the sheet posts no settings-editor request: ' + L);
    assert.ok(m.rows.length <= 6, 'at most six rows: ' + L);
    assert.deepEqual(m.rows, ['글자 크기', '움직임 줄이기', '알림'], 'the host-named rows in requirement order: ' + L);
    assert.equal(m.advanced, seat === 'adult' ? 1 : 0, '고급 설정 only when the host allows it: ' + L);
    assert.equal(m.focus, '설정 닫기', 'focus moves into the sheet: ' + L);
    for (const t of m.targets) { assert.ok(t.h >= 44, `44px target ${t.t}: ` + L); assert.ok(t.inside, `target inside the sheet ${t.t}: ` + L); }
    for (const t of m.texts) assert.ok(t.fs >= 14, `>=14px text ${t.t}: ` + L);
    assert.ok(m.left >= 0 && m.right <= m.vw + 0.5 && m.page <= width + 1, 'sheet inside the viewport, no horizontal scroll: ' + L);
    // DES-SHELL-13: a modal right-side sheet over the page, 320–400px wide, full height.
    assert.ok(m.modal, 'the sheet is modal (over the page): ' + L);
    assert.ok(Math.abs(m.right - m.vw) <= 0.5 && m.top <= 0.5 && Math.abs(m.height - m.vh) <= 0.5, 'the sheet sits on the right edge at full height: ' + L);
    assert.ok(m.width >= Math.min(320, m.vw) - 0.5 && m.width <= 400.5, 'the sheet is 320-400px wide: ' + L);
    assert.equal(m.geo.length, m.rows.length + m.advanced, 'every setting and 고급 설정 is a row: ' + L);
    for (const g of m.geo) {
      assert.ok(g.h >= 47.5 && g.h <= 48.5, `48px row ${g.t}: ` + L);
      assert.ok(g.inRow && g.sameLine, `row name and control on one line ${g.t}: ` + L);
      assert.ok(g.inside, `row inside the sheet ${g.t}: ` + L);
    }
    if (shots) { const { data } = await b.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, `start-settings-${width}-${dark ? 'dark' : 'light'}${forced ? '-forced' : ''}-${seat}.png`), Buffer.from(data, 'base64')); }
    // Each choice is posted to the host as a validated key/value; nothing is stored in the webview.
    await b.evaluate(`(()=>{window.sent=[];const d=document.querySelector('dialog.studio-settings');
      const pick=(sel,value)=>{const s=d.querySelector(sel);Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,value);s.dispatchEvent(new Event('change',{bubbles:true}));};
      pick('select[name="studio-text-size"]','xlarge');
      pick('select[name="studio-reduce-motion"]','on');
      d.querySelector('input[type="checkbox"]').click();})()`);
    const posted = await b.evaluate(`JSON.stringify(window.sent)`);
    assert.deepEqual(JSON.parse(posted), [{ type: 'startSetting', key: 'textSize', value: 'xlarge' }, { type: 'startSetting', key: 'reduceMotion', value: 'on' }, { type: 'startSetting', key: 'notices', value: true }], label);
    // The selects keep their names and descriptions, and the modal traps Tab (checked by what the page reports, not by markup).
    const names = await b.evaluate(`JSON.stringify(['studio-text-size','studio-reduce-motion','studio-notices'].map(id=>{const e=document.getElementById(id),d=e.getAttribute('aria-describedby');return {id,names:[...e.labels].map(l=>l.textContent.trim()).filter(Boolean),desc:d?document.getElementById(d)?.textContent.trim():null}}))`);
    const named = JSON.parse(names);
    assert.deepEqual(named.map((n) => n.names), [['글자 크기'], ['움직임 줄이기'], ['알림']], 'each control is named by its row label: ' + label);
    assert.ok(named[0].desc && named[2].desc, 'text size and notices keep their description: ' + label);
    const tab = async (modifiers = 0) => { for (const type of ['rawKeyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers }); };
    await b.evaluate(`document.querySelector('dialog.studio-settings header button').focus()`);
    for (let i = 0; i < 8; i++) { await tab(); assert.ok(await b.evaluate(`!!document.activeElement.closest('dialog.studio-settings')`), 'Tab stays inside the sheet: ' + label); }
    await tab(8); assert.ok(await b.evaluate(`!!document.activeElement.closest('dialog.studio-settings')`), 'Shift+Tab stays inside the sheet: ' + label);
    if (seat === 'adult') {
      await b.evaluate(`window.sent=[];[...document.querySelectorAll('dialog.studio-settings button')].find(x=>x.textContent==='고급 설정').click()`);
      assert.deepEqual(JSON.parse(await b.evaluate(`JSON.stringify(window.sent)`)), [{ type: 'openAdvancedSettings' }], label);
      await until(b, `!document.querySelector('dialog.studio-settings')`, '고급 설정 closes the sheet');
      await b.evaluate(`[...document.querySelectorAll('.studio-nav button')].find(x=>x.textContent==='설정').click()`);
      await until(b, `document.querySelector('dialog.studio-settings')?.open`, 'sheet reopens');
    }
    // Escape closes the sheet and focus returns to the start page "설정".
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(b, `!document.querySelector('dialog.studio-settings')`, 'Escape closes');
    await until(b, `document.activeElement?.textContent==='설정'`, 'focus returns to 설정');
  }
  // The sheet draws the host's rows only: a view naming one row (and an unknown one) draws that row alone.
  await b.load(`<!doctype html><html data-surface="start"><style>${css}</style><body class="vscode-dark"><div id="root"></div><script>window.sent=[];window.acquireVsCodeApi=()=>({postMessage(m){window.sent.push(m)},getState(){},setState(){}});</script><script>${js}</script></body></html>`, { width: 800, height: 900 });
  await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{checking:false,version:'1.0.0',settings:${JSON.stringify({ ...adultView, rows: ['notices', 'unknown-row'] })}}}}))`);
  await until(b, `[...document.querySelectorAll('.studio-nav button')].some(x=>x.textContent==='설정')`, 'nav');
  await b.evaluate(`[...document.querySelectorAll('.studio-nav button')].find(x=>x.textContent==='설정').click()`);
  await until(b, `document.querySelector('dialog.studio-settings')?.open`, 'sheet opens');
  assert.deepEqual(JSON.parse(await b.evaluate(`JSON.stringify([...document.querySelectorAll('dialog.studio-settings .studio-settings-row > label:first-child')].map(l=>l.textContent))`)), ['알림'], 'only the rows the host names');
  console.log('PASS start settings sheet: 설정 opens the learner right-side sheet (320-400px, full height, 48px one-line rows, <=6 host rows, 고급 설정 adult-only), posts validated choices, 44px/14px, Escape returns focus, 320/800/1420 both themes + forced colours');
} finally { await b.close(); }
