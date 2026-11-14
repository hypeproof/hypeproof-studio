// REQ-STUDIO-LEARNING-BLOCK-REPORT (CGP-LEARN-R-011 (a), CGP-LEARN-D-011 report half). This runs on the mounted ChatPanel
// with the shipped stylesheet in headless Chromium, using real key events (CDP Input.dispatchKeyEvent). It checks:
// - Without a live class connection (no inbox run, or offline, or ended) the 자료 메뉴 has only 접기 (control). With one, the
//   menu reads "자료가 틀린 것 같아요", then 접기.
// - The report opens inline in the open card (no dialog, nothing positioned): three reason radios in 44px labels at a 14px
//   floor, no text field, 선생님께 보내기 disabled until a reason is picked, focus on the first reason, no sideways scroll.
// - Sending posts exactly { type: materialReport, stepId, reason } (the host adds the block identity). "sent" closes the
//   report, announces "선생님께 전달했어요" in the polite live region and returns focus to the menu button. "not_sent" keeps it
//   open and says so. Escape closes it, focus on the menu button.
// Runs on the classroom seat, dark and light, at 800 and 1420 px.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chatConfig, chatPanelProps, weekFixture } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';
const root=createRoot(document.getElementById('root'));
window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles[0].text;

// Week 3: expect = criterion_form.
const config = (() => { const base = chatConfig(3); return { ...base, profile: { ...base.profile, lesson: { ...base.profile.lesson, content: weekFixture(3) } } }; })();
const lesson = config.profile.lesson;
const inbox = (over) => ({ type: 'inboxState', inbox: { run: 'run-1', student: 'student-a', generation: 1, ended: false, offline: false, cards: [], unread: 0, ...over } });

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: learning-block-report browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (expr) => browser.evaluate(expr);
const waitFor = async (expr, what, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) { if (await ev(`!!(${expr})`)) return; if (Date.now() > end) throw Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 16)); }
};
const KEYS = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, Space: 32 };
const press = async (key) => {
  const base = { key: key === 'Space' ? ' ' : key, code: key, windowsVirtualKeyCode: KEYS[key], nativeVirtualKeyCode: KEYS[key] };
  const text = key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : key === 'Space' ? { text: ' ', unmodifiedText: ' ' } : {};
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...text });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await new Promise((r) => setTimeout(r, 40));
};
const HELPERS = `
window.card=()=>document.querySelector('[data-block-card="criterion_form"]');
window.host=(m)=>window.dispatchEvent(new MessageEvent('message',{data:m}));
window.items=()=>[...card().querySelectorAll('[role="menuitem"]')].map(i=>i.textContent);
window.openMenu=()=>{const c=card();if(c.querySelector('[data-block-toggle]').getAttribute('aria-expanded')==='false')c.querySelector('[data-block-toggle]').click();};
window.__fetches=0;const __f=window.fetch;window.fetch=(...a)=>{window.__fetches++;return __f(...a)};`;
const settle = () => new Promise((r) => setTimeout(r, 60));

