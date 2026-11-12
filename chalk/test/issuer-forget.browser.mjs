// #3301 / ADM-01: actual served issuer page and Chromium input/storage, now on the
// Lab login connection. The page has no instructor token field, sends no
// Authorization header and stores nothing; "연결 해제" discards late results the way
// "강사 코드 지우기" used to. The loopback server defers synthetic issuance responses
// and fakes /connect/status; it does not revoke any server grant or prove live
// Service authorization (qualified separately).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';
const { default: app } = await import('../src/index.ts');
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required');
  console.log('NOT RUN issuer forget: no Chromium');
  process.exit(0);
}
const requests = [];
const droppedUsers = new Set();
const sockets = new Set();
let linked = true;
let disconnects = 0;
const status = () => linked
  ? { connected: true, configured: true, member: { name: '합성 강사', handle: 'lab-synthetic' }, expires_at: new Date(Date.now() + 3600e3).toISOString(), scopes: [{ cohort: 'synthetic-class', profiles: ['synthetic-profile'] }] }
  : { connected: false, configured: true };
const html = await (await app.fetch(new Request('https://chalk.test/issuer'), { ENVIRONMENT: 'test' })).text();
const server = createServer(async (req, res) => {
  if (req.url === '/issuer') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
  if (req.url === '/connect/status') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(status())); return; }
  if (req.url === '/connect/disconnect' && req.method === 'POST') { disconnects++; linked = false; res.writeHead(204); res.end(); return; }
  if (req.url === '/admin/tokens/issue' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    // Chromium can transparently retry a socket dropped before response headers.
    // Keep that synthetic user offline so a retry also reaches a terminal failure.
    if (droppedUsers.has(input.u)) { res.destroy(); return; }
    requests.push({ res, body: input, authorization: req.headers.authorization });
    return;
  }
  res.writeHead(404); res.end();
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/issuer`;
let browser;
const state = () => browser.evaluate(`({ field: !!document.querySelector('#issuer, #token, textarea, input[type=password]'), saved: sessionStorage.length + localStorage.length, text: document.getElementById('result').textContent, token: document.getElementById('tok')?.textContent ?? null, busy: document.getElementById('mint').disabled, label: document.getElementById('mint').textContent, panel: document.querySelector('[data-chalk-connect]')?.dataset.state })`);
async function until(predicate, description) {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error('Timed out: ' + description);
}
async function navigate() {
  const loaded = browser.waitForEvent(e => e.method === 'Page.loadEventFired', 'issuer page load');
  await browser.send('Page.navigate', { url }); await loaded;
  await until(() => browser.evaluate(`typeof document.getElementById('mint')?.onclick === 'function' && document.querySelector('[data-chalk-connect]')?.dataset.state !== 'checking'`), 'issuer handlers and connection status');
}
async function click(selector) {
  const point = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function fill(selector, text) {
  await click(selector);
  // Select the field's existing text independently of OS shortcut translation;
  // Chromium's input event inserts the replacement, as for actual typing.
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
  await browser.send('Input.insertText', { text });
}
async function mint(user) {
  for (const [id, value] of Object.entries({ u: user, c: 'synthetic-class', p: 'synthetic-profile', hours: '1' })) await fill('#' + id, value);
  const index = requests.length;
  const wire = browser.waitForEvent(e => e.method === 'Network.requestWillBeSent' && e.params.request.url.endsWith('/admin/tokens/issue'), 'issuance request');
  await click('#mint'); await until(() => requests.length > index, 'loopback issuance');
  const record = requests[index]; record.requestId = (await wire).params.requestId;
  assert.equal(record.authorization, undefined, 'the page sends no instructor credential of its own');
  assert.equal(record.body.u, user);
  assert.equal((await state()).busy, true);
  return record;
}
async function finish(record, mode = 'success') {
  const event = mode === 'network' ? 'Network.loadingFailed' : 'Network.loadingFinished';
  const completed = browser.waitForEvent(e => e.method === event && e.params.requestId === record.requestId, 'issuance completion');
  if (mode === 'network') { droppedUsers.add(record.body.u); record.res.destroy(); }
  else {
    if (!record.res.headersSent) record.res.writeHead(mode === 'http' ? 403 : 200, { 'content-type': 'application/json' });
    const body = JSON.stringify(mode === 'http' ? { error: 'synthetic denied' } : { token: 'student-' + record.body.u, exp: 2000000000, jti: record.body.u });
    record.res.end(record.partial ? body.slice(1) : body);
  }
  await completed;
  // Drain page tasks after the actual body/error reached Chromium, not just server.end().
  await browser.send('Runtime.evaluate', { expression: 'new Promise(resolve => setTimeout(resolve, 60))', awaitPromise: true });
}
/** "연결 해제" in the shared panel: the Lab session is cleared and this page forgets its results. */
async function disconnect() {
  const before = disconnects;
  await click('[data-chalk-connect] button.ghost');
  await until(async () => disconnects > before && (await state()).panel === 'disconnected', 'disconnect');
}
/** Back from the Lab with a new connection (the real flow navigates away and back). */
async function reconnect() {
  linked = true;
  await browser.evaluate('chalkConnection.refresh()');
  await until(async () => (await state()).panel === 'connected', 'reconnect');
}
async function forgotten() {
  const s = await state();
  assert.equal(s.field, false); assert.equal(s.saved, 0); assert.equal(s.text, ''); assert.equal(s.token, null);
  assert.equal(s.busy, false); assert.equal(s.label, '발급 →'); assert.equal(s.panel, 'disconnected');
}
try {
  browser = await launch(bin); await browser.send('Network.enable');
  await navigate();
  assert.equal((await state()).field, false, 'no instructor token field');
  assert.equal((await state()).panel, 'connected');
  let current = await mint('normal'); await finish(current);
  assert.equal((await state()).saved, 0, 'nothing is persisted in the browser');
  assert.equal((await state()).token, 'student-normal');
  await disconnect(); await forgotten(); await navigate(); await forgotten();
  // Without a connection the page refuses before any request.
  await fill('#u', 'offline'); await click('#mint');
  assert.match((await state()).text, /Lab 로그인으로 연결/); assert.equal(requests.length, 1);
  await reconnect();
  for (const mode of ['http', 'network']) {
    current = await mint(mode); await finish(current, mode);
    assert.equal((await state()).token, null);
    assert.ok((await state()).text.includes('오류')); assert.equal((await state()).busy, false);
  }
  console.log('PASS normal issuance/reload without a token field, refusal when disconnected, current HTTP/network failure');

  // Headers arrive first: disconnecting must also invalidate a response awaiting JSON.
  const staleBody = await mint('forgotten');
  const headers = browser.waitForEvent(e => e.method === 'Network.responseReceived' && e.params.requestId === staleBody.requestId, 'headers before body');
  staleBody.res.writeHead(200, { 'content-type': 'application/json' });
  staleBody.partial = true; staleBody.res.write('{'); await headers;
  await disconnect(); await forgotten(); await finish(staleBody); await forgotten();
  await navigate(); await forgotten();
  console.log('PASS disconnect while a successful response body is pending stays clear after reload');

  // Old success, HTTP error and rejected fetch must not run another request's finally.
  for (const mode of ['success', 'http', 'network']) {
    await reconnect();
    const old = await mint('old-' + mode); await disconnect(); await forgotten();
    await reconnect();
    current = await mint('new-' + mode);
    await finish(old, mode);
    const s = await state();
    assert.equal(s.text, ''); assert.equal(s.busy, true); assert.equal(s.label, '발급 중…');
    await finish(current);
    assert.equal((await state()).token, 'student-new-' + mode); assert.equal((await state()).busy, false);
    await disconnect();
  }
  console.log('PASS stale success/HTTP/network completion preserves the new request busy state');

  // The reverse order must retain the newest completed result.
  for (const mode of ['success', 'http', 'network']) {
    await reconnect();
    const old = await mint('previous-' + mode); await disconnect(); await reconnect();
    current = await mint('latest-' + mode); await finish(current);
    const before = await state(); await finish(old, mode); assert.deepEqual(await state(), before);
    await disconnect();
  }
  console.log('PASS late success/HTTP/network completion preserves the latest result');
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  if (browser) await browser.close();
}
