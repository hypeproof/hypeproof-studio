// CGP-ART-D-002 / DES-ART-02 (extends CGP-ART-R-002, AE-15) — the review bar pinned at the bottom of the
// preview. Real preview host and shell; the chat host's revert and keep are reused, never duplicated.
//   host:    the bar mirrors the chat review, presses reach the chat review only for the current turn and
//            only while open, a revert result is shown once (toast) and reloads a watched file.
//   shell:   headless Chromium, 320/800/1420, both themes, forced colours, reduced motion: copy, ≤48 px,
//            never covers the page, arrow keys move it and Home resets, toast 4 s with role=status,
//            hostile frames cannot drive it.
//   wiring:  chatPanelProvider posts the same review to the preview and routes presses to
//            handleTurnReviewMessage; 바뀐 곳 보기 opens the chat review at the file.
// Run: node --experimental-strip-types test/preview-review-bar.smoke.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { previewReviewBar } from '../src/turnReviewView.ts';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));

// ── pure: what the preview bar carries ──
const view = (o = {}) => ({ turnId: 't1', state: 'open', added: ['a.html'], changed: ['b.css', 'c.js'], deleted: [], notCovered: [], ...o });
assert.equal(previewReviewBar(null), null);
assert.deepEqual(previewReviewBar(view()), { turnId: 't1', state: 'open', count: 3 });
assert.equal(previewReviewBar(view({ added: [], changed: [] })), null, 'no bar for a turn that changed nothing');
assert.deepEqual(previewReviewBar(view({ notice: '진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요.' })).notice, '진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요.');
assert.equal(previewReviewBar(view({ state: 'restored' })).state, 'restored');
assert.ok(!('files' in previewReviewBar(view({ files: [{ path: 'a.html', lines: [] }] }))), 'no paths or contents cross to the preview');
console.log('preview review bar pure PASS');

