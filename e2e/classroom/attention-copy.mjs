import '@hypeproof/service-testkit/test/harness/loader.mjs';
// Attention item copy (CGP-AGENT-R-013, classroom-admin ADM-09 attention-copy table) in a real browser.
//
// Every seat reason the instructor page knows is drawn once: 21 seats, one reason each, plus a shared provider incident line.
// Checks, at 1280×900 and 800×900:
//   - each row's stage reads exactly the item title, and the title is not clipped (scrollWidth <= clientWidth) or wrapped
//     onto a third line; the page has no horizontal overflow;
//   - the incident line names the title and the affected count;
//   - at 1280, opening each seat's detail shows "앱이 보고한 상태: <title> — <summary>".
// Real: Chalk page, script and forwarder in Chromium, the Service router + SQLite for the run, roster and pairing.
// Synthetic: the reason and attention on each seat — the /status response is rewritten in the browser route, because
// several reasons (budget, class closed, roster) cannot be produced together on one run. Copy only; no behaviour is asserted.
// Screenshots: e2e/test-results/classroom-attention-copy/ (HPS_ATTENTION_SHOTS=<dir> also copies them there).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { localOps, OPS_ALL } from './service-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), out = path.join(repo, 'e2e/test-results/classroom-attention-copy'); mkdirSync(out, { recursive: true });
const html = readFileSync(path.join(repo, 'chalk/src/ui/manage.html'), 'utf8');
const labels = JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.match(/const reasonLabels=(\{[^\n]*\});\n/)[1] + ')')));
const REASONS = Object.keys(labels);
// Attention per reason as the Service would rate it: unknown for missing/stale signals, ok for approval wait, caution for
// an upload retry, blocked for the rest. Only the tag colour depends on it; the copy under test does not.
const attentionOf = (r) => ['no_signal', 'stale_signal', 'not_connected'].includes(r) ? 'unknown' : r === 'waiting_approval' ? 'ok' : r === 'upload_failed' ? 'caution' : 'blocked';

