// CGP-LEARN-R-017 / REQ-CGP-LEARN-17 (DES-CGP-LEARN-17): keyboard triage of the /manage help-request queue, run on the
// REAL served page in headless Chromium with real key events through CDP (page-level input only: no OS input, no window).
// (a) J/K and ↓/↑ move the selection, Enter opens, E saves the open request as 답변 완료 and opens the next one;
// (b) "?" shows the inline shortcut sheet; (c) no shortcut fires in a text field or while Hangul is composing.
// Also measured: the selected row's 2px ring at >= 3:1, 44px targets for every action, forced colours, a re-render that
// keeps focus on the same request, a double press, and an answer that resolves after the instructor moved on.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('help-triage.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  help-triage.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
// The harness loads the page into about:blank, an insecure context without crypto.randomUUID (the served https page has it);
// without this shim the page's script stops at its first randomUUID call and never wires its handlers.
const SHIM = '<script>if (!crypto.randomUUID) crypto.randomUUID = () => "00000000-0000-4000-8000-" + String(Math.random()).slice(2, 14).padEnd(12, "0");</script>';
const served = await (await app.fetch(new Request('https://chalk.test/manage'), { ENVIRONMENT: 'test' })).text();
assert.ok(served.includes('<head>'), 'served /manage has a <head>');
const html = served.replace('<head>', '<head>' + SHIM);

// Page fixture: three open help requests in the open class, a mocked Service behind the page's own fetch, and the page's
// real renderHelp/openShare/answerAndNext. `refresh` is counted, not run (no network in this test).
const SETUP = `(() => {
  const now = Math.floor(Date.now() / 1000);
  const mk = (id, n) => ({ id, kind: 'help', session_id: 'S1', student_id: '학생-' + id, status: 'received', revision: 1, created_at: now - 60 * n, expires_at: now + 3600, feedback: '', next_action: '' });
  window.__shares = { r1: mk('r1', 1), r2: mk('r2', 2), r3: mk('r3', 3) };
  window.__calls = []; window.__gate = null; window.__refreshes = 0;
  window.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET', id = decodeURIComponent(String(url).split('/').pop());
    __calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
    if (__gate) await __gate;
    const row = __shares[id];
    if (method === 'PUT') { const b = JSON.parse(opts.body); row.status = b.status; row.revision++; row.feedback = b.feedback; row.next_action = b.next_action; }
    return { ok: true, status: 200, json: async () => ({ ...row, content: { question: '질문 ' + id } }) };
  };
  refresh = () => { __refreshes++; };
  token = 't'; cohort = 'c1'; board = { session: { session_id: 'S1' }, seats: [] };
  helpRows = Object.values(__shares).map((r) => ({ ...r })); helpState = 'ok'; helpCounts = { open: 3, answered: 0 }; helpExpanded = true;
  renderHelp(); return document.querySelectorAll('#ops-help-list li[data-help-id]').length;
})()`;

