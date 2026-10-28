// Actual runSdkCoach/canUseTool with a scripted SDK, real temporary filesystem. No CLI/model/app.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm, symlink, link, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompanionExecutionPolicy } from '../src/companionExecutionPolicy.ts';
import { buildSdkGatewayEnv } from '../src/sdkCoachHelpers.ts';

const executionBinding = () => ({turnId:'companion-turn',grant_id:'ceg_'+'a'.repeat(32),request_id:'phone-intent',request_hash:'b'.repeat(64),
  task_id:'selected-task',epoch:1,consent_revision:1,selection_hash:'c'.repeat(64)});

test('SDK environment removes ambient execution claims and accepts only exact turn-bound fields', () => {
  const base = {ANTHROPIC_CUSTOM_HEADERS:'X-HPS-Companion-Execution: injected\nx-hps-turn-id: wrong\nx-extra: unchanged'};
  const plain = buildSdkGatewayEnv(base,{proxyUrl:'http://127.0.0.1:1/v1',token:'synthetic'});
  assert.equal(plain.ANTHROPIC_CUSTOM_HEADERS,'x-extra: unchanged');
  const binding=executionBinding(),env=buildSdkGatewayEnv(base,{proxyUrl:'http://127.0.0.1:1/v1',token:'synthetic',turnId:binding.turnId,companionExecutionBinding:binding});
  const lines=env.ANTHROPIC_CUSTOM_HEADERS.split('\n');assert.equal(lines.filter(x=>x.startsWith('x-hps-companion-execution:')).length,1);
  assert(lines.includes('x-hps-turn-id: companion-turn'));assert.equal(JSON.parse(lines.find(x=>x.startsWith('x-hps-companion-execution:')).slice('x-hps-companion-execution: '.length)).request_id,'phone-intent');
  for(const changed of [{...binding,turnId:'other'},{...binding,task_id:'task\r\nAuthorization: x'},{...binding,extra:'grant'},{...binding,grant_id:'preview-only'},{...binding,epoch:0}])
    assert.throws(()=>buildSdkGatewayEnv({}, {proxyUrl:'http://127.0.0.1:1/v1',token:'synthetic',turnId:binding.turnId,companionExecutionBinding:changed}));
});

test('real SDK orchestration snapshots exact companion headers before async setup',async t=>{
  const f=await fixture(t),binding=executionBinding();
  const running=turn(f,async options=>{
    const lines=options.env.ANTHROPIC_CUSTOM_HEADERS.split('\n'),header=lines.find(x=>x.startsWith('x-hps-companion-execution: '));
    assert.equal(JSON.parse(header.slice('x-hps-companion-execution: '.length)).request_id,'phone-intent');
    assert(lines.includes('x-hps-turn-id: companion-turn'));
  },{turnId:binding.turnId,companionExecutionBinding:binding,companionExecutionRevalidate:async()=>{}});
  binding.request_id='changed-after-admission';await running;
});

test('SDK execution binding cannot omit local selected-file restriction or name another turn',async t=>{
  const f=await fixture(t);let queried=false;
  for(const extra of [{companionExecutionPolicy:undefined},{turnId:'another-turn'},{companionExecutionRevalidate:undefined}]){
    await assert.rejects(turn(f,async()=>{queried=true;},{turnId:'companion-turn',companionExecutionBinding:executionBinding(),companionExecutionRevalidate:async()=>{},...extra}),e=>e.name==='CompanionExecutionPolicyError');
  }
  assert.equal(queried,false);
});

