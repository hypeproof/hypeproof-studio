// CGP-AGENT-R-024 (REQ-CGP-AGENT-47b) and CGP-AGENT-D-011 (DES-CGP-AGENT-23): the instructor is told in the console when a
// student sends a help request, and the help queue rows read as attention-list rows. Run on the REAL served /manage page in
// headless Chromium (page-level only: no OS input, no visible window).
// Notice: (a) the first read of a class is the baseline and says nothing; (b) a new request of THIS class raises a notice and
// a 새 항목 mark; another class's request raises nothing; (c) neither the notice nor the OS notification carries request
// content; (d) there is no OS/browser Notification (the page does not refresh in a hidden tab, and minors' IDs must not reach
// lock screens); (e) opening a request clears its mark and the notice; (f) a new class is a new baseline; (g) the same
// through the page's REAL refresh() against a mocked Service, including a class switch and another class's rows.
// Rows: bold title, muted summary, relative time, one 44px action, 14px text, >= 56px, no overflow at 375 and 1280.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('help-notice.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  help-notice.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const SHIM = '<script>if (!crypto.randomUUID) crypto.randomUUID = () => "00000000-0000-4000-8000-" + String(Math.random()).slice(2, 14).padEnd(12, "0");</script>';
const served = await (await app.fetch(new Request('https://chalk.test/manage'), { ENVIRONMENT: 'test' })).text();
assert.ok(served.includes('<head>'), 'served /manage has a <head>');
assert.ok(!/requestPermission|new Notification|showNotification/.test(served), 'served /manage never constructs a Notification or asks permission, at load or later');
const html = served.replace('<head>', '<head>' + SHIM);

let checks = 0;
const check = (cond, msg) => { assert.ok(cond, msg); checks++; };
const settle = () => new Promise((r) => setTimeout(r, 120));

// Fixture: class S1 with two seats, two open requests as the baseline. Request rows carry content-like fields that must never
// reach a notice. A spy Notification records any construction or permission request (there must be none).
const SETUP = `(() => {
  const now = Math.floor(Date.now() / 1000);
  window.mk = (id, n, sid = 'S1', student = 'student-' + id) => ({ id, kind: 'help', session_id: sid, student_id: student, status: 'received', revision: 1, created_at: now - n, expires_at: now + 3600, question: 'SECRET-QUESTION-' + id, feedback: 'SECRET-FEEDBACK-' + id, next_action: '' });
  window.__calls = []; window.__notes = []; window.__perm = 'default'; window.__permCalls = 0;
  window.fetch = async (url, opts = {}) => { __calls.push({ url: String(url), method: opts.method || 'GET' }); return { ok: true, status: 200, json: async () => ({ id: 'x', student_id: 'student-a', session_id: 'S1', expires_at: now + 3600, revision: 1, status: 'received', content: {} }) }; };
  window.Notification = class { constructor(title, opts) { __notes.push({ title, ...opts }); } static get permission() { return __perm; } static requestPermission() { __permCalls++; __perm = window.__answer || 'granted'; return Promise.resolve(__perm); } };
  window.__realRefresh = refresh; refresh = () => {}; renderSummary = () => {}; renderSelection = () => {};
  token = 't'; cohort = 'c1';
  board = { session: { session_id: 'S1' }, seats: [] };
  opsData = { seats: [{ seat_id: 'S01', student_id: 'student-a', step: { step_id: 'step-2' } }, { seat_id: 'S02', student_id: 'student-b' }] };
  helpRows = [mk('a', 120, 'S1', 'student-a'), mk('b', 60, 'S1', 'student-b')]; helpState = 'ok'; helpCounts = { open: 2, answered: 0 }; helpExpanded = true;
  renderHelp(); return document.querySelectorAll('#ops-help-list li[data-help-id]').length;
})()`;
const ADD = (rows) => `(() => { helpRows = [...helpRows, ...${rows}]; renderHelp(); })()`;
const NOTICE = `(() => { const n = document.getElementById('ops-help-notice'); return n ? { hidden: n.hidden, text: n.textContent } : null; })()`;
const HIDDEN = (v) => `Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${v} })`;

