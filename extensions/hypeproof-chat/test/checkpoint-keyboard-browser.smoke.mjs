// CGP-AGENT-D-023 / DES-CGP-AGENT-53 (REQ-STUDIO-CHECKPOINT): the checkpoint form driven by real key events in
// headless Chromium, and its primary action measured on the real markup.
//   node --experimental-strip-types test/checkpoint-keyboard-browser.smoke.mjs
//
// The real webview entry (main.tsx) is bundled and gets the 바뀐 것 review of a turn with a checkpoint offer.
// Keys and IME composition go through the DevTools protocol into the headless page (Input.dispatchKeyEvent,
// Input.imeSetComposition, Input.insertText), never to the OS.
//   - Enter on 저장 지점 남기기 opens the form with the suggestion in the textarea, focused and wholly selected;
//     typed text replaces it.
//   - Enter inserts a newline and saves nothing. Cmd+Enter or Ctrl+Enter while a Hangul syllable is still being
//     composed (isComposing), or reported with the keyCode 229 that macOS Chrome gives the commit keystroke, saves nothing and leaves the
//     composed text in the field. Cmd+Enter and Ctrl+Enter save the exact text once each, without a newline.
//   - The form's only buttons, as the browser's accessibility tree names them, are 저장 지점 남기기 and 취소:
//     no push, publish, upload or commit control. 저장 지점 남기기 comes first and is the primary: it takes the
//     theme's button fill while 취소 stays transparent, and its keyboard ring sits outside its fill (2px).
// test/checkpoint.test.tsx holds the same contract on mini-dom; test/checkpoint-layout.smoke.mjs measures 44px,
// 14px and the ring across seats, themes and widths. Without a headless Chromium this prints NOT RUN;
// FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('checkpoint-keyboard: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('checkpoint-keyboard NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');

const temp = mkdtempSync(path.join(tmpdir(), 'hps-checkpoint-keyboard-'));
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

const BUTTON_FILL = 'rgb(0, 120, 212)';
const THEME = '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;';
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const CONFIG = {
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-site', name: '홈페이지', kind: 'personal', workspace: '/synthetic', verified: true },
};
const SUGGESTION = '메인 페이지에 예약 버튼을 추가했어요.';
const VIEW = { turnId: 't1', state: 'open', added: [], changed: ['index.html'], deleted: [], notCovered: [], checkpoint: { suggestion: SUGGESTION, source: 'ai', history: [] } };

const KEYS = { Enter: 13, Tab: 9 };
const MOD = { meta: 4, ctrl: 2 };
const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const b = await launch(bin);
await b.send('Accessibility.enable');
async function press(name, { modifiers = 0, keyCode = KEYS[name], text = name === 'Enter' ? '\r' : undefined } = {}) {
  const common = { key: name, code: name, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await b.send('Input.dispatchKeyEvent', { type: text && !modifiers ? 'keyDown' : 'rawKeyDown', ...common, ...(text && !modifiers ? { text } : {}) });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  await pause();
}
const state = () => b.evaluate(`(() => { const f = document.querySelector('#hps-checkpoint-message');
  return { open: !!f, active: !!f && document.activeElement === f, value: f?.value ?? null, selStart: f?.selectionStart ?? -1, selEnd: f?.selectionEnd ?? -1,
    saves: window.sent.filter((m) => m.type === 'checkpointSave').map((m) => ({ turnId: m.turnId, message: m.message })) }; })()`);

async function openPage() {
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1420, height: 900, deviceScaleFactor: 1, mobile: false });
  const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
    document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEME)};
      document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-dark'); });` });
  try {
    await b.send('Page.navigate', { url: base });
    for (let i = 0; i < 100 && !(await b.evaluate(`!!window.sent && window.sent.some((m) => m.type === 'ready')`).catch(() => false)); i++) await pause(100);
    await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(CONFIG)} } }))`);
    await pause(200);
    await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'turnReviewState', view: ${JSON.stringify(VIEW)} } }))`);
    for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-checkpoint button')`)); i++) await pause(100);
  } finally { await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
}

