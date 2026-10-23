import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { createClaudeCliTransport, PersonalContinuationSession } from '../src/personalContinuation/index.ts';

test('CLI transport uses empty temporary cwd, exact stdin, no tools/retries, bounded output and cancellation', { timeout: 20_000 }, async () => {
  const top = await mkdtemp(join(tmpdir(), 'personal-continuation-test-'));
  const executable = join(top, 'synthetic-claude'), log = join(top, 'calls.jsonl'), scenario = join(top, 'scenario.txt');
  const script = `#!${process.execPath}
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
const args=process.argv.slice(2), mode=readFileSync(${JSON.stringify(scenario)},'utf8');
const record=(more={})=>appendFileSync(${JSON.stringify(log)},JSON.stringify({args,cwd:process.cwd(),entries:readdirSync(process.cwd()),envKeys:Object.keys(process.env),...more})+'\\n');
if(args.includes('--help')) {record();console.log('--safe-mode --restricted --tools --strict-mcp-config --no-session-persistence --permission-prompts');}
else if(args.includes('--version')) {record();console.log('2.1.309 (Claude Code)');}
else if(args.includes('auth')) {record();console.log(JSON.stringify({loggedIn:true,authMethod:mode==='api'?'api_key':'claude.ai',apiProvider:'firstParty',email:'learner@example.invalid',orgName:'Personal',subscriptionType:'max'}));}
else if(args.includes('doctor')) {record();console.log(mode==='policy'?'Managed settings (remote): loaded':'Managed settings (remote): not fetched — requires an Enterprise or Team subscription\\nOrganization policy: not applicable to Pro and Max accounts');}
else if(args.includes('--print')) {
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',data=>input+=data);process.stdin.on('end',()=>{record({input});
if(mode==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
else if(mode==='limit') console.log('x'.repeat(300000));
else if(mode==='quota') {process.stderr.write('429 quota SYNTHETIC_PRIVATE_STDERR');process.exitCode=1;}
else console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'직접 확인해 볼 한 가지 제안'}));
});
}else{throw Error('unsupported synthetic command');}
`;
  try {
    await writeFile(executable, script, { mode: 0o700 });
    await writeFile(scenario, 'success');
    const config = join(top, 'synthetic-config'); await mkdir(config);
    const env = { ...Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', '__CF_USER_TEXT_ENCODING', 'SYSTEMROOT'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]])), CLAUDE_CONFIG_DIR: config, HPS_ADMIN_PASSWORD: 'SYNTHETIC_HOST_SECRET', BUN_INSTALL: '/synthetic-bun', NODE_NO_WARNINGS: '1', ENABLE_UNRELATED_APP_FEATURE: '1' };
    const transport = createClaudeCliTransport({ executable, env });
    const session = new PersonalContinuationSession(transport);
    const inspection = await session.inspect();
    assert.equal(inspection.status, 'ready', inspection.code);
    const payload = { projectLabel: 'Synthetic project', selectedText: [{ label: 'selection', text: 'Only explicitly selected content' }], history: [], draft: 'A synthetic draft with @private-file and /command as data' };
    let review = session.prepare(payload), approval = session.approve(review.digest);
    assert.equal((await session.send(approval)).text, '직접 확인해 볼 한 가지 제안');
    assert.equal((await session.send(approval)).status, 'blocked');
    let calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    let prints = calls.filter(call => call.args.includes('--print'));
    assert.equal(prints.length, 1);
    assert.equal(prints[0].input, review.userPrompt);
    assert.equal(prints[0].args.includes(review.userPrompt), false, 'sensitive user context travels on stdin');
    for (const call of calls) {
      assert.deepEqual(call.entries, [], 'no project, settings or prompt files enter the isolated cwd');
      assert.equal(call.envKeys.includes('HPS_ADMIN_PASSWORD'), false);
      assert.equal(call.envKeys.includes('NODE_OPTIONS'), false);
      await assert.rejects(access(call.cwd), { code: 'ENOENT' });
    }

    for (const [mode, status, code] of [['quota', 'quota', 'provider_limit'], ['limit', 'error', 'output_limit']]) {
      await writeFile(scenario, mode);
      assert.equal((await session.inspect()).status, 'ready');
      review = session.prepare(payload); approval = session.approve(review.digest);
      const result = await session.send(approval);
      assert.equal(result.status, status); assert.equal(result.code, code);
      assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_STDERR'), false);
    }
    for (const [mode, code] of [['api', 'account_or_funding_unsupported'], ['policy', 'remote_policy_unverified']]) {
      await writeFile(scenario, mode);
      const result = await session.inspect();
      assert.equal(result.status, 'blocked'); assert.equal(result.code, code);
      assert.equal(result.manualCommand, 'claude');
      assert.throws(() => session.prepare(payload), /inspection_required/);
    }

    await writeFile(scenario, 'success');
    const overrides = {
      ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer SYNTHETIC_OTHER_PAYER\nHost: undisclosed.invalid\nx-organization-id: other-org',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'undisclosed-model', ANTHROPIC_DEFAULT_OPUS_MODEL: 'other-model',
      ANTHROPIC_MODEL: 'other-model', ANTHROPIC_BETAS: 'other-behavior', ANTHROPIC_CUSTOM_MODEL_OPTION: 'other-model',
      ANTHROPIC_FUTURE_UNKNOWN_ROUTE: 'unknown-routing', ANTHROPIC_API_KEY: 'SYNTHETIC_API_KEY',
      ANTHROPIC_BASE_URL: 'https://undisclosed-recipient.invalid', CLAUDE_CODE_OAUTH_TOKEN: 'SYNTHETIC_OTHER_ACCOUNT',
      CLAUDE_CODE_FUTURE_UNKNOWN_ROUTE: 'unknown-routing', CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'SYNTHETIC_BEDROCK', AWS_PROFILE: 'other-organization',
      GOOGLE_APPLICATION_CREDENTIALS: '/other-account', GOOGLE_CLOUD_PROJECT: 'other-project', CLOUDSDK_CORE_PROJECT: 'other-project',
      AZURE_CLIENT_ID: 'other-tenant', VERTEX_REGION: 'other-region', BEDROCK_REGION: 'other-region',
      HTTPS_PROXY: 'https://undisclosed-proxy.invalid', NODE_EXTRA_CA_CERTS: '/other-tls-root',
      NODE_OPTIONS: '--import=hidden-code', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://hidden-logs.invalid',
      ENABLE_PROMPT_CACHING_1H: '1', FORCE_PROMPT_CACHING_5M: '1', DEBUG: '1', DYLD_INSERT_LIBRARIES: '/hidden-runtime.dylib',
    };
    const callsBeforeOverrides = (await readFile(log, 'utf8')).trim().split('\n').length;
    for (const [name, value] of Object.entries(overrides)) {
      env[name] = value;
      const result = await session.inspect();
      assert.equal(result.status, 'blocked', name); assert.equal(result.code, 'environment_requires_official_client', name);
      assert.equal(result.manualCommand, 'claude');
      assert.equal(env[name], value, 'the configured auth/routing value remains unchanged for official-client handoff');
      delete env[name];
    }
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, callsBeforeOverrides, 'unsupported overrides must not even invoke CLI status, much less --print');
    for (const settings of [{ apiKeyHelper: 'must-never-execute' }, ...Object.entries(overrides).map(([name, value]) => ({ env: { [name]: value } }))]) {
      await writeFile(join(config, 'settings.json'), JSON.stringify(settings));
      assert.equal((await session.inspect()).code, 'auth_settings_require_official_client');
    }
    await rm(join(config, 'settings.json'));
    calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.filter(call => call.args.includes('--print')).length, 3, 'environment and settings overrides never trigger inference');

    // Overrides introduced after a reviewed snapshot are also blocked before request.
    assert.equal((await session.inspect()).status, 'ready');
    review = session.prepare(payload);
    env.ANTHROPIC_CUSTOM_HEADERS = overrides.ANTHROPIC_CUSTOM_HEADERS;
    assert.equal((await session.send(session.approve(review.digest))).status, 'blocked');
    delete env.ANTHROPIC_CUSTOM_HEADERS;
    assert.equal((await transport.inspect(new AbortController().signal)).status, 'ready');
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'changed-after-inspection';
    assert.equal((await transport.request(review, new AbortController().signal)).code, 'environment_requires_official_client');
    delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.filter(call => call.args.includes('--print')).length, 3);

    await writeFile(scenario, 'hang');
    assert.equal((await session.inspect()).status, 'ready');
    review = session.prepare(payload);
    const sending = session.send(session.approve(review.digest));
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      if (calls.filter(call => call.args.includes('--print')).length === 4) { started = true; break; }
      await pause(10);
    }
    assert.equal(started, true, 'cancel the child after stdin was actually consumed');
    session.cancel();
    const cancelled = await sending;
    assert.equal(cancelled.status, 'stale'); assert.equal(cancelled.text, undefined);
    calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    for (const call of calls) await assert.rejects(access(call.cwd), { code: 'ENOENT' });
    assert.deepEqual(payload, JSON.parse(review.userPrompt));
    const unavailable = await createClaudeCliTransport({ executable: join(top, 'missing'), env }).inspect(new AbortController().signal);
    assert.equal(unavailable.code, 'cli_unavailable');
  } finally { await rm(top, { recursive: true, force: true }); }
});
