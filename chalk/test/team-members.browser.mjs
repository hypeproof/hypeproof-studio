// The team control on the REAL served /manage page in headless Chromium, against a mocked Service that behaves like
// PUT /v1/curriculum/projects/:id/members: it replaces the list and refuses a seat outside the roster.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('team-members.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  team-members.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const SHIM = '<script>if (!crypto.randomUUID) crypto.randomUUID = () => "00000000-0000-4000-8000-" + String(Math.random()).slice(2, 14).padEnd(12, "0");</script>';
const served = await (await app.fetch(new Request('https://chalk.test/manage'), { ENVIRONMENT: 'test' })).text();
const html = served.replace('<head>', '<head>' + SHIM);

const SETUP = `(async () => {
  window.__team = ['seat-a', 'seat-b'];
  window.__roster = ['seat-a', 'seat-b', 'seat-c'];
  window.__puts = [];
  window.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET';
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u === '/v1/curriculum/director/projects') return json(200, { projects: [
      { id: 'p-1', title: '키오스크', cohort_id: 'c1', profile_id: 'pf', members: [...__team] },
      { id: 'p-other', title: '다른 수업', cohort_id: 'c2', profile_id: 'pf', members: ['x'] },
    ] });
    if (u === '/v1/curriculum/projects/p-1/members' && method === 'PUT') {
      const members = JSON.parse(opts.body).members; __puts.push(members);
      const missing = members.filter((m) => !__roster.includes(m));
      if (missing.length) return json(400, { error: { type: 'curriculum', code: 'members_not_in_roster', members: missing } });
      __team = [...members];
      return json(200, { project: { id: 'p-1', members: [...__team] } });
    }
    return json(404, { error: { type: 'not_found' } });
  };
  connected = true; cohort = 'c1'; board = { seats: [] };
  await chalkTeamMembers.load();
  return [...document.querySelectorAll('#team-project option')].map((o) => o.value);
})()`;
const add = (id) => `(() => { document.getElementById('team-seat').value = ${JSON.stringify(id)}; document.getElementById('team-add').requestSubmit(); })()`;
const save = `(async () => { const b = document.getElementById('team-save'); if (b.disabled) return 'disabled'; b.click(); for (let i = 0; i < 50 && document.getElementById('team-reload').disabled; i++) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 20)); return 'clicked'; })()`;
const state = `({ team: __team, puts: __puts, status: document.getElementById('team-status').textContent, listed: [...document.querySelectorAll('#team-list li')].map((l) => l.dataset.member), saveDisabled: document.getElementById('team-save').disabled })`;

const browser = await launch(bin);
try {
  await browser.load(html);
  // The helper's evaluate does not await a promise, so async steps go through CDP directly.
  const page = { eval: async (js) => {
    const r = await browser.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  } };
  assert.deepEqual(await page.eval(SETUP), ['p-1'], 'only this class\'s projects are offered');

  // Adding a member sends the existing team too.
  await page.eval(add('seat-c'));
  assert.equal(await page.eval(save), 'clicked');
  let s = await page.eval(state);
  assert.deepEqual(s.puts.at(-1), ['seat-a', 'seat-b', 'seat-c']);
  assert.deepEqual(s.team, ['seat-a', 'seat-b', 'seat-c'], 'no existing member was dropped');

  // A seat outside the roster: the Service's refusal is shown, the team and the draft stay.
  await page.eval(add('seat-zz'));
  await page.eval(save);
  s = await page.eval(state);
  assert.match(s.status, /수업 명단에 없는 학생입니다: seat-zz/);
  assert.deepEqual(s.team, ['seat-a', 'seat-b', 'seat-c']);
  assert.ok(s.listed.includes('seat-zz'), 'the instructor can still see and fix the refused seat');
  await page.eval(`document.querySelector('#team-list li[data-member="seat-zz"] button').click()`);

  // Removing needs the confirmation before the save opens.
  await page.eval(`document.querySelector('#team-list li[data-member="seat-b"] button').click()`);
  assert.equal(await page.eval(save), 'disabled', 'a removal cannot be saved unconfirmed');
  assert.ok((await page.eval(state)).listed.includes('seat-b'), 'the leaving member stays visible');

  // The team changes elsewhere before the save: nothing is sent, and the other change survives.
  await page.eval(`document.getElementById('team-confirm').click(); __roster.push('seat-late'); __team = [...__team, 'seat-late'];`);
  const before = (await page.eval(state)).puts.length;
  await page.eval(save);
  s = await page.eval(state);
  assert.equal(s.puts.length, before, 'a changed team stops the save');
  assert.match(s.status, /다른 곳에서 팀이 바뀌어/);
  assert.ok(s.listed.includes('seat-late'));
  assert.equal(s.saveDisabled, true, 'the removal must be confirmed again');

  await page.eval(`document.getElementById('team-confirm').click()`);
  await page.eval(save);
  s = await page.eval(state);
  assert.deepEqual([...s.team].sort(), ['seat-a', 'seat-c', 'seat-late'], 'only the confirmed removal left');
} finally {
  await browser.close();
}
console.log('PASS team-members browser: existing members kept, roster refusal shown, removal confirmed, concurrent change preserved');