const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); };
try {
  await openPage();
  // Open the form from the keyboard.
  await b.evaluate(`[...document.querySelectorAll('.hps-checkpoint button')].find((x) => x.textContent === '저장 지점 남기기')?.focus()`);
  await press('Enter');
  let s = await state();
  expect(s.open && s.active, `Enter on 저장 지점 남기기 did not open the form with the textarea focused (${JSON.stringify(s)})`);
  expect(s.value === SUGGESTION && s.selStart === 0 && s.selEnd === SUGGESTION.length, `the suggestion is not prefilled and wholly selected (${JSON.stringify(s)})`);
  expect(s.saves.length === 0, 'opening the form saved');

  // The form's controls as the browser's accessibility tree sees them, and the primary's paint.
  // Every control in the 바뀐 것 review section, named by the browser's accessibility tree (the composer's own
  // 보내기 sends a chat message and is outside the section).
  const { result: list } = await b.send('Runtime.evaluate', { expression: `[...document.querySelector('[data-testid="turn-review"]').querySelectorAll('button, a, [role="button"], [role="link"]')]` });
  const { result: props } = await b.send('Runtime.getProperties', { objectId: list.objectId, ownProperties: true });
  const nodes = [];
  for (const p of props.filter((x) => /^\d+$/.test(x.name))) nodes.push(...(await b.send('Accessibility.getPartialAXTree', { objectId: p.value.objectId, fetchRelatives: false })).nodes.filter((n) => !n.ignored).slice(0, 1));
  const formButtons = await b.evaluate(`[...document.querySelectorAll('.hps-checkpoint-form button, .hps-checkpoint-form a, .hps-checkpoint-form [role="button"], .hps-checkpoint-form [role="link"]')].map((e) => e.textContent.trim())`);
  const axButtons = nodes.filter((n) => !n.ignored && ['button', 'link'].includes(n.role?.value)).map((n) => n.name?.value);
  expect(JSON.stringify(formButtons) === JSON.stringify(['저장 지점 남기기', '취소']), `the form's controls are ${JSON.stringify(formButtons)}, want exactly 저장 지점 남기기 then 취소`);
  expect(axButtons.includes('저장 지점 남기기') && axButtons.includes('취소'), `the accessibility tree does not name both actions (${JSON.stringify(axButtons)})`);
  const pushLike = axButtons.filter((n) => /올리기|푸시|push|게시|커밋|commit|보내기|업로드|upload|publish|배포/i.test(n ?? ''));
  expect(pushLike.length === 0, `a push-like control is in the review section: ${JSON.stringify(pushLike)}`);
  const paint = await b.evaluate(`(() => { const [save, cancel] = document.querySelectorAll('.hps-checkpoint-form .hps-turn-review-actions button');
    const cs = (e) => getComputedStyle(e); return { saveClass: save.className, save: cs(save).backgroundColor, saveInk: cs(save).color, cancel: cs(cancel).backgroundColor }; })()`);
  expect(paint.saveClass === 'hps-checkpoint-save' && paint.save === BUTTON_FILL && paint.saveInk === 'rgb(255, 255, 255)', `저장 지점 남기기 is not drawn as the primary (${JSON.stringify(paint)})`);
  expect(paint.cancel === 'rgba(0, 0, 0, 0)', `취소 is filled (${paint.cancel}); only the primary takes the fill`);

  // Typing replaces the selected suggestion; Enter is a newline and never saves.
  await b.send('Input.insertText', { text: '예약 버튼' });
  await pause();
  await press('Enter');
  s = await state();
  expect(s.value === '예약 버튼\n', `typing did not replace the selection or Enter did not insert a newline (${JSON.stringify(s.value)})`);
  expect(s.saves.length === 0, `plain Enter saved ${JSON.stringify(s.saves)}`);

  // A Hangul syllable still being composed: neither modified Enter saves, and the composed text stays.
  await b.send('Input.imeSetComposition', { text: '추', selectionStart: 1, selectionEnd: 1 });
  await pause();
  await press('Enter', { modifiers: MOD.meta });
  await press('Enter', { modifiers: MOD.ctrl, keyCode: 229 });
  s = await state();
  expect(s.saves.length === 0, `Cmd/Ctrl+Enter during IME composition saved ${JSON.stringify(s.saves)}`);
  await b.send('Input.insertText', { text: '추가' });
  await pause();
  s = await state();
  expect(s.value === '예약 버튼\n추가', `the composed text did not land in the field (${JSON.stringify(s.value)})`);
  // The commit keystroke macOS Chrome reports as keyCode 229 even once the composition has ended.
  await press('Enter', { modifiers: MOD.ctrl, keyCode: 229 });
  s = await state();
  expect(s.saves.length === 0, `Ctrl+Enter reported as keyCode 229 saved ${JSON.stringify(s.saves)}`);

  // Cmd+Enter and Ctrl+Enter save the exact text, once each, without adding a newline.
  await press('Enter', { modifiers: MOD.meta });
  s = await state();
  expect(JSON.stringify(s.saves) === JSON.stringify([{ turnId: 't1', message: '예약 버튼\n추가' }]), `Cmd+Enter saved ${JSON.stringify(s.saves)}, want one checkpointSave of the field text`);
  expect(s.value === '예약 버튼\n추가', `Cmd+Enter changed the field (${JSON.stringify(s.value)})`);
  await press('Enter', { modifiers: MOD.ctrl });
  s = await state();
  expect(s.saves.length === 2 && s.saves[1].message === '예약 버튼\n추가', `Ctrl+Enter did not save once (${JSON.stringify(s.saves)})`);

  // The primary's keyboard ring sits outside its fill, inside the scrolling transcript too.
  await press('Tab');
  const ring = await b.evaluate(`(() => { const e = document.activeElement, c = getComputedStyle(e); return { cls: e.className, style: c.outlineStyle, width: parseFloat(c.outlineWidth), offset: parseFloat(c.outlineOffset) }; })()`);
  expect(ring.cls === 'hps-checkpoint-save' && ring.style !== 'none' && ring.width >= 2 && ring.offset >= 2, `Tab from the field does not ring the primary outside its fill (${JSON.stringify(ring)})`);
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
if (failures.length) { console.error(failures.map((f) => '  FAIL ' + f).join('\n')); console.error(`checkpoint-keyboard: ${failures.length} failed`); process.exit(1); }
console.log('PASS checkpoint keyboard: the form opens focused with the suggestion selected; Enter is a newline; Cmd/Ctrl+Enter during IME composition saves nothing; Cmd+Enter and Ctrl+Enter save the exact text once; only 저장 지점 남기기 and 취소, the first filled as the primary with an outside ring');