let checks = 0;
try {
  for (const dark of [false, true]) for (const width of [800, 1420]) {
    const tag = `${dark ? 'dark' : 'light'} ${width}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.__vs=undefined;window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>window.__vs,setState:s=>{window.__vs=s}});</script><script>${js}</script><script>${HELPERS}</script></body></html>`, { width, height: 1100, dark });
    await ev(`mount(${JSON.stringify(config)})`);
    await waitFor(`card()`, `${tag} criterion block`);

    // Control: no class connection, so the menu has only 접기. Offline and ended connections are not one either.
    await ev('openMenu()'); await settle();
    await ev(`card().querySelector('[data-block-menu-toggle]').click()`); await settle();
    assert.deepEqual(await ev('items()'), ['접기'], `${tag}: no connection, no report item`);
    for (const over of [{ offline: true }, { ended: true }, { run: '' }]) {
      await ev(`host(${JSON.stringify(inbox(over))})`); await settle();
      assert.deepEqual(await ev('items()'), ['접기'], `${tag}: ${JSON.stringify(over)} is not a live class connection`);
    }
    checks += 4;

    // A live class connection: the report item comes first.
    await ev(`host(${JSON.stringify(inbox({}))})`); await settle();
    assert.deepEqual(await ev('items()'), ['자료가 틀린 것 같아요', '접기'], `${tag}: report item, then 접기`);
    await ev(`card().querySelector('[data-block-menu-toggle]').click()`); await settle();
    assert.equal(await ev(`!!card().querySelector('[role="menu"]')`), false, `${tag}: the menu is closed`);
    await ev(`card().querySelector('[data-block-menu-toggle]').focus()`);
    await press('ArrowDown');
    assert.equal(await ev(`document.activeElement.dataset.blockReportOpen!==undefined`), true, `${tag}: ArrowDown opens the menu on the report item`);
    const before = await ev('[posted.length, window.__fetches]');
    await press('Enter'); await settle();
    checks += 2;

    // The inline report: no dialog, nothing positioned, three 44px radios, no text field, send disabled, focus on the first.
    const panel = await ev(`(()=>{const c=card(),p=c.querySelector('[data-block-report-panel]'),labels=[...p.querySelectorAll('label')],send=p.querySelector('[data-report-send]');
      return {menu:!!c.querySelector('[role="menu"]'),dialog:!!document.querySelector('dialog,[role="dialog"],[aria-modal]'),pos:getComputedStyle(p).position,
        words:labels.map(l=>l.textContent),radios:p.querySelectorAll('input[type="radio"]').length,text:p.querySelectorAll('textarea,input:not([type="radio"]),[contenteditable]').length,
        big:labels.every(l=>l.getBoundingClientRect().height>=44),font:labels.every(l=>parseFloat(getComputedStyle(l).fontSize)>=14),send:send.disabled,sendBig:send.getBoundingClientRect().height>=44,
        focus:document.activeElement.dataset.reportReason,scroll:document.documentElement.scrollWidth>document.documentElement.clientWidth,
        within:p.getBoundingClientRect().right<=c.getBoundingClientRect().right+0.5,note:p.querySelector('.hp-block-report-note').textContent}})()`);
    assert.deepEqual(panel, { menu: false, dialog: false, pos: 'static', words: ['내용이 틀려요', '열리지 않아요', '이해하기 어려워요'], radios: 3, text: 0, big: true, font: true, send: true, sendBig: true, focus: 'wrong', scroll: false, within: true, note: '어떤 자료인지와 고른 이유만 선생님께 가요. 대화 내용은 가지 않아요.' }, `${tag}: inline report`);
    const ring = await browser.focusVisibleStyle('[data-report-reason="wrong"]');
    assert.ok(parseFloat(ring['outline-width']) > 0 && ring['outline-style'] !== 'none', `${tag}: the reason radio has a focus ring ${JSON.stringify(ring)}`);
    assert.deepEqual(await ev('[posted.length, window.__fetches]'), before, `${tag}: opening the report sends nothing`);
    checks += 3;

    // Keyboard: arrow to 열리지 않아요 (native radio group), then send. Exactly a step and a reason are posted.
    await press('ArrowRight'); await settle();
    assert.equal(await ev(`card().querySelector('[data-report-reason="broken"]').checked`), true, `${tag}: arrows move between reasons`);
    await ev(`card().querySelector('[data-report-send]').focus()`); await press('Enter'); await settle();
    const sent = await ev(`posted.filter(m=>m.type==='materialReport')`), stepId = await ev(`card().dataset.hpsMaterialStep`);
    assert.equal(sent.length, 1, `${tag}: one report posted`);
    assert.deepEqual({ type: sent[0].type, stepId: sent[0].stepId, reason: sent[0].reason }, { type: 'materialReport', stepId, reason: 'broken' }, `${tag}: posted fields`);
    assert.ok(Object.keys(sent[0]).every((k) => ['type', 'stepId', 'reason', 'activityId', 'taskId'].includes(k)), `${tag}: no other field: ${JSON.stringify(sent[0])}`);
    assert.equal(await ev(`[card().querySelector('[data-report-send]').disabled, card().querySelector('[data-report-send]').textContent]`).then(JSON.stringify), JSON.stringify([true, '보내는 중…']), `${tag}: sending`);
    assert.equal(await ev('window.__fetches'), before[1], `${tag}: the webview fetches nothing`);
    checks += 5;

    // The host answers "not_sent": the report stays open and says so; another lesson's answer is ignored.
    await ev(`host({type:'materialReportResult',sha256:${JSON.stringify((lesson.sha256[0] === '0' ? '1' : '0') + lesson.sha256.slice(1))},stepId:${JSON.stringify(stepId)},state:'sent'})`); await settle();
    assert.equal(await ev(`!!card().querySelector('[data-block-report-panel]')`), true, `${tag}: another lesson's answer changes nothing`);
    await ev(`host({type:'materialReportResult',sha256:${JSON.stringify(lesson.sha256)},stepId:${JSON.stringify(stepId)},state:'not_sent'})`); await settle();
    assert.deepEqual(await ev(`[!!card().querySelector('[data-block-report-panel]'), card().querySelector('[data-report-result="not_sent"]')?.textContent, card().querySelector('[data-report-send]').disabled]`), [true, '수업 연결이 없어 보내지 못했어요. 선생님께 직접 말해 주세요.', false], `${tag}: not sent is said`);
    checks += 2;

    // Send again; "sent" closes it, the toast is announced politely, focus returns to the menu button.
    await ev(`card().querySelector('[data-report-send]').click()`); await settle();
    await ev(`host({type:'materialReportResult',sha256:${JSON.stringify(lesson.sha256)},stepId:${JSON.stringify(stepId)},state:'sent'})`); await settle();
    const done = await ev(`[!!card().querySelector('[data-block-report-panel]'), document.activeElement.dataset.blockMenuToggle!==undefined, [...document.querySelectorAll('.hps-copy-live[role="status"]')].map(n=>n.textContent).join('|'), document.querySelector('.hps-copy-toasts')?.textContent ?? '']`);
    assert.deepEqual(done, [false, true, '선생님께 전달했어요', '선생님께 전달했어요'], `${tag}: sent`);
    assert.equal(await ev(`posted.filter(m=>m.type==='materialReport').length`), 2, `${tag}: two reports in all`);
    checks += 2;

    // Escape closes an open report; focus returns to the menu button. Nothing is posted.
    await ev(`card().querySelector('[data-block-menu-toggle]').click()`); await settle();
    await ev(`card().querySelector('[data-block-report-open]').click()`); await settle();
    const n = await ev('posted.length');
    await press('Escape'); await settle();
    assert.deepEqual(await ev(`[!!card().querySelector('[data-block-report-panel]'), document.activeElement.dataset.blockMenuToggle!==undefined, posted.length]`), [false, true, n], `${tag}: Escape closes`);
    checks += 1;

    // The connection drops: the item goes away, and an open report closes with it.
    await ev(`card().querySelector('[data-block-menu-toggle]').click()`); await settle();
    await ev(`card().querySelector('[data-block-report-open]').click()`); await settle();
    await ev(`host(${JSON.stringify(inbox({ offline: true }))})`); await settle();
    assert.equal(await ev(`!!card().querySelector('[data-block-report-panel]')`), false, `${tag}: an offline seat has no open report`);
    await ev(`card().querySelector('[data-block-menu-toggle]').click()`); await settle();
    assert.deepEqual(await ev('items()'), ['접기'], `${tag}: offline again, no report item`);
    checks += 2;
  }
  console.log(`PASS learning-block-report-browser: ${checks} checks (light/dark, 800/1420 px)`);
} finally { await browser.close(); }
