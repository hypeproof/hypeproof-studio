// REQ-STUDIO-LEARNING-BLOCK-COLLAPSE (CGP-LEARN-R-011 (c), CGP-LEARN-D-011 collapse half). This runs on the mounted ChatPanel
// with the shipped stylesheet in headless Chromium, using real key events (CDP Input.dispatchKeyEvent). It checks:
// - The open 자료 card's 자료 메뉴 is the next Tab stop after 닫기; the closed card keeps its one row, with no menu.
// - 접기 puts the block away and 다시 보기 brings it back open. Focus follows: 다시 보기 after 접기, and the menu button after
//   다시 보기. Closing the card closes its menu.
// - The collapsed state is kept per lesson version and step in the webview's own state, so it survives a re-mount, and it is
//   never sent to the host: no host message, no fetch, so no evidence event.
// - Targets are 44px with clear accessible names and the visible words at their start.
// Runs on the classroom seat, dark and light, at 800 and 1420 px, on criterion_form and decision_form.
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
// `remount` drops the React tree and mounts a new one, as a hide/show of the webview view does; the webview state stays.
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';
let root=createRoot(document.getElementById('root'));
window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);
window.remount=(config)=>{root.unmount();root=createRoot(document.getElementById('root'));window.mount(config);};`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

// Week 3: expect = criterion_form, build = decision_form.
const content = weekFixture(3);
content.steps = content.steps.map((s) => (s.id === 'build' ? { ...s, ui: 'decision_form' } : s));
const config = (() => { const base = chatConfig(3); return { ...base, profile: { ...base.profile, lesson: { ...base.profile.lesson, content } } }; })();
// The same lesson at another version: a new version starts with every block shown.
// Two learners on one shared classroom PC: the same lesson, two Service seats (CGP-LEARN-R-011 (c) follow-up).
const asSeat = (c) => ({ ...config, profile: { ...config.profile, activity_id: c.repeat(64) } });
const seatA = asSeat('a'), seatB = asSeat('b');
// No seat at all: no Service seat id, no capability receipt, no local activity id (a local/dev or instructor-like window).
const noSeat = { ...config, activity: { ...config.activity, id: '' } };
const nextVersion = { ...config, profile: { ...config.profile, lesson: { ...config.profile.lesson, version: config.profile.lesson.version + '-next', sha256: 'e'.repeat(64) } } };

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: learning-block-collapse browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (expr) => browser.evaluate(expr);
const waitFor = async (expr, what, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) { if (await ev(`!!(${expr})`)) return; if (Date.now() > end) throw Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 16)); }
};
const KEYS = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
const press = async (key) => {
  const base = { key, code: key, windowsVirtualKeyCode: KEYS[key], nativeVirtualKeyCode: KEYS[key] };
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await new Promise((r) => setTimeout(r, 40));
};
const HELPERS = `
window.card=(kind)=>document.querySelector('[data-block-card="'+kind+'"]');
window.active=()=>{const a=document.activeElement;return a?(a.dataset.blockMenuToggle!==undefined?'menu-toggle':a.dataset.blockCollapse!==undefined?'collapse':a.dataset.blockRestore!==undefined?'restore':a.dataset.blockToggle!==undefined?'open-toggle':a.localName):null};
window.__fetches=0;const __f=window.fetch;window.fetch=(...a)=>{window.__fetches++;return __f(...a)};
window.hostMsgs=()=>posted.length+window.__fetches;`;
const settle = () => new Promise((r) => setTimeout(r, 60));

let checks = 0;
try {
  for (const dark of [false, true]) for (const width of [800, 1420]) {
    const tag = `${dark ? 'dark' : 'light'} ${width}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.__vs=undefined;window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>window.__vs,setState:s=>{window.__vs=s}});</script><script>${js}</script><script>${HELPERS}</script></body></html>`, { width, height: 1100, dark });
    await ev(`mount(${JSON.stringify(config)})`);
    await waitFor(`card('criterion_form')`, `${tag} criterion block`);
    const title = await ev(`card('criterion_form').querySelector('.hp-block-card-name').textContent`);
    const before = await ev('hostMsgs()');

    // The closed card keeps its one row: no menu button. Open, the menu button is the next Tab stop after 닫기, a 44px target
    // named "자료 메뉴: <title>".
    assert.equal(await ev(`!!card('criterion_form').querySelector('[data-block-menu-toggle]')`), false, `${tag}: no menu on the closed card`);
    await ev(`card('criterion_form').querySelector('[data-block-toggle]').click()`); await settle();
    await ev(`card('criterion_form').querySelector('[data-block-toggle]').focus()`);
    await press('Tab');
    assert.equal(await ev('active()'), 'menu-toggle', `${tag}: Tab from 닫기 reaches the 자료 메뉴 button`);
    const mb = await ev(`(()=>{const b=card('criterion_form').querySelector('[data-block-menu-toggle]'),r=b.getBoundingClientRect();return [b.getAttribute('aria-label'),b.getAttribute('aria-haspopup'),b.getAttribute('aria-expanded'),r.width>=44&&r.height>=44]})()`);
    assert.deepEqual(mb, [`자료 메뉴: ${title}`, 'menu', 'false', true], `${tag}: menu button name, popup, state, 44px`);
    checks += 3;

    // ArrowDown opens the menu on its first item; Escape closes it and returns focus to the button.
    await press('ArrowDown');
    assert.equal(await ev('active()'), 'collapse', `${tag}: ArrowDown opens the menu on 접기`);
    const item = await ev(`(()=>{const m=card('criterion_form').querySelector('[role="menu"]'),i=m.querySelector('[role="menuitem"]'),r=i.getBoundingClientRect();return [m.getAttribute('aria-label'),i.textContent,i.getAttribute('aria-label'),r.height>=44,parseFloat(getComputedStyle(i).fontSize)>=14,document.documentElement.scrollWidth>innerWidth]})()`);
    assert.deepEqual(item, [`자료 메뉴: ${title}`, '접기', `접기: ${title}`, true, true, false], `${tag}: menu and item names, 44px / 14px, no sideways scroll`);
    const ring = await browser.focusVisibleStyle('[data-block-collapse]');
    assert.ok(parseFloat(ring['outline-width']) > 0 && ring['outline-style'] !== 'none', `${tag}: the item has a focus ring ${JSON.stringify(ring)}`);
    await press('Escape');
    assert.deepEqual(await ev(`[active(), !!card('criterion_form').querySelector('[role="menu"]')]`), ['menu-toggle', false], `${tag}: Escape closes the menu, focus on its button`);
    checks += 4;

    // Enter on the button opens the menu, Enter on 접기 collapses: one row, focus on 다시 보기.
    await press('Enter');
    assert.equal(await ev('active()'), 'collapse', `${tag}: Enter opens the menu`);
    await press('Enter'); await settle();
    const col = await ev(`(()=>{const c=card('criterion_form'),b=c.querySelector('[data-block-restore]'),r=b.getBoundingClientRect();return {collapsed:c.dataset.blockCollapsed!==undefined,text:c.querySelector('.hp-block-collapsed-name').textContent,name:b.getAttribute('aria-label'),words:b.textContent,big:r.width>=44&&r.height>=44,state:!!c.querySelector('.hp-material-state'),bodyHidden:c.querySelector('.hp-block-card-body').hidden,surface:!!c.querySelector('[data-surface="criterion_form"]'),toggle:!!c.querySelector('[data-block-toggle]')}})()`);
    assert.deepEqual(col, { collapsed: true, text: `접은 자료: ${title}`, name: `다시 보기: ${title}`, words: '다시 보기', big: true, state: false, bodyHidden: true, surface: true, toggle: false }, `${tag}: collapsed row`);
    assert.equal(await ev('active()'), 'restore', `${tag}: focus moves to 다시 보기`);
    assert.equal(await ev('hostMsgs()'), before, `${tag}: menu and 접기 send nothing to the host`);
    assert.equal(await ev('((window.__vs.lessonBlocksCollapsed||{}).keys||[]).length'), 1, `${tag}: one collapsed key in the webview state`);
    checks += 4;

    // A re-mount (webview hidden and shown) keeps it collapsed. 다시 보기 by keyboard restores it.
    await ev(`remount(${JSON.stringify(config)})`);
    await waitFor(`card('criterion_form')`, `${tag} criterion block after re-mount`);
    assert.equal(await ev(`card('criterion_form').dataset.blockCollapsed!==undefined`), true, `${tag}: still collapsed after a re-mount`);
    const before1 = await ev('hostMsgs()');
    await ev(`card('criterion_form').querySelector('[data-block-restore]').focus()`);
    await press('Enter'); await settle();
    assert.deepEqual(await ev(`[card('criterion_form').dataset.blockCollapsed===undefined, !!card('criterion_form').querySelector('.hp-material-state'), active(), ((window.__vs.lessonBlocksCollapsed||{}).keys||[]).length]`), [true, true, 'menu-toggle', 0], `${tag}: restored, state line back, focus on the menu button, nothing left collapsed`);
    assert.equal(await ev('hostMsgs()'), before1, `${tag}: 다시 보기 sends nothing to the host`);
    checks += 3;

    // Collapsing one step's block leaves another step's block shown.
    if (await ev(`card('criterion_form').querySelector('[data-block-toggle]').getAttribute('aria-expanded')==='false'`)) { await ev(`card('criterion_form').querySelector('[data-block-toggle]').click()`); await settle(); }
    await ev(`card('criterion_form').querySelector('[data-block-menu-toggle]').click()`); await settle();
    await ev(`card('criterion_form').querySelector('[data-block-collapse]').click()`); await settle();
    await ev(`document.querySelector('button[data-step-id="build"]').click()`);
    await waitFor(`card('decision_form')`, `${tag} decision block`);
    assert.equal(await ev(`card('decision_form').dataset.blockCollapsed===undefined`), true, `${tag}: another step's block is shown`);
    checks += 1;

    // On the decision step: open the card, collapse, restore by keyboard. It comes back open, with focus on the menu button.
    await ev(`card('decision_form').querySelector('[data-block-toggle]').click()`); await settle();
    const before2 = await ev('hostMsgs()');
    await ev(`card('decision_form').querySelector('[data-block-menu-toggle]').focus()`);
    await press('Enter'); await press('Enter'); await settle();
    assert.equal(await ev(`card('decision_form').dataset.blockCollapsed!==undefined && active()==='restore'`), true, `${tag}: decision block collapsed`);
    await press('Enter'); await settle();
    const back = await ev(`(()=>{const c=card('decision_form');return [c.dataset.blockCollapsed===undefined,c.querySelector('[data-block-toggle]').getAttribute('aria-expanded'),!c.querySelector('.hp-block-card-body').hidden,!!c.querySelector('.hp-material-state'),active()]})()`);
    assert.deepEqual(back, [true, 'true', true, true, 'menu-toggle'], `${tag}: 다시 보기 restores the open card, state line and focus`);
    assert.equal(await ev('hostMsgs()'), before2, `${tag}: 접기 and 다시 보기 send nothing to the host`);
    checks += 3;

    // Closing the card closes its menu and removes the button; the closed card is one row again.
    await ev(`card('decision_form').querySelector('[data-block-menu-toggle]').click()`); await settle();
    await ev(`card('decision_form').querySelector('[data-block-toggle]').click()`); await settle();
    assert.deepEqual(await ev(`[!!card('decision_form').querySelector('[role="menu"]'), !!card('decision_form').querySelector('[data-block-menu-toggle]'), card('decision_form').getBoundingClientRect().height<=72]`), [false, false, true], `${tag}: closing the card closes its menu, one row`);
    await ev(`card('decision_form').querySelector('[data-block-toggle]').click()`); await settle();
    checks += 1;

    // A new lesson version starts with every block shown, though this version still has a collapsed block.
    await ev(`card('decision_form').querySelector('[data-block-menu-toggle]').click()`); await settle();
    await ev(`card('decision_form').querySelector('[data-block-collapse]').click()`); await settle();
    assert.equal(await ev('((window.__vs.lessonBlocksCollapsed||{}).keys||[]).length'), 2, `${tag}: two collapsed keys`);
    await ev(`remount(${JSON.stringify(nextVersion)})`);
    await waitFor(`document.querySelector('[data-block-card]')`, `${tag} next version block`);
    assert.equal(await ev(`document.querySelectorAll('[data-block-collapsed]').length`), 0, `${tag}: a new lesson version shows its blocks`);
    checks += 2;

    // A shared classroom PC: learner A collapses a block, then learner B signs in on the same window (no reload). B sees every
    // block, and A's set is cleared from the webview state rather than hidden, so A finds it shown again too.
    const collapseCriterion = async () => {
      await waitFor(`card('criterion_form')`, `${tag} criterion block`);
      if (await ev(`card('criterion_form').querySelector('[data-block-toggle]').getAttribute('aria-expanded')==='false'`)) { await ev(`card('criterion_form').querySelector('[data-block-toggle]').click()`); await settle(); }
      await ev(`card('criterion_form').querySelector('[data-block-menu-toggle]').click()`); await settle();
      await ev(`card('criterion_form').querySelector('[data-block-collapse]').click()`); await settle();
    };
    // The seat before A (this lesson without a Service seat id) left blocks collapsed; A is another learner and sees none.
    await ev(`remount(${JSON.stringify(seatA)})`); await waitFor(`card('criterion_form')`, `${tag} learner A`); await settle();
    assert.equal(await ev(`document.querySelectorAll('[data-block-collapsed]').length`), 0, `${tag}: learner A does not inherit the previous seat's collapsed blocks`);
    await collapseCriterion();
    assert.equal(await ev(`card('criterion_form').dataset.blockCollapsed!==undefined`), true, `${tag}: learner A collapsed the block`);
    // Host traffic across a seat switch equals a same-seat re-mount's (the control): a seat change posts nothing extra and
    // fetches nothing, so it is never a host event.
    const traffic = async (next, what) => {
      const p0 = await ev('posted.length'), f0 = await ev('window.__fetches');
      await ev(`remount(${JSON.stringify(next)})`); await waitFor(`card('criterion_form')`, `${tag} ${what}`); await settle(); await settle();
      return { types: await ev(`posted.slice(${p0}).map(m=>m.type).sort()`), fetches: (await ev('window.__fetches')) - f0 };
    };
    const same = await traffic(seatA, 'A again');
    assert.equal(await ev(`card('criterion_form').dataset.blockCollapsed!==undefined`), true, `${tag}: the same learner keeps it across a re-mount (control)`);
    const switched = await traffic(seatB, 'learner B');
    assert.deepEqual(switched, same, `${tag}: a seat switch sends the host exactly what a same-seat re-mount sends, and fetches nothing`);
    assert.equal(switched.fetches, 0, `${tag}: no fetch across a seat switch`);
    assert.deepEqual(await ev(`[document.querySelectorAll('[data-block-collapsed]').length, JSON.stringify(window.__vs.lessonBlocksCollapsed)]`), [0, JSON.stringify({ seat: 'seat:' + 'b'.repeat(64), keys: [] })], `${tag}: learner B sees every block; A's set is cleared`);
    await ev(`remount(${JSON.stringify(seatA)})`); await waitFor(`card('criterion_form')`, `${tag} A after B`);
    assert.equal(await ev(`document.querySelectorAll('[data-block-collapsed]').length`), 0, `${tag}: A's set did not survive B's sign-in`);
    checks += 7;

    // An empty seat is not a learner: its collapsed set works in memory but is never stored, and switching to it clears the
    // previous seat's stored set. A re-mount without a seat starts with every block shown (no shared bucket).
    await collapseCriterion();
    assert.equal(JSON.parse(await ev('JSON.stringify(window.__vs.lessonBlocksCollapsed)')).keys.length, 1, `${tag}: A stored one collapsed key`);
    await ev(`remount(${JSON.stringify(noSeat)})`); await waitFor(`card('criterion_form')`, `${tag} no seat`); await settle();
    assert.deepEqual(await ev(`[document.querySelectorAll('[data-block-collapsed]').length, window.__vs.lessonBlocksCollapsed]`), [0, null], `${tag}: no seat: nothing shown collapsed and A's stored set cleared`);
    await collapseCriterion();
    assert.deepEqual(await ev(`[card('criterion_form').dataset.blockCollapsed!==undefined, window.__vs.lessonBlocksCollapsed]`), [true, null], `${tag}: no seat: collapsed in this view, nothing stored`);
    await ev(`remount(${JSON.stringify(noSeat)})`); await waitFor(`card('criterion_form')`, `${tag} no seat again`); await settle();
    assert.equal(await ev(`document.querySelectorAll('[data-block-collapsed]').length`), 0, `${tag}: no seat: a re-mount does not bring it back`);
    checks += 4;
  }
  console.log(`PASS learning-block-collapse-browser: ${checks} checks (light/dark, 800/1420 px)`);
} finally { await browser.close(); }
