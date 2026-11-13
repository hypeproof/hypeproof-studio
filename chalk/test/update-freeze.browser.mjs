// CGP-SHELL-R-003 / CGP-SHELL-D-002 (DES-SHELL-02) — the cohort update freeze on /console, in real headless Chromium.
// The served console page; synthetic Lab connection, state and Service answers only.
//   badge "업데이트 고정 ~M/D" on the cohort row: amber, lock icon, a visible edge, ≥4.5:1, ≥14px
//   two labelled date inputs, operable from the keyboard, the range announced (aria-describedby + aria-live)
//   save → PUT {from, until} → state re-read → badge; 고정 풀기 → DELETE → no badge; Service refusals in Korean
//   a security-critical latest release is labelled; a connection without can_start_session reads only
//   44px controls, 14px text, no page overflow at 390px
// Font-independent: no assertion depends on a measured text width.
//   node --experimental-strip-types test/update-freeze.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) throw new Error('update-freeze: Chromium required');
  console.log('NOT RUN update-freeze browser: no Chromium');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const kst = (offset) => new Date(Date.now() + 9 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const md = (day) => { const [, m, d] = day.split('-').map(Number); return m + '/' + d; };
const view = (from, until) => ({ from, until, starts_at: new Date(Date.parse(from + 'T00:00:00+09:00')).toISOString(), ends_at: new Date(Date.parse(until + 'T00:00:00+09:00') + 86400e3).toISOString(), set_by: 'synthetic-teacher', set_at: new Date().toISOString() });

const cohorts = ['frozen-class', 'reader-class'];
const scopes = [
  { cohort: 'frozen-class', profiles: ['track-0'], can_start_session: true, max_session_hours: 4, max_hours: 12 },
  { cohort: 'reader-class', profiles: ['track-1'], can_start_session: false, max_session_hours: 4, max_hours: 12 },
];
const status = { connected: true, configured: true, member: { name: 'Synthetic instructor', handle: 'synthetic' }, expires_at: new Date(Date.now() + 3600e3).toISOString(), scopes };
const world = { freeze: { 'frozen-class': view(kst(0), kst(5)), 'reader-class': view(kst(0), kst(3)) }, refuse: null, requests: [] };
const errors = [];
const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  world.requests.push({ method: req.method, path: req.url, body });
  try {
    let response;
    const m = /^\/admin\/cohorts\/([^/]+)\/(state|update-freeze)$/.exec(req.url);
    if (req.url === '/console') response = await app.fetch(new Request('http://127.0.0.1/console'), { ENVIRONMENT: 'test' });
    else if (req.url === '/connect/status') response = Response.json(status);
    else if (req.url === '/workshop/boa-tokens') response = Response.json({ targets: [] });
    else if (req.url === '/studio/latest-release') response = Response.json({ version: '2026.1112.0', checked_at: null, security_critical: true, source: 'test' });
    else if (req.url === '/favicon.ico') response = new Response(null, { status: 204 });
    else if (req.url.startsWith('/admin/cohorts/') && req.url.endsWith('/lab-tokens')) response = Response.json({ tokens: [] });
    else if (m && m[2] === 'state' && req.method === 'GET') {
      const i = cohorts.indexOf(m[1]);
      response = Response.json({ id: m[1], session: null, paused: false, roster_size: 0, scope: scopes[i], profiles: [{ id: 'track-' + i, display_name: '수업 ' + (i + 1) }], update_freeze: world.freeze[m[1]] ?? null });
    } else if (m && m[2] === 'update-freeze' && m[1] === 'frozen-class' && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (world.refuse) response = Response.json({ error: 'invalid update freeze range', reason: world.refuse }, { status: 400 });
      else if (req.method === 'PUT') { const b = JSON.parse(body); world.freeze['frozen-class'] = view(b.from, b.until); response = Response.json({ update_freeze: world.freeze['frozen-class'] }); }
      else { delete world.freeze['frozen-class']; response = Response.json({ update_freeze: null }); }
    } else throw new Error('Unexpected fixture path ' + req.method + ' ' + req.url);
    res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'content-security-policy': "connect-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'none'" });
    res.end(await response.text());
  } catch (error) { errors.push(error.message); res.writeHead(500); res.end('{}'); }
});
const sockets = new Set();
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
await new Promise(done => server.listen(0, '127.0.0.1', done));

