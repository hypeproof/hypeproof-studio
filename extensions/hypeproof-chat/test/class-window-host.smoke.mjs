// CGP-AGENT-D-002: exercise real postConfig, including effective settings and fallback.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const built = await build({ stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const settings = { coachRuntime: 'agent-sdk', requireApprovalFor: ['writeFile', 'delegateAgent', 'webSearch'] };
const vscode = { env: { appName: 'HypeProof Studio' }, workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) }, commands: { executeCommand: async () => {} } };
const module = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, process, Buffer, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout });
const h = Object.create(module.exports.ChatPanelProvider.prototype);
let profile = { profile_id: 'lesson', activity_kind: 'classroom', sdk_tools: { read: true, write: true, shell: true, subagents: true, browser: true }, tools: { web_search: true }, browser_control: { enabled: true } };
let token = Buffer.from(JSON.stringify({ u: 'learner', c: 'cohort', p: 'lesson' })).toString('base64url') + '.signature';
const posts = [];
Object.assign(h, {
  context: { secrets: { get: async key => key === 'hypeproofChat.workshopToken' ? token : undefined }, workspaceState: { get: (_key, fallback) => fallback } },
  loadAccess: async () => {}, ensureProfile: async () => profile, refreshCrDirectorContext: async () => {},
  _instructorMode: { checkInstructorMode: async () => false, reset() {} },
  prepareTaskWorkspace: async () => {}, currentTaskStore: () => null,
  getCoach: () => ({ name: 'HypeProof' }), sitePublisher: () => ({ available: () => false }),
  post: async m => posts.push(JSON.parse(JSON.stringify(m))),
  // CGP-KNOW-D-015 — postConfig narrows the preview header's file grant.
  preview: { setAskAboutFileEnabled() {} },
});
const publish = async () => { await h.postConfig(); return posts.filter(p => p.type === 'config').at(-1).config; };

let connection = { class_run_id: 'class-a', student: { u: 'learner', c: 'cohort', p: 'lesson' }, run: { starts_at: 1800000000000, ends_at: 1800003600000 } };
h.classWindowSource = () => connection;
assert.equal((await publish()).classWindow?.endsAt, connection.run.ends_at);
for (const runtime of ['proxy', 'agent-sdk']) { settings.coachRuntime = runtime; assert.equal((await publish()).classWindow?.id, 'class-a'); }
connection = { ...connection, student: { ...connection.student, u: 'other' } };
assert.equal((await publish()).classWindow, null);
connection.student.u = 'learner';
profile.activity_kind = 'personal'; assert.equal((await publish()).classWindow, null);
profile.activity_kind = 'trial'; assert.equal((await publish()).classWindow, null);
profile.activity_kind = 'classroom';
connection = null; assert.equal((await publish()).classWindow, null);
profile = null; assert.equal((await publish()).classWindow, null);
console.log('PASS real postConfig: current class, both runtimes, foreign seat, personal, trial, disconnected, unknown');
profile = { activity_kind: 'classroom', profile_id: 'lesson' };
connection = { class_run_id: 'class-b', student: { u: 'learner', c: 'cohort', p: 'lesson' }, run: { starts_at: 1800000000000, ends_at: 1800007200000 } };
h.inboxSource = { inboxView: async () => ({ cards: [] }) };
await h.postInbox(); assert.equal(posts.at(-1).config.classWindow.id, 'class-b', 'live connection changes republish the config');
connection = null; await h.postInbox(); assert.equal(posts.at(-1).config.classWindow, null);
// An old config read cannot publish the prior seat after an in-flight token switch.
const count = posts.length;
h.prepareTaskWorkspace = async () => { token = 'changed-during-read'; };
await h.postConfig(); assert.equal(posts.length, count);
console.log('PASS connection updates and in-flight token replacement');

