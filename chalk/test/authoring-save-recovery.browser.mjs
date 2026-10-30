// DES-12 / DES-07 / DES-08: uncertain draft saves explain the next action without
// changing SAVE-01 retries. Actual served HTML and Chromium; loopback API fixtures
// model commit/no-commit. This is not Service, D1, authentication or hosted proof.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const guidance = '저장 결과를 확인하지 못했습니다. 입력한 내용은 이 화면에 남아 있습니다. 내용을 바꾸지 말고 ‘초안 저장’을 다시 눌러 주세요.';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runAuthoringSaveRecoveryBrowser() {
  const bin = findChromium();
  if (!bin) {
    if (process.env.FOCUS_REQUIRE_BROWSER) throw Error('authoring-save-recovery: Chromium required');
    console.log('NOT RUN authoring-save-recovery (no headless Chromium)');
    return;
  }
  const evidence = process.env.CHALK_SAVE_RECOVERY_EVIDENCE;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const report = { status: 'RUNNING', cases: [], requests: [], navigationDialogs: [], boundary: 'Actual Chromium and Chalk HTML; synthetic loopback API/ledger', cleanup: false };
  const checkpoint = (phase) => {
    report.phase = phase;
    if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  };
  const bounded = async (promise, label) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timed out: ' + label)), 15000); })]); }
    finally { clearTimeout(timer); }
  };
  const { default: app } = await import('../src/index.ts');
  let browser, mode = 'normal', cutResponse = null, committed = null, navigation = 0;
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && !req.url.startsWith('/admin/')) {
        const r = await app.fetch(new Request('http://127.0.0.1' + req.url), { ENVIRONMENT: 'test' });
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString();
      const row = { method: req.method, path: req.url, body: text ? JSON.parse(text) : null, mode };
      report.requests.push(row);
      if (req.method !== 'PUT' || !/^\/admin\/cohorts\/fixture-cohort\/authoring\/course-[\w-]+$/.test(req.url)) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'fixture-read-refusal' }));
        return;
      }
      if (mode.startsWith('http-')) {
        const status = Number(mode.slice(5));
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: status === 400 ? 'invalid learning fields' : 'fixture-refusal' }));
        return;
      }
      if (committed) assert.deepEqual(row.body, committed.body, 'unchanged retry keeps its request ID and complete body');
      else committed = { body: row.body, revision: 1 };
      const body = Buffer.from(JSON.stringify({ revision: committed.revision }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
      if (mode === 'body-loss') {
        // Do not destroy pre-header: Chromium can transparently retry that loss.
        // The test destroys this response only after CDP observes its 200 headers.
        cutResponse = res;
        res.flushHeaders();
        res.write(body.subarray(0, 1));
      } else res.end(body);
    } catch (error) {
      report.serverError = String(error);
      res.destroy();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const state = () => browser.evaluate(`({status:document.getElementById('status').textContent,title:document.getElementById('title').value,disabled:document.getElementById('save').disabled,pending:pending?JSON.parse(JSON.stringify(pending)):null,revision,dirty,clicks:window.saveClicks})`);
  async function until(expression, label) {
    for (let i = 0; i < 200; i++) {
      if (await browser.evaluate(expression)) return;
      await pause(25);
    }
    throw Error('timed out: ' + label);
  }
  async function click(id) {
    const point = await browser.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:e.disabled};})()`);
    assert.equal(point.disabled, false, id + ' is enabled');
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
  async function fresh() {
    checkpoint('starting-independent-case-' + (navigation + 1));
    committed = null; cutResponse = null; mode = 'normal';
    await browser.send('Network.setBlockedURLs', { urls: ['https://*'] });
    const query = '?case=' + (++navigation);
    const dirtyPage = await browser.evaluate(`typeof dirty!=='undefined'&&dirty`);
    // Independent cases leave the prior draft explicitly. Observe and accept the
    // real beforeunload dialog; never disable the product's unsaved-input guard.
    const dialog = dirtyPage ? browser.waitForEvent((m) => m.method === 'Page.javascriptDialogOpening', 'leave prior fixture draft').then(async (event) => {
      report.navigationDialogs.push({ case: navigation, type: event.params.type });
      checkpoint('leaving-prior-fixture-draft');
      assert.equal(event.params.type, 'beforeunload');
      await browser.send('Page.handleJavaScriptDialog', { accept: true });
    }) : Promise.resolve();
    await bounded(Promise.all([dialog, browser.send('Page.navigate', { url: origin + '/authoring' + query })]), 'independent case navigation');
    await until(`location.search===${JSON.stringify(query)}&&document.readyState==='complete'&&!!document.getElementById('new')`, 'page ready');
    await browser.evaluate(`if(!document.getElementById('first-run').hidden)document.getElementById('fr-later').click();for(const [id,value] of [['token','synthetic-issuer'],['cohort','fixture-cohort'],['profile','fixture-profile']]){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}window.confirm=()=>true;window.saveClicks=[];document.getElementById('save').addEventListener('click',e=>window.saveClicks.push({trusted:e.isTrusted}));0`);
    await click('new');
    await until(`!document.getElementById('save').disabled`, 'new draft');
    await browser.evaluate(`const title=document.getElementById('title');title.value='보존할 수업 제목';title.dispatchEvent(new Event('input',{bubbles:true}));0`);
    checkpoint('independent-case-ready-' + navigation);
  }
  async function save({ brokenBody = false, blocked = false } = {}) {
    let requestId;
    const request = browser.waitForEvent((m) => {
      if (m.method === 'Network.requestWillBeSent' && m.params.request.method === 'PUT' && m.params.request.url.startsWith(origin + '/admin/')) { requestId = m.params.requestId; return true; }
      return false;
    }, 'draft PUT').catch((error) => ({ error: String(error) }));
    const response = blocked ? null : browser.waitForEvent((m) => m.method === 'Network.responseReceived' && m.params.requestId === requestId, 'save response headers').catch((error) => ({ error: String(error) }));
    const completion = browser.waitForEvent((m) => m.method === (brokenBody || blocked ? 'Network.loadingFailed' : 'Network.loadingFinished') && m.params.requestId === requestId, 'save completion').catch((error) => ({ error: String(error) }));
    await click('save');
    const sent = await request; assert.ok(!sent.error, sent.error);
    const headers = response ? await response : null;
    if (headers) assert.ok(!headers.error, headers.error);
    if (brokenBody) {
      assert.equal(headers.params.response.status, 200);
      assert.ok(cutResponse && committed, 'fixture committed and sent original 200 prefix');
      cutResponse.destroy(); cutResponse = null;
    }
    const done = await completion; assert.ok(!done.error, done.error);
    await until('!busy', 'page released save lock');
    return { status: headers?.params.response.status ?? null, completion: done.method, failure: done.params.errorText ?? null, requestId };
  }
  async function snapshot(name) {
    if (!evidence) return;
    await browser.evaluate(`document.getElementById('status').scrollIntoView({block:'center'});0`);
    const r = await browser.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(evidence, name + '.png'), Buffer.from(r.data, 'base64'));
  }
  try {
    browser = await launch(bin);
    await browser.send('Network.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await fresh(); mode = 'body-loss';
    const before = report.requests.length, lost = await save({ brokenBody: true }), failed = await state();
    assert.equal(lost.failure, 'net::ERR_CONTENT_LENGTH_MISMATCH');
    assert.equal(failed.status, guidance);
    assert.equal(failed.title, '보존할 수업 제목');
    assert.equal(failed.disabled, false); assert.equal(failed.revision, 0); assert.equal(failed.dirty, true);
    assert.ok(failed.pending?.id); assert.equal(committed.revision, 1);
    assert.equal(report.requests.length - before, 1, 'no extra application write');
    assert.deepEqual(failed.clicks, [{ trusted: true }]);
    await snapshot('unconfirmed-save');
    mode = 'normal'; const retry = await save(), saved = await state();
    assert.equal(saved.status, '저장했습니다. revision 1');
    assert.equal(saved.pending, null); assert.equal(saved.dirty, false);
    assert.equal(report.requests.length - before, 2);
    assert.deepEqual(report.requests.at(-1).body, report.requests.at(-2).body);
    assert.deepEqual(saved.clicks, [{ trusted: true }, { trusted: true }]);
    report.cases.push({ name: 'postcommit-body-loss-and-explicit-retry', lost, failed, retry, saved, fixtureRows: 1 });
    checkpoint('postcommit-body-loss-and-explicit-retry-complete');
    await snapshot('confirmed-retry');

    await fresh();
    const pre = report.requests.length;
    await browser.send('Network.setBlockedURLs', { urls: ['https://*', origin + '/admin/*'] });
    const blocked = await save({ blocked: true }), precommit = await state();
    assert.equal(precommit.status, guidance); assert.equal(precommit.title, '보존할 수업 제목');
    assert.equal(report.requests.length, pre); assert.equal(committed, null); assert.ok(precommit.pending?.id);
    report.cases.push({ name: 'precommit-fetch-rejection', blocked, state: precommit, fixtureRows: 0 });
    checkpoint('precommit-fetch-rejection-complete');

    await fresh(); const normal = await save(), normalState = await state();
    assert.equal(normalState.status, '저장했습니다. revision 1'); assert.equal(normalState.pending, null);
    report.cases.push({ name: 'normal-save', normal, state: normalState });
    checkpoint('normal-save-complete');

    for (const status of [400, 401, 403, 409]) {
      await fresh(); mode = 'http-' + status;
      const response = await save(), current = await state();
      assert.equal(response.status, status); assert.match(current.status, new RegExp('^HTTP ' + status + ':'));
      assert.notEqual(current.status, guidance); assert.equal(current.title, '보존할 수업 제목');
      assert.equal(current.revision, 0); assert.ok(current.pending?.id); assert.equal(committed, null);
      if (status === 400) assert.match(current.status, /미션·주차·완료 조건을 확인하세요/);
      if (status === 409) assert.match(current.status, /내보낸 뒤 저장본을 다시 열어 비교하세요/);
      report.cases.push({ name: 'parsed-http-' + status, response, state: current });
      checkpoint('parsed-http-' + status + '-complete');
    }
    await fresh();
    const localBefore = report.requests.length;
    await browser.evaluate(`const on=document.getElementById('learning-on');on.checked=true;on.dispatchEvent(new Event('change',{bubbles:true}));0`);
    await click('save'); await until('!busy', 'local validation');
    const invalid = await state(); assert.match(invalid.status, /주차\(1–52\)/);
    assert.equal(report.requests.length, localBefore); assert.equal(invalid.pending, null);
    report.cases.push({ name: 'local-preflight-validation', state: invalid });
    checkpoint('local-preflight-validation-complete');
    assert.equal(report.serverError, undefined);
    report.status = 'PASS';
    console.log('PASS authoring-save-recovery: Korean unknown outcome, unchanged explicit retry, parsed HTTP and preflight controls');
  } catch (error) {
    report.status = 'FAIL'; report.error = String(error); throw error;
  } finally {
    let cleanupError;
    try {
      cutResponse?.destroy();
      if (browser) await browser.close();
    } catch (error) { cleanupError = error; }
    finally {
      try {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      } catch (error) { cleanupError ??= error; }
      finally {
        report.cleanup = !cleanupError;
        if (cleanupError) { report.status = 'FAIL'; report.cleanupError = String(cleanupError); }
        if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
      }
    }
    if (cleanupError && !report.error) throw cleanupError;
  }
}
