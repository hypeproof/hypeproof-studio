// #3301 / ADM-01: actual served issuer page and Chromium input/storage.
// The loopback server defers synthetic issuance responses; this does not revoke
// any server grant or prove live Service authorization (qualified separately).
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
const html = await (await app.fetch(new Request('https://chalk.test/issuer'), { ENVIRONMENT: 'test' })).text();
const server = createServer(async (req, res) => {
  if (req.url === '/issuer') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
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
const state = () => browser.evaluate(`({ input: document.getElementById('issuer').value, saved: sessionStorage.getItem('hps_issuer_token'), text: document.getElementById('result').textContent, token: document.getElementById('tok')?.textContent ?? null, busy: document.getElementById('mint').disabled, label: document.getElementById('mint').textContent })`);
async function until(predicate, description) {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error('Timed out: ' + description);
}
async function navigate() {
  const loaded = browser.waitForEvent(e => e.method === 'Page.loadEventFired', 'issuer page load');
  await browser.send('Page.navigate', { url }); await loaded;
  await until(() => browser.evaluate(`typeof document.getElementById('mint')?.onclick === 'function'`), 'issuer handlers');
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
async function mint(issuer, user) {
  for (const [id, value] of Object.entries({ issuer, u: user, c: 'synthetic-class', p: 'synthetic-profile', hours: '1' })) await fill('#' + id, value);
  const index = requests.length;
  const wire = browser.waitForEvent(e => e.method === 'Network.requestWillBeSent' && e.params.request.url.endsWith('/admin/tokens/issue'), 'issuance request');
  await click('#mint'); await until(() => requests.length > index, 'loopback issuance');
  const record = requests[index]; record.requestId = (await wire).params.requestId;
  assert.equal(record.authorization, 'Bearer ' + issuer); assert.equal(record.body.u, user);
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
async function forgotten() {
  const s = await state();
  assert.equal(s.input, ''); assert.equal(s.saved, null); assert.equal(s.text, ''); assert.equal(s.token, null);
  assert.equal(s.busy, false); assert.equal(s.label, '발급 →');
}
try {
  browser = await launch(bin); await browser.send('Network.enable');
  await navigate();
  let current = await mint('normal.signature', 'normal'); await finish(current);
  assert.equal((await state()).saved, 'normal.signature'); assert.equal((await state()).token, 'student-normal');
  await navigate(); assert.equal((await state()).input, 'normal.signature');
  await click('#forget'); await forgotten(); await navigate(); await forgotten();
  for (const mode of ['http', 'network']) {
    current = await mint('current.signature', mode); await finish(current, mode);
    assert.equal((await state()).saved, null); assert.equal((await state()).token, null);
    assert.ok((await state()).text.includes('오류')); assert.equal((await state()).busy, false);
    await click('#forget');
  }
  console.log('PASS normal issuance/reload and current HTTP/network failure');

  // Headers arrive first: forgetting must also invalidate a response awaiting JSON.
  const staleBody = await mint('forgotten.signature', 'forgotten');
  const headers = browser.waitForEvent(e => e.method === 'Network.responseReceived' && e.params.requestId === staleBody.requestId, 'headers before body');
  staleBody.res.writeHead(200, { 'content-type': 'application/json' });
  staleBody.partial = true; staleBody.res.write('{'); await headers;
  await click('#forget'); await forgotten(); await finish(staleBody); await forgotten();
  await navigate(); await forgotten();
  console.log('PASS forget while successful response body is pending stays clear after reload');

  // Old success, HTTP error and rejected fetch must not run another request's finally.
  for (const mode of ['success', 'http', 'network']) {
    const old = await mint('old.signature', 'old-' + mode); await click('#forget'); await forgotten();
    current = await mint('new.signature', 'new-' + mode);
    await finish(old, mode);
    const s = await state();
    assert.equal(s.input, 'new.signature'); assert.equal(s.saved, null); assert.equal(s.text, '');
    assert.equal(s.busy, true); assert.equal(s.label, '발급 중…');
    await finish(current); assert.equal((await state()).saved, 'new.signature');
    assert.equal((await state()).token, 'student-new-' + mode); assert.equal((await state()).busy, false);
    await click('#forget');
  }
  console.log('PASS stale success/HTTP/network completion preserves the new request busy state');

  // The reverse order must retain the newest completed result and persisted issuer.
  for (const mode of ['success', 'http', 'network']) {
    const old = await mint('previous.signature', 'previous-' + mode); await click('#forget');
    current = await mint('latest.signature', 'latest-' + mode); await finish(current);
    const before = await state(); await finish(old, mode); assert.deepEqual(await state(), before);
    await navigate(); assert.equal((await state()).input, 'latest.signature'); await click('#forget');
  }
  console.log('PASS late success/HTTP/network completion preserves the latest result and reload identity');
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  if (browser) await browser.close();
}
