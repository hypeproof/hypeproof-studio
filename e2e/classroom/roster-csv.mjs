import '@hypeproof/service-testkit/test/harness/loader.mjs';
// Roster CSV import on /console (CGP-SHELL-R-032 / CGP-SHELL-D-031, classroom-admin ADM-01 roster CSV) in Chromium.
//
// Real: the served /console page and its script, Chalk's forwarder, and the Service router (roster append, issuer
// verification, KV roster) from the pinned test kit. Controlled: the Lab distribution lookup the page makes on load
// (answered with no targets), and one dropped append (aborted in the browser route) to produce a failure.
// Checks, at 1280×900 and 800×900:
//   - a file with BOM + CRLF + quotes + a Korean name + an empty line + a formula row + an invalid handle + a duplicate
//     shows a preview table and the count "정상 4 · 확인 필요 3" with NO append request sent;
//   - the add button stays disabled until the instructor ticks the confirmation; the body is { users: [4 handles] }
//     with no names; the Service roster afterwards holds exactly those handles once;
//   - every sent row gets one line: 추가됨 (new) or 이미 있음 (already on the roster), from the real answer;
//   - a dropped answer marks every sent row 실패 with the reason; "실패한 줄만 다시" sends only those rows and the
//     invalid preview rows are never sent;
//   - pasted text follows the same contract (an over-cap paste is refused whole, nothing sent);
//   - keyboard only: Tab reaches the controls, Space ticks the box, Enter sends.
// Screenshots: e2e/test-results/classroom-roster-csv/ (HPS_ROSTER_SHOTS=<dir> also copies them there).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { localOps } from './service-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), out = path.join(repo, 'e2e/test-results/classroom-roster-csv'); mkdirSync(out, { recursive: true });
const local = await localOps(), { default: chalk } = await import('../../chalk/src/index.ts'), { getRoster, setRoster } = await import('@hypeproof/service-testkit/src/lib/kv.ts');
const realFetch = globalThis.fetch; globalThis.fetch = (url, init) => String(url).startsWith('https://service.test') ? local.app.fetch(new Request(url, init), local.env, { waitUntil() {} }) : realFetch(url, init);
const server = createServer(async (req, res) => { try { const parts = []; for await (const p of req) parts.push(p); const body = Buffer.concat(parts); const r = await chalk.fetch(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), { ...local.env, HPS_SERVICE_ORIGIN: 'https://service.test' }, {}); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); } catch (e) { res.writeHead(500); res.end(String(e)); } });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const BASE_ROSTER = ['student-a', 'student-b', 'student-c', 'legacy-test-seat'];
// The fixture roster already holds student-a and student-b; s01 and s02 are new.
const CSV = '\uFEFFhandle,name\r\ns01,김민지\r\nstudent-a,"에이, 학생"\r\n\r\n=HYPERLINK("x"),수식\r\n김서준,한글 handle\r\ns02,이서준\r\ns01,중복\r\nstudent-b,\r\n';
const SENT = ['s01', 'student-a', 's02', 'student-b'];