let bundle, runSdkCoach, SdkUnavailableError, originalAppData;
test.before(async () => {
  bundle = await mkdtemp(join(tmpdir(), 'hps-companion-policy-bundle-'));
  originalAppData = process.env.APPDATA;
  process.env.APPDATA = join(bundle, 'appdata');
  const out = join(bundle, 'sdk.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('../src/sdkCoach.ts', import.meta.url))], outfile: out,
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['@anthropic-ai/claude-agent-sdk', 'zod'],
    plugins: [{ name: 'vscode-stub', setup(b) {
      b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports={window:{},workspace:{},Uri:{file:p=>({fsPath:p})}};', loader: 'js' }));
    } }] });
  ({ runSdkCoach, SdkUnavailableError } = createRequire(import.meta.url)(out));
});
test.after(async () => {
  if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
  await rm(bundle, { recursive: true, force: true });
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hps-companion-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'work'), artifact = join(workspace, 'selected.html'), other = join(workspace, 'other.html');
  await mkdir(workspace); await writeFile(artifact, '<p>original</p>'); await writeFile(other, '<p>private</p>');
  let live = true, time = 100;
  const config = { workspaceRoot: workspace, artifactPath: artifact, expiresAt: 200, isCurrent: () => live, now: () => time };
  const policy = createCompanionExecutionPolicy(config);
  return { root, workspace, artifact, other, config, policy, revoke: () => { live = false; }, expire: () => { time = 200; } };
}

async function turn(f, exercise, extra = {}) {
  let approvals = 0, queries = 0;
  const ctrl = new AbortController();
  const sdk = { query: ({ options }) => (async function* () {
    queries++;
    await exercise(options, (name, input) => options.canUseTool(name, input, { toolUseID: 'tool-1', signal: ctrl.signal }));
    yield { type: 'result', subtype: 'success', is_error: false };
  })() };
  await runSdkCoach({ sdk, binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1',
    token: 'test', model: 'm', profile: { sdk_tools: { read: true, write: true, shell: true, browser: true, subagents: true } },
    systemPrompt: '', history: [], userText: 'Revise this HTML', cwd: f.workspace, signal: ctrl.signal,
    stallTimeoutMs: 0, onDelta() {}, requestApproval: async () => { approvals++; return true; }, companionExecutionPolicy: f.policy, ...extra });
  return { approvals, queries };
}

test('selected read cannot auto-allow another workspace file', async t => {
  const f = await fixture(t);
  await turn(f, async (_opts, use) => {
    assert.equal((await use('Read', { file_path: f.artifact })).behavior, 'allow');
    assert.equal((await use('Read', { file_path: f.other })).behavior, 'deny');
  });
});

test('only intersected selected Read/Write/Edit are advertised and accepted; writes still request approval', async t => {
  const f = await fixture(t);
  const result = await turn(f, async (opts, use) => {
    assert.deepEqual([...opts.tools].sort(), ['Edit', 'Read', 'Write']);
    assert.deepEqual(opts.allowedTools, []); assert.deepEqual(opts.settingSources, []);
    assert.equal(opts.permissionMode, 'default'); assert.equal(opts.strictMcpConfig, true);
    assert.equal(opts.agents, undefined); assert.equal(opts.mcpServers, undefined);
    assert.ok(!opts.systemPrompt.includes('other.html'));
    for (const [tool, input] of [['Read', { allow_large: false }], ['Write', { content: '<p>new</p>' }], ['Edit', { old_string: 'new', new_string: 'changed' }]]) {
      const answer = await use(tool, { file_path: 'selected.html', ...input });
      assert.equal(answer.behavior, 'allow'); assert.equal(answer.updatedInput.file_path, f.policy.artifactPath);
    }
    for (const tool of ['Bash', 'Glob', 'Grep', 'MultiEdit', 'WebSearch', 'WebFetch', 'Task', 'Agent', 'mcp__hypeproof__browser_open', 'unknown']) {
      assert.equal((await use(tool, { file_path: f.artifact })).behavior, 'deny', tool);
    }
  });
  assert.equal(result.approvals, 2);
});

