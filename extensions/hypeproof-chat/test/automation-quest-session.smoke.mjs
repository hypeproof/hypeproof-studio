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

test('shared runner migrates an old plan without inventing personal upload or deployment', async () => {
  const quest = createAutomationQuestSession(async () => {});
  let result = { recoveryRequired: true, sharedRunner: true };
  let connection = { connected: true, reused: true };
  let sends = 0;
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, isSharedRunner: () => true, confirmSend: async () => false,
    connectGoogle: async () => connection,
    appsScriptPrepare: async () => ({ prepared: true, sharedRunner: true }),
    appsScriptUpload: async () => ({ sharedRunner: true, ready: true, uploaded: false }),
    appsScriptDeploy: async () => ({ sharedRunner: true, ready: true, deployed: false }),
    appsScriptRun: async mode => { if (mode === 'send') sends++; return result; },
  }, quest);
  await host.workflowPlan({ title: '나의 자동화', nodes: [
    { id: 'goal', label: '업무 정하기', dependsOn: [] },
    { id: 'skill', label: '스킬 저장', dependsOn: ['goal'] },
    { id: 'connect', label: 'Google 연결', dependsOn: ['goal'] },
    { id: 'sheet', label: '명단 연결', dependsOn: ['connect'] },
    { id: 'prepare', label: '코드 생성', dependsOn: ['skill'] },
    { id: 'upload', label: '코드 업로드', dependsOn: ['prepare', 'connect'] },
    { id: 'deploy', label: '개인 배포', dependsOn: ['upload'] },
    { id: 'preview', label: '미리보기', dependsOn: ['deploy', 'sheet'] },
    { id: 'send', label: '메일 발송', dependsOn: ['preview'] },
    { id: 'publish', label: '스토어 공유', dependsOn: ['send'] },
  ] });
  assert(!quest.snapshot().nodes.some(node => ['upload', 'deploy'].includes(node.id)));
  assert.deepEqual(Array.from(quest.snapshot().nodes.find(node => node.id === 'preview').dependsOn), ['prepare', 'sheet']);
  assert.deepEqual(Array.from(quest.snapshot().nodes.find(node => node.id === 'publish').dependsOn), ['preview']);
  await host.appsScriptUpload(); await host.appsScriptDeploy();
  assert.equal(quest.snapshot().nodes.filter(node => node.status === 'succeeded').length, 0, 'compatibility readiness is not learner progress');
  await host.appsScriptRun('preview');
  assert.equal(status(quest, 'preview'), 'blocked');
  result = { sharedRunner: true, previewed: true, reviewed: true, nextAction: 'wait_for_user', mailSent: false };
  await host.appsScriptRun('preview');
  for (const id of ['goal', 'skill', 'connect', 'sheet', 'prepare', 'preview']) assert.equal(status(quest, id), 'succeeded');
  for (const id of ['send', 'publish']) assert.equal(status(quest, id), 'current');
  assert.equal(sends, 0, 'review never initiates a send');
  await host.connectGoogle('reuse');
  assert.equal(status(quest, 'preview'), 'succeeded', 'verified reuse keeps the same connection evidence');
  connection = { connected: true, reused: false };
  await host.connectGoogle('change');
  assert.equal(status(quest, 'connect'), 'succeeded');
  for (const id of ['sheet', 'prepare', 'preview', 'send', 'publish']) assert.notEqual(status(quest, id), 'succeeded', 'actual account-change tool receipt invalidates caller-bound readiness and preview');
  assert.equal(status(quest, 'skill'), 'succeeded');
  await host.appsScriptRun('preview');
  await host.connectGoogle('reuse');
  assert.notEqual(status(quest, 'preview'), 'succeeded', 'a reconnect reached from reuse also creates a new connection');
});

test('shared preview receipts never mark legacy personal-script stages as complete', async () => {
  const quest = createAutomationQuestSession(async () => {});
  await quest.plan({ title: '이전 활동', nodes: [
    { id: 'goal', label: '업무', dependsOn: [] },
    { id: 'upload', label: '코드 저장', dependsOn: ['goal'] },
    { id: 'deploy', label: '개인 배포', dependsOn: ['upload'] },
    { id: 'preview', label: '미리보기', dependsOn: ['deploy'] },
  ] });
  const host = withAutomationQuest({ runtime: {}, isAllowed: () => true, confirmSend: async () => false,
    appsScriptRun: async () => ({ sharedRunner: true, previewed: true }) }, quest);
  await host.appsScriptRun('preview');
  for (const id of ['upload', 'deploy']) assert.notEqual(status(quest, id), 'succeeded');
});

