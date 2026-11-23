// The curriculum team control on /manage. PUT /v1/curriculum/projects/:id/members replaces the whole list, so by design:
// an existing member leaves only by an explicit, confirmed removal; a team changed elsewhere is never overwritten; a seat
// outside the roster shows the Service's refusal and saves nothing; and Chalk forwards only these two routes, with the
// issuer from the Lab connection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { withBearerAsConnection } from './harness/connect.mjs';
import { teamMembersKit } from '../src/lib/team-members.ts';

const kit = teamMembersKit();
const chalk = withBearerAsConnection((await import('../src/index.ts')).default);
const env = { ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: 'https://service.test' };

test('adding a seat keeps every existing member in the list that is sent', () => {
  const { draft, problem } = kit.addSeat(['seat-a', 'seat-b'], ' seat-c ');
  assert.equal(problem, null);
  assert.deepEqual(draft, ['seat-a', 'seat-b', 'seat-c']);
  assert.equal(kit.blocked(['seat-a', 'seat-b'], draft, false), null, 'adding needs no removal confirmation');
});

test('removing an existing member cannot be saved until the instructor confirms that person', () => {
  const baseline = ['seat-a', 'seat-b'];
  const draft = ['seat-a'];
  assert.match(kit.blocked(baseline, draft, false), /seat-b/);
  assert.equal(kit.blocked(baseline, draft, true), null);
  assert.ok(kit.blocked(baseline, [], true), 'an empty team is never sent');
});

test('a team changed elsewhere keeps the other change and the instructor edits', () => {
  // Loaded a+b; the instructor added d and removed b; meanwhile someone else added c.
  assert.deepEqual(kit.rebase(['seat-a', 'seat-b'], ['seat-a', 'seat-d'], ['seat-a', 'seat-b', 'seat-c']), ['seat-a', 'seat-c', 'seat-d']);
});

test('the roster refusal names the seat and separates a current member from a new one', () => {
  const body = { error: { type: 'curriculum', code: 'members_not_in_roster', members: ['seat-new', 'seat-a'] } };
  const shown = kit.refusal(400, body, ['seat-a']);
  assert.match(shown, /저장하지 않았습니다/);
  assert.match(shown, /수업 명단에 없는 학생입니다: seat-new/);
  assert.match(shown, /현재 팀원이지만 수업 명단에서 빠져 있습니다: seat-a/);
  assert.equal(kit.outcomeUnknown(400), false);
  assert.equal(kit.outcomeUnknown(502), true, 'a failed gateway may have applied the write: read again first');
});

test('Chalk forwards only the team read and write, with the connected issuer', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true }); };
  const send = (method, path, body) => chalk.fetch(new Request('https://chalk.test' + path, { method, ...(body ? { body } : {}), headers: { authorization: 'Bearer fixture-issuer', 'content-type': 'application/json' } }), env);
  try {
    assert.equal((await send('GET', '/v1/curriculum/director/projects')).status, 200);
    assert.equal(calls.at(-1).url, 'https://service.test/v1/curriculum/director/projects');
    assert.equal(calls.at(-1).init.headers.get('authorization'), 'Bearer fixture-issuer');
    const body = JSON.stringify({ members: ['seat-a', 'seat-b'] });
    assert.equal((await send('PUT', '/v1/curriculum/projects/p-1/members', body)).status, 200);
    assert.equal(calls.at(-1).url, 'https://service.test/v1/curriculum/projects/p-1/members');
    assert.equal(new TextDecoder().decode(calls.at(-1).init.body), body);
    const forwarded = calls.length;
    for (const [method, path] of [['GET', '/v1/curriculum/projects/p-1'], ['POST', '/v1/curriculum/projects/p-1/members'], ['PUT', '/v1/curriculum/projects/p-1/problem'], ['DELETE', '/v1/curriculum/experiments/e-1']]) {
      assert.equal((await send(method, path, method === 'GET' || method === 'DELETE' ? undefined : '{}')).status, 404, `${method} ${path}`);
    }
    assert.equal(calls.length, forwarded, 'nothing else under /v1/curriculum reaches the Service');
  } finally {
    globalThis.fetch = previous;
  }
});