test('profile denial and host approval denial cannot be widened', async t => {
  const f = await fixture(t);
  const missing = await turn(f, async (opts, use) => {
    assert.deepEqual(opts.tools, ['Read']);
    assert.equal((await use('Write', { file_path: f.artifact, content: 'x' })).behavior, 'deny');
  }, { profile: { sdk_tools: { read: true } } });
  assert.equal(missing.approvals, 0);
  await turn(f, async (_opts, use) => {
    assert.equal((await use('Edit', { file_path: f.artifact, old_string: 'x', new_string: 'y' })).behavior, 'deny');
  }, { requestApproval: async () => false });
});

test('expiry/revocation between tools and during write approval deny the next effect', async t => {
  for (const change of ['revoke', 'expire']) {
    const f = await fixture(t);
    await turn(f, async (_opts, use) => {
      assert.equal((await use('Read', { file_path: f.artifact })).behavior, 'allow');
      f[change]();
      assert.equal((await use('Read', { file_path: f.artifact })).behavior, 'deny');
    });
    const g = await fixture(t);
    await turn(g, async (_opts, use) => {
      assert.equal((await use('Write', { file_path: g.artifact, content: 'x' })).behavior, 'deny');
    }, { requestApproval: async () => { g[change](); return true; } });
  }
});

test('changed path during approval and malformed/alternate targets are refused', async t => {
  const f = await fixture(t);
  await turn(f, async (_opts, use) => {
    for (const input of [{ file_path: f.other }, { file_path: f.artifact, path: f.other }, { file_path: '' }, []]) {
      assert.equal((await use('Read', input)).behavior, 'deny');
    }
    assert.equal((await use('Write', { file_path: f.artifact, content: 'x' })).behavior, 'deny');
  }, { requestApproval: async () => { await rm(f.artifact); await symlink(f.other, f.artifact); return true; } });
});

test('regular-file scope accepts legitimate atomic replacement, rejects missing/directory/symlink/hardlink', async t => {
  const f = await fixture(t);
  const replacement = join(f.workspace, 'new.html'); await writeFile(replacement, '<p>new</p>'); await rename(replacement, f.artifact);
  assert.equal(f.policy.toolInput('Read', { file_path: f.artifact }, f.workspace).file_path, f.policy.artifactPath);
  await rm(f.artifact); assert.throws(() => f.policy.assertCurrent(f.workspace));
  await mkdir(f.artifact); assert.throws(() => f.policy.assertCurrent(f.workspace)); await rm(f.artifact, { recursive: true });
  await symlink(f.other, f.artifact); assert.throws(() => createCompanionExecutionPolicy(f.config)); await rm(f.artifact);
  await link(f.other, f.artifact); assert.throws(() => createCompanionExecutionPolicy(f.config));
});

test('a selected ancestor replaced by a symlink is refused, including during write approval', async t => {
  const f = await fixture(t), directory = join(f.workspace, 'nested'), moved = join(f.workspace, 'moved');
  await mkdir(directory); const artifact = join(directory, 'page.htm'); await writeFile(artifact, '<p>original</p>');
  const config = { ...f.config, artifactPath: artifact }, policy = createCompanionExecutionPolicy(config);
  await turn({ ...f, policy }, async (_opts, use) => {
    assert.equal((await use('Read', { file_path: artifact })).behavior, 'allow');
    assert.equal((await use('Write', { file_path: artifact, content: 'x' })).behavior, 'deny');
    assert.equal((await use('Read', { file_path: artifact })).behavior, 'deny');
  }, { requestApproval: async () => { await rename(directory, moved); await symlink(moved, directory); return true; } });
  assert.throws(() => createCompanionExecutionPolicy(config), 'a pre-existing ancestor alias is not a selected regular path');
});

test('scoped run does not enumerate the workspace or mutate caller tool input', async t => {
  const f = await fixture(t), fs = createRequire(import.meta.url)('node:fs'), original = fs.readdirSync;
  let enumerations = 0;
  fs.readdirSync = function (...args) { enumerations++; return original.apply(this, args); };
  try {
    await turn(f, async (_opts, use) => {
      const input = { file_path: 'selected.html' };
      assert.equal((await use('Read', input)).behavior, 'allow'); assert.equal(input.file_path, 'selected.html');
    });
    assert.equal(enumerations, 0, 'selected context must not call the broad file inventory');
  } finally { fs.readdirSync = original; }
});