const local = await localOps(), { default: chalk } = await import('../../chalk/src/index.ts'), { setRoster } = await import('@hypeproof/service-testkit/src/lib/kv.ts');
const realFetch = globalThis.fetch; globalThis.fetch = (url, init) => String(url).startsWith('https://service.test') ? local.app.fetch(new Request(url, init), local.env, { waitUntil() {} }) : realFetch(url, init);
const server = createServer(async (req, res) => { try { const parts = []; for await (const p of req) parts.push(p); const body = Buffer.concat(parts); const r = await chalk.fetch(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), { ...local.env, HPS_SERVICE_ORIGIN: 'https://service.test' }, {}); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); } catch (e) { res.writeHead(500); res.end(String(e)); } });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
let browser;
try {
  const seats = REASONS.map((_, i) => ({ seat_id: 'S' + String(i + 1).padStart(2, '0'), student_id: 'student-' + String(i + 1).padStart(2, '0') }));
  const reasonOf = Object.fromEntries(seats.map((s, i) => [s.seat_id, REASONS[i]]));
  await setRoster(local.env.HPS_KV, local.cohort, seats.map((s) => s.student_id)); await local.freeze();
  assert.equal((await local.configure(seats, 0, { flags: { ops_observe: true, ops_commands: true } })).status, 201);
  let n = 0; for (const s of seats) { n++; const c = (await local.pair(s.seat_id, 1, n)).conn.json; assert.equal((await local.sync(c.credential, [local.event(1, 'activation', { stage: 'runtime_ready' })], n)).status, 200); }
  const teacher = await local.teacher('teacher-a', OPS_ALL);
  const shared = seats.filter((s) => reasonOf[s.seat_id] === 'provider_5xx').map((s) => s.seat_id);

  browser = await chromium.launch(); const origin = 'http://127.0.0.1:' + server.address().port, errors = [], shots = [];
  const open = async (viewport) => {
    const p = await browser.newPage({ viewport }); p.on('pageerror', (e) => errors.push(e.message));
    await p.route(/\/classroom\/runs\/[^/]+\/status(\?|$)/, async (route) => {
      const r = await route.fetch(), d = await r.json();
      for (const s of d.seats) { s.reason = reasonOf[s.seat_id]; s.attention = attentionOf(s.reason); s.recommended = null; }
      d.incidents = [{ class: 'provider_5xx', seats: shared.concat(['S98', 'S99']) }];
      await route.fulfill({ response: r, json: d });
    });
    await p.goto(origin + '/manage');
    await p.locator('#token').fill(teacher); await p.locator('#cohort').fill(local.cohort); await p.locator('#prefix').fill('student-'); await p.locator('#connect-go').click();
    await p.locator('#status').filter({ hasText: '연결됨' }).waitFor(); await p.locator('#ops-seats .ops-seat').nth(seats.length - 1).waitFor();
    return p;
  };
  const shot = async (p, name, opts = {}) => { const f = path.join(out, name + '.png'); await p.screenshot({ path: f, ...opts }); shots.push(f); };

  for (const width of [1280, 800]) {
    const page = await open({ width, height: 900 });
    // Every row stage is the item title, whole: not clipped by its box and not wrapped past two lines.
    const rows = await page.evaluate(() => [...document.querySelectorAll('#ops-seats .ops-seat')].map((r) => { const st = r.querySelector('.c-step .stage'), lh = parseFloat(getComputedStyle(st).lineHeight) || 20;
      return { seat: r.dataset.seat, text: st.textContent, clipped: st.scrollWidth > st.clientWidth + 1, lines: Math.round(st.getBoundingClientRect().height / lh), tag: r.querySelector('.c-step .tag')?.textContent }; }));
    assert.equal(rows.length, seats.length);
    for (const r of rows) {
      assert.equal(r.text, labels[reasonOf[r.seat]][0], r.seat + ' stage is the ' + reasonOf[r.seat] + ' title');
      assert.equal(r.clipped, false, r.seat + ' title clipped at ' + width);
      assert.ok(r.lines <= 2, r.seat + ' title takes ' + r.lines + ' lines at ' + width);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal page overflow at ' + width);
    assert.match(await page.locator('#ops-incidents').innerText(), new RegExp(labels.provider_5xx[0] + ' · 영향 ' + (shared.length + 2) + '명'));
    console.log('PASS ' + width + 'px: ' + rows.length + ' rows show their item title whole; max lines ' + Math.max(...rows.map((r) => r.lines)) + '; incident line names title and count');
    await shot(page, `attention-list-${width}`, { fullPage: true });
    // The list scrolls inside its own box: a second picture shows the last rows (S15–S21: upload, unknown, signals, approval).
    await page.locator(`#ops-seats .ops-seat[data-seat="${seats.at(-1).seat_id}"]`).scrollIntoViewIfNeeded(); await shot(page, `attention-list-${width}-end`);
    if (width === 1280) {
      // The detail line pairs the title with its summary (the next step). Checked for every reason.
      for (const s of seats) {
        await page.locator(`#ops-seats .ops-seat[data-seat="${s.seat_id}"] .seat-open`).click();
        const [title, summary] = labels[reasonOf[s.seat_id]];
        const cause = page.locator('#ops-cause details').first(); await cause.waitFor({ state: 'attached' }); if (!(await cause.evaluate((e) => e.open))) await cause.locator('> summary').click();
        await page.locator('#ops-recovery').filter({ hasText: '앱이 보고한 상태: ' + title + ' — ' + summary }).waitFor({ timeout: 5000 });
        if (['S04', 'S20', 'S21'].includes(s.seat_id)) await shot(page, `attention-detail-${reasonOf[s.seat_id]}-${width}`);
      }
      console.log('PASS 1280px detail: every reason shows "앱이 보고한 상태: <title> — <summary>"');
    }
    await page.close();
  }
  assert.deepEqual(errors, [], 'no page errors');
  if (process.env.HPS_ATTENTION_SHOTS) { mkdirSync(process.env.HPS_ATTENTION_SHOTS, { recursive: true }); for (const f of shots) copyFileSync(f, path.join(process.env.HPS_ATTENTION_SHOTS, path.basename(f))); }
  console.log('attention copy browser checks passed → ' + out);
} finally { await browser?.close(); server.close(); }
