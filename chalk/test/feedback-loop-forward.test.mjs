// #1013 feedback-loop — Chalk only FORWARDS the new routes: the learner's answer to a person's feedback and the instructor's
// retrospective → next draft. The allowlist is the Service's own (isIssuerAllowedEndpoint, re-exported), so the exact set
// below is what an instructor Bearer may reach; anything else stops here with 404 and never reaches the Service.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
const { default: chalk } = await import('../src/index.ts');
const env = { HPS_SIGNING_SECRET: 'test-secret-0123456789abcdef', ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: 'https://service.test' };
const retros = '/admin/cohorts/test-cohort/authoring/course-1/retrospectives', rt = retros + '/rt-0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const original = globalThis.fetch; const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true }, { status: 200 }); };
const send = (method, path, body) => chalk.fetch(new Request('https://chalk.test' + path, { method, body, headers: { authorization: 'Bearer fixture', 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'forged@example.test' } }), env, {});
try {
  // Positive control: every route this slice adds is forwarded unchanged, with only the whitelisted headers.
  for (const [method, path] of [['POST', '/v1/classroom/shares/share-1/response'], ['GET', retros], ['POST', retros], ['GET', retros + '/sources'], ['GET', rt], ['PUT', rt], ['POST', rt + '/next-draft']]) {
    const body = method === 'GET' ? undefined : JSON.stringify({ expected_revision: 1 });
    const r = await send(method, path, body); assert.equal(r.status, 200, method + ' ' + path);
    const call = calls.at(-1); assert.equal(call.url, 'https://service.test' + path); assert.equal(call.init.method, method);
    assert.equal(call.init.headers.get('authorization'), 'Bearer fixture'); assert.equal(call.init.headers.get('cf-access-authenticated-user-email'), null, 'the trusted Access header is never forwarded');
    if (body) assert.equal(new TextDecoder().decode(call.init.body), body);
  }
  // Negative control: the neighbours of those routes are not forwarded (no delete, no write to sources, no arbitrary verb).
  const forwarded = calls.length;
  for (const [method, path] of [['DELETE', rt], ['PUT', retros + '/sources'], ['POST', retros + '/sources'], ['DELETE', retros], ['PUT', '/v1/classroom/shares/share-1/response'], ['POST', '/v1/classroom/shares/share-1/feedback'], ['POST', rt + '/apply']])
    assert.equal((await send(method, path, method === 'DELETE' ? undefined : '{}')).status, 404, method + ' ' + path);
  assert.equal(calls.length, forwarded, 'nothing outside the allowlist reached the Service');
  console.log('PASS feedback-loop forward: learner answer + retrospective routes forwarded with header filtering; neighbours refused before the Service');
} finally { globalThis.fetch = original; }
