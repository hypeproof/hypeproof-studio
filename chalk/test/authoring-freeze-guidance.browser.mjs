// DES-12 / scoped T-26: current Web freeze guidance, not Studio integration.
// Actual served Chalk HTML + Chromium; loopback API is synthetic. The complete
// 422 body below is retained native evidence; this suite does not run Service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const retained422 = "{\"error\":\"수업 설계가 교육 원칙 검사를 통과하지 못했습니다\",\"reason\":\"pedagogy_blocked\",\"findings\":[{\"check\":\"lesson_prerequisites\",\"severity\":\"fail\",\"message\":\"수업의 선행 조건이 비어 있습니다.\",\"remedy\":\"필요한 사전 역량·준비물을 적으세요. 없다면 \\\"코딩 경험 불필요\\\"처럼 없다는 사실을 명시적으로 적습니다.\",\"source\":\"hypeproof_kids_edu 커리큘럼 위키 (조항 미확정)\"},{\"check\":\"step_evidence\",\"severity\":\"warn\",\"step_id\":\"step-c3108ad3\",\"message\":\"단계 \\\"기준 만들기\\\"에 남는 증거물이 지목되지 않았습니다.\",\"remedy\":\"안내 본문에 \\\"제출 증거: <파일명 또는 산출물>\\\" 한 줄을 추가하세요. 제3자가 볼 수 있는 물건이어야 하며 소감·성찰은 증거가 아닙니다.\",\"source\":\"lint 2 · curriculum_wiki/rules/curriculum-schema.md\"},{\"check\":\"step_evidence\",\"severity\":\"warn\",\"step_id\":\"step-18651939\",\"message\":\"단계 \\\"이유 선택\\\"에 남는 증거물이 지목되지 않았습니다.\",\"remedy\":\"안내 본문에 \\\"제출 증거: <파일명 또는 산출물>\\\" 한 줄을 추가하세요. 제3자가 볼 수 있는 물건이어야 하며 소감·성찰은 증거가 아닙니다.\",\"source\":\"lint 2 · curriculum_wiki/rules/curriculum-schema.md\"},{\"check\":\"duration_consistency\",\"severity\":\"warn\",\"skipped\":true,\"message\":\"단계별 시간이 스키마에 없어 수업 시간과의 정합을 확인하지 못했습니다. 통과가 아니라 미확인입니다.\",\"remedy\":\"단계 시간 검사를 켜려면 steps[]에 시간 필드가 필요합니다. 칸이 생기면 ±10분으로 판정합니다. 필드 추가는 저작 화면의 미확인 필드 보존(#1036)이 먼저입니다.\",\"source\":\"관문2-9 (±10분) · curriculum_wiki/design/lesson-plan-quality-checklist.md\"}]}";
const original = {"schema": "hps-session-design/1", "title": "합성 기준과 선택", "audience": "합성 성인 학습자", "duration_minutes": 60, "objective": "확인 기준과 고른 이유를 문장으로 남긴다", "prerequisites": "", "starter": "로컬 합성 텍스트 예제", "steps": [{"id": "step-c3108ad3", "title": "기준 만들기", "instructions": "완료를 확인할 기준을 적으세요.", "hint": "자신이 쓴 한 문장을 다시 읽으세요.", "acceptance": "한 문장이 남아 있습니다.", "help": {"default": "hint", "allowed": ["hint", "independent"]}, "ui": "criterion_form"}, {"id": "step-18651939", "title": "이유 선택", "instructions": "선택한 이유를 적으세요.", "hint": "자신이 쓴 한 문장을 다시 읽으세요.", "acceptance": "한 문장이 남아 있습니다.", "help": {"default": "hint", "allowed": ["hint", "independent"]}, "ui": "decision_form"}], "features": {"allowed": ["read"]}, "learning": {"week": 1, "mission": "예약 안내의 확인 기준과 고른 이유를 남긴다", "completion": [{"id": "c-d151765d", "text": "확인 기준을 한 문장으로 저장한다", "event": "criterion_set"}]}};
const digest = (body) => createHash('sha256').update(body).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runAuthoringFreezeGuidanceBrowser() {
  const bin = findChromium();
  if (!bin) {
    if (process.env.FOCUS_REQUIRE_BROWSER) throw Error('authoring-freeze-guidance: Chromium required');
    console.log('NOT RUN authoring-freeze-guidance (no headless Chromium)'); return;
  }
  assert.equal(digest(retained422), '39349b13f4ac43cbb208a601718e495b493f6f6b3e4917b839254a46a38721fa');
  const evidence = process.env.CHALK_FREEZE_GUIDANCE_EVIDENCE;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const report = { status: 'RUNNING', cases: [], requests: [], dialogs: [], disclosures: [], cleanup: false,
    boundary: 'Actual Chromium/served Chalk HTML; synthetic API, no Service/authentication/provider' };
  const checkpoint = (phase) => { report.phase = phase; if (evidence) writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n'); };
  const bounded = async (promise, label) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timed out: ' + label)), 15000); })]); } finally { clearTimeout(timer); } };
  const { default: app } = await import('../src/index.ts');
  let browser, navigation = 0, saved = structuredClone(original), savedRevision = 1, responseBody = retained422, responseStatus = 422;
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && !req.url.startsWith('/admin/')) {
        const r = await app.fetch(new Request('http://127.0.0.1' + req.url), { ENVIRONMENT: 'test' });
        res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
      }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const row = { method: req.method, path: req.url, body, request_sha256: digest(body) };
      report.requests.push(row);
      const draftPath = '/admin/cohorts/fixture-cohort/authoring/fixture-course';
      let status = 200, output;
      if (req.method === 'GET' && req.url === draftPath) output = JSON.stringify({ profile_id: 'fixture-profile', revision: savedRevision, content: saved });
      else if (req.method === 'PUT' && req.url === draftPath) {
        const input = JSON.parse(body); assert.equal(input.expected_revision, savedRevision); assert.ok(input.request_id);
        saved = input.content; savedRevision++; output = JSON.stringify({ revision: savedRevision });
      } else if (req.method === 'PUT' && req.url.startsWith(draftPath + '/versions/')) { status = responseStatus; output = responseBody; }
      else if (req.method === 'GET' && req.url.endsWith('/readiness')) output = JSON.stringify({ state: 'not_run', content: saved, confirmed: null });
      else { report.unexpectedRequest = row; status = 503; output = JSON.stringify({ error: 'fixture-refusal' }); }
      row.status = status; row.response_body = output; row.response_sha256 = digest(output);
      res.once('finish', () => { row.finished = true; });
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(output) }); res.end(output);
    } catch (error) { report.serverError = String(error); res.destroy(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function until(expression, label) {
    for (let i = 0; i < 240; i++) { if (await browser.evaluate(expression)) return; await pause(25); }
    throw Error('timed out: ' + label);
  }
  async function mouse(point) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
  async function click(selector) {
    // Open each actual enclosing disclosure with a pointer before its control.
    let revealed = false;
    for (let depth = 0; depth < 8; depth++) {
      const point = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing control');let d=e.parentElement?.closest('details:not([open])'),outer=d;while(d){outer=d;d=d.parentElement?.closest('details:not([open])');}if(!outer)return null;const s=outer.querySelector(':scope > summary');s.scrollIntoView({block:'center'});const r=s.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,index:[...document.querySelectorAll('details')].indexOf(outer)};})()`);
      if (!point) { revealed = true; break; }
      await mouse(point);
      const opened = await browser.evaluate(`document.querySelectorAll('details')[${point.index}].open`);
      report.disclosures.push({ selector, point, opened });
      assert.equal(opened, true, 'pointer opens enclosing disclosure: ' + JSON.stringify({ selector, point }));
    }
    assert.equal(revealed, true, 'bounded disclosure ancestry: ' + selector);
    const point = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,disabled:!!e.disabled};})()`);
    assert.equal(point.disabled, false, selector + ' enabled'); assert.ok(point.width > 0 && point.height > 0, selector + ' visible');
    await mouse(point);
  }
  async function fill(selector, value) {
    await click(selector);
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers });
    await browser.send('Input.insertText', { text: value });
  }
  async function acceptDialog(type) {
    const event = await browser.waitForEvent((m) => m.method === 'Page.javascriptDialogOpening', type);
    report.dialogs.push(event.params); assert.equal(event.params.type, type);
    await browser.send('Page.handleJavaScriptDialog', { accept: true });
  }
  async function action(selector, { method = 'PUT', confirm = false } = {}) {
    let id;
    const request = browser.waitForEvent((m) => {
      if (m.method === 'Network.requestWillBeSent' && m.params.request.method === method && m.params.request.url.startsWith(origin + '/admin/')) { id = m.params.requestId; return true; } return false;
    }, 'action request').catch((error) => ({ error: String(error) }));
    const headers = browser.waitForEvent((m) => m.method === 'Network.responseReceived' && m.params.requestId === id, 'action response').catch((error) => ({ error: String(error) }));
    const finished = browser.waitForEvent((m) => m.method === 'Network.loadingFinished' && m.params.requestId === id, 'action full body').catch((error) => ({ error: String(error) }));
    const dialog = confirm ? acceptDialog('confirm') : Promise.resolve();
    await click(selector); await dialog;
    for (const value of [await request, await headers, await finished]) assert.ok(!value.error, value.error);
    await until('!busy', 'action complete');
    const response = await browser.send('Network.getResponseBody', { requestId: id });
    const text = response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body;
    const row = report.requests.findLast((r) => r.method === method && r.response_body === text);
    assert.ok(row?.finished, 'server full response completed'); assert.equal(digest(text), row.response_sha256);
    return { status: (await headers).params.response.status, body: text, sha256: digest(text), fullBody: true };
  }
  const state = () => browser.evaluate(`({status:$('status').textContent,hidden:$('freeze-guidance')?.hidden??true,findings:$('freeze-findings')?.textContent??'',rows:[...document.querySelectorAll('#freeze-findings li')].map(x=>x.textContent),actions:document.querySelectorAll('#freeze-findings button').length,content:content(),revision,dirty,candidateVersion,completion:$('completion').textContent,confirmDisabled:$('confirm-go').disabled,events:window.guidanceEvents})`);
  async function fresh() {
    checkpoint('fresh-' + (++navigation));
    saved = structuredClone(original); savedRevision = 1; responseStatus = 422; responseBody = retained422;
    const dirty = await browser.evaluate(`typeof dirty!=='undefined'&&dirty`);
    const dialog = dirty ? acceptDialog('beforeunload') : Promise.resolve();
    const query = '?freeze-case=' + navigation;
    await bounded(Promise.all([dialog, browser.send('Page.navigate', { url: origin + '/authoring' + query })]), 'fresh page navigation');
    await until(`location.search===${JSON.stringify(query)}&&document.readyState==='complete'&&typeof busy!=='undefined'`, 'new page');
    if (await browser.evaluate(`!$('first-run').hidden`)) await click('#fr-later');
    // Only synthetic identity setup uses DOM assignment; product actions below use real input.
    await browser.evaluate(`for(const [id,value] of [['token','synthetic-issuer'],['cohort','fixture-cohort'],['profile','fixture-profile'],['course','fixture-course']]){const e=$(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}window.guidanceEvents=[];document.addEventListener('click',e=>{if(e.target.matches('#freeze,#save,#freeze-findings button'))window.guidanceEvents.push({id:e.target.id||'guidance-action',trusted:e.isTrusted});});0`);
    await action('#load', { method: 'GET' });
    await until(`!$('freeze').disabled`, 'saved draft ready');
  }
  async function freeze() { return action('#freeze', { confirm: true }); }
  async function screenshot(name) {
    if (!evidence) return;
    await browser.evaluate(`$('freeze-guidance').scrollIntoView({block:'center'});0`);
    const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  function noCandidate(s) { assert.equal(s.candidateVersion, ''); assert.equal(s.completion, ''); assert.equal(s.confirmDisabled, true); }
  try {
    browser = await launch(bin); await browser.send('Network.enable');
    await browser.send('Network.setBlockedURLs', { urls: ['https://*'] });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await fresh(); const before = await state(), response = await freeze(), blocked = await state();
    report.retainedObservation = { response, before, blocked }; checkpoint('retained-422-observed');
    assert.equal(response.status, 422); assert.equal(response.body, retained422);
    assert.equal(blocked.hidden, false, 'completed blocked freeze exposes actionable findings');
    assert.deepEqual(blocked.content, before.content); assert.equal(blocked.dirty, false); noCandidate(blocked);
    assert.equal(blocked.rows.length, 3); assert.match(blocked.rows[0], /^수정 필요.*선수 조건/s);
    assert.match(blocked.rows[1], /^권장/); assert.match(blocked.rows[2], /^미확인/);
    assert.doesNotMatch(blocked.findings, /lesson_prerequisites|steps\[\]|curriculum_wiki|#1036|step-c3108ad3/);
    await screenshot('blocked-1280');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    const geometry = await browser.evaluate(`(()=>{const e=$('freeze-guidance');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {width:innerWidth,page:document.scrollingElement.scrollWidth,left:r.left,right:r.right,height:r.height,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,lines:[...e.querySelectorAll('li')].map(n=>{const a=document.createRange();a.selectNodeContents(n);return [...a.getClientRects()].map(x=>({left:x.left,right:x.right}));})};})()`);
    assert.equal(geometry.width, 375); assert.ok(geometry.height > 0 && geometry.page <= 375);
    assert.ok(geometry.left >= 0 && geometry.right <= 375 && geometry.scrollWidth <= geometry.clientWidth);
    assert.ok(geometry.lines.flat().every((r) => r.left >= geometry.left && r.right <= geometry.right));
    await screenshot('blocked-375');
    // Tab back from the following input, then activate the real action with Enter.
    await click('#rehearsal-learner');
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8 });
    assert.equal(await browser.evaluate(`document.activeElement.textContent`), '선수 조건 입력으로 이동');
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.equal(await browser.evaluate(`document.activeElement.id`), 'prerequisites');
    await fill('#prerequisites', '코딩 경험 불필요');
    assert.equal((await state()).hidden, true, 'editing invalidates the old result');
    assert.equal(report.requests.filter((r) => r.method === 'PUT').length, 1, 'guidance action and typing do not write');
    const savedResponse = await action('#save'); assert.equal(savedResponse.status, 200); assert.equal(saved.prerequisites, '코딩 경험 불필요');
    responseStatus = 201; responseBody = JSON.stringify({ version: 'candidate-only' });
    const success = await freeze(), completed = await state();
    assert.equal(success.status, 201); assert.equal(completed.hidden, true); assert.ok(completed.candidateVersion);
    assert.match(completed.completion, /아직 확정이 아닙니다/); assert.equal(completed.confirmDisabled, true);
    assert.ok(completed.events.length >= 4 && completed.events.every((e) => e.trusted));
    report.cases.push({ name: 'retained422-visible-remedy-correction-explicit-save-and-freeze', blocked, geometry, success, completed }); checkpoint('retained-recovery-pass');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    for (const [name, body] of [
      ['unknown', { reason: 'pedagogy_blocked', error: '<img src=x onerror=alert(1)>SECRET', findings: [{ check: 'unknown', severity: 'fail', message: 'SECRET', remedy: '<script>SECRET</script>' }] }],
      ['malformed', { reason: 'pedagogy_blocked', findings: { check: 'lesson_prerequisites', severity: 'fail' } }],
      ['inconsistent', { reason: 'pedagogy_blocked', findings: [{ check: 'lesson_prerequisites', severity: 'warn' }, { check: 'duration_consistency', severity: 'warn', skipped: true }] }],
      ['hostile-known', { reason: 'pedagogy_blocked', error: 'SECRET', findings: [{ check: 'lesson_prerequisites', severity: 'fail', message: '<svg onload=alert(1)>SECRET', remedy: 'SECRET', source: 'SECRET' }] }],
    ]) {
      await fresh(); responseBody = JSON.stringify(body); const result = await freeze(), s = await state();
      assert.equal(result.status, 422); assert.equal(s.hidden, false); noCandidate(s); assert.deepEqual(s.content, original);
      assert.doesNotMatch(s.status + s.findings, /SECRET|<svg|<img|<script|lesson_prerequisites/);
      assert.equal(await browser.evaluate(`document.querySelectorAll('#freeze-guidance img,#freeze-guidance svg,#freeze-guidance script').length`), 0);
      assert.equal(s.actions, name === 'hostile-known' ? 1 : 0);
      if (name !== 'hostile-known') assert.match(s.findings, /자세히 표시하지 못했습니다/);
      report.cases.push({ name: 'safe-' + name, response: result, state: s }); checkpoint('safe-' + name);
    }
    for (const code of [400, 401, 403, 409, 422]) {
      await fresh(); responseStatus = code; responseBody = JSON.stringify({ error: 'fixture-refusal', reason: code === 422 ? 'another-reason' : 'pedagogy_blocked', findings: JSON.parse(retained422).findings });
      const response = await freeze(), s = await state(); assert.equal(response.status, code); assert.match(s.status, new RegExp('^HTTP ' + code + ':'));
      assert.equal(s.hidden, true); noCandidate(s); assert.deepEqual(s.content, original);
      if (code === 409) assert.match(s.status, /내보낸 뒤 저장본을 다시 열어 비교하세요/);
      report.cases.push({ name: 'completed-http-' + code, response, state: s }); checkpoint('http-' + code);
    }
    const lifetimes = [];
    for (const transition of ['cohort', 'profile', 'course', 'load', 'new', 'forget']) {
      await fresh(); await freeze(); assert.equal((await state()).hidden, false);
      if (['cohort', 'profile', 'course'].includes(transition)) await fill('#' + transition, 'other-' + transition);
      else if (transition === 'load') await action('#load', { method: 'GET' });
      else { await click('#' + transition); await until('!busy', transition); }
      const s = await state(); assert.equal(s.hidden, true); assert.equal(s.actions, 0); lifetimes.push({ transition, state: s });
    }
    report.cases.push({ name: 'scope-load-new-forget-clear-old-findings', lifetimes }); checkpoint('lifetimes-pass');
    assert.equal(report.serverError, undefined); assert.equal(report.unexpectedRequest, undefined);
    report.status = 'PASS'; console.log('PASS authoring-freeze-guidance: actionable retained422, safe projection, explicit correction and lifecycle/auth preservation');
  } catch (error) { report.status = 'FAIL'; report.error = String(error); throw error; }
  finally {
    let cleanupError;
    try { if (browser) await browser.close(); } catch (error) { cleanupError = error; }
    finally { try { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } catch (error) { cleanupError ??= error; }
      report.cleanup = !cleanupError; if (cleanupError) { report.status = 'FAIL'; report.cleanupError = String(cleanupError); } checkpoint('finished'); }
    if (cleanupError && !report.error) throw cleanupError;
  }
}
