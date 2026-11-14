// CGP-KNOW-R-029 (REQ-KNOW-47 / DES-KNOW-47) — "기록 없이 묻기" in the real App bundle in headless Chromium, measured on the
// real markup. Dark and light at 320, 800 and 1420 px, plus forced colours:
//   1. an adult personal seat: the 대화 메뉴 has 기록 없이 묻기 (a 44px item); choosing it posts `taskCreateTemporary` once;
//   2. while the temporary task is open, a band runs across the top of the task above its heading: the title "이 기기에
//      기록이 남지 않는 작업" (CGP-KNOW-D-029: the register's title, scoped to this device), "이 기기에 기록을 남기지 않아요…", that it is chat only and that the request still goes to the Service; 14px or more, 4.5:1,
//      inside the window; it promises nothing about other places ("어디에도", "서버에도" never appear); it goes when the
//      learner leaves the task;
//   3. a seat that may not open one (a personal seat the host refused: minor or unknown; and a classroom seat): the
//      control is unavailable (aria-disabled, still focusable), focus shows "수업에서는 기록이 남아요", and pressing it
//      posts nothing.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const { TEMPORARY_TASK_COPY, TEMPORARY_TASK_UNAVAILABLE } = await import('../src/temporaryTask.ts');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN temporary task: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'temporary-task-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const evidence = process.env.TEMPORARY_TASK_EVIDENCE; if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async data => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const key = async k => { for (const type of ['rawKeyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: { Tab: 9, ArrowDown: 40 }[k] }); await settle(30); };
const luminance = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const color = value => value.match(/[\d.]+/g).map(Number);
const contrast = (a, b2) => { const x = luminance(color(a)), y = luminance(color(b2)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const background = `(e=>{for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c&&c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;}return getComputedStyle(document.body).backgroundColor;})`;
const history = [{ id: 'u1', role: 'user', content: '질문', createdAt: 1 }, { id: 'a1', role: 'assistant', content: '답', createdAt: 2 }];
const control = `(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.classList.contains('tw-temporary-open'));if(!e)return null;const q=e.getBoundingClientRect();const r=e.querySelector('.tw-temporary-reason');
  return {disabled:e.getAttribute('aria-disabled'),native:e.disabled,role:e.getAttribute('role'),w:q.width,h:q.height,font:parseFloat(getComputedStyle(e).fontSize),reason:r&&getComputedStyle(r).display!=='none'?r.textContent:null,describedby:e.getAttribute('aria-describedby'),focused:document.activeElement===e}})()`;

let states = 0;
try {
  for (const dark of [true, false]) for (const width of [320, 800, 1420]) for (const forcedColors of width === 800 && dark ? [false, true] : [false]) for (const seat of ['adult', 'refused', 'classroom']) {
    const tag = `${seat}-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 720, dark, forcedColors, appReady: true });
    const personal = seat !== 'classroom';
    const workspace = { scope: 'tt-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '발표', createdAt: 1, updatedAt: 1, messageCount: 2 }], sourceSelection: null };
    const config = chatConfig(3, { activity: { ...chatConfig().activity, kind: personal ? 'personal' : 'classroom' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: personal ? workspace : undefined, temporaryTask: { allowed: seat === 'adult' } });
    await send({ type: 'config', config });
    await send({ type: 'history', messages: history });
    if (personal) { await b.evaluate(`document.querySelector('.tw-chat-menu-toggle').click()`); await settle(); }
    let m = await b.evaluate(control);
    assert.ok(m, `${tag}: the control is there`);
    if (personal) assert.equal(m.role, 'menuitem', `${tag}: an item of 대화 메뉴`);
    assert.ok(m.h >= 44 && m.w >= 44 && m.font >= 14, `${tag}: a 44px target with 14px text (${JSON.stringify(m)})`);
    assert.equal(m.native, false, `${tag}: never natively disabled, so focus can reach the reason`);
    await b.evaluate(`window.posted.length=0`);
    if (seat === 'adult') {
      assert.equal(m.disabled, null, `${tag}: available`);
      await b.evaluate(`[...document.querySelectorAll('button')].find(x=>x.classList.contains('tw-temporary-open')).click()`); await settle();
      assert.deepEqual(await b.evaluate(`window.posted.filter(p=>p.type==='taskCreateTemporary').length`), 1, `${tag}: one request`);
      // The host opened it: the band runs across the top of the task.
      const temporaryId = 'temp-1';
      await send({ type: 'taskWorkspaceState', view: { ...workspace, revision: 1, activeTaskId: temporaryId, temporaryTaskId: temporaryId, tasks: [{ id: temporaryId, title: '기록 없이 묻기', createdAt: 2, updatedAt: 2, messageCount: 0 }, ...workspace.tasks] } });
      const band = await b.evaluate(`(()=>{const n=document.querySelector('[data-testid=temporary-band]');if(!n)return null;const q=n.getBoundingClientRect();const h=document.querySelector('.tw-heading').getBoundingClientRect();
        return {text:n.textContent,lines:[...n.querySelectorAll('p')].map(p=>p.textContent),role:n.getAttribute('role'),top:q.top,bottom:q.bottom,left:q.left,right:q.right,heading:h.top,
          texts:[...n.querySelectorAll('p,span')].map(p=>({t:p.textContent.slice(0,12),font:parseFloat(getComputedStyle(p).fontSize),fg:getComputedStyle(p).color,bg:(${background})(p)})),scroll:document.documentElement.scrollWidth-innerWidth}})()`);
      assert.ok(band, `${tag}: the band is shown`);
      assert.deepEqual(band.lines, [TEMPORARY_TASK_COPY.bandTitle, TEMPORARY_TASK_COPY.device, `${TEMPORARY_TASK_COPY.chatOnly} ${TEMPORARY_TASK_COPY.service}`], `${tag}: the band's words`);
      assert.ok(band.text.includes('이 기기에 기록을 남기지 않아요'), `${tag}: it promises this device`);
      // CGP-KNOW-D-029 — the register's title "기록이 남지 않는 작업", always scoped to this device, never unscoped.
      assert.equal(band.lines[0], '이 기기에 기록이 남지 않는 작업', `${tag}: the band's title`);
      assert.ok(band.lines.every(line => !/^기록이 남지 않는/.test(line)), `${tag}: no unscoped "기록이 남지 않는…"`);
      assert.doesNotMatch(band.text, /어디에도|서버에도|아무 데도|완전히|영원히/, `${tag}: and nothing about other places`);
      assert.ok(band.bottom <= band.heading + 0.5, `${tag}: above the task heading (${band.bottom} <= ${band.heading})`);
      assert.ok(band.left >= -0.5 && band.right <= width + 0.5 && band.scroll <= 0, `${tag}: inside the window, no sideways scroll`);
      for (const x of band.texts) { assert.ok(x.font >= 14, `${tag}: "${x.t}" ${x.font}px`); if (!forcedColors) assert.ok(contrast(x.fg, x.bg) >= 4.5, `${tag}: "${x.t}" contrast ${x.fg} on ${x.bg}`); }
      if (evidence) { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${tag}.png`, Buffer.from(s.data, 'base64')); }
      // Leaving the task (back to the one underneath): no band.
      await send({ type: 'taskWorkspaceState', view: workspace });
      assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=temporary-band]')`), false, `${tag}: the band goes with the task`);
    } else {
      assert.equal(m.disabled, 'true', `${tag}: unavailable`);
      assert.equal(m.reason, null, `${tag}: the reason waits for focus`);
      // Real keyboard focus: ArrowDown through 대화 메뉴 (it opened with focus on its first item), Tab along the classroom row.
      const isOn = `document.activeElement?.classList.contains('tw-temporary-open')`;
      if (!personal) await b.evaluate(`document.activeElement?.blur?.()`);
      for (let i = 0; i < 80 && !(await b.evaluate(isOn)); i++) await key(personal ? 'ArrowDown' : 'Tab');
      m = await b.evaluate(control);
      assert.equal(m.focused, true, `${tag}: focusable`);
      assert.equal(m.reason, TEMPORARY_TASK_UNAVAILABLE, `${tag}: focus shows "${TEMPORARY_TASK_UNAVAILABLE}"`);
      assert.equal(await b.evaluate(`document.getElementById(${JSON.stringify(m.describedby)})?.textContent`), TEMPORARY_TASK_UNAVAILABLE, `${tag}: and describes the control`);
      await b.evaluate(`[...document.querySelectorAll('button')].find(x=>x.classList.contains('tw-temporary-open')).click()`); await settle();
      assert.equal(await b.evaluate(`window.posted.filter(p=>p.type==='taskCreateTemporary').length`), 0, `${tag}: pressing it posts nothing`);
      if (evidence) { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${tag}.png`, Buffer.from(s.data, 'base64')); }
    }
    states++;
  }
  console.log(`PASS temporary task: ${states} states (adult, refused and classroom seats; dark/light, 320/800/1420, forced colours)`);
} finally { await b.close(); }