const KEYS = {
  j: { key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, text: 'j' },
  k: { key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, text: 'k' },
  e: { key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, text: 'e' },
  ㅓ: { key: 'ㅓ', code: 'KeyJ', windowsVirtualKeyCode: 74, text: 'ㅓ' },
  down: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  up: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  '?': { key: '?', code: 'Slash', windowsVirtualKeyCode: 191, text: '?', modifiers: 8 },
  esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  ime: { key: 'Process', code: 'KeyJ', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 },
  ctrlJ: { key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: 2 },
};
async function press(b, name) {
  const k = KEYS[name];
  await b.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...k });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k, text: undefined });
  await new Promise((r) => setTimeout(r, 30));
}
const focused = (b) => b.evaluate(`(() => { const a = document.activeElement; const li = a && a.closest('#ops-help-list li[data-help-id]'); return { id: li ? li.dataset.helpId : null, el: a ? (a.id || a.className || a.tagName) : null }; })()`);
const settle = () => new Promise((r) => setTimeout(r, 120));
// WCAG relative luminance contrast of two rgb() strings (alpha ignored: the ring and the panels are opaque).
const contrast = (a, b) => { const lum = (c) => { const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; }; const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const GEOMETRY = `(() => {
  const li = document.activeElement.closest('#ops-help-list li[data-help-id]'), s = getComputedStyle(li);
  let n = li, under = 'rgba(0, 0, 0, 0)';
  while (n && (under = getComputedStyle(n).backgroundColor) === 'rgba(0, 0, 0, 0)') n = n.parentElement;
  const sizes = [...document.querySelectorAll('#ops-help-list li[data-help-id] button, #ops-help-keys-toggle, #answer-next')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => ({ name: e.id || e.className, h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width, font: parseFloat(getComputedStyle(e).fontSize) }));
  return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor, under, sizes, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`;

let checks = 0;
const check = (cond, msg) => { assert.ok(cond, msg); checks++; };

// Behaviour at 1420px.
{
  const b = await launch(bin);
  try {
    await b.load(html, { width: 1420, height: 900 });
    assert.equal(await b.evaluate(SETUP), 3, 'three open help requests render as triage rows');
    await b.evaluate(`document.querySelector('#ops-help-list li[data-help-id="r1"] .help-open').focus()`);
    // (a) next / previous with J/K, the arrows and the Korean 2-set letter on the J key; the ends do not wrap.
    await press(b, 'j'); check((await focused(b)).id === 'r2', 'J moves to the next request');
    await press(b, 'down'); check((await focused(b)).id === 'r3', '↓ moves to the next request');
    await press(b, 'down'); check((await focused(b)).id === 'r3', '↓ on the last request stays');
    await press(b, 'k'); check((await focused(b)).id === 'r2', 'K moves to the previous request');
    await press(b, 'up'); check((await focused(b)).id === 'r1', '↑ moves to the previous request');
    await press(b, 'ㅓ'); check((await focused(b)).id === 'r2', 'the J key in Hangul 2-set (ㅓ) moves too');
    // (c) composition and modifiers never move the selection.
    await press(b, 'ime'); check((await focused(b)).id === 'r2', 'keyCode 229 (IME processing) moves nothing');
    await b.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', isComposing: true, bubbles: true, cancelable: true }))`);
    check((await focused(b)).id === 'r2', 'isComposing moves nothing');
    await press(b, 'ctrlJ'); check((await focused(b)).id === 'r2', 'Ctrl+J is left to the browser');
    // A re-render (the 10 s refresh) keeps the selection on the same request.
    await b.evaluate(`renderHelp()`); check((await focused(b)).id === 'r2', 'a re-render keeps focus on the selected request');
    // Geometry of the selected row and the triage targets.
    const g = await b.evaluate(GEOMETRY);
    check(g.width === '2px' && g.style === 'solid', `selected row ring 2px solid (${g.width} ${g.style})`);
    check(contrast(g.color, g.under) >= 3, `selected row ring ${g.color} on ${g.under} = ${contrast(g.color, g.under).toFixed(2)}:1 >= 3:1`);
    // E before anything is open says what to do and saves nothing.
    await press(b, 'e');
    check((await b.evaluate(`document.getElementById('ops-help-key-status').textContent`)).includes('먼저 요청을 열어'), 'E with no open request explains Enter first');
    check((await b.evaluate(`__calls.length`)) === 0, 'E with no open request calls nothing');
    // Enter opens the selected request (the native button).
    await press(b, 'enter'); await settle();
    let st = await b.evaluate(`({ open: !document.getElementById('detail').hidden, title: document.getElementById('detail-title').textContent, next: !document.getElementById('answer-next').hidden, focus: document.activeElement.id, get: __calls.filter((c) => c.method === 'GET').map((c) => c.url.split('/').pop()) })`);
    check(st.open && st.title.includes('학생-r2') && st.get.join() === 'r2', 'Enter opens the selected request: ' + JSON.stringify(st));
    check(st.next && st.focus === 'detail-title', 'the open request offers 답변 완료로 저장하고 다음 요청 and takes focus');
    // E without a next action refuses, saves nothing and puts the cursor in the field.
    await press(b, 'e');
    st = await b.evaluate(`({ puts: __calls.filter((c) => c.method === 'PUT').length, focus: document.activeElement.id, msg: document.getElementById('detail-status').textContent })`);
    check(st.puts === 0 && st.focus === 'next-action' && st.msg.includes('다음 조치'), 'E without a next action saves nothing: ' + JSON.stringify(st));
    // (c) In the text field every key is typing: J, E and ? are letters there.
    await press(b, 'j'); await press(b, 'e'); await press(b, '?');
    st = await b.evaluate(`({ value: document.getElementById('next-action').value, focus: document.activeElement.id, sheet: document.getElementById('ops-help-keys').hidden, puts: __calls.filter((c) => c.method === 'PUT').length })`);
    check(st.value === 'je?' && st.focus === 'next-action' && st.sheet === true && st.puts === 0, 'keys in a textarea type text and trigger nothing: ' + JSON.stringify(st));
    // A real Hangul composition in the field (CDP IME) ends as text, nothing fires.
    await b.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
    await b.send('Input.insertText', { text: '학생에게 다시 설명' });
    await b.evaluate(`document.getElementById('feedback-text').value = '단계 2를 다시 봐요'`);
    st = await b.evaluate(`({ value: document.getElementById('next-action').value, puts: __calls.filter((c) => c.method === 'PUT').length })`);
    check(st.value.endsWith('학생에게 다시 설명') && st.puts === 0, 'IME text lands in the field and saves nothing: ' + JSON.stringify(st));
    // E from a non-text control of the open record: saves r2 as answered (bound revision) and opens the next request r3.
    await b.evaluate(`document.querySelector('#feedback > button:not([id])').focus()`);
    await press(b, 'e'); await settle();
    st = await b.evaluate(`({ put: __calls.filter((c) => c.method === 'PUT').map((c) => ({ id: c.url.split('/').pop(), ...c.body })), title: document.getElementById('detail-title').textContent, rows: [...document.querySelectorAll('#ops-help-list li[data-help-id]')].map((l) => l.dataset.helpId), say: document.getElementById('ops-help-key-status').textContent, refreshes: __refreshes, select: document.getElementById('review-state').value })`);
    check(st.put.length === 1 && st.put[0].id === 'r2' && st.put[0].status === 'answered' && st.put[0].expected_revision === 1 && st.put[0].next_action.endsWith('학생에게 다시 설명'), 'E saves the open request as answered: ' + JSON.stringify(st.put));
    check(st.title.includes('학생-r3') && st.rows.join() === 'r1,r3' && st.say.includes('다음 요청을 열었어요') && st.refreshes === 1, 'E advances to the next request: ' + JSON.stringify(st));
    // Double press on the next request: one save only.
    await b.evaluate(`document.getElementById('next-action').value = '다음 조치 r3'; window.__release = null; window.__gate = new Promise((r) => { window.__release = r; })`);
    // Focus stays on an enabled control of the record (the answer button disables itself while saving).
    await b.evaluate(`document.querySelector('#feedback > button:not([id])').focus()`);
    await press(b, 'e'); await press(b, 'e');
    await b.evaluate(`document.getElementById('answer-next').click()`);
    check((await b.evaluate(`__calls.filter((c) => c.method === 'PUT').length`)) === 2, 'a double press while saving sends one request');
    // The instructor moves on while that save is in flight: nothing advances under them.
    await b.evaluate(`window.__gate = null; openShare('r1')`); await settle();
    const before = await b.evaluate(`({ gets: __calls.filter((c) => c.method === 'GET').length, say: document.getElementById('ops-help-key-status').textContent })`);
    await b.evaluate(`document.getElementById('ops-help-key-status').textContent = ''; __release()`); await settle();
    const after = await b.evaluate(`({ gets: __calls.filter((c) => c.method === 'GET').length, say: document.getElementById('ops-help-key-status').textContent })`);
    check(after.gets === before.gets && after.say === '', 'the late save opens nothing and announces no advance: ' + JSON.stringify({ before, after }));
    st = await b.evaluate(`({ title: document.getElementById('detail-title').textContent, rows: [...document.querySelectorAll('#ops-help-list li[data-help-id]')].map((l) => l.dataset.helpId), puts: __calls.filter((c) => c.method === 'PUT').length })`);
    check(st.title.includes('학생-r1') && st.rows.join() === 'r1' && st.puts === 2, 'a save that lands after the instructor opened another request does not move them: ' + JSON.stringify(st));
    // Mouse path: the 44px button answers the last request; with nothing left the saved record stays open with the message.
    await b.evaluate(`document.getElementById('next-action').value = '마지막'; document.getElementById('answer-next').click()`); await settle();
    st = await b.evaluate(`({ open: !document.getElementById('detail').hidden, focus: document.activeElement.id, say: document.getElementById('detail-status').textContent, again: !document.getElementById('answer-next').hidden, puts: __calls.filter((c) => c.method === 'PUT').map((c) => c.url.split('/').pop()) })`);
    check(st.open && !st.again && st.focus === 'detail-title' && st.say.includes('남은 응답할 요청이 없어요') && st.puts.join() === 'r2,r3,r1', 'answering the last request keeps the saved record open and says the queue is empty: ' + JSON.stringify(st));
  } finally { await b.close(); }
}

// (b) "?" sheet, and geometry at 1420 and 800 px, then forced colours.
for (const [width, forcedColors] of [[1420, false], [800, false], [800, true]]) {
  const b = await launch(bin);
  try {
    await b.load(html, { width, height: 900, forcedColors });
    await b.evaluate(SETUP);
    await b.evaluate(`document.querySelector('#ops-help-list li[data-help-id="r1"] .help-open').focus()`);
    await press(b, '?');
    let st = await b.evaluate(`(() => { const k = document.getElementById('ops-help-keys'), t = document.getElementById('ops-help-keys-toggle'); return { shown: !k.hidden && getComputedStyle(k).display !== 'none' && k.getBoundingClientRect().height > 0, text: k.textContent, expanded: t.getAttribute('aria-expanded'), modal: !!k.closest('dialog'), focus: (document.activeElement.closest('li[data-help-id]') || {}).dataset?.helpId }; })()`);
    check(st.shown && st.expanded === 'true' && !st.modal && st.focus === 'r1', `? opens the inline sheet without moving focus at ${width}px`);
    for (const word of ['J', 'K', '↓', '↑', 'Enter', 'E', '?', '답변 완료', '글자를 쓰는 칸']) check(st.text.includes(word), `the sheet lists ${word}`);
    await press(b, '?');
    check(await b.evaluate(`document.getElementById('ops-help-keys').hidden`), '? again closes the sheet');
    await b.evaluate(`document.getElementById('ops-help-keys-toggle').click()`);
    check(!(await b.evaluate(`document.getElementById('ops-help-keys').hidden`)), 'the 단축키 button opens the sheet by mouse');
    await b.evaluate(`document.querySelector('#ops-help-list li[data-help-id="r1"] .help-open').focus()`);
    await press(b, 'esc');
    check(await b.evaluate(`document.getElementById('ops-help-keys').hidden && document.activeElement.id === 'ops-help-keys-toggle'`), `Esc closes the sheet and returns focus to the 단축키 button at ${width}px`);
    await b.evaluate(`document.querySelector('#ops-help-list li[data-help-id="r1"] .help-open').focus()`);
    await b.evaluate(`openShare('r1')`); await settle();
    await b.evaluate(`document.querySelector('#ops-help-list li[data-help-id="r2"] .help-open').focus()`);
    const g = await b.evaluate(GEOMETRY);
    check(g.width === '2px' && g.style === 'solid', `ring 2px solid at ${width}px forced=${forcedColors}`);
    if (!forcedColors) check(contrast(g.color, g.under) >= 3, `ring contrast ${contrast(g.color, g.under).toFixed(2)}:1 at ${width}px`);
    check(g.sizes.length >= 5, 'open, seat-less rows, toggle and answer button measured: ' + g.sizes.length);
    for (const s of g.sizes) { check(s.h >= 43.5, `${s.name} ${s.h}px >= 44 at ${width}px`); check(s.font >= 12, `${s.name} font ${s.font}px`); }
    check(g.overflow <= 0, `no horizontal page scroll at ${width}px (${g.overflow})`);
    if (process.env.HELP_TRIAGE_PNG) {
      const { writeFileSync } = await import('node:fs');
      await b.evaluate(`document.getElementById('ops-help').scrollIntoView({ block: 'start' })`);
      const shot = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(`${process.env.HELP_TRIAGE_PNG}/help-triage-${width}${forcedColors ? '-forced' : ''}.png`, Buffer.from(shot.data, 'base64'));
    }
  } finally { await b.close(); }
}
console.log(`help-triage.browser: J/K/arrows, Enter, E answer-and-advance, ? sheet, text-field and IME guards, 2px ring, 44px targets (${checks} checks) PASS`);