test('factory refuses invalid grants, non-HTML, outside workspace and mismatched cwd before SDK query', async t => {
  const f = await fixture(t);
  for (const change of [{ isCurrent: () => false }, { isCurrent: () => { throw Error('unavailable'); } }, { expiresAt: 100 }, { expiresAt: NaN }]) {
    assert.throws(() => createCompanionExecutionPolicy({ ...f.config, ...change }));
  }
  const outside = join(f.root, 'outside.html'), text = join(f.workspace, 'note.txt'); await writeFile(outside, 'x'); await writeFile(text, 'x');
  for (const artifactPath of [outside, text]) assert.throws(() => createCompanionExecutionPolicy({ ...f.config, artifactPath }));
  await assert.rejects(turn(f, () => assert.fail('query must not start'), { cwd: f.root }));
  f.revoke(); await assert.rejects(turn(f, () => assert.fail('query must not start')));
});

test('a scoped missing SDK is not the fallback error; ordinary missing SDK remains unchanged', async t => {
  const f = await fixture(t);
  const binaryResolution = { available: false, reasons: ['test missing'] };
  await assert.rejects(turn(f, () => assert.fail('query'), { binaryResolution }), error => error.name === 'CompanionExecutionPolicyError' && error.code === 'sdk_required' && !(error instanceof SdkUnavailableError));
  await assert.rejects(turn(f, () => assert.fail('query'), { binaryResolution, companionExecutionPolicy: undefined }), error => error instanceof SdkUnavailableError);
});

test('absent policy retains ordinary desktop tools, read scope and approval behavior', async t => {
  const f = await fixture(t);
  const result = await turn(f, async (opts, use) => {
    assert.ok(opts.tools.includes('Glob')); assert.ok(opts.tools.includes('Bash')); assert.ok(opts.agents);
    assert.equal((await use('Read', { file_path: f.other })).behavior, 'allow');
    assert.equal((await use('Write', { file_path: f.other, content: 'x' })).behavior, 'allow');
  }, { companionExecutionPolicy: undefined });
  assert.equal(result.approvals, 1);
});

// Synthetic authority callbacks only: these controls make no Service/network claim.
test('bound SDK start revalidates authority and never queries on remote failure or changed owner', async t => {
  for (const mode of ['remote', 'owner', 'abort']) {
    const f = await fixture(t), controller = new AbortController(); let checks = 0, queried = false;
    await assert.rejects(turn(f, async () => { queried = true; }, {
      turnId: 'companion-turn', companionExecutionBinding: executionBinding(), signal: controller.signal,
      companionExecutionRevalidate: async () => {
        checks++;
        if (mode === 'remote') throw Error('synthetic Service revoked');
        if (mode === 'owner') f.revoke();
        if (mode === 'abort') controller.abort();
      },
    }), error => error.name === 'CompanionExecutionPolicyError' || error.name === 'AbortError');
    assert.equal(checks, 1); assert.equal(queried, false);
  }
});

test('remote revocation after model reply blocks every selected tool before local effect or approval', async t => {
  const f = await fixture(t); let remoteLive = true, checks = 0;
  const result = await turn(f, async (_options, use) => {
    remoteLive = false; // A model response already arrived; local owner still reports current.
    for (const [name, input] of [['Read', {}], ['Write', {content: 'forbidden'}], ['Edit', {old_string: 'original', new_string: 'forbidden'}]]) {
      assert.equal((await use(name, {file_path: f.artifact, ...input})).behavior, 'deny', name);
    }
  }, {turnId: 'companion-turn', companionExecutionBinding: executionBinding(), companionExecutionRevalidate: async () => {
    checks++; if (!remoteLive) throw Error('synthetic Service revoked');
  }});
  assert.equal(checks, 4); assert.equal(result.approvals, 0);
});