// Seats that never see the line even with a matching, live connection: a local-runtime app and an instructor.
connection = { class_run_id: 'class-c', student: { u: 'learner', c: 'cohort', p: 'lesson' }, run: { starts_at: 1800000000000, ends_at: 1800007200000 } };
profile = { activity_kind: 'classroom', profile_id: 'lesson' }; token = Buffer.from(JSON.stringify({ u: 'learner', c: 'cohort', p: 'lesson' })).toString('base64url') + '.signature';
h.prepareTaskWorkspace = async () => {};
assert.equal((await publish()).classWindow?.id, 'class-c', 'control: the same seat shows the line');
// Instructor mode is reachable with a matching identity: a structurally expired student token hands the panel to the instructor path.
const studentToken = token;
token = Buffer.from(JSON.stringify({ u: 'learner', c: 'cohort', p: 'lesson', exp: 1 })).toString('base64url') + '.signature';
h._instructorMode = { checkInstructorMode: async () => true, reset() {} };
assert.equal((await publish()).classWindow, null, 'an instructor never gets the learner line');
h._instructorMode = { checkInstructorMode: async () => false, reset() {} };
token = studentToken;
const devKeys = ['HPS_DEV_RUNTIME', 'HPS_DEV_PROVIDER', 'HPS_DEV_EXECUTABLE', 'HPS_DEV_MODEL'], savedEnv = Object.fromEntries(devKeys.map(k => [k, process.env[k]])), savedName = vscode.env.appName;
Object.assign(process.env, { HPS_DEV_RUNTIME: '1', HPS_DEV_PROVIDER: 'claude', HPS_DEV_EXECUTABLE: '/nonexistent/never-run', HPS_DEV_MODEL: 'test-model' }); vscode.env.appName = 'HypeProof Studio Dev'; settings.proxyUrl = 'http://127.0.0.1:8787/v1';
try { assert.equal((await publish()).classWindow, null, 'a local-runtime app never gets the learner line'); }
finally { for (const [k, v] of Object.entries(savedEnv)) v === undefined ? delete process.env[k] : (process.env[k] = v); vscode.env.appName = savedName; delete settings.proxyUrl; }
console.log('PASS instructor and local-runtime seats stay silent');

// Wiring in the real activate(): the provider must read the live connection from the same ClassroomOpsHost instance it listens to.
const ext = readFileSync(fileURLToPath(new URL('../src/extension.ts', import.meta.url)), 'utf8').replace(/\/\/[^\n]*/g, '');
const hostAt = ext.indexOf('const classroomOps = new ClassroomOpsHost(');
const wireAt = ext.search(/provider\.classWindowSource\s*=\s*\(\)\s*=>\s*classroomOps\.helpConnection\(\)\s*;/);
assert.ok(hostAt >= 0 && wireAt > hostAt, 'extension.ts assigns provider.classWindowSource from classroomOps.helpConnection() after the host exists');
assert.match(ext, /classroomOps\.onInboxChanged\(\(\) => \{ void provider\.postInbox\(\);/, 'every connection change reaches postInbox, which republishes the config');
console.log('PASS extension.ts wiring');

// Dismissals are durable receipts for the exact current learner/window revision.
const receipts = new Map(); let failWrite = false;
h.context.globalState = { get: key => receipts.get(key), update: async (key,value) => { if(failWrite)throw Error('disk'); receipts.set(key,value); } };
let first = (await publish()).classWindow;
assert.match(first.noticeId,/^[a-f0-9]{64}$/);
await h.handleMessage({type:'dismissClassWindow',id:'stale'});assert.equal(receipts.size,0);
failWrite=true;await h.handleMessage({type:'dismissClassWindow',id:first.noticeId});assert.ok((await publish()).classWindow);failWrite=false;
await h.handleMessage({type:'dismissClassWindow',id:first.noticeId});assert.equal((await publish()).classWindow,null);
assert.equal(receipts.size,1);assert.ok([...receipts.values()].every(v=>v===true),'only a receipt, no learner data');
delete h.currentClassNoticeId;assert.equal((await publish()).classWindow,null,'fresh publication reads durable receipt');
connection.run.ends_at+=60000;let revised=(await publish()).classWindow;assert.ok(revised);assert.notEqual(revised.noticeId,first.noticeId);
await h.handleMessage({type:'dismissClassWindow',id:first.noticeId});assert.ok((await publish()).classWindow,'stale old schedule cannot dismiss revised window');
const priorToken=token;connection.student.u='second';token=Buffer.from(JSON.stringify(connection.student)).toString('base64url')+'.renewed';
let other=(await publish()).classWindow;assert.ok(other);assert.notEqual(other.noticeId,revised.noticeId);
await h.handleMessage({type:'dismissClassWindow',id:revised.noticeId});assert.equal(receipts.size,1,'old learner cannot dismiss current learner');
connection.student.u='learner';token=priorToken;connection.run.ends_at-=60000;assert.equal((await publish()).classWindow,null,'same learner and original window stay dismissed');
connection.class_run_id='next-class';assert.ok((await publish()).classWindow,'next class appears');
{ // A webview that still shows the previous schedule cannot write a receipt: the host refreshes the seat first.
  const shown = (await publish()).classWindow; const before = receipts.size; const postsBefore = posts.length;
  connection.run.ends_at += 120000;
  await h.handleMessage({type:'dismissClassWindow',id:shown.noticeId});
  assert.equal(receipts.size, before, 'stale id from the previous schedule writes nothing');
  assert.ok(posts.length > postsBefore, 'host republished the current window before judging the id');
  assert.ok((await publish()).classWindow, 'revised window stays visible');
}
console.log('PASS class notice receipt: persistence, write failure, stale schedule/learner, next class');
