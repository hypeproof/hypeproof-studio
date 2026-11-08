// Epic #3418 store slice 2 (scenes 1–4): a finished email quest as a store item, the buyer's quest from
// the public layer, the conversational adaptation, and the store-run header on the buyer's turn.
// Expected values follow the custody design (D4–D6, F2, F6, F8), written by hand, not read back from the code.
//
// Run: node --experimental-strip-types test/quest-skill-store.smoke.mjs
import assert from 'node:assert/strict';
const Q = await import('../src/questSkill.ts');
const { defaultAutomationRecipe } = await import('../src/automationProtocol.ts');
const { buildSdkGatewayEnv } = await import('../src/sdkCoachHelpers.ts');
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); };

// The email quest as automationHost.ensureQuest plans it.
const NODES = [
  { id: 'goal', label: '내 업무 이야기하기', description: '대화에서 필요한 내용을 하나씩 확인해요.', dependsOn: [] },
  { id: 'skill', label: '메일 스킬 만들기', description: '반복해서 쓸 문구와 항목을 저장해요.', dependsOn: ['goal'] },
  { id: 'connect', label: '내 Google 계정 연결', description: '허용한 연결은 다음에도 다시 쓸 수 있어요.', dependsOn: ['goal'] },
  { id: 'sheet', label: '내 명단 연결', description: '시트 주소와 명단은 비공개로 확인해요.', dependsOn: ['connect'] },
  { id: 'prepare', label: 'Google 실행 준비', description: '저장한 스킬을 본인 Google 연결로 실행할 준비를 해요.', dependsOn: ['skill', 'connect'] },
  { id: 'preview', label: '실제 메일 미리보기', description: 'Google에서 실행해 내용을 확인해요. 발송은 별도 승인이 필요해요.', dependsOn: ['prepare', 'sheet'] },
];
const recipe = defaultAutomationRecipe();

{
  const draft = Q.questDraft(recipe, NODES);
  assert.deepEqual([draft.title, draft.summary], ['서류 제출 요청', '명단의 이름과 제출 서류, 기한으로 안내 메일을 만들어요.'], 'the completion card prefills the skill name and description');
  const pkg = Q.emailQuestPackage(recipe, NODES, { title: '서류 제출 요청', summary: draft.summary, price_krw: 5000 });
  assert.deepEqual(pkg.outputs, ['mail_draft']);
  assert.deepEqual(pkg.tools, [], 'F2: a mail quest needs no write or browser tool');
  // One store step per quest node, the graph kept as depends_on, in a topological order.
  assert.deepEqual(pkg.steps.map((s) => [s.step_id, s.depends_on ?? []]), [
    ['goal', []], ['skill', ['goal']], ['connect', ['goal']], ['sheet', ['connect']], ['prepare', ['skill', 'connect']], ['preview', ['prepare', 'sheet']],
  ]);
  // F8: connections from the fixed list, each with its reason, only on the steps that use them.
  assert.deepEqual(pkg.steps.flatMap((s) => s.connections.map((c) => `${s.step_id}:${c.id}`)), ['connect:google.gmail.send', 'sheet:google.sheets.read', 'sheet:roster.read']);
  assert.ok(pkg.steps.every((s) => s.connections.every((c) => c.why.length > 0)));
  // D10: the mail template rides in the private layer of the skill step, renamed to store parameters.
  const skill = pkg.steps.find((s) => s.step_id === 'skill');
  assert.deepEqual(skill.private.mail, { subject: '{{name}}님, {{document}} 제출 안내', body: '{{name}}님, 안녕하세요.\n\n{{document}}를 {{due_date}}까지 제출해 주세요.\n감사합니다.' });
  assert.deepEqual(skill.params.map((p) => p.name), ['name', 'document', 'due_date']);
  // The public layer carries no template: what the buyer will see is titles, descriptions, params and connections.
  const publicLayer = JSON.stringify(pkg.steps.map(({ private: _p, ...pub }) => pub));
  assert.ok(!publicLayer.includes('제출해 주세요') && !publicLayer.includes('{{'), 'no template text in the public layer');
  // Negative control: a quest without the skill step has nothing to sell.
  assert.throws(() => Q.emailQuestPackage(recipe, NODES.filter((n) => n.id === 'goal'), { title: 't', summary: 's', price_krw: 0 }));
  ok('a finished email quest becomes one store item: steps by node id, graph, connections with reasons, template private');
}