// ── host: real PreviewProvider with a vscode stub ──
let receive, save, panel;
const messages = [];
const fired = [];
const vscode = {
  EventEmitter: class { constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; } fire(v) { for (const f of this.l) f(v); } },
  ViewColumn: { Beside: 2 },
  Uri: { joinPath: (u) => u },
  workspace: { workspaceFolders: [], onDidSaveTextDocument: f => { save = f; return { dispose() {} }; }, fs: { readFile: async () => Buffer.from('<p>reverted</p>') } },
  window: { createWebviewPanel: () => panel = { reveal() {}, onDidDispose: () => {}, webview: {
    cspSource: 'https://test.invalid', html: '', asWebviewUri: u => u.fsPath,
    onDidReceiveMessage: f => { receive = f; }, postMessage: m => { messages.push(m); },
  } } },
};
const bundled = await build({ entryPoints: [`${root}/src/previewProvider.ts`], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const mod = { exports: {} };
vm.runInNewContext(bundled.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? vscode : require(id), Buffer, console });
const preview = new mod.exports.PreviewProvider({});
assert.equal(typeof preview.setReviewBar, 'function', 'preview exposes the review bar');
assert.equal(typeof preview.onReviewAction, 'function', 'preview reports review presses');
preview.onReviewAction((a) => fired.push(JSON.parse(JSON.stringify(a))));
const last = () => JSON.parse(JSON.stringify(messages.filter(m => m.type === 'previewReviewState').at(-1) ?? null)) ?? undefined;
preview.setReviewBar({ turnId: 't1', state: 'open', count: 3 });
await preview.show('<p>page</p>');
assert.equal(last(), undefined, 'nothing is posted before the shell is ready');
receive({ type: 'previewReady' });
assert.deepEqual(last().bar, { turnId: 't1', state: 'open', count: 3 }, 'ready shell gets the current bar');
receive({ type: 'preview_review_action', action: 'revert', turnId: 'old' });
receive({ type: 'preview_review_action', action: 'delete', turnId: 't1' });
assert.equal(fired.length, 0, 'another turn or an unknown action is ignored');
receive({ type: 'preview_review_action', action: 'revert', turnId: 't1' });
receive({ type: 'preview_review_action', action: 'show', turnId: 't1' });
assert.deepEqual(fired, [{ action: 'revert', turnId: 't1' }, { action: 'show', turnId: 't1' }]);
preview.setReviewBar({ turnId: 't1', state: 'restoring', count: 3 });
receive({ type: 'preview_review_action', action: 'keep', turnId: 't1' });
assert.equal(fired.length, 2, 'no keep or revert while restoring');
// A watched file is reloaded after the revert; the toast is posted once even if the host re-sends it.
let reads = 0;
preview.watchForReload({ fsPath: '/w/index.html' }, async () => { reads++; return '<p>reverted page</p>'; });
const renders = messages.filter(m => m.type === 'renderPreview').length;
preview.setReviewBar({ turnId: 't1', state: 'restored', count: 3 });
await new Promise(r => setTimeout(r, 0));
assert.deepEqual(last().bar, { turnId: 't1', state: 'restored', count: 3, stale: false }, 'reloaded page: plain toast');
assert.equal(reads, 1, 'the watched file is read again after a revert');
assert.ok(messages.filter(m => m.type === 'renderPreview').length > renders && messages.filter(m => m.type === 'renderPreview').at(-1).html.includes('reverted page'), 'the reverted page is shown');
preview.setReviewBar({ turnId: 't1', state: 'restored', count: 3 });
assert.equal(last().bar, null, 'a re-sent result does not toast again');
receive({ type: 'preview_review_action', action: 'revert', turnId: 't1' });
assert.equal(fired.length, 2, 'no press after the result');
// A revert that removed the watched file (the AI created it): the read fails, so the toast says so.
preview.watchForReload({ fsPath: '/w/new.html' }, async () => { throw new Error('ENOENT'); });
preview.setReviewBar({ turnId: 't3', state: 'restored', count: 1 });
await new Promise(r => setTimeout(r, 0));
assert.equal(last().bar.stale, true, 'a failed reload is not claimed as the reverted page');
await preview.show('<p>generated</p>');
preview.setReviewBar({ turnId: 't2', state: 'restored', count: 1 });
await new Promise(r => setTimeout(r, 0));
assert.equal(last().bar.stale, true, 'a generated preview says it was not reloaded');
preview.setReviewBar(null);
assert.equal(last().bar, null);
void save;
const shell = panel.webview.html;
console.log('preview review bar host PASS: mirror, ready re-post, turn/state gates, one toast, reload');

// ── wiring: one undo, the chat review's own ──
const src = readFileSync(`${root}/src/chatPanelProvider.ts`, 'utf8');
const post = src.slice(src.indexOf('private postTurnReview(): void {'), src.indexOf('private async enrichPageCard'));
assert.match(post, /this\.preview\?\.setReviewBar\(this\._instructorMode\?\.isInstructor \? null : previewReviewBar\(view\)\)/, 'postTurnReview mirrors the task-scoped review to the preview');
assert.match(post, /await this\.handleTurnReviewMessage\(\{ type: a\.action === "revert" \? "turnRevert" : "turnKeep", turnId: a\.turnId \}\)/, 'presses reuse the chat revert and keep');
assert.match(post, /type: "turnReviewShow"/, '바뀐 곳 보기 opens the chat review');
assert.match(readFileSync(`${root}/src/extension.ts`, 'utf8'), /preview\.onReviewAction\(\(a\) => void provider\.handlePreviewReviewAction\(a\)\)/);
assert.match(readFileSync(`${root}/webview-ui/src/ChatPanel.tsx`, 'utf8'), /msg\.type === "turnReviewShow" && msg\.path\)[^\n]*setReviewFocus/);
console.log('preview review bar wiring PASS');

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER) throw new Error('no Chromium'); console.log('preview review bar browser NOT RUN'); process.exit(0); }
const browser = await launch(bin);
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms));
const inShell = expr => browser.evaluate(`(()=>{const S=document.getElementById('shell').contentWindow;const D=S.document;return (${expr});})()`);
const send = async data => { await browser.evaluate(`document.getElementById('shell').contentWindow.postMessage(${JSON.stringify(data)},'*')`); await settle(); };
const geometry = () => inShell(`(()=>{const s=D.querySelector('#review-strip'),b=D.querySelector('#review-bar'),f=D.querySelector('#frame').getBoundingClientRect(),r=s.getBoundingClientRect(),br=b.getBoundingClientRect();
  return {stripHidden:s.hidden,barHidden:b.hidden,top:r.top,height:r.height,frameBottom:f.bottom,barLeft:br.left,barRight:br.right,docWidth:D.documentElement.scrollWidth,viewWidth:S.innerWidth,
    title:D.querySelector('#review-title').textContent,notice:D.querySelector('#review-notice').hidden?'':D.querySelector('#review-notice').textContent,toast:D.querySelector('#review-toast').textContent,live:D.querySelector('#review-live').textContent,
    buttons:[...D.querySelectorAll('#review-actions button')].filter(x=>!x.hidden).map(x=>{const q=x.getBoundingClientRect(),c=S.getComputedStyle(x);return {label:x.textContent,w:q.width,h:q.height,font:parseFloat(c.fontSize),cls:x.className,disabled:x.disabled}})}})()`);
