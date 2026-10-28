// CGP-KNOW-D-009 / DES-KNOW-14 (REQ-STUDIO-TASK-MOVE): the rail's task menu driven by the keyboard in headless
// Chromium, and what the browser's accessibility tree announces for it.
//   node --experimental-strip-types test/task-menu-keyboard-browser.smoke.mjs
//
// The real webview entry (main.tsx) is bundled and gets a personal task workspace with two tasks and a host move
// rule. Keys go through the DevTools protocol into the headless page (Input.dispatchKeyEvent), never to the OS.
//   - personal: ArrowDown on the toggle opens the menu on its first item; ArrowDown/ArrowUp wrap, Home/End jump;
//     Escape closes and returns focus to the toggle; Tab closes; Enter on an item posts exactly one taskMove.
//   - class: the one move item is reached by ArrowDown, keeps focus under every arrow key, and the browser's own
//     accessibility tree reports it as a focusable, disabled menuitem whose description is the reason; the reason
//     is drawn on screen while the item has focus; Enter and Space post nothing; Escape returns to the toggle.
// task-menu-computed.smoke.mjs measures the same menu's 44px rows, 14px text and focus ring.
// Self-test: the class checks are rerun after the DOM is broken three ways (no aria-describedby, `disabled`
// instead of aria-disabled, the reason hidden); each must be caught. Without a headless Chromium this prints
// NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('task-menu-keyboard: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('task-menu-keyboard NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');

const temp = mkdtempSync(path.join(tmpdir(), 'hps-task-menu-keyboard-'));
await build({
  entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEME = '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;';
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const CLASS_REASON = '수업 작업은 이 수업 활동 안에만 둘 수 있어요. 다른 활동으로 옮길 수 없어요.';
const MOVES = {
  personal: { allowed: true, destinations: [{ ref: 'ref-b', name: '그림 연습' }, { ref: 'ref-c', name: '홈페이지' }, { ref: 'ref-d', name: '발표 준비' }] },
  class: { allowed: false, reason: CLASS_REASON },
};
const config = (seat) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + seat, name: '내 작업', kind: 'personal', workspace: '/synthetic', verified: true },
  taskWorkspace: { scope: 's-' + seat, revision: 1, activeTaskId: 't1', sourceSelection: null, tasks: [
    { id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 2, messageCount: 2 },
    { id: 't2', title: '둘째 작업', createdAt: 1, updatedAt: 1, messageCount: 0 },
  ] },
  taskMove: MOVES[seat],
});

const KEYS = { ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Escape: 27, Enter: 13, Tab: 9, ' ': 32 };
const CODES = { ' ': 'Space' };
const TEXT = { Enter: '\r', ' ': ' ' };
const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const b = await launch(bin);
await b.send('Accessibility.enable');
async function press(name) {
  const common = { key: name, code: CODES[name] ?? name, windowsVirtualKeyCode: KEYS[name], nativeVirtualKeyCode: KEYS[name] };
  await b.send('Input.dispatchKeyEvent', { type: TEXT[name] ? 'keyDown' : 'rawKeyDown', ...common, ...(TEXT[name] ? { text: TEXT[name] } : {}) });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  await pause();
}
// What the page has focused, as the DOM and as the browser's accessibility tree see it.
async function focused() {
  const dom = await b.evaluate(`(() => { const e = document.activeElement, panel = document.querySelector('.tw-task-menu-panel');
    const id = e?.getAttribute('aria-describedby'), reason = id ? document.getElementById(id) : null, rb = reason?.getBoundingClientRect();
    return { open: !!panel, isToggle: !!e?.classList.contains('tw-task-menu-toggle'), toggleIndex: [...document.querySelectorAll('.tw-task-menu-toggle')].indexOf(e),
      item: e?.getAttribute('role') === 'menuitem' ? [...panel.querySelectorAll('[role="menuitem"]')].indexOf(e) : -1,
      reasonShown: !!reason && rb.width > 0 && rb.height > 0 && getComputedStyle(reason).visibility === 'visible' && getComputedStyle(reason).display !== 'none',
      sent: window.sent.filter((m) => m.type === 'taskMove').map((m) => ({ id: m.id, destination: m.destination })) }; })()`);
  const { result } = await b.send('Runtime.evaluate', { expression: 'document.activeElement' });
  // Focus on <body> or nowhere has no accessible node to read; report it as "nothing announced".
  const nodes = result.objectId ? (await b.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false }).catch(() => ({ nodes: [] }))).nodes : [];
  const node = nodes.find((n) => !n.ignored) ?? nodes[0] ?? {};
  const prop = (name) => node.properties?.find((p) => p.name === name)?.value?.value;
  return { ...dom, ax: { role: node.role?.value, name: node.name?.value, description: node.description?.value ?? '', disabled: prop('disabled') === true, focusable: prop('focusable') === true } };
}
async function openPage(seat) {
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1420, height: 900, deviceScaleFactor: 1, mobile: false });
  const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
    document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEME)};
      document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-dark'); });` });
  try {
    await b.send('Page.navigate', { url: base });
    for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await pause(100);
    await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(config(seat))} } }))`);
    for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.tw-task-menu-toggle')`)); i++) await pause(100);
  } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  await b.evaluate(`document.querySelector('.tw-task-menu-toggle').focus()`);
}

