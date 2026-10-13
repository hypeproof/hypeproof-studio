import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: ['src/automationQuestSession.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require });
const { createAutomationQuestSession, withAutomationQuest } = module.exports;
const plan = { title: '자료 요청 메일', nodes: [
  { id: 'goal', label: '업무 정하기', dependsOn: [] },
  { id: 'skill', label: '스킬 저장', dependsOn: ['goal'] },
  { id: 'prepare', label: '코드 준비', dependsOn: ['skill'] },
  { id: 'upload', label: '코드 저장', dependsOn: ['prepare'] },
] };
const status = (quest, id) => quest.snapshot().nodes.find(node => node.id === id).status;

test('install receipt completes the shared skill and intent, never another learner\'s execution', async () => {
  const frames=[];
  const quest=createAutomationQuestSession(async html=>frames.push(html));
  const ids=['goal','skill','connect','sheet','prepare','upload','deploy','preview'];
  await quest.plan({title:'공유 스킬 재사용',nodes:ids.map((id,i)=>({id,label:id,dependsOn:i?[ids[i-1]]:[]}))});
  let outcome={installed:true};
  const host=withAutomationQuest({runtime:{},isAllowed:()=>true,confirmSend:async()=>false,
    installSkill:async()=>{if(outcome.error)throw Error('synthetic install failure');return outcome;}},quest);
  await host.installSkill('synthetic-shared-skill');
  assert.equal(status(quest,'goal'),'succeeded');assert.equal(status(quest,'skill'),'succeeded');
  for(const id of ids.slice(2))assert.notEqual(status(quest,id),'succeeded');
  assert.match(frames.at(-1),/2 \/ 8 완료/);
  for(const id of ids.slice(2))await quest.track(id,async()=>true);
  outcome={cancelled:true};await host.installSkill('replacement');
  assert.equal(status(quest,'preview'),'succeeded','declining replacement preserves the installed skill');
  outcome={error:true};await assert.rejects(host.installSkill('replacement'));
  assert.equal(status(quest,'preview'),'succeeded','failed download does not replace the saved skill');
  outcome={installed:true};await host.installSkill('replacement');
  assert.equal(status(quest,'skill'),'succeeded');
  for(const id of ['prepare','upload','deploy','preview'])assert.notEqual(status(quest,id),'succeeded','old execution does not verify a different recipe');
});

test('a late install receipt cannot advance a replacement activity',async()=>{
  const quest=createAutomationQuestSession(async()=>{});await quest.plan(plan);
  let finish;
  const host=withAutomationQuest({runtime:{},isAllowed:()=>true,confirmSend:async()=>false,
    installSkill:()=>new Promise(resolve=>{finish=resolve;})},quest);
  const operation=host.installSkill('synthetic-shared-skill');
  quest.clear();await quest.plan(plan);finish({installed:true});await operation;
  assert.equal(quest.snapshot().nodes.filter(node=>node.status==='succeeded').length,0);
});

test('experienced learner can provide complete intent without a redundant question', async () => {
  const quest = createAutomationQuestSession(async () => {});
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, confirmSend: async () => false,
    saveSkill: async () => ({ saved: true }), appsScriptPrepare: async () => ({ prepared: true }) }, quest);
  await host.workflowPlan(plan);
  await host.saveSkill({});
  await host.appsScriptPrepare();
  assert.equal(status(quest, 'goal'), 'succeeded');
  assert.equal(status(quest, 'skill'), 'succeeded');
  assert.equal(status(quest, 'prepare'), 'succeeded');
});

test('a coach restatement keeps completed work and the result of an in-flight operation', async () => {
  const quest = createAutomationQuestSession(async () => {});
  await quest.plan(plan);
  await quest.track('goal', async () => true);
  let finish;
  const pending = quest.track('skill', () => new Promise(resolve => { finish = resolve; }));
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await quest.plan({ ...plan, title: '업무 자동화', nodes: [...plan.nodes].reverse() });
  assert.equal(status(quest, 'goal'), 'succeeded');
  assert.equal(status(quest, 'skill'), 'running');
  finish(true); await pending;
  assert.equal(status(quest, 'skill'), 'succeeded');
});

test('changing a prerequisite invalidates descendants but leaves unrelated evidence intact', async () => {
  const quest = createAutomationQuestSession(async () => {});
  await quest.plan(plan);
  for (const id of ['goal', 'skill', 'prepare', 'upload']) await quest.track(id, async () => true);
  quest.invalidate(['skill']);
  assert.equal(status(quest, 'goal'), 'succeeded');
  for (const id of ['skill', 'prepare', 'upload']) assert.notEqual(status(quest, id), 'succeeded');
  // Delayed results from before a request change cannot complete its new graph.
  let finish;
  const pending = quest.track('skill', () => new Promise(resolve => { finish = resolve; }));
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  quest.clear(); await quest.plan(plan); finish(true); await pending;
  assert.equal(status(quest, 'goal'), 'current');
  assert.equal(status(quest, 'skill'), 'pending');
});

test('cancellation and recovery instructions remain incomplete until actual retry succeeds', async () => {
  const quest = createAutomationQuestSession(async () => {});
  let result = { cancelled: true };
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, confirmSend: async () => false,
    appsScriptUpload: async () => result }, quest);
  await quest.plan({ title: 'Google 저장', nodes: [{ id: 'upload', label: '코드 저장', dependsOn: [] }] });
  await host.appsScriptUpload(); assert.equal(status(quest, 'upload'), 'blocked');
  result = { recoveryRequired: true, executionVerified: false };
  await host.appsScriptUpload(); assert.equal(status(quest, 'upload'), 'blocked');
  result = { uploaded: true };
  await host.appsScriptUpload(); assert.equal(status(quest, 'upload'), 'succeeded');
});


