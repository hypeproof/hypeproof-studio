// #3304 / ADM-03/05: real served sharing HTML, Chromium input and delayed
// loopback responses. Synthetic Service responses do not prove Service auth/storage.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';
const { default: app } = await import('../src/index.ts');
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required');
  console.log('NOT RUN sharing draft: no Chromium'); process.exit(0);
}
const html = await (await app.fetch(new Request('https://chalk.test/sharing'), { ENVIRONMENT: 'test' })).text();
const posts = [], sockets = new Set(), report = { status: 'INCOMPLETE', cases: [], posts: [] };
let shares = [], heldGet = null, holdRefresh = false, browser;
const server = createServer(async (req, res) => {
  if (req.url === '/sharing') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
  if (req.url === '/v1/classroom/shares') {
    assert.equal(req.headers.authorization, 'Bearer synthetic-sharing-token');
    if (req.method === 'GET') {
      if (holdRefresh) { heldGet = res; return; }
      respondGet(res); return;
    }
    if (req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part;
      posts.push({ raw, body: JSON.parse(raw), res }); return;
    }
  }
  res.writeHead(404); res.end();
});
function respondGet(res) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ shares, share_records: ['independent_task', 'self_reliance'] })); }
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/sharing`;
async function until(predicate, description) {
  for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error('Timed out: ' + description);
}
async function click(selector) {
  const point = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function fill(selector, text) {
  await click(selector); await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
  await browser.send('Input.insertText', { text });
}
async function select(selector, key) {
  // Native keyboard navigation on the focused select, not a synthetic change event.
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  for (const k of ['Home', key, 'Enter']) {
    const code = { Home: 36, ArrowDown: 40, End: 35, Enter: 13 }[k];
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
  }
}
const state = () => browser.evaluate(`(()=>{const $=id=>document.getElementById(id);return {
 fields:Object.fromEntries(['recipient','kind','prompt','response','tool_summary','artifact_url','verification','duration','task-text','task-help-note'].map(id=>[id,$(id).value])),
 consent:$('consent').checked,help:[...$('task-help').querySelectorAll('input:checked')].map(n=>n.value),
 rows:[...$('reliance-rows').children].map(row=>({work:row.querySelector('[data-work]').value,how:row.querySelector('[data-how]').value,note:row.querySelector('[data-note]').value})),
 status:$('status').textContent,records:$('records').textContent,pending:!!$('submit').dataset.pending,dialog:$('outbound').open,errors:window.testErrors||[]};})()`);
const draft = s => ({ fields: s.fields, consent: s.consent, help: s.help, rows: s.rows });
async function open() {
  shares = []; holdRefresh = false; heldGet = null;
  const loaded = browser.waitForEvent(e => e.method === 'Page.loadEventFired', 'sharing page load');
  await browser.send('Page.navigate', { url }); await loaded;
  await until(() => browser.evaluate(`typeof document.getElementById('share')?.onsubmit==='function'`), 'sharing handlers');
  await browser.evaluate(`window.testErrors=[];window.addEventListener('error',e=>window.testErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.testErrors.push(String(e.reason)))`);
  await fill('#token', 'synthetic-sharing-token'); await click('#login button:not([type="button"])');
  await until(async () => (await state()).status.includes('연결됨'), 'synthetic connection');
  await fill('#recipient', 'teacher-a'); await fill('#prompt', 'A: approved question'); await click('#consent');
}
async function send() {
  const index = posts.length; await click('#submit');
  await until(async () => (await state()).dialog, 'confirmation');
  assert.equal(posts.length, index, 'nothing is sent before explicit approval');
  await click('#outbound-send'); await until(() => posts.length === index + 1, 'approved POST');
  return posts[index];
}
function finish(post, status = 201) {
  report.posts.push({ raw: post.raw, body: post.body, status });
  if (status === 201) shares.push({ ...post.body, status: 'received', revision: 1, expires_at: 2000000000 });
  post.res.writeHead(status, { 'content-type': 'application/json' });
  post.res.end(JSON.stringify(status === 201 ? { id: post.body.id, expires_at: 2000000000 } : { error: 'synthetic sharing unavailable' }));
}
async function settled() { await until(async () => !(await state()).pending, 'submit completion'); const s = await state(); assert.deepEqual(s.errors, []); return s; }
async function screenshot(name) {
  if (!process.env.SHARE_DRAFT_OUTPUT) return;
  await browser.evaluate(`document.getElementById('status').scrollIntoView({block:'start'})`);
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(process.env.SHARE_DRAFT_OUTPUT + '/' + name + '.png', Buffer.from(data, 'base64'));
}
try {
  if (process.env.SHARE_DRAFT_OUTPUT) await mkdir(process.env.SHARE_DRAFT_OUTPUT, { recursive: true });
  browser = await launch(bin); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await open(); await select('#kind', 'End'); await click('#reliance-add');
  await fill('[data-work]', 'approved work'); await select('[data-how]', 'ArrowDown');
  let post = await send(); assert.deepEqual(post.body.content.self_reliance, [{ work: 'approved work', how: 'direct' }]);
  finish(post); let after = await settled(); assert.equal(after.fields.prompt, ''); assert.equal(after.consent, false); assert.deepEqual(after.rows, []);
  report.cases.push({ name: 'unchanged-approved-input-resets', after }); console.log('PASS unchanged approved input and optional rows reset');

  // Each isolated change must survive; checking only text would miss checkbox,
  // select and newly added blank/incomplete optional records.
  const mutations = [
    ['text-and-recipient', async () => { for (const [id, value] of Object.entries({ recipient: 'teacher-b', prompt: 'B: unsent question', response: 'B response', tool_summary: 'B tools', artifact_url: 'https://example.invalid/new', verification: 'B review' })) await fill('#' + id, value); }],
    ['duration-only', async () => select('#duration', 'ArrowDown')],
    ['consent-only', async () => click('#consent')],
    ['optional-help-only', async () => click('#task-help input[value="hint"]')],
    ['optional-empty-row', async () => click('#reliance-add')],
    ['optional-incomplete-row', async () => { await click('#reliance-add'); await fill('[data-work]', 'unfinished B, no decision yet'); }],
  ];
  for (const [name, mutate] of mutations) {
    await open(); await select('#kind', 'End'); post = await send(); const approved = draft(await state()); await mutate(); const before = await state();
    assert.notDeepEqual(draft(before), approved, name + ' actually changed the DOM');
    const count = posts.length; await click('#submit');
    assert.equal(posts.length, count, 'pending request cannot duplicate POST'); assert.equal((await state()).dialog, false);
    finish(post); after = await settled();
    assert.deepEqual(draft(after), draft(before), name + ' unsent input survives earlier success');
    assert.ok(after.status.includes('앞서 확인한 내용을 공유했습니다. 현재 입력은 보내지 않고 유지했습니다.'), 'sent/unsent distinction survives refresh');
    assert.equal(shares.length, 1); assert.equal(post.body.recipient_id, 'teacher-a'); assert.equal(post.body.content.prompt, 'A: approved question');
    assert.equal(post.body.duration_minutes, 60); assert.equal(post.body.consent, true); assert.equal(post.body.content.self_reliance, undefined); assert.equal(post.body.content.independent_task, undefined);
    report.cases.push({ name, approved_body: post.body, before, after });
    if (name === 'text-and-recipient') await screenshot('retained-unsent-draft');
  }
  console.log('PASS text, recipient, select, checkbox and blank/incomplete optional drafts remain unsent');

  await open(); await select('#kind', 'End'); await click('#reliance-add'); await fill('[data-work]', 'approved row'); await select('[data-how]', 'ArrowDown');
  post = await send(); await click('#reliance-rows button'); const removed = draft(await state()); finish(post); after = await settled();
  assert.deepEqual(draft(after), removed); assert.equal(post.body.content.self_reliance[0].work, 'approved row'); assert.equal(after.rows.length, 0);
  report.cases.push({ name: 'optional-row-removal', after }); console.log('PASS removed optional row stays removed without resetting remaining input');

  await open(); post = await send(); await fill('#prompt', 'B: keep on failure'); const failedDraft = draft(await state()); finish(post, 503); after = await settled();
  assert.deepEqual(draft(after), failedDraft); assert.equal(shares.length, 0); assert.ok(after.status.includes('입력 내용은 유지됩니다.')); assert.ok(!after.status.includes('앞서 확인한'));
  report.cases.push({ name: 'failure-keeps-current-input', after });
  await open(); const count = posts.length, cancelled = draft(await state()); await click('#submit'); await click('#outbound-cancel'); after = await settled();
  assert.equal(posts.length, count); assert.deepEqual(draft(after), cancelled); report.cases.push({ name: 'cancel-sends-nothing', after });
  console.log('PASS failure and Cancel preserve input without claiming success');

  await open(); post = await send(); await fill('#prompt', 'B: discarded by explicit disconnect'); holdRefresh = true; finish(post);
  await until(() => heldGet !== null, 'post-success refresh held'); await click('#logout'); const disconnected = await state();
  respondGet(heldGet); after = await settled(); assert.deepEqual(draft(after), draft(disconnected)); assert.equal(after.status, '연결을 해제했습니다.'); assert.equal(after.records, '연결하지 않았습니다.');
  report.cases.push({ name: 'disconnect-during-refresh', after }); console.log('PASS late refresh cannot restore an unsent notice or discarded input after disconnect');
  report.status = 'PASS';
} finally {
  if (browser) await browser.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  report.cleanup = true;
  if (process.env.SHARE_DRAFT_OUTPUT) await writeFile(process.env.SHARE_DRAFT_OUTPUT + '/result.json', JSON.stringify(report, null, 2) + '\n');
}