test('new requirement questions reopen old skill completion until the next saved recipe receipt',async()=>{
 const quest=createAutomationQuestSession(async()=>{});
 const host=withAutomationQuest({runtime:{},isAllowed:()=>true,confirmSend:async()=>false,isSharedRunner:()=>true,askUser:async()=>({answer:'different tone'}),saveSkill:async()=>({saved:true})},quest);
 await host.workflowPlan({title:'Requirements revision',nodes:[{id:'goal',label:'Goal',dependsOn:[]},{id:'skill',label:'Skill',dependsOn:['goal']}]});
 await host.saveSkill({});assert.equal(quest.snapshot().nodes.find(n=>n.id==='skill').status,'succeeded');
 await host.askUser({question:'Tone?',choices:[],allowFreeText:true});
 assert.equal(quest.snapshot().nodes.find(n=>n.id==='goal').status,'succeeded');
 assert.equal(quest.snapshot().nodes.find(n=>n.id==='skill').status,'current');
});

test('column clarification preserves verified account and sheet while reopening design and execution',async()=>{
 for(const answer of [{answer:'Use the deadline column'},{cancelled:true}]){
  const quest=createAutomationQuestSession(async()=>{});let resolveQuestion,started;
  const questionStarted=new Promise(resolve=>{started=resolve;});
  const host=withAutomationQuest({runtime:{},isAllowed:()=>true,confirmSend:async()=>false,isSharedRunner:()=>true,
   askUser:()=>new Promise(resolve=>{resolveQuestion=resolve;started();}),saveSkill:async()=>({saved:true}),
   appsScriptRun:async()=>({sharedRunner:true,previewed:true})},quest);
  await host.workflowPlan({title:'Column correction',nodes:[
   {id:'goal',label:'Goal',dependsOn:[]},{id:'skill',label:'Skill',dependsOn:['goal']},
   {id:'connect',label:'Account',dependsOn:['goal']},{id:'sheet',label:'Sheet',dependsOn:['connect']},
   {id:'prepare',label:'Prepare',dependsOn:['skill','connect']},{id:'preview',label:'Preview',dependsOn:['prepare','sheet']},
   {id:'send',label:'Send',dependsOn:['preview']},
  ]});
  await host.appsScriptRun('preview');
  const question=host.askUser({question:'Correct the deadline column?',choices:[],allowFreeText:true});
  await questionStarted;
  for(const id of ['goal','connect','sheet'])assert.equal(status(quest,id),'succeeded',id+' retains its real receipt while clarification is pending');
  for(const id of ['skill','prepare','preview','send'])assert.notEqual(status(quest,id),'succeeded',id+' cannot reuse prior execution evidence');
  resolveQuestion(answer);await question;
  for(const id of ['connect','sheet'])assert.equal(status(quest,id),'succeeded','cancellation does not disconnect the account or sheet');
  await host.saveSkill({});
  assert.equal(status(quest,'skill'),'succeeded');assert.notEqual(status(quest,'preview'),'succeeded','saving the correction still needs a fresh preview');
 }
});

test('withdrawal clears only publication evidence after success and ignores a late receipt',async()=>{
  const quest=createAutomationQuestSession(async()=>{});
  const publicationPlan={title:'공유 철회',nodes:[{id:'skill',label:'스킬',dependsOn:[]},{id:'publish',label:'공유',dependsOn:['skill']}]};
  await quest.plan(publicationPlan);await quest.track('skill',async()=>true);await quest.track('publish',async()=>true);
  let result={cancelled:true},finish;
  const host=withAutomationQuest({runtime:{},isAllowed:()=>true,confirmSend:async()=>false,unpublishSkill:async()=>result},quest);
  await host.unpublishSkill('owned');assert.equal(status(quest,'publish'),'succeeded');
  result={unpublished:true};await host.unpublishSkill('owned');assert.notEqual(status(quest,'publish'),'succeeded');assert.equal(status(quest,'skill'),'succeeded');
  const slow=withAutomationQuest({runtime:{},isAllowed:()=>true,confirmSend:async()=>false,unpublishSkill:()=>new Promise(resolve=>{finish=resolve;})},quest);
  const pending=slow.unpublishSkill('old');quest.clear();await quest.plan(publicationPlan);await quest.track('skill',async()=>true);await quest.track('publish',async()=>true);
  finish({unpublished:true});await pending;assert.equal(status(quest,'publish'),'succeeded','late withdrawal cannot erase a new activity publication');
});