test('preparing a saved recipe reconciles earlier successful tool results without asking or saving again', async () => {
  const quest = createAutomationQuestSession(async () => {});
  let result = { recoveryRequired: true };
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, confirmSend: async () => false,
    appsScriptPrepare: async () => result }, quest);
  await quest.plan(plan);
  await host.appsScriptPrepare();
  assert.equal(status(quest, 'goal'), 'current');
  assert.equal(status(quest, 'skill'), 'pending');
  await quest.track('upload', async () => ({ uploaded: true }), value => value.uploaded);
  result = { prepared: true };
  await host.appsScriptPrepare();
  for (const id of ['goal', 'skill', 'prepare', 'upload']) assert.equal(status(quest, id), 'succeeded');
});

test('late saved-recipe preparation cannot complete any stage of a replacement activity', async () => {
  const quest = createAutomationQuestSession(async () => {});
  let finish;
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, confirmSend: async () => false,
    appsScriptPrepare: () => new Promise(resolve => { finish = resolve; }) }, quest);
  await quest.plan(plan);
  const operation = host.appsScriptPrepare();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  quest.clear(); await quest.plan(plan);
  finish({ prepared: true }); await operation;
  assert.equal(quest.snapshot().nodes.filter(node => node.status === 'succeeded').length, 0);
});


test('verified preview of an existing deployment reconciles reused prerequisites but never sending or sharing', async () => {
  const quest = createAutomationQuestSession(async () => {});
  const ids = ['goal', 'skill', 'connect', 'sheet', 'prepare', 'upload', 'deploy', 'preview', 'send', 'publish'];
  await quest.plan({ title: '저장된 자동화 실행', nodes: ids.map((id, i) => ({ id, label: id, dependsOn: i ? [ids[i - 1]] : [] })) });
  let result = { deploymentRequired: true };
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, confirmSend: async () => false,
    appsScriptRun: async () => result }, quest);
  await host.appsScriptRun('preview');
  assert.equal(quest.snapshot().nodes.filter(node => node.status === 'succeeded').length, 0);
  result = { previewed: true, reviewed: false, dismissed: true, mailSent: false };
  await host.appsScriptRun('preview');
  for (const id of ids.slice(0, 8)) assert.equal(status(quest, id), 'succeeded');
  for (const id of ['send', 'publish']) assert.notEqual(status(quest, id), 'succeeded');
});


test('missing deployment and thrown errors surface on the attempted node before prerequisites are observed', async () => {
  const frames = [];
  const quest = createAutomationQuestSession(async html => { frames.push(html); });
  await quest.plan({ title: '다시 실행', nodes: [
    { id: 'goal', label: '업무 확인', dependsOn: [] },
    { id: 'deploy', label: '실행 버전 준비', dependsOn: ['goal'] },
    { id: 'preview', label: '메일 미리보기', dependsOn: ['deploy'] },
  ] });
  let outcome = { deploymentRequired: true };
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, confirmSend: async () => false,
    appsScriptRun: async () => { if (outcome.error) throw Error('Synthetic runtime failure'); return outcome; } }, quest);
  await host.appsScriptRun('preview');
  assert.equal(status(quest, 'preview'), 'blocked');
  assert.equal(status(quest, 'goal'), 'current');
  assert.equal(status(quest, 'deploy'), 'pending');
  assert.match(frames.at(-1), /설정 필요/);
  assert.match(frames.at(-1), /0 \/ 3 완료/);
  outcome = { error: true };
  await assert.rejects(host.appsScriptRun('preview'));
  assert.equal(status(quest, 'preview'), 'failed');
  assert.equal(quest.snapshot().nodes.filter(node => node.status === 'succeeded').length, 0);
  outcome = { previewed: true };
  await host.appsScriptRun('preview');
  assert(quest.snapshot().nodes.every(node => node.status === 'succeeded'));
});

test('a failed rerun preserves prerequisites and revokes only the failed stage and its dependants', async () => {
  const quest = createAutomationQuestSession(async () => {});
  await quest.plan(plan);
  for (const id of ['goal', 'skill', 'prepare', 'upload']) await quest.track(id, async () => true);
  await quest.track('prepare', async () => ({ recoveryRequired: true }), () => false);
  assert.equal(status(quest, 'goal'), 'succeeded');
  assert.equal(status(quest, 'skill'), 'succeeded');
  assert.equal(status(quest, 'prepare'), 'blocked');
  assert.equal(status(quest, 'upload'), 'pending');
  await quest.track('prepare', async () => true);
  assert.equal(status(quest, 'prepare'), 'succeeded');
  assert.equal(status(quest, 'upload'), 'current');
});

test('reading a private sheet restores verified connection evidence after a cancelled public question', async () => {
  const quest = createAutomationQuestSession(async () => {});
  const ids = ['goal', 'skill', 'connect', 'sheet', 'prepare'];
  await quest.plan({ title: '공유 스킬 재사용', nodes: ids.map((id, i) => ({ id, label: id, dependsOn: i ? [ids[i - 1]] : [] })) });
  let result = { needsGoogleConnection: true };
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, confirmSend: async () => false,
    configureSheet: async () => result, appsScriptPrepare: async () => ({ prepared: true }) }, quest);
  await host.configureSheet('reuse');
  assert.notEqual(status(quest, 'connect'), 'succeeded');
  result = { rowCount: 1, columns: ['이메일'], reused: true };
  await host.configureSheet('reuse');
  await host.appsScriptPrepare();
  for (const id of ids) assert.equal(status(quest, id), 'succeeded');
});