let browser;
try {
  browser = await chromium.launch(); const origin = 'http://127.0.0.1:' + server.address().port, errors = [], shots = [];
  const shot = async (p, name, opts = {}) => { const f = path.join(out, name + '.png'); await p.screenshot({ path: f, ...opts }); shots.push(f); };
  for (const width of [1280, 800]) {
    await setRoster(local.env.HPS_KV, local.cohort, BASE_ROSTER);
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.on('pageerror', (e) => errors.push(e.message));
    const appends = []; let dropNext = 0, hold = null;
    await page.route('**/workshop/boa-tokens', (route) => route.fulfill({ json: { targets: [] } }));
    await page.route('**/roster/append', async (route) => {
      appends.push(JSON.parse(route.request().postData()));
      if (dropNext > 0) { dropNext--; return route.abort('connectionreset'); }
      if (hold) await hold.promise;
      return route.continue();
    });
    await page.goto(origin + '/console');
    await page.locator('#issuer').fill(local.teacherToken); await page.locator('#load').click();
    const box = page.locator('fieldset.roster-import'); await box.waitFor();
    assert.match(await box.locator('legend').textContent(), // innerText would read the theme's uppercase legend
      new RegExp('명단 가져오기 \\(CSV\\) — ' + local.cohort));

    // 1. File → preview, nothing sent.
    await box.locator('input[type=file]').setInputFiles({ name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
    await box.locator('[data-ri-summary]').filter({ hasText: '정상 4 · 확인 필요 3' }).waitFor();
    const rows = await box.locator('.ri-table tbody tr').evaluateAll((trs) => trs.map((tr) => ({ bad: tr.classList.contains('ri-bad'), cells: [...tr.children].map((td) => td.textContent) })));
    assert.deepEqual(rows.map((r) => r.cells.slice(0, 3)), [['2', 's01', '김민지'], ['3', 'student-a', '에이, 학생'], ['5', '=HYPERLINK("x")', '수식'], ['6', '김서준', '한글 handle'], ['7', 's02', '이서준'], ['8', 's01', '중복'], ['9', 'student-b', '']]);
    assert.deepEqual(rows.map((r) => r.bad), [false, false, true, true, false, true, false]);
    assert.match(rows[2].cells[3], /^!확인 필요 — =, \+, -, @로 시작하는 칸/, 'formula row: icon + text, shown verbatim, refused');
    assert.match(rows[3].cells[3], /영문 소문자·숫자·하이픈/); assert.match(rows[5].cells[3], /2번째 줄과 같은 handle/);
    assert.equal(await page.evaluate(() => typeof window.__formula), 'undefined');
    assert.equal(appends.length, 0, 'the preview sends nothing');
    const send = box.locator('[data-ri-send]');
    assert.equal(await send.innerText(), '정상 4명 명단에 추가');
    assert.equal(await send.isDisabled(), true, 'disabled until confirmed');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal overflow at ' + width);
    await shot(page, `roster-preview-${width}`, { fullPage: true });

    // 2. Keyboard: confirm with Space, send with Enter. The first answer is dropped → every sent row 실패.
    dropNext = 1;
    await box.locator('[data-ri-confirm]').focus(); await page.keyboard.press('Space');
    assert.equal(await send.isDisabled(), false);
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-ri-send')), true, 'Tab moves from the box to the add button');
    await page.keyboard.press('Enter');
    await box.locator('[data-ri-count]').filter({ hasText: '추가됨 0 · 이미 있음 0 · 실패 4' }).waitFor();
    assert.deepEqual(appends[0], { users: SENT }, 'handles only, valid rows only, in file order');
    assert.doesNotMatch(JSON.stringify(appends[0]), /김민지|이서준|에이|HYPERLINK|김서준/);
    const failed = await box.locator('.ri-results li').allInnerTexts();
    assert.equal(failed.length, 4); for (const t of failed) assert.match(t, /^✕실패 · .+ — 결과를 확인하지 못했어요\. 다시 보내도 같은 학생이 두 번 등록되지는 않아요\.$/);
    assert.equal(await box.locator('[data-ri-retry]').isVisible(), true);
    await shot(page, `roster-failed-${width}`, { fullPage: true });

    // 3. Retry only the failed rows → real per-row answer from the Service. While it is in flight the inputs are locked (L1).
    let release; hold = { promise: new Promise((r) => { release = r; }) };
    await box.locator('[data-ri-retry]').click();
    await page.waitForFunction(() => document.querySelector('fieldset.roster-import input[type=file]').disabled);
    assert.equal(await box.locator('input[type=file]').isDisabled(), true, 'file input locked while a send is in flight');
    assert.equal(await box.locator('textarea').evaluate((t) => t.readOnly), true, 'textarea locked while a send is in flight');
    await box.locator('textarea').press('End').catch(() => {}); await page.keyboard.type('x'); assert.doesNotMatch(await box.locator('textarea').inputValue(), /x$/, 'typing changes nothing while locked');
    release(); hold = null;
    await box.locator('[data-ri-count]').filter({ hasText: '추가됨 2 · 이미 있음 2 · 실패 0' }).waitFor();
    assert.deepEqual(appends[1], { users: SENT }, 'the retry carries exactly the failed rows, not the refused preview rows');
    assert.deepEqual(await box.locator('.ri-results li').evaluateAll((li) => li.map((x) => [x.dataset.handle, x.dataset.state])), [['s01', 'added'], ['student-a', 'exists'], ['s02', 'added'], ['student-b', 'exists']]);
    assert.match((await box.locator('.ri-results li').first().innerText()), /^✓추가됨 · s01 \(김민지\)$/);
    assert.equal(await box.locator('[data-ri-retry]').isVisible(), false, 'no failures, no retry button');
    assert.equal(await box.locator('input[type=file]').isDisabled(), false, 'inputs unlocked after the answer');
    // M1: the name sits in its own <bdi>, so its direction cannot reorder the rest of the line.
    assert.deepEqual(await box.locator('.ri-results li bdi').allTextContents(), ['김민지', '에이, 학생', '이서준']);
    // L2: the same CSV cannot be sent again; the button says why and the results stay.
    assert.equal(await send.isDisabled(), true, '추가 is off after a send'); assert.equal(await send.innerText(), '보냈어요 · CSV를 바꾸면 다시 보낼 수 있어요');
    await box.locator('[data-ri-preview]').click(); await box.locator('[data-ri-summary]').filter({ hasText: '정상 4' }).waitFor();
    assert.equal(await send.isDisabled(), true, 're-previewing the same CSV does not re-enable 추가');
    assert.equal(await box.locator('[data-ri-count]').innerText(), '추가됨 2 · 이미 있음 2 · 실패 0', 'the last result stays visible');
    assert.deepEqual((await getRoster(local.env.HPS_KV, local.cohort)).users, [...BASE_ROSTER, 's01', 's02'], 'the Service roster holds each new handle once');
    await shot(page, `roster-results-${width}`, { fullPage: true });

    // 4. Paste path, same contract: an over-cap paste is refused whole and nothing is sent.
    const before = appends.length;
    await box.locator('textarea').fill('handle\n' + Array.from({ length: 201 }, (_, i) => 'p-' + i).join('\n'));
    assert.equal(await box.locator('[data-ri-preview-area]').isVisible(), false, 'editing voids the previous preview');
    await box.locator('[data-ri-preview]').click();
    await box.locator('[data-ri-error]').filter({ hasText: '한 번에 200줄까지 받아요. 지금 201줄이에요.' }).waitFor();
    assert.equal(await box.locator('[data-ri-results-area]').isVisible(), true, 'the last result stays visible after a new input (L2)');
    // L2: a changed CSV may be sent again.
    await box.locator('textarea').fill('handle\ns03'); await box.locator('[data-ri-preview]').click(); await box.locator('[data-ri-confirm]').check();
    assert.equal(await send.isDisabled(), false, 'a changed CSV re-enables 추가'); assert.equal(await send.innerText(), '정상 1명 명단에 추가');
    assert.equal(appends.length, before, 'nothing sent');
    console.log(`PASS ${width}px: preview before send (정상 4 · 확인 필요 3, 0 requests), confirm gate, handles-only body, dropped answer → 실패 ×4, retry → 추가됨 2 · 이미 있음 2 from the Service, over-cap paste refused`);
    await page.close();
  }
  assert.deepEqual(errors, [], 'no page errors');
  if (process.env.HPS_ROSTER_SHOTS) { mkdirSync(process.env.HPS_ROSTER_SHOTS, { recursive: true }); for (const f of shots) copyFileSync(f, path.join(process.env.HPS_ROSTER_SHOTS, path.basename(f))); }
  console.log('roster CSV browser checks passed → ' + out);
} finally { await browser?.close(); server.close(); }
