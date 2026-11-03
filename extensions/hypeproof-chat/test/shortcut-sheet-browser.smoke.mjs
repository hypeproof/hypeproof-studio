// CGP-CHAT-R-030: the real App bundle in headless Chromium. 키보드 단축키 opens from the settings
// dialog and from `?` outside a text field (never from the composer). Every key the sheet lists is
// then pressed on the real panel and must do what its row says; keys that are not bound (Esc to
// stop, a focus-the-composer key) must not be listed. Platform modifiers follow navigator.platform
// (⌘ on macOS, Ctrl on Windows). CGP-CHAT-D-030: the sheet is a two-column table (key, action) in
// computed layout at every width, Tab and Shift+Tab stay inside it, Esc closes it. Computed
// geometry: 44px entry and close targets, >=14px text, the dialog inside the viewport, forced
// colours keep the key caps outlined.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN shortcut sheet App: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'shortcut-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.SHORTCUT_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
// The VS Code webview is a secure context (crypto.randomUUID); a loaded test page may not be.
const host = (platform) => `Object.defineProperty(Navigator.prototype,'platform',{configurable:true,get:()=>${JSON.stringify(platform)}});window.__posts=[];if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');}window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});`;
const page = (vars, dark, platform) => `<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${host(platform)}</script><script>${script}</script></body></html>`;
const sheet = `document.querySelector('dialog.hps-shortcuts[open]')`;
const key = (target, init) => b.evaluate(`(()=>{const t=${target};const e=new KeyboardEvent('keydown',Object.assign({bubbles:true,cancelable:true},${JSON.stringify(init)}));t.dispatchEvent(e);return e.defaultPrevented})()`);
const rows = () => b.evaluate(`[...document.querySelectorAll('dialog.hps-shortcuts .hps-shortcut-row')].map(r=>({id:r.dataset.shortcut,keys:[...r.querySelectorAll('kbd')].map(k=>k.textContent),text:r.textContent}))`);
// Real key input through CDP (the browser's own default actions run: a typed `?`, a newline).
const MODS = { altKey: 1, ctrlKey: 2, metaKey: 4, shiftKey: 8 };
const press = async (focus, { key, code, vk, text, ...mods }) => {
  if (focus) await b.evaluate(`(${focus}).focus()`);
  const modifiers = Object.entries(mods).reduce((sum, [name, on]) => sum + (on ? MODS[name] : 0), 0);
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text, unmodifiedText: text } : {}) });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  await settle();
};
const QUESTION = { key: '?', code: 'Slash', vk: 191, text: '?', shiftKey: true };
const composer = `document.querySelector('.hps-input textarea')`;
const typeDraft = async (text) => { await b.evaluate(`(()=>{const t=${composer};t.focus();t.select();})()`); await b.send('Input.insertText', { text: text || ' ' }); if (!text) await press(composer, { key: 'Backspace', code: 'Backspace', vk: 8 }); await settle(); };
const workspace = { scope: 'shortcut-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '고양이 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const configFor = (seat) => chatConfig(3, {
  activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null },
  taskWorkspace: seat === 'personal' ? workspace : undefined,
  // The classroom settings dialog opens from its access chip (CGP-SHELL-D-028).
  access: seat === 'classroom' ? { status: 'unavailable' } : undefined,
});
let states = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [320, 800, 1420]) for (const platform of ['MacIntel', 'Win32']) {
    if (platform === 'Win32' && width !== 800) continue;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(page(vars, dark, platform), { width, height: 900, dark });
    await send({ type: 'config', config: configFor(seat) });
    await send({ type: 'history', messages: [] });
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', 'requested seat branch is mounted');
    const label = `${seat} ${dark ? 'dark' : 'light'} ${width}px ${platform}`;

    // `?` inside the composer types a question mark; it never opens the sheet.
    await typeDraft('');
    await press(composer, QUESTION);
    assert.equal(await b.evaluate(`${composer}.value`), '?', 'the composer keeps `?` as text');
    assert.equal(await b.evaluate(`!!${sheet}`), false, `no sheet from the composer (${label})`);

    // From the settings dialog.
    const settings = seat === 'personal' ? `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='설정')` : `document.querySelector('.hps-access-chip')`;
    // Personal: 설정 sits in the task menu (대화 메뉴).
    if (seat === 'personal') { await b.evaluate(`(()=>{const t=document.querySelector('.tw-chat-menu-toggle');t.focus();if(t.getAttribute('aria-expanded')!=='true')t.click();})()`); await settle(); }
    assert.equal(await b.evaluate(`!!(${settings})`), true, `settings entry exists (${label})`);
    await b.evaluate(`(()=>{const e=${settings};e.focus();e.click()})()`); await settle(120);
    const entry = `[...document.querySelectorAll('dialog.hps-preferences[open] button')].find(e=>e.textContent.trim()==='키보드 단축키')`;
    const entryBox = await b.evaluate(`(()=>{const e=${entry};if(!e)return null;const r=e.getBoundingClientRect();return {h:r.height,w:r.width,font:parseFloat(getComputedStyle(e).fontSize)}})()`);
    assert.ok(entryBox, `settings dialog lists 키보드 단축키 (${label})`);
    assert.ok(entryBox.h >= 44 && entryBox.w >= 44 && entryBox.font >= 14, `44px entry, >=14px text: ${JSON.stringify(entryBox)}`);
    await b.evaluate(`(${entry}).click()`); await settle(160);
    assert.equal(await b.evaluate(`document.querySelectorAll('dialog[open]').length`), 1, 'settings closes; only the sheet is open');
    assert.equal(await b.evaluate(`!!${sheet}`), true, `sheet opens from settings (${label})`);
    assert.equal(await b.evaluate(`${sheet}.contains(document.activeElement)`), true, 'focus moves into the sheet');
    const listed = await rows();
    const expected = seat === 'personal' ? ['send', 'newline', 'close', 'find', 'conversation', 'help'] : ['send', 'newline', 'close', 'find', 'help'];
    assert.deepEqual(listed.map(r => r.id), expected, `only bound keys are listed (${label})`);
    const mac = platform === 'MacIntel';
    assert.deepEqual(listed.find(r => r.id === 'newline').keys, [mac ? '⇧ Shift' : 'Shift', 'Enter'], 'platform Shift name');
    if (seat === 'personal') assert.deepEqual(listed.find(r => r.id === 'conversation').keys, [mac ? '⌥ Option' : 'Alt', mac ? '⇧ Shift' : 'Shift', 'J'], 'platform Alt name');
    assert.deepEqual(listed.find(r => r.id === 'find').keys, [mac ? '⌘ Cmd' : 'Ctrl', 'F'], 'platform Command glyph: ⌘ on macOS, Ctrl on Windows');
    const all = listed.map(r => r.text).join('\n');
    for (const absent of ['멈추기', '입력창으로', mac ? 'Ctrl' : '⌘']) assert.ok(!all.includes(absent), `unbound key or other platform's name is not listed: ${absent}`);
    // CGP-CHAT-D-030: a real two-column table, measured: every row has its key cell left of its
    // action cell on the same line, at 320px too.
    const table = await b.evaluate(`(()=>{const t=${sheet}.querySelector('table.hps-shortcut-list');if(!t)return null;const head=[...t.tHead.rows[0].cells].map(c=>c.textContent);const rows=[...t.tBodies[0].rows].map(r=>{const [k,a]=[...r.cells].map(c=>c.getBoundingClientRect());const caps=[...r.cells[0].querySelectorAll('kbd')].map(c=>c.getBoundingClientRect().top);return {cells:r.cells.length,scope:r.cells[0].getAttribute('scope'),beside:k.right<=a.left+0.5,line:Math.abs(k.top-a.top)<1,oneLine:caps.every(t=>Math.abs(t-caps[0])<1)}});return {display:getComputedStyle(t).display,head,rows}})()`);
    assert.ok(table, `the sheet is a table (${label})`);
    assert.equal(table.display, 'table', 'computed display is table');
    assert.deepEqual(table.head, ['키', '하는 일'], 'column headers: key, action');
    for (const { oneLine, ...row } of table.rows) {
      assert.deepEqual(row, { cells: 2, scope: 'row', beside: true, line: true }, `two columns side by side (${label}): ${JSON.stringify(table.rows)}`);
      // Key caps share one line when the window has room; only a narrow window wraps them.
      if (width >= 800) assert.equal(oneLine, true, `key caps on one line at ${width}px (${label})`);
    }
    // Focus trap: Tab and Shift+Tab never leave the sheet.
    for (const shiftKey of [false, false, false, true, true, true]) {
      await press(null, { key: 'Tab', code: 'Tab', vk: 9, shiftKey });
      assert.equal(await b.evaluate(`${sheet}?.contains(document.activeElement)`), true, `Tab${shiftKey ? ' with Shift' : ''} stays in the sheet (${label})`);
    }
    const geometry = await b.evaluate(`(()=>{const d=${sheet};const r=d.getBoundingClientRect();const close=d.querySelector('header button').getBoundingClientRect();const fonts=[...d.querySelectorAll('kbd, th, td, td small, h2')].map(e=>parseFloat(getComputedStyle(e).fontSize));const k=getComputedStyle(d.querySelector('kbd'));return {inView:r.left>=0&&r.right<=innerWidth+0.5&&r.top>=0&&r.bottom<=innerHeight+0.5,close:[close.width,close.height],min:Math.min(...fonts),border:k.borderTopStyle,overflow:d.scrollWidth<=d.clientWidth+1,bg:getComputedStyle(d).backgroundColor}})()`);
    assert.equal(geometry.inView, true, `sheet inside the viewport: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.close[0] >= 44 && geometry.close[1] >= 44, `44px close: ${geometry.close}`);
    assert.ok(geometry.min >= 14, `>=14px text in the sheet: ${geometry.min}`);
    assert.equal(geometry.border, 'solid', 'key caps are outlined'); assert.ok(!/^rgba\(.*, 0\)$|transparent/.test(geometry.bg) && !/rgba\(.*, 0\.\d+\)$/.test(geometry.bg), `the sheet has an opaque surface (the page must not show through): ${geometry.bg}`); assert.equal(geometry.overflow, true, 'no horizontal overflow');
    if (evidence) { await settle(700); const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${seat}-${width}-${dark ? 'dark' : 'light'}-${platform}.png`, Buffer.from(shot.data, 'base64')); }

    // `close`: Escape closes the sheet; focus goes back to what opened settings.
    await press(null, { key: 'Escape', code: 'Escape', vk: 27 }); await settle(400);
    assert.equal(await b.evaluate(`!!${sheet}`), false, 'Escape closes the sheet');
    assert.equal(await b.evaluate(`(()=>{const a=document.activeElement;return a===(${settings})||a===document.querySelector('.tw-chat-menu-toggle')||a===document.querySelector('.hps-input textarea')})()`), true, 'focus returns to the settings opener (menu toggle) or the composer, never <body>');

    // `help`: `?` outside a text field opens it; focus returns to that element.
    const outside = seat === 'personal' ? `document.querySelector('#task-conversation')` : `document.querySelector('.hps-messages, .hps-shell')`;
    await b.evaluate(`(()=>{const e=${outside};e.tabIndex=e.tabIndex<0?-1:e.tabIndex;e.focus()})()`);
    await press(null, QUESTION); await settle(120);
    assert.equal(await b.evaluate(`!!${sheet}`), true, `? opens the sheet (${label})`);
    assert.equal(await key(`document.activeElement`, { key: '?', shiftKey: true }), false, 'a second `?` inside the open sheet does nothing');
    await b.evaluate(`${sheet}.querySelector('header button').click()`); await settle(400);
    assert.equal(await b.evaluate(`!!${sheet}`), false, '× closes the sheet');
    assert.equal(await b.evaluate(`document.activeElement===(${outside})`), true, 'focus returns to the element that had it when `?` was pressed');
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }]) {
      await key(outside, { key: '?', shiftKey: true, ...mod }); await settle();
      assert.equal(await b.evaluate(`!!${sheet}`), false, `\`?\` with ${JSON.stringify(mod)} does not open the sheet`);
    }

    // `find`: the platform's Command key + F opens the find bar from the real panel; the other
    // platform's modifier does not. Esc closes it.
    const findInput = `document.querySelector('.hps-find-input')`;
    await press(outside, { key: 'f', code: 'KeyF', vk: 70, ...(mac ? { ctrlKey: true } : { metaKey: true }) });
    assert.equal(await b.evaluate(`!!${findInput}`), false, `the other platform's modifier does not open find (${label})`);
    await press(outside, { key: 'f', code: 'KeyF', vk: 70, ...(mac ? { metaKey: true } : { ctrlKey: true }) }); await settle(80);
    assert.equal(await b.evaluate(`document.activeElement===${findInput}`), true, `${mac ? '⌘' : 'Ctrl'}+F opens find and focuses it (${label})`);
    await press(null, { key: 'Escape', code: 'Escape', vk: 27 }); await settle(120);
    assert.equal(await b.evaluate(`!!${findInput}`), false, 'Esc closes find');

    // `newline`: Shift+Enter is left to the textarea (not sent, not prevented).
    await typeDraft('SHORTCUT-NEWLINE');
    await press(composer, { key: 'Enter', code: 'Enter', vk: 13, text: '\r', shiftKey: true });
    assert.equal(await b.evaluate(`${composer}.value`), 'SHORTCUT-NEWLINE\n', 'Shift+Enter inserts a line break');
    assert.equal(await b.evaluate(`window.__posts.some(m=>m.type==='sendMessage'&&String(m.text).includes('SHORTCUT-NEWLINE'))`), false, 'Shift+Enter does not send');
    // `send`: Enter sends the draft.
    await typeDraft('SHORTCUT-SEND');
    await press(composer, { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }); await settle(120);
    assert.equal(await b.evaluate(`window.__posts.some(m=>m.type==='sendMessage'&&m.text==='SHORTCUT-SEND')`), true, `Enter sends (${label})`);
    // `conversation`: Alt+Shift+J moves focus to the conversation (personal task layout only).
    if (seat === 'personal') {
      await press(composer, { key: mac ? 'Ô' : 'J', code: 'KeyJ', vk: 74, altKey: true, shiftKey: true });
      assert.equal(await b.evaluate(`document.activeElement?.id`), 'task-conversation', 'Alt+Shift+J focuses the conversation');
    }
    states++;
  }
  // Forced colours: key caps and the dialog keep visible borders.
  await b.load(page('', true, 'MacIntel'), { width: 800, height: 900, forcedColors: true });
  await send({ type: 'config', config: configFor('personal') }); await send({ type: 'history', messages: [] });
  await b.evaluate(`document.querySelector('#task-conversation').focus()`);
  await press(null, QUESTION); await settle(120);
  const fc = await b.evaluate(`(()=>{const k=getComputedStyle(${sheet}.querySelector('kbd'));return {style:k.borderTopStyle,width:parseFloat(k.borderTopWidth)}})()`);
  assert.equal(fc.style, 'solid'); assert.ok(fc.width >= 1, `forced-colours key cap border: ${JSON.stringify(fc)}`);
  if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/personal-800-forced-colors.png`, Buffer.from(shot.data, 'base64')); }
  console.log(`PASS actual App shortcut sheet in ${states} seat/theme/width/platform states + forced colours: settings entry, ?, only bound keys, each listed key pressed`);
} finally { await b.close(); }
