import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: "export * from './src/automationOps.ts'; export * from './src/classroomOps.ts'; export * from './src/classroomOpsHost.ts'; export * from './src/automationQuestSession.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? {} : require(id), console, Buffer });
const { automationOpsProgress, automationOpsRuntime, ClassroomOpsHost, ChangeGate, createAutomationQuestSession } = module.exports;
const emitted = [];
const host = Object.create(ClassroomOpsHost.prototype);
host.automationGate = new ChangeGate();
host.meta = { student: { u: 'synthetic-student', c: 'synthetic-class' } };
host.outbox = { async add(kind, payload, actor) { emitted.push({ kind, payload, actor }); } };
let nudges = 0;
host.loop = { nudge() { nudges++; } };
let question, owner = { u: 'synthetic-student', c: 'synthetic-class' };
const quest = createAutomationQuestSession(async () => {}, () => { host.refreshAutomation(); });
host.setAutomationSource(() => ({ owner, progress: automationOpsProgress(quest.snapshot(), question) }));
await quest.plan({ title: 'Unsent task title', nodes: [
  { id: 'goal', label: 'Unsent label', description: 'Unsent description', dependsOn: [] },
  { id: 'connect', label: 'Private connection', dependsOn: ['goal'] },
] });
assert.equal(emitted.at(-1).payload.phase, 'planned');
question = { kind: 'text', title: 'DO_NOT_TRANSMIT', text: 'user@example.invalid' };
host.refreshAutomation();
assert.equal(emitted.at(-1).payload.phase, 'waiting_user');
assert.equal(automationOpsRuntime(emitted.at(-1).payload, 'running'), 'waiting_user');
question = { kind: 'connect', title: 'DO_NOT_TRANSMIT' };
host.refreshAutomation();
assert.equal(emitted.at(-1).payload.phase, 'waiting_approval');
assert.equal(automationOpsRuntime(emitted.at(-1).payload, 'running'), 'waiting_approval');
assert.equal(emitted.at(-1).payload.step_id, 'connect');
const previewReview = automationOpsProgress(quest.snapshot(), { kind: 'preview_review' });
assert.equal(previewReview.phase, 'waiting_user');
assert.equal(previewReview.step_id, 'preview', 'a replayed preview review never inherits the earlier pending goal label');
assert.equal(automationOpsProgress(quest.snapshot(), { kind: 'preview' }).step_id, 'send');
question = undefined;
await quest.track('goal', async () => true);
await quest.track('connect', async () => ({ recoveryRequired: true }), () => false);
assert.equal(emitted.at(-1).payload.phase, 'blocked');
assert.equal(emitted.at(-1).payload.completed, 1);
assert.equal(automationOpsRuntime(emitted.at(-1).payload, 'idle'), 'waiting_user');
await assert.rejects(quest.track('connect', async () => { throw Error('private stack'); }));
assert.equal(emitted.at(-1).payload.phase, 'failed');
await quest.track('connect', async () => true);
assert.equal(emitted.at(-1).payload.phase, 'completed');
assert.equal(emitted.at(-1).payload.completed, 2);
assert.equal(emitted.at(-1).payload.total, 2);
assert(emitted.some(event => event.payload.phase === 'running'));
assert.doesNotMatch(JSON.stringify(emitted), /Unsent|Private|DO_NOT_TRANSMIT|example|private stack|synthetic/);
assert(emitted.every(event => Object.keys(event.payload).every(key => ['phase', 'step_id', 'completed', 'total'].includes(key))));
const count = emitted.length;
host.refreshAutomation(); assert.equal(emitted.length, count, 'unchanged progress is not duplicated');
owner = { u: 'different-student', c: 'synthetic-class' };
assert.equal(host.refreshAutomation(), null);
assert.equal(emitted.length, count, 'another activity owner cannot overwrite the paired seat');
host.outbox = null;
assert.equal(host.refreshAutomation(), null);
assert.equal(emitted.length, count, 'disconnected observation cannot enqueue');
assert(nudges > 0);
// Clearing a plan reports no active automation; it is never turned into completion.
owner = { u: 'synthetic-student', c: 'synthetic-class' };
host.outbox = { async add(kind, payload, actor) { emitted.push({ kind, payload, actor }); } };
quest.clear();
assert.equal(emitted.at(-1).payload.phase, 'idle');
assert.equal(emitted.at(-1).payload.total, 0);
console.log('PASS automation observation: real session transitions, questions, recovery, failure, completion, privacy allowlist, dedupe and seat/disconnect guards');

const resumed = createAutomationQuestSession(async () => {});
await resumed.plan({ title: 'Resume', nodes: [
  { id: 'goal', label: 'Goal', dependsOn: [] },
  { id: 'preview', label: 'Preview', dependsOn: ['goal'] },
] });
await resumed.track('preview', async () => ({ deploymentRequired: true }), value => value.previewed === true);
const needsSetup = automationOpsProgress(resumed.snapshot());
assert.equal(needsSetup.phase, 'blocked');
assert.equal(needsSetup.step_id, 'preview');
assert.equal(needsSetup.completed, 0);
await assert.rejects(resumed.track('preview', async () => { throw Error('Synthetic failure'); }));
const failed = automationOpsProgress(resumed.snapshot());
assert.equal(failed.phase, 'failed');
assert.equal(failed.step_id, 'preview');
assert.equal(failed.completed, 0);
console.log('PASS unobserved prerequisites do not suppress the attempted automation stage fault');