test('remote revocation during asynchronous host approval refuses selected Write and Edit', async t => {
  for (const [name, input] of [['Write', {content: 'forbidden'}], ['Edit', {old_string: 'original', new_string: 'forbidden'}]]) {
    const f = await fixture(t); let remoteLive = true, checks = 0, approvals = 0;
    await turn(f, async (_options, use) => {
      assert.equal((await use(name, {file_path: f.artifact, ...input})).behavior, 'deny');
    }, {turnId: 'companion-turn', companionExecutionBinding: executionBinding(),
      requestApproval: async () => { approvals++; await Promise.resolve(); remoteLive = false; return true; },
      companionExecutionRevalidate: async () => { checks++; if (!remoteLive) throw Error('synthetic Service revoked'); },
    });
    assert.equal(checks, 3); assert.equal(approvals, 1);
  }
});

test('successful live checks preserve selected tool approval and run once at every effect boundary', async t => {
  const f = await fixture(t); let checks = 0;
  const result = await turn(f, async (_options, use) => {
    for (const [name, input] of [['Read', {}], ['Write', {content: 'allowed'}], ['Edit', {old_string: 'original', new_string: 'allowed'}]])
      assert.equal((await use(name, {file_path: f.artifact, ...input})).behavior, 'allow');
  }, {turnId: 'companion-turn', companionExecutionBinding: executionBinding(), companionExecutionRevalidate: async () => { checks++; }});
  assert.equal(checks, 6); // start + Read + Write(before/after approval) + Edit(before/after approval)
  assert.equal(result.approvals, 2);
});

test('local owner, abort and selected path are checked again after asynchronous tool revalidation', async t => {
  for (const mode of ['owner', 'abort', 'path']) {
    const f = await fixture(t), controller = new AbortController(); let checks = 0;
    const running = turn(f, async (_options, use) => {
      assert.equal((await use('Read', {file_path: f.artifact})).behavior, 'deny', mode);
    }, {turnId: 'companion-turn', companionExecutionBinding: executionBinding(), signal: controller.signal,
      companionExecutionRevalidate: async () => {
        if (++checks !== 2) return;
        await Promise.resolve();
        if (mode === 'owner') f.revoke();
        if (mode === 'abort') controller.abort();
        if (mode === 'path') { await rm(f.artifact); await symlink(f.other, f.artifact); }
      },
    });
    if (mode === 'abort') await assert.rejects(running, error => error.name === 'AbortError');
    else await running;
    assert.equal(checks, 2);
  }
});

test('callback is captured before await and ordinary or policy-only SDK does not invoke it', async t => {
  const f = await fixture(t); let checks = 0, replacement = 0;
  const controller = new AbortController();
  const args = {turnId: 'companion-turn', companionExecutionBinding: executionBinding(), companionExecutionRevalidate: async () => { checks++; },
    sdk: {query: ({options}) => (async function* () {
      assert.equal((await options.canUseTool('Read', {file_path:f.artifact}, {toolUseID:'read',signal:controller.signal})).behavior,'allow');
      yield {type:'result',subtype:'success',is_error:false};
    })()}, binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',token:'synthetic',model:'m',
    profile:{sdk_tools:{read:true,write:true}},systemPrompt:'',history:[],userText:'Read selected HTML',cwd:f.workspace,
    signal:controller.signal,stallTimeoutMs:0,onDelta(){},requestApproval:async()=>true,companionExecutionPolicy:f.policy};
  const running = runSdkCoach(args);
  args.companionExecutionRevalidate = async () => { replacement++; throw Error('replaced callback'); };
  await running; assert.equal(checks, 2); assert.equal(replacement, 0);
  for (const policy of [f.policy, undefined]) await turn(f, async (_options, use) => {
    assert.equal((await use('Read', {file_path:f.artifact})).behavior, 'allow');
  }, {companionExecutionPolicy:policy,companionExecutionRevalidate:async()=>{throw Error('ordinary must not call this');}});
});