let browser;
const wait = ms => new Promise(done => setTimeout(done, ms));
const ev = (expr) => browser.evaluate(expr);
async function until(expression, label) {
  for (let i = 0; i < 160; i++) { if (await ev(expression).catch(() => false)) return; await wait(25); }
  throw new Error('Timed out: ' + label);
}
async function click(selector) {
  const p = await ev(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
}
async function press(key, code) {
  for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
}
// WCAG relative luminance contrast of two computed rgb() colours.
const CONTRAST = `(()=>{const L=c=>{const v=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
  const bgOf=e=>{for(let n=e;n;n=n.parentElement){const b=getComputedStyle(n).backgroundColor;if(b&&!/rgba\\(0, 0, 0, 0\\)|transparent/.test(b))return b}return getComputedStyle(document.body).backgroundColor};
  return (e)=>{const a=L(getComputedStyle(e).color),b=L(bgOf(e));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)}})()`;
const badge = (cohort) => ev(`(() => { const b=document.querySelector('[data-freeze-badge="${cohort}"]'); if(!b) return null; const s=getComputedStyle(b), r=b.getBoundingClientRect();
  const warn=getComputedStyle(document.documentElement).getPropertyValue('--hp-warn').trim(); const probe=document.createElement('span'); probe.style.color='var(--hp-warn)'; document.body.append(probe); const warnRgb=getComputedStyle(probe).color; probe.remove();
  return { text:b.textContent.trim(), inLegend:!!b.closest('legend'), svg:!!b.querySelector('svg'), color:s.color, warnRgb, border:s.borderTopStyle+' '+parseFloat(s.borderTopWidth)+' '+s.borderTopColor, font:parseFloat(s.fontSize), contrast:${CONTRAST}(b), height:r.height }; })()`);

try {
  browser = await launch(bin);
  for (const width of [1280, 390]) {
    world.freeze['frozen-class'] = view(kst(0), kst(5)); world.refuse = null;
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.waitForEvent(e => e.method === 'Page.loadEventFired', 'console navigation');
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/console` });
    await loaded;
    await until("document.querySelectorAll('[data-freeze]').length===2", width + ': freeze blocks');
    const name = String(width);

    // Badge on the cohort row (DES-SHELL-02).
    const b = await badge('frozen-class');
    assert.ok(b, name + ': badge drawn');
    assert.equal(b.text, '업데이트 고정 ~' + md(kst(5)), name + ': badge words');
    assert.ok(b.inLegend && b.svg, name + ': on the cohort row, with the lock icon');
    if (process.env.DEBUG_FREEZE) console.log(JSON.stringify(await ev("(()=>{const e=document.querySelector('[data-freeze-badge]');const out=[];for(const sh of document.styleSheets){let rs;try{rs=sh.cssRules}catch{continue}for(const r of rs){if(r.selectorText&&e.matches(r.selectorText))out.push(r.cssText.slice(0,160))}}return out})()"),null,1));
    assert.equal(b.color, b.warnRgb, name + ': amber is the page warn ink');
    assert.match(b.border, /^solid 1 /, name + ': a visible 1px edge (high-contrast)');
    assert.ok(b.font >= 14, name + ': badge text ≥14px');
    assert.ok(b.contrast >= 4.5, name + ': badge contrast ' + b.contrast.toFixed(2));
    assert.ok((await badge('reader-class'))?.text.startsWith('업데이트 고정 ~'), name + ': a read-only connection still sees the badge');

    // Security-critical latest release is labelled.
    await until("!document.querySelector('[data-freeze=\"frozen-class\"] [data-freeze-security]').hidden", name + ': security label');
    assert.match(await ev("document.querySelector('[data-freeze=\"frozen-class\"] [data-freeze-security]').textContent"), /v2026\.1112\.0는 보안 업데이트예요\. 업데이트 고정 중에도 학생에게 안내돼요\./);

    // Read-only connection: no controls.
    assert.equal(await ev("document.querySelectorAll('[data-freeze=\"reader-class\"] input,[data-freeze=\"reader-class\"] button').length"), 0, name + ': no controls without can_start_session');

    // Controls: labelled date inputs that describe the range; 44px; 14px.
    const controls = await ev(`(() => { const box=document.querySelector('[data-freeze="frozen-class"]');
      const ins=[...box.querySelectorAll('input')], btns=[...box.querySelectorAll('button')], range=box.querySelector('[data-freeze-range]');
      return { group: box.getAttribute('role')+'|'+document.getElementById(box.getAttribute('aria-labelledby'))?.textContent,
        inputs: ins.map(i=>({type:i.type,label:i.labels[0]?.textContent,described:i.getAttribute('aria-describedby')===range.id,h:i.getBoundingClientRect().height,font:parseFloat(getComputedStyle(i).fontSize)})),
        buttons: btns.map(x=>({text:x.textContent,h:x.getBoundingClientRect().height,font:parseFloat(getComputedStyle(x).fontSize)})),
        live: range.getAttribute('aria-live'), range: range.textContent, overflow: document.documentElement.scrollWidth-innerWidth }; })()`);
    assert.equal(controls.group, 'group|Studio 업데이트 고정', name + ': a named group');
    assert.deepEqual(controls.inputs.map(i => [i.type, i.label, i.described]), [['date', '시작일', true], ['date', '마지막 날', true]], name + ': two labelled date inputs that point at the range text');
    assert.ok(controls.inputs.every(i => i.h >= 44 && i.font >= 14), name + ': inputs 44px, 14px');
    assert.deepEqual(controls.buttons.map(x => x.text), ['고정 기간 바꾸기', '고정 풀기'], name + ': actions');
    assert.ok(controls.buttons.every(x => x.h >= 44 && x.font >= 14), name + ': buttons 44px, 14px');
    assert.equal(controls.live, 'polite', name + ': range is announced');
    assert.ok(controls.range.startsWith('고정 기간: ') && controls.range.endsWith('(6일)'), name + ': range text ' + controls.range);
    assert.ok(controls.overflow <= 0.5, name + ': no horizontal page scroll');

    // Keyboard: Tab reaches the last-day input, ArrowUp changes the day, the range text follows.
    await click('h1');
    for (let n = 0; n < 60 && !await ev("document.activeElement?.matches('[data-freeze=\"frozen-class\"] [data-freeze-until]')"); n++) await press('Tab', 9);
    assert.ok(await ev("document.activeElement.matches('[data-freeze-until]')"), name + ': Tab reaches the date input');
    const before = await ev("document.querySelector('[data-freeze-until]').value");
    await press('ArrowUp', 38);
    await until(`document.querySelector('[data-freeze-until]').value!==${JSON.stringify(before)}`, name + ': ArrowUp changes the date');
    assert.notEqual(await ev("document.querySelector('[data-freeze-range]').textContent"), controls.range, name + ': the range text follows the keyboard change');

    // Refusal from the Service, in Korean; nothing else changes.
    world.refuse = 'freeze_range_past';
    await ev("(()=>{const u=document.querySelector('[data-freeze-until]');u.value=" + JSON.stringify(kst(9)) + ";u.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await click('[data-freeze-save]');
    await until("document.querySelector('[data-freeze-msg]').textContent.length>0", name + ': refusal shown');
    assert.equal(await ev("document.querySelector('[data-freeze-msg]').textContent"), '마지막 날이 이미 지났어요. 오늘이나 그 뒤로 골라 주세요.');
    world.refuse = null;

    // Save: PUT {from, until}, then the badge follows the re-read state.
    const puts = world.requests.filter(r => r.method === 'PUT').length;
    await click('[data-freeze-save]');
    await until(`document.querySelector('[data-freeze-badge="frozen-class"]')?.textContent.trim()==='업데이트 고정 ~${md(kst(9))}'`, name + ': badge after save');
    const put = world.requests.filter(r => r.method === 'PUT').at(-1);
    assert.equal(world.requests.filter(r => r.method === 'PUT').length, puts + 1);
    assert.equal(put.path, '/admin/cohorts/frozen-class/update-freeze');
    assert.deepEqual(JSON.parse(put.body), { from: kst(0), until: kst(9) });
    assert.match(await ev("document.querySelector('[data-freeze-msg]').textContent"), /^저장했어요\./);

    // Client-side refusal: more than 60 days never reaches the Service.
    const count = world.requests.length;
    await ev("(()=>{const u=document.querySelector('[data-freeze-until]');u.value=" + JSON.stringify(kst(70)) + ";u.dispatchEvent(new Event('input',{bubbles:true}))})()");
    assert.match(await ev("document.querySelector('[data-freeze-range]').textContent"), /최대 60일까지 고정할 수 있어요\.$/);
    await click('[data-freeze-save]');
    assert.equal(await ev("document.querySelector('[data-freeze-msg]').textContent"), '최대 60일까지 고정할 수 있어요.');
    assert.equal(world.requests.length, count, 'a 71-day range is refused before the Service');

    // Clear: DELETE, the badge goes, the form offers a new freeze.
    await click('[data-freeze-clear]');
    await until("!document.querySelector('[data-freeze-badge=\"frozen-class\"]')", name + ': badge cleared');
    assert.equal(world.requests.filter(r => r.method === 'DELETE').at(-1).path, '/admin/cohorts/frozen-class/update-freeze');
    assert.equal(await ev("document.querySelector('[data-freeze=\"frozen-class\"] [data-freeze-save]').textContent"), '업데이트 고정하기');
    assert.equal(await ev("document.querySelector('[data-freeze=\"frozen-class\"] [data-freeze-until]').value"), '', 'no freeze: the last day is empty');
    console.log(`  ok   ${name}px: badge (${b.contrast.toFixed(2)}:1, ${b.font}px, ${b.height.toFixed(1)}px tall), security label, read-only scope, labelled keyboard date range (inputs ${controls.inputs.map(i => i.h.toFixed(0)).join('/')}px, buttons ${controls.buttons.map(x => x.h.toFixed(0)).join('/')}px), save/refuse/clear`);
  }
  assert.deepEqual(errors, [], 'only fixture paths were requested');
} finally {
  if (browser) await browser.close();
  for (const s of sockets) s.destroy();
  await new Promise(done => server.close(done));
}
console.log('PASS update-freeze browser: DES-SHELL-02 badge and date-range control at 1280 and 390');