const hostileInner = `<p>미리보기</p><script>parent.postMessage({type:'previewReviewState',bar:null},'*');parent.postMessage({type:'previewReviewState',bar:{turnId:'evil',state:'open',count:99}},'*');<\/script>`;
try {
  for (const width of [320, 800, 1420]) for (const theme of ['Dark+', 'Light+']) for (const forcedColors of [false, true]) {
    const vars = Object.entries(THEMES[theme]).filter(([, v]) => typeof v === 'string' && v.startsWith('#')).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    // CSP is removed only for this test's API shim; production CSP is covered by csp-sandbox.
    const html = shell.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '').replace('<head>', `<head><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m)});window.parent=window;window.top=window;</script><style>:root{${vars}}</style>`);
    await browser.load(`<!doctype html><html><head><style>html,body{margin:0;height:100%}#shell{width:100vw;height:100vh;border:0;display:block}</style></head><body><iframe id="shell"></iframe></body></html>`, { width, forcedColors, dark: theme === 'Dark+' });
    await browser.evaluate(`document.getElementById('shell').srcdoc=${JSON.stringify(html)};true`);
    for (let i = 0; i < 50 && !(await inShell(`Array.isArray(S.posted)&&D.readyState==='complete'`)); i++) await settle();
    const tag = JSON.stringify({ width, theme, forcedColors });
    assert.equal((await geometry()).stripHidden, true, 'no bar before the host sends one');
    // The host bar arrives first; the framed page then tries to hide and replace it (and to press).
    await send({ type: 'previewReviewState', bar: { turnId: 't1', state: 'open', count: 3 } });
    await send({ type: 'renderPreview', revision: 1, html: hostileInner });
    await settle(300);
    assert.equal(await inShell(`S.posted.filter(m=>m.type==='preview_review_action').length`), 0, 'the framed page cannot press');
    let g = await geometry();
    assert.equal(g.title, 'AI가 3곳을 바꿨어요', tag);
    assert.deepEqual(g.buttons.map(b => [b.label, b.cls]), [['바뀐 곳 보기', 'secondary'], ['되돌리기', 'secondary'], ['이대로 둘게요', 'primary']], tag);
    for (const b of g.buttons) assert.ok(b.w >= 44 && b.h >= 44 && b.font >= 14, `${tag} ${JSON.stringify(b)}`);
    assert.ok(g.frameBottom <= g.top + 0.5, `${tag} the bar never covers the page`);
    assert.ok(g.docWidth <= g.viewWidth, `${tag} no horizontal scroll`);
    if (width >= 800) assert.ok(g.height <= 48, `${tag} bar height ${g.height}`);
    assert.equal(await inShell(`D.querySelector('#review-bar').getAttribute('aria-describedby')`), 'review-move-hint');
    // A framed page cannot hide or replace the bar.
    await inShell(`(D.querySelector('#frame').contentWindow.postMessage('x','*'),true)`);
    // Keyboard: arrows move it inside the strip, Home resets.
    if (width >= 800) {
      const start = g.barLeft;
      await inShell(`(D.querySelector('#review-keep').focus(),true)`);
      for (let i = 0; i < 3; i++) await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
      await settle();
      g = await geometry();
      assert.ok(Math.abs(g.barLeft - (start - 72)) < 1, `${tag} ArrowLeft moves the bar: ${start} -> ${g.barLeft}`);
      for (let i = 0; i < 200; i++) await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await settle();
      g = await geometry();
      assert.ok(g.barRight <= g.viewWidth, `${tag} the bar stays inside the preview`);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
      await settle();
      g = await geometry();
      assert.ok(Math.abs(g.barLeft - start) < 1, `${tag} Home resets`);
    }
    // Presses post the turn id; keep/revert are single-flight until the host answers.
    await inShell(`(D.querySelector('#review-show').click(),D.querySelector('#review-revert').click(),D.querySelector('#review-revert').click(),D.querySelector('#review-keep').click(),true)`);
    assert.deepEqual(await inShell(`S.posted.filter(m=>m.type==='preview_review_action')`),
      [{ type: 'preview_review_action', action: 'show', turnId: 't1' }, { type: 'preview_review_action', action: 'revert', turnId: 't1' }], tag);
    await send({ type: 'previewReviewState', bar: { turnId: 't1', state: 'restoring', count: 3 } });
    g = await geometry();
    assert.equal(g.title, '되돌리는 중…');
    assert.deepEqual(g.buttons.map(b => b.disabled), [false, true, true]);
    await send({ type: 'previewReviewState', bar: { turnId: 't1', state: 'open', count: 3, notice: '진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요.' } });
    g = await geometry();
    assert.equal(g.title, 'AI가 3곳을 바꿨어요', 'the count stays with a notice');
    assert.equal(g.notice, '진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요.', 'a refusal is shown, not swallowed');
    // The longest standing notice (a large folder's tracked turn) keeps the bar at 48 px.
    const tracked = '작업 폴더가 커서 이번 요청은 AI가 쓰거나 고친 파일만 보관했어요. 명령 실행으로 바뀐 파일은 되돌릴 수 없어요.';
    await send({ type: 'previewReviewState', bar: { turnId: 't1', state: 'open', count: 3, notice: tracked } });
    g = await geometry();
    assert.equal(g.title, 'AI가 3곳을 바꿨어요');
    assert.equal(g.notice, tracked);
    if (width >= 800) assert.ok(g.height <= 48, `${tag} bar height with a notice ${g.height}`);
    assert.ok(g.docWidth <= g.viewWidth, `${tag} no horizontal scroll with a notice`);
    // Revert result: toast "되돌렸어요" with role=status for 4 s, then the strip goes away.
    await send({ type: 'previewReviewState', bar: { turnId: 't1', state: 'restored', count: 3, stale: false } });
    g = await geometry();
    assert.equal(g.barHidden, true);
    assert.equal(g.toast, '되돌렸어요');
    assert.equal(g.live, '되돌렸어요', 'announced through the always-present status region');
    assert.equal(await inShell(`D.querySelector('#review-live').getAttribute('role')`), 'status');
    assert.equal(await inShell(`D.querySelector('#review-live').closest('[hidden]')`), null, 'the status region is never inside a hidden container');
    assert.ok(g.frameBottom <= g.top + 0.5, `${tag} the toast never covers the page`);
    if (width === 800 && theme === 'Dark+' && !forcedColors) {
      await settle(3400);
      assert.equal((await geometry()).toast, '되돌렸어요', 'still shown before 4 s');
      await settle(800);
      g = await geometry();
      assert.equal(g.toast, '');
      assert.equal(g.live, '');
      assert.equal(g.stripHidden, true, 'the strip leaves after the toast');
    }
    await send({ type: 'previewReviewState', bar: { turnId: 't2', state: 'failed', count: 2 } });
    g = await geometry();
    assert.equal(g.title, '되돌리지 못했어요. 채팅에서 확인해 주세요.');
    assert.deepEqual(g.buttons.map(b => b.label), ['채팅에서 보기'], 'a failed revert offers no second revert here');
    await send({ type: 'previewReviewState', bar: { turnId: 'x', state: 'open', count: 'lots' } });
    assert.equal((await geometry()).stripHidden, true, 'a malformed bar is not shown');
    await send({ type: 'previewReviewState', bar: null });
    assert.equal((await geometry()).stripHidden, true);
  }
  // Motion: ≤150 ms, none with reduced motion.
  const motion = async (reduce) => {
    const html = shell.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '').replace('<head>', `<head><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m)});window.parent=window;window.top=window;</script>`);
    await browser.load(`<!doctype html><html><head><style>html,body{margin:0;height:100%}#shell{width:100vw;height:100vh;border:0;display:block}</style></head><body><iframe id="shell"></iframe></body></html>`, { width: 800 });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
    await browser.evaluate(`document.getElementById('shell').srcdoc=${JSON.stringify(html)};true`);
    for (let i = 0; i < 50 && !(await inShell(`Array.isArray(S.posted)&&D.readyState==='complete'`)); i++) await settle();
    await send({ type: 'previewReviewState', bar: { turnId: 'm', state: 'open', count: 1 } });
    return inShell(`(()=>{const c=S.getComputedStyle(D.querySelector('#review-bar'));return {name:c.animationName,ms:parseFloat(c.animationDuration)*1000}})()`);
  };
  const normal = await motion(false);
  assert.ok(normal.name === 'hp-review-in' && normal.ms > 0 && normal.ms <= 150, JSON.stringify(normal));
  assert.equal((await motion(true)).name, 'none', 'no motion with reduced motion');
  console.log('preview review bar shell PASS: 12 configurations, copy, ≤44px targets, never covers the page, move/Home, single flight, toast 4 s, failed, malformed, motion');
} finally {
  await browser.close?.();
}