// Behaviour at 1280.
{
  const b = await launch(bin);
  try {
    await b.load(html, { width: 1280, height: 900 });
    check((await b.evaluate(SETUP)) === 2, 'two baseline requests render');
    let n = await b.evaluate(NOTICE);
    check(n && n.hidden === true, 'the first read is the baseline: no notice');
    check((await b.evaluate(`__notes.length`)) === 0, 'the baseline raises no OS notification');
    check((await b.evaluate(`document.querySelectorAll('#ops-help-list .help-new').length`)) === 0, 'baseline rows carry no 새 항목 mark');

    // Row layout (D-011): bold title, muted summary, relative time, one action.
    const row = await b.evaluate(`(() => { const li = document.querySelector('#ops-help-list li[data-help-id="a"]'); const cs = (e) => getComputedStyle(e);
      const t = li.querySelector('.help-title'), s = li.querySelector('.help-sum'), tm = li.querySelector('time'), btns = [...li.querySelectorAll('button')];
      const r = li.getBoundingClientRect();
      return { h: r.height, title: t && t.textContent, titleW: t && +cs(t).fontWeight, titleF: t && cs(t).fontSize, sumF: s && cs(s).fontSize, sumC: s && cs(s).color, titleC: t && cs(t).color,
        time: tm && tm.textContent, iso: tm && tm.getAttribute('datetime'), btn: btns.map((x) => ({ text: x.textContent, h: x.getBoundingClientRect().height, f: cs(x).fontSize })), sumLen: s ? s.textContent.length : 0,
        tip: t && t.getAttribute('title'), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
    check(row.h >= 56, 'row is at least 56px: ' + row.h);
    check(row.titleW >= 600 && row.titleF === '14px', 'title is bold 14px: ' + row.titleW + ' ' + row.titleF);
    check(row.sumF === '14px' && row.sumC !== row.titleC, 'summary is 14px and muted: ' + row.sumC + ' vs ' + row.titleC);
    check(row.sumLen > 0 && row.sumLen <= 40, 'summary is a next step of 40 characters or fewer: ' + row.sumLen);
    check(/^(방금|\d+분 전)$/.test(row.time) && row.iso, 'relative time with a machine value: ' + row.time);
    check(row.btn.length === 1 && row.btn[0].text === '요청 열기' && row.btn[0].h >= 44 && row.btn[0].f === '14px', 'a single 44px 14px action: ' + JSON.stringify(row.btn));
    check(row.title.includes('S01') && row.title.includes('student-a') && row.tip === row.title, 'title names the seat and student, with a tooltip for truncation: ' + row.title);
    check(row.overflow <= 0, 'no horizontal overflow at 1280');

    // (b) A new request of this class: notice, mark, no OS notification.
    await b.evaluate(HIDDEN(true));
    await b.evaluate(ADD(`[mk('c', 2, 'S1', 'student-a')]`)); await settle();
    n = await b.evaluate(NOTICE);
    check(n.hidden === false && n.text.includes('새 도움 요청 1건') && n.text.includes('S01') && n.text.includes('student-a'), 'a new request raises a notice naming seat and student: ' + n.text);
    check(n.text.includes('step-2'), 'the notice names the lesson stage the console already shows: ' + n.text);
    check(!/SECRET/.test(n.text), 'the notice carries no request content');
    check((await b.evaluate(`document.querySelectorAll('#ops-help-list li[data-help-id="c"] .help-new').length`)) === 1 && (await b.evaluate(`document.querySelector('#ops-help-list li[data-help-id="c"] .help-new').textContent`)).includes('새 항목'), 'the new request carries a 새 항목 mark with text, not colour alone');
    check((await b.evaluate(`document.querySelector('#ops-help-notice').getAttribute('role')`)) === 'status', 'the notice is a polite status');
    check((await b.evaluate(`__notes.length`)) === 0, 'no OS notification before the instructor opts in');
    // Re-rendering does not re-announce.
    await b.evaluate(`renderHelp()`);
    check((await b.evaluate(NOTICE)).text.includes('1건'), 'a re-render keeps the same single notice');

    // Another class's request raises nothing (the page only lists its own class).
    await b.evaluate(ADD(`[mk('z', 1, 'S2', 'student-other')]`)); await settle();
    n = await b.evaluate(NOTICE);
    check(n.text.includes('1건') && !n.text.includes('student-other'), 'another class request raises no notice: ' + n.text);
    check((await b.evaluate(`document.querySelectorAll('#ops-help-list li[data-help-id="z"]').length`)) === 0, 'another class request is not listed');

    // (d) No OS/browser notification at all: no control, no permission request, no construction, tab hidden or not.
    check((await b.evaluate(`document.getElementById('ops-help-os') === null && !/알림 받기|알림 끄기/.test(document.body.textContent)`)), 'no OS notification control or copy on the page');
    for (const id of ['d', 'e', 'f']) { await b.evaluate(HIDDEN(id !== 'e')); await b.evaluate(ADD(`[mk('${id}', 1, 'S1', 'student-b')]`)); await settle(); }
    check((await b.evaluate(`__notes.length + __permCalls`)) === 0, 'new requests never construct a Notification or ask permission');
    check((await b.evaluate(NOTICE)).hidden === false, 'the in-console notice is the only channel');

    // (e) Opening clears the mark; the notice button opens the oldest new request; keyboard reaches both buttons.
    const before = await b.evaluate(`document.querySelectorAll('#ops-help-list .help-new').length`);
    await b.evaluate(`document.getElementById('ops-help-notice-open').focus()`);
    const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' };
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k, text: undefined }); await settle();
    const opened = await b.evaluate(`({ gets: __calls.filter((c) => c.method === 'GET').map((c) => c.url.split('/').pop()), left: document.querySelectorAll('#ops-help-list .help-new').length })`);
    check(opened.gets.length === 1 && opened.gets[0] === 'c' && opened.left === before - 1, 'Enter on the notice opens the oldest new request and clears its mark: ' + JSON.stringify(opened));
    for (const id of ['d', 'e', 'f']) await b.evaluate(`document.querySelector('#ops-help-list li[data-help-id="${id}"] .help-open').click()`);
    await settle();
    check((await b.evaluate(NOTICE)).hidden === true, 'the notice goes away once every new request is opened');

    // Dismiss hides the notice, keeps the marks.
    await b.evaluate(ADD(`[mk('g', 1, 'S1', 'student-b')]`)); await settle();
    check((await b.evaluate(NOTICE)).hidden === false, 'a later request raises the notice again');
    await b.evaluate(`document.getElementById('ops-help-notice-close').click()`); await settle();
    check((await b.evaluate(NOTICE)).hidden === true && (await b.evaluate(`document.querySelectorAll('#ops-help-list .help-new').length`)) === 1, '닫기 hides the notice and keeps the 새 항목 mark');
    const sz = await b.evaluate(`[...document.querySelectorAll('#ops-help-notice button')].map((e) => ({ h: e.getBoundingClientRect().height, f: getComputedStyle(e).fontSize }))`);
    // The dismissed notice is hidden; measure again with a fresh one.
    await b.evaluate(ADD(`[mk('h', 1, 'S1', 'student-b')]`)); await settle();
    const sz2 = await b.evaluate(`[...document.querySelectorAll('#ops-help-notice button')].map((e) => ({ h: e.getBoundingClientRect().height, f: getComputedStyle(e).fontSize }))`);
    check(sz2.length === 2 && sz2.every((s) => s.h >= 44 && s.f === '14px'), 'notice buttons are 44px and 14px: ' + JSON.stringify(sz2) + JSON.stringify(sz));

    // (f) A new class is a new baseline.
    await b.evaluate(`(() => { board = { session: { session_id: 'S9' }, seats: [] }; helpRows = [mk('n1', 5, 'S9', 'student-a'), mk('n2', 4, 'S9', 'student-b')]; renderHelp(); })()`); await settle();
    check((await b.evaluate(NOTICE)).hidden === true && (await b.evaluate(`document.querySelectorAll('#ops-help-list .help-new').length`)) === 0, 'a different class re-baselines silently');
    // Older rows paged in later are not new.
    await b.evaluate(`(() => { helpRows = [...helpRows, mk('old', 9000, 'S9', 'student-a')]; renderHelp(); })()`); await settle();
    check((await b.evaluate(NOTICE)).hidden === true, 'an older request loaded later is not announced');
    // Disconnect clears everything.
    await b.evaluate(`reset()`);
    check((await b.evaluate(NOTICE)).hidden === true, 'reset hides the notice');

    // (g) The real refresh cycle: the page's own refresh() reads /board and the shares (general and kind=help) from a mocked Service.
    await b.evaluate(`reset()`);
    await b.evaluate(`(() => {
      const now = Math.floor(Date.now() / 1000);
      window.__srv = { S1: [mk('s1a', 300, 'S1', 'student-a')], S2: [mk('s2a', 5, 'S2', 'student-c'), mk('s2b', 4, 'S2', 'student-d')] };
      window.__cur = 'S1'; window.__leak = null;
      window.fetch = async (url) => {
        const u = new URL(String(url), 'https://chalk.test'), q = u.searchParams;
        let body = {};
        if (u.pathname.endsWith('/board')) body = { session: { session_id: __cur }, seats: [] };
        else if (u.pathname.endsWith('/classroom/shares')) {
          const rows = q.get('kind') === 'help' ? [...__srv[q.get('session_id')] || [], ...(__leak ? [__leak] : [])] : [];
          body = { shares: rows, complete: true, limit: 50, next: null, has_more: false, counts: { open: rows.length, answered: 0 } };
        }
        return { ok: true, status: 200, json: async () => body };
      };
      refresh = __realRefresh; renderBoard = (d) => { board = d; };
      opsRefresh = () => {};
      cohort = 'c1'; token = 't';
    })()`);
    await b.evaluate(`refresh()`); await settle();
    check((await b.evaluate(`document.querySelectorAll('#ops-help-list li[data-help-id]').length`)) === 1 && (await b.evaluate(NOTICE)).hidden === true, 'refresh: the first read through the real cycle is a silent baseline');
    await b.evaluate(`__srv.S1.push(mk('s1b', 200, 'S1', 'student-b'))`);
    await b.evaluate(`refresh()`); await settle();
    n = await b.evaluate(NOTICE);
    check(n.hidden === false && n.text.includes('student-b') && !/SECRET/.test(n.text), 'refresh: a request received between two refreshes raises the notice: ' + n.text);
    // Another class's row returned by a (misbehaving) read is never noticed or listed.
    await b.evaluate(`__leak = mk('leak', 0, 'S2', 'student-leak')`);
    await b.evaluate(`refresh()`); await settle();
    n = await b.evaluate(NOTICE);
    check(!n.text.includes('student-leak') && (await b.evaluate(`document.querySelectorAll('#ops-help-list li[data-help-id="leak"]').length`)) === 0, 'refresh: another class row raises no notice and is not listed');
    await b.evaluate(`__leak = null`);
    // Class switch: S2's requests are NEWER than anything in S1's baseline, yet the first read of S2 is a fresh silent baseline.
    await b.evaluate(`__cur = 'S2'`);
    await b.evaluate(`refresh()`); await settle();
    check((await b.evaluate(`[...document.querySelectorAll('#ops-help-list li[data-help-id]')].map((l) => l.dataset.helpId).join()`)) === 's2a,s2b' || (await b.evaluate(`document.querySelectorAll('#ops-help-list li[data-help-id]').length`)) === 2, 'refresh: the new class lists its own requests');
    check((await b.evaluate(NOTICE)).hidden === true && (await b.evaluate(`document.querySelectorAll('#ops-help-list .help-new').length`)) === 0, 'refresh: a class switch re-baselines silently even when its requests are newer than the old baseline');
    await b.evaluate(`__srv.S2.push(mk('s2c', 1, 'S2', 'student-e'))`);
    await b.evaluate(`refresh()`); await settle();
    n = await b.evaluate(NOTICE);
    check(n.hidden === false && n.text.includes('student-e') && !n.text.includes('student-b'), 'refresh: after the switch a new request of the new class notices: ' + n.text);
    check((await b.evaluate(`__notes.length + __permCalls`)) === 0, 'refresh: still no Notification');
  } finally { await b.close(); }
}

// Layout at 375: the same row, no overflow, truncation with a tooltip, targets still 44px.
{
  const b = await launch(bin);
  try {
    await b.load(html, { width: 375, height: 800 });
    await b.evaluate(SETUP);
    await b.evaluate(`(() => { helpRows = [mk('long', 30, 'S1', 'student-with-a-very-long-identifier-0123456789-abcdefghij'), ...helpRows]; renderHelp(); })()`); await settle();
    await b.evaluate(ADD(`[mk('c', 1, 'S1', 'student-a')]`)); await settle();
    const g = await b.evaluate(`(() => { const li = document.querySelector('#ops-help-list li[data-help-id="long"]'); li.scrollIntoView(); const t = li.querySelector('.help-title'), btn = li.querySelector('button'), r = btn.getBoundingClientRect(), lr = li.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, truncated: t.scrollWidth > t.clientWidth, ellipsis: getComputedStyle(t).textOverflow, tip: t.getAttribute('title'), h: lr.height, bh: r.height, inside: r.right <= innerWidth && r.left >= 0 && lr.right <= innerWidth,
        notice: (() => { const n = document.getElementById('ops-help-notice'); const nr = n.getBoundingClientRect(); return { hidden: n.hidden, right: nr.right, w: innerWidth, btns: [...n.querySelectorAll('button')].map((x) => x.getBoundingClientRect().height) }; })() }; })()`);
    check(g.overflow <= 0 && g.inside, 'no horizontal overflow at 375: ' + JSON.stringify(g));
    check(g.truncated && g.ellipsis === 'ellipsis' && g.tip.includes('identifier'), 'a long title truncates with an ellipsis and keeps the full text as a tooltip');
    check(g.h >= 56 && g.bh >= 44, 'row >= 56px and action >= 44px at 375: ' + g.h + ' ' + g.bh);
    check(g.notice.hidden === false && g.notice.right <= g.notice.w && g.notice.btns.every((h) => h >= 44), 'the notice fits at 375 with 44px buttons: ' + JSON.stringify(g.notice));
  } finally { await b.close(); }
}

console.log(`help-notice.browser: baseline silent, own-class notice with 새 항목, no content, no OS notification, open clears, re-baseline, row layout 375/1280 (${checks} checks) PASS`);
