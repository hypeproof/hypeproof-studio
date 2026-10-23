import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { createClaudeCliTransport, PersonalContinuationSession } from '../src/personalContinuation/index.ts';

test('CLI transport uses empty temporary cwd, exact stdin, no tools/retries, bounded output and cancellation', { timeout: 20_000 }, async () => {
  const top = await mkdtemp(join(tmpdir(), 'personal-continuation-test-'));
  const executable = join(top, 'synthetic-claude'), log = join(top, 'calls.jsonl');
  const script = `#!${process.execPath}
import { appendFileSync, readdirSync } from 'node:fs';
const args=process.argv.slice(2), mode=process.env.ANTHROPIC_TEST_SCENARIO;
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
    const env = { ...process.env, ANTHROPIC_TEST_SCENARIO: 'success', HPS_ADMIN_PASSWORD: 'SYNTHETIC_HOST_SECRET', NODE_OPTIONS: '--throw-deprecation' };
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
      env.ANTHROPIC_TEST_SCENARIO = mode;
      assert.equal((await session.inspect()).status, 'ready');
      review = session.prepare(payload); approval = session.approve(review.digest);
      const result = await session.send(approval);
      assert.equal(result.status, status); assert.equal(result.code, code);
      assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_STDERR'), false);
    }
    for (const [mode, code] of [['api', 'account_or_funding_unsupported'], ['policy', 'remote_policy_unverified']]) {
      env.ANTHROPIC_TEST_SCENARIO = mode;
      const result = await session.inspect();
      assert.equal(result.status, 'blocked'); assert.equal(result.code, code);
      assert.equal(result.manualCommand, 'claude');
      assert.throws(() => session.prepare(payload), /inspection_required/);
    }

    env.ANTHROPIC_TEST_SCENARIO = 'success';
    env.ANTHROPIC_API_KEY = 'SYNTHETIC_API_KEY';
    assert.equal((await session.inspect()).code, 'account_or_funding_unsupported', 'an API credential cannot borrow a cached subscription identity');
    delete env.ANTHROPIC_API_KEY;
    env.ANTHROPIC_BASE_URL = 'https://undisclosed-recipient.invalid';
    assert.equal((await session.inspect()).code, 'recipient_unsupported');
    delete env.ANTHROPIC_BASE_URL;

    env.ANTHROPIC_TEST_SCENARIO = 'hang';
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
    const unavailable = await createClaudeCliTransport({ executable: join(top, 'missing') }).inspect(new AbortController().signal);
    assert.equal(unavailable.code, 'cli_unavailable');
  } finally { await rm(top, { recursive: true, force: true }); }
});
