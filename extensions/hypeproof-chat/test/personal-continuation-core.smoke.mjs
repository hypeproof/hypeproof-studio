import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersonalContinuationSession, CONTINUATION_LIMITS, claudeAccountDisclosure, personalClaudeEnvironment, classifyClaudeFailure, claudeRequestArguments } from '../src/personalContinuation/index.ts';

const disclosure = claudeAccountDisclosure({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'learner@example.invalid', orgName: 'Personal', subscriptionType: 'pro' });
const ready = () => ({ status: 'ready', code: 'personal_subscription_ready', disclosure, manualCommand: 'claude' });
const payload = () => ({ projectLabel: 'My project', selectedText: [{ label: 'selected.txt', text: 'Only this selection' }], history: [{ role: 'user', content: 'A selected earlier question' }], draft: 'How can I improve my draft?' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('consent authorizes exactly the reviewed immutable payload once; edits, expiry and account changes consume it', async () => {
  let now = 1000, requests = 0, inspected = ready(), sent;
  const session = new PersonalContinuationSession({ inspect: async () => inspected, request: async snapshot => { requests++; sent = snapshot; return { status: 'success', code: 'completed', text: 'A text-only suggestion' }; } }, () => now);
  await session.inspect();
  const original = payload(), preserved = structuredClone(original);
  const snapshot = session.prepare({ ...original, unselectedPrivateText: 'never disclosed' });
  assert.deepEqual(JSON.parse(snapshot.userPrompt), original);
  assert.equal(snapshot.userPrompt.includes('never disclosed'), false);
  assert.equal((await session.send(undefined)).status, 'blocked');
  assert.equal((await session.send('')).status, 'blocked');
  assert.throws(() => session.approve('forged'), /review_required/);
  const consent = session.approve(snapshot.digest);
  snapshot.userPrompt = 'mutated by UI'; snapshot.disclosure.account = 'other';
  assert.equal((await session.send(consent)).status, 'success');
  assert.deepEqual(JSON.parse(sent.userPrompt), original);
  assert.equal(sent.disclosure.account, disclosure.account);
  assert.equal((await session.send(consent)).status, 'blocked');
  assert.equal(requests, 1);

  const first = session.prepare(original), oldConsent = session.approve(first.digest);
  const changed = session.prepare({ ...original, draft: 'Changed after review' });
  assert.notEqual(changed.digest, first.digest);
  assert.equal((await session.send(oldConsent)).status, 'blocked');
  const expiring = session.approve(changed.digest);
  now += CONTINUATION_LIMITS.consentMs;
  assert.equal((await session.send(expiring)).status, 'blocked');

  const beforeAccountChange = session.prepare(original), approvedAccount = session.approve(beforeAccountChange.digest);
  inspected = { ...ready(), disclosure: { ...disclosure, account: 'switched@example.invalid' } };
  assert.equal((await session.send(approvedAccount)).code, 'account_or_policy_changed');
  assert.equal(requests, 1);
  assert.deepEqual(original, preserved);
});

test('cancel, switch, late inspection and in-flight expiry cannot restore consent or append stale output', async () => {
  let pending = deferred();
  const inspectionSession = new PersonalContinuationSession({ inspect: () => pending.promise, request: async () => { throw Error('must not send'); } });
  const inspecting = inspectionSession.inspect(); inspectionSession.cancel(); pending.resolve(ready());
  assert.equal((await inspecting).code, 'stale');
  assert.throws(() => inspectionSession.prepare(payload()), /inspection_required/);

  let now = 1000, signal;
  const request = deferred();
  const session = new PersonalContinuationSession({ inspect: async () => ready(), request: async (_snapshot, s) => { signal = s; return request.promise; } }, () => now);
  await session.inspect(); let snapshot = session.prepare(payload());
  const sending = session.send(session.approve(snapshot.digest));
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  session.invalidate();
  assert.equal(signal.aborted, true);
  await session.inspect(); snapshot = session.prepare({ ...payload(), draft: 'New project draft' });
  request.resolve({ status: 'success', code: 'completed', text: 'Old project output' });
  const stale = await sending;
  assert.equal(stale.status, 'stale'); assert.equal(stale.text, undefined);
  assert.doesNotThrow(() => session.approve(snapshot.digest));

  const late = deferred();
  const expiring = new PersonalContinuationSession({ inspect: async () => ready(), request: async () => late.promise }, () => now);
  await expiring.inspect(); const review = expiring.prepare(payload());
  const result = expiring.send(expiring.approve(review.digest));
  await Promise.resolve(); now += CONTINUATION_LIMITS.consentMs;
  late.resolve({ status: 'success', code: 'completed', text: 'Expired output' });
  assert.deepEqual(Object.fromEntries(Object.entries(await result).filter(([k]) => k !== 'requestId')), { status: 'stale', code: 'consent_expired' });
});

test('failure paths preserve all host-owned work and never replay a request', async () => {
  const original = payload(), preserved = structuredClone(original);
  for (const status of ['quota', 'offline', 'auth', 'error']) {
    let calls = 0;
    const session = new PersonalContinuationSession({ inspect: async () => ready(), request: async () => { calls++; return { status, code: `provider_${status}` }; } });
    await session.inspect(); const snapshot = session.prepare(original), consent = session.approve(snapshot.digest);
    assert.equal((await session.send(consent)).status, status);
    assert.equal((await session.send(consent)).status, 'blocked');
    assert.equal(calls, 1); assert.deepEqual(original, preserved);
  }
  const session = new PersonalContinuationSession({ inspect: async () => ready(), request: async () => ({ status: 'success', code: 'completed', text: 'a'.repeat(CONTINUATION_LIMITS.replyBytes + 1) }) });
  await session.inspect(); const snapshot = session.prepare(original);
  assert.equal((await session.send(session.approve(snapshot.digest))).code, 'reply_limit');
  assert.throws(() => session.prepare({ ...original, draft: 'a'.repeat(CONTINUATION_LIMITS.payloadBytes + 1) }), /payload_limit/);
});

test('official authentication options survive env isolation; unknown account, recipient and errors fail closed', () => {
  const configured = { USER: 'synthetic', HOME: '/synthetic-home', PATH: '/bin', ANTHROPIC_API_KEY: 'synthetic-api-key', ANTHROPIC_AUTH_TOKEN: 'synthetic-bearer', CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-oauth', CLAUDE_CONFIG_DIR: '/synthetic-config', CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'synthetic-profile', GOOGLE_APPLICATION_CREDENTIALS: '/synthetic-google', CLAUDE_CODE_USE_FOUNDRY: '1', AZURE_CLIENT_ID: 'synthetic-client', HPS_ADMIN_PASSWORD: 'must-not-forward', NODE_OPTIONS: '--import=hidden-code', CLAUDE_CODE_PLUGIN_DIRS: '/hidden-plugin', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://hidden.invalid' };
  const env = personalClaudeEnvironment(configured);
  for (const key of ['USER', 'HOME', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_PROFILE', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDE_CODE_USE_FOUNDRY', 'AZURE_CLIENT_ID']) assert.equal(env[key], configured[key]);
  for (const key of ['HPS_ADMIN_PASSWORD', 'NODE_OPTIONS', 'CLAUDE_CODE_PLUGIN_DIRS', 'OTEL_EXPORTER_OTLP_ENDPOINT']) assert.equal(env[key], undefined);
  assert.equal(env.CLAUDE_CODE_MAX_RETRIES, '0');
  assert.equal(env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK, '1');
  for (const status of [{ loggedIn: false }, { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }, { loggedIn: true, authMethod: 'third_party', apiProvider: 'bedrock' }, { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'bad\naccount', subscriptionType: 'max' }]) assert.equal(claudeAccountDisclosure(status), undefined);
  assert.equal(disclosure.account, 'learner@example.invalid');
  const secret = 'SYNTHETIC_SECRET_DO_NOT_RETURN';
  for (const [error, status] of [['429 quota reached', 'quota'], ['401 authentication_error', 'auth'], ['ENOTFOUND host', 'offline'], ['unknown problem', 'error']]) {
    const result = classifyClaudeFailure(`${error} ${secret}`);
    assert.equal(result.status, status); assert.equal(JSON.stringify(result).includes(secret), false);
  }
  const args = claudeRequestArguments({ systemPrompt: 'reviewed system', model: 'sonnet' });
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--system-prompt') + 1], 'reviewed system');
  assert.ok(args.includes('--safe-mode') && args.includes('--restricted') && args.includes('--strict-mcp-config') && args.includes('--no-session-persistence'));
  assert.equal(args.includes('--bare'), false);
  assert.equal(args.includes('--continue') || args.includes('--resume') || args.includes('--fallback-model'), false);
  assert.equal(JSON.parse(args[args.indexOf('--settings') + 1]).switchModelsOnFlag, false);
});
