import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const bundle = await build({ stdin: { contents: "export {runSdkCoach} from './src/sdkCoach'; export {RunningProcesses} from './src/runningProcesses';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const module = { exports: {} }, require = createRequire(import.meta.url);
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? {} : id === 'node:fs' ? { ...require(id), mkdirSync() {} } : require(id), console, process, Buffer, AbortController, AbortSignal, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval });
const { runSdkCoach, RunningProcesses } = module.exports;
const registry = new RunningProcesses(() => {});
const stopped = [];
const sdk = { query() {
  const stream = (async function*() {
    yield { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'shell', run_id: '1', task_type: 'local_bash', description: '테스트 서버' }] };
    assert.equal(registry.list()[0].purpose, '테스트 서버');
    await registry.stop('turn:shell:1');
    assert.deepEqual(stopped, ['shell']); assert.equal(registry.list()[0].state, 'stopping');
    yield { type: 'system', subtype: 'task_notification', task_id: 'shell', run_id: '1', status: 'stopped' };
    assert.equal(registry.list()[0].state, 'stopped');
    // Another stream's entry (here the live server) must survive this turn's close (verify3 V11).
    registry.add('live:server', '라이브 서버', '.', async () => {});
    yield { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'unfinished', run_id: '1', task_type: 'local_bash', description: '미확인 실행' }] };
  })();
  stream.stopTask = async id => { stopped.push(id); };
  return stream;
} };
await runSdkCoach({ sdk, processes: { registry, prefix: 'turn:' }, binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1', token: 'test', model: 'fixture', profile: {}, systemPrompt: '', history: [], userText: 'q', signal: new AbortController().signal, stallTimeoutMs: 0, onDelta() {} });
assert.equal(registry.list().find(e => e.id === 'turn:unfinished:1').state, 'unknown');
assert.equal(registry.list().find(e => e.id === 'live:server').state, 'running', 'closing one SDK turn leaves other streams running');
console.log('shell-process-sdk: PASS (actual SDK adapter events, stop request, unconfirmed close scoped to its own turn)');