{
  const pkg = Q.emailQuestPackage(recipe, NODES, { title: '서류 제출 요청', summary: 's', price_krw: 0 });
  const pub = pkg.steps.map(({ private: _p, ...s }) => s);
  const mine = Q.storeQuestSnapshot('서류 제출 요청', pub, { google: true, roster: true });
  const status = Object.fromEntries(mine.nodes.map((x) => [x.id, x.status]));
  // Scene 2/3: the buyer's existing Google and roster connections are reused and shown as already connected.
  assert.equal(status.connect, 'succeeded');
  assert.equal(status.sheet, 'succeeded');
  assert.equal(status.goal, 'current');
  assert.ok(mine.nodes.find((x) => x.id === 'connect').description.startsWith('이미 연결됨'));
  assert.equal(status.skill, 'pending', 'a step that waits for an unfinished one is not ready');
  // Negative control: a device with no connection completes nothing in advance.
  const fresh = Q.storeQuestSnapshot('서류 제출 요청', pub, { google: false, roster: false });
  assert.deepEqual(fresh.nodes.filter((x) => x.status === 'succeeded'), []);
  assert.ok(!fresh.nodes.some((x) => x.description.includes('이미 연결됨')));
  // Steps without depends_on (a single-step skill) run in order.
  const linear = Q.storeQuestSnapshot('회의록 요약', [
    { step_id: 'read-notes', title: '메모 읽기', description: '메모를 읽어요.', connections: [] },
    { step_id: '2-summary', title: '요약하기', description: '요약해요.', connections: [] },
  ], undefined);
  assert.deepEqual(linear.nodes.map((x) => [x.id, x.dependsOn]), [['read-notes', []], ['s2-summary', ['read-notes']]]);
  ok('the installed skill is the buyer\'s quest from the public layer; existing connections show as already connected');
}

{
  const steps = [
    { step_id: 'read-notes', title: '메모 읽기', description: '', connections: [] },
    { step_id: 'summary', title: '요약하기', description: '', connections: [] },
  ];
  // Scene 4: the buyer's sentence becomes the last enabled step's extra instruction; a tone word sets its tone.
  const a = Q.adaptOverlay('세 줄로 짧게 요약해 주세요', steps, {});
  assert.deepEqual(a.overlay, { summary: { extra: '세 줄로 짧게 요약해 주세요', tone: '짧게' } });
  assert.equal(a.changes.length, 2);
  // An earlier adaptation of another field stays; a disabled last step moves the target to the one before.
  const b = Q.adaptOverlay('친근하게 써 주세요', steps, { summary: { enabled: false }, 'read-notes': { position: 0 } });
  assert.deepEqual(b.overlay, { summary: { enabled: false }, 'read-notes': { position: 0, extra: '친근하게 써 주세요', tone: '친근하게' } });
  // Negative controls: an empty request, and a skill with every step off.
  assert.throws(() => Q.adaptOverlay('  ', steps, {}));
  assert.throws(() => Q.adaptOverlay('짧게', steps, { summary: { enabled: false }, 'read-notes': { enabled: false } }));
  ok('conversational adaptation is an overlay change decided by rules, from the public steps only');
}

{
  const item = 'ski_' + 'a'.repeat(32);
  const env = buildSdkGatewayEnv({ ANTHROPIC_CUSTOM_HEADERS: `x-hps-store-run: ski_${'b'.repeat(32)}@9\nx-other: keep` }, { proxyUrl: 'https://synthetic.invalid/v1', token: 't', storeRun: `${item}@2` });
  const lines = env.ANTHROPIC_CUSTOM_HEADERS.split('\n');
  assert.deepEqual(lines.filter((l) => /^x-hps-store-run:/.test(l)), [`x-hps-store-run: ${item}@2`], 'an ambient store-run header never survives');
  assert.ok(lines.includes('x-other: keep'));
  // A turn that runs no store skill sends no store header, even with one in the ambient environment.
  const plain = buildSdkGatewayEnv({ ANTHROPIC_CUSTOM_HEADERS: `x-hps-store-run: ${item}@2` }, { proxyUrl: 'https://synthetic.invalid/v1', token: 't' });
  assert.ok(!(plain.ANTHROPIC_CUSTOM_HEADERS ?? '').includes('x-hps-store-run'));
  assert.throws(() => buildSdkGatewayEnv({}, { proxyUrl: 'https://synthetic.invalid/v1', token: 't', storeRun: 'ski_x@1\nx-hps-effort: high' }));
  ok('the buyer\'s turn names the installed skill in x-hps-store-run and nothing else can');
}

{
  // D8 structural guard: chatPanelProvider cannot be driven without vscode, so its two exits to a non-Service
  // runtime are read from source. Before any route is chosen, and in the SDK-unavailable fallback before the
  // seat's outcome is decided, a store-run task is refused.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
  // #3597: the local route also carries the release instructor runner (instructorLocalRuntime, instructor turns only); the guard is the same.
  const route = src.indexOf('const local = localRuntimeConfig(vscode.env.appName, proxyUrl) ?? instructorLocalRuntime(this._instructorMode.isInstructor === true, this.releaseRuntime);');
  const routeGuard = src.indexOf('throw new Error(STORE_RUN_NEEDS_SERVICE)', route);
  assert.ok(route > 0 && routeGuard > route && routeGuard < src.indexOf('if (local) {', route), 'refused before the runtime route');
  const fallback = src.indexOf('if (!(err instanceof SdkUnavailableError)) throw err;');
  const outcome = src.indexOf('const outcome = sdkUnavailableOutcome(', fallback);
  const fallbackGuard = src.indexOf('throw new Error(STORE_RUN_NEEDS_SERVICE)', fallback);
  assert.ok(fallback > 0 && fallbackGuard > fallback && fallbackGuard < outcome, 'refused before the proxy fallback is decided');
  ok('a store-run task never reaches a local, instructor or proxy runtime, including the SDK-unavailable fallback');
}

console.log(`quest-skill-store: ${n} passed`);