async function personal() {
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push('personal: ' + msg); };
  await openPage('personal');
  let f = await focused();
  expect(f.isToggle && !f.open, `the first task's menu toggle is not focused and closed (${JSON.stringify(f)})`);
  expect(f.ax.role === 'button' && f.ax.name === '작업 메뉴: 반 소개 페이지', `the toggle announces ${f.ax.role} "${f.ax.name}"`);
  await press('ArrowDown');
  f = await focused();
  expect(f.open && f.item === 0, `ArrowDown on the toggle did not open the menu on its first item (${JSON.stringify(f)})`);
  expect(f.ax.role === 'menuitem' && f.ax.name === '옮기기: 그림 연습' && !f.ax.disabled, `the first item announces ${JSON.stringify(f.ax)}`);
  for (const [key, want] of [['ArrowDown', 1], ['ArrowDown', 2], ['ArrowDown', 0], ['ArrowUp', 2], ['Home', 0], ['End', 2], ['ArrowUp', 1]]) {
    await press(key);
    f = await focused();
    expect(f.open && f.item === want, `${key} put focus on item ${f.item}, want ${want}`);
  }
  await press('Escape');
  f = await focused();
  expect(!f.open && f.isToggle && f.toggleIndex === 0, `Escape did not close the menu back onto its toggle (${JSON.stringify(f)})`);
  await press('Enter');
  f = await focused();
  expect(f.open && f.item === 0, `Enter on the toggle did not open the menu on its first item (${JSON.stringify(f)})`);
  await press('Tab');
  f = await focused();
  expect(!f.open, 'Tab did not close the menu');
  await b.evaluate(`document.querySelector('.tw-task-menu-toggle').focus()`);
  await press('ArrowDown'); await press('End');
  expect((await focused()).sent.length === 0, 'a taskMove was posted before any item was chosen');
  await press('Enter');
  f = await focused();
  expect(JSON.stringify(f.sent) === JSON.stringify([{ id: 't1', destination: 'ref-d' }]), `Enter on the last item posted ${JSON.stringify(f.sent)}, want one taskMove of t1 to ref-d`);
  expect(!f.open, 'the menu stayed open after a move was chosen');
  return failures;
}

// `breakDom` runs in the page after the menu opened: the self-test uses it to remove what the checks guard.
async function classTask(breakDom = '') {
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push('class: ' + msg); };
  await openPage('class');
  await press('ArrowDown');
  if (breakDom) { await b.evaluate(breakDom).catch(() => {}); await b.evaluate(`document.querySelector('.tw-task-menu-panel [role="menuitem"]')?.focus()`); await pause(); }
  let f = await focused();
  expect(f.open && f.item === 0, `ArrowDown on the toggle did not focus the move item (${JSON.stringify(f)})`);
  expect(f.ax.role === 'menuitem' && f.ax.name === '다른 활동으로 옮기기', `the move item announces ${f.ax.role} "${f.ax.name}"`);
  expect(f.ax.focusable, 'the browser does not report the move item as focusable');
  expect(f.ax.disabled, 'the browser does not report the move item as disabled');
  expect(f.ax.description === CLASS_REASON, `the move item's accessible description is "${f.ax.description}", want the reason`);
  expect(f.reasonShown, 'the reason is not drawn while the move item has focus');
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    await press(key);
    f = await focused();
    expect(f.open && f.item === 0, `${key} moved focus off the only item (${JSON.stringify(f)})`);
  }
  await press('Enter'); await press(' ');
  f = await focused();
  expect(f.sent.length === 0, `Enter or Space on the disabled item posted ${JSON.stringify(f.sent)}`);
  await press('Escape');
  f = await focused();
  expect(!f.open && f.isToggle, `Escape did not close the menu back onto its toggle (${JSON.stringify(f)})`);
  return failures;
}

const MUTANTS = {
  'the reason is not the description': `document.querySelector('.tw-task-menu-panel [aria-disabled]').removeAttribute('aria-describedby')`,
  'disabled instead of aria-disabled': `(() => { const e = document.querySelector('.tw-task-menu-panel [aria-disabled]'); e.removeAttribute('aria-disabled'); e.disabled = true; })()`,
  'the reason is hidden': `document.querySelector('.tw-task-menu-reason').style.display = 'none'`,
};

let failures = [];
try {
  failures.push(...await personal());
  failures.push(...await classTask());
  for (const [label, js] of Object.entries(MUTANTS)) {
    const caught = await classTask(js);
    if (caught.length === 0) failures.push(`self-test: "${label}" was not caught`);
    else console.log(`  self-test caught: ${label} (${caught.length}: ${caught[0]})`);
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
if (failures.length) { console.error(failures.map((f) => '  FAIL ' + f).join('\n')); console.error(`task-menu-keyboard: ${failures.length} failed`); process.exit(1); }
console.log('PASS task menu keyboard: arrows wrap, Home/End, Escape returns to the toggle, Tab closes, Enter moves once; the class item is a focusable, disabled menuitem described by its shown reason; Enter/Space send nothing; three broken DOMs caught');
