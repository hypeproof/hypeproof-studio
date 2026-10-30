// REQ-STUDIO-MEMORY-OVERVIEW (CGP-KNOW-R-025 / REQ-KNOW-43) — the memory overview: stated facts grouped by task, never an
// ability, personality or capability statement. The real check on planted good and bad sentences, the real store on real
// temporary files (the task line), then the real provider routing into the real host module (VS Code stubbed): the
// overview on an adult seat, none on a minor or unknown cohort, and a correction in words with its no-op answer.
//   node --experimental-strip-types test/memory-overview.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_MODELS } from '@hypeproof/measurement-core/capability-models';
import { ActivityMemory } from '../src/activityMemory.ts';
import { memoryResultNotice } from '../src/activityMemoryView.ts';
import { ABILITY_NOUNS, EVALUATIVE_WORDS, GONE_TASK_TITLE, HIDDEN_TITLE, NO_TASK_TITLE, buildMemoryOverview, memoryOverviewPasses, memoryStatementRefusal } from '../src/memoryOverview.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-overview-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const put = (root, name, text) => { fs.mkdirSync(memDir(root), { recursive: true }); fs.writeFileSync(path.join(memDir(root), name), text); };
const files = root => fs.existsSync(memDir(root)) ? fs.readdirSync(memDir(root)).sort() : [];

/** Stated facts a learner keeps, ordinary task memories: every one must reach the overview (a too-strict check would drop them). */
const FACTS = [
  '제목은 파란색으로 하기로 함', '3단계에서 버튼 위치 고침', '발표는 금요일이에요.', '좋아하는 색은 초록이에요.', '사이트 이름은 Green Day예요.',
  '배경 이미지는 바다 사진으로 바꿈', '점수판은 오른쪽 위에 둔다.', '포기 버튼은 왼쪽에 둔다', '글꼴은 고딕체를 좋아해요.', '검증 단계를 먼저 하기로 했어요.',
  '이 작업의 의도는 학급 신문이에요.', '판단 기준: 버튼이 화면 안에 보인다.', '맥락 설명은 첫 화면에 넣기로 했어요.', '장애물은 세 개로 정함', '게임 시작 화면에 음악 넣기',
  '친구 이름은 민준이라고 부르기로 함', '마감은 11월 3일', '파란 버튼을 누르면 다음 장으로 넘어감', '타입스크립트 대신 자바스크립트로 만들기로 함', '로고는 왼쪽 위에 둔다',
  '발표 시간은 5분', '표는 3열로 만들기로 함', '회의 내용을 요약해서 첫 장에 넣기', '아이디어 목록은 세 개', '토요일에 예약해 둔 방에서 촬영',
  '아이콘은 별 모양', '서버가 불안정해서 다시 올림', '반복 버튼은 아래쪽',
];
/** Ability, personality and capability statements, written by hand (not taken from the check's own lists). */
const JUDGMENTS = [
  ['OWNERSHIP이 높아요', 'capability'], ['FRAMING 단계', 'capability'], ['ＶＥＲＩＦＹ', 'capability'], ['TASTE가 좋다', 'capability'],
  ['문제 구성을 잘 못함', 'capability'], ['주인의식이 있다', 'capability'], ['역할·통제 설계 보류', 'capability'], ['검증이 약함', 'capability'], ['판단 점수 3', 'capability'],
  ['문제 정의 능력이 향상됐어요', 'judgment'], ['넌 똑똑해', 'judgment'], ['나는 꼼꼼한 사람', 'judgment'],
  ['수학을 잘해요', 'judgment'], ['영어를 못해요', 'judgment'], ['성격이 급한 편', 'judgment'], ['집중력이 약해요', 'judgment'],
  ['맥락을 잘 이해함', 'judgment'], ['He is smart', 'judgment'], ['she is BAD AT math', 'judgment'], ['창의적인 학생', 'judgment'],
  ['똑\u200B똑해요', 'judgment'], ['너는 늘 서두르는 타입', 'judgment'], ['불안이 많은 편', 'health'], ['has ADHD', 'health'],
];
/**
 * The privacy verifier's 71 bypass sentences for a89b16703 (cgp-knowr025-a-memory-overview-lists-verify/adv.mjs), verbatim:
 * every one must be left out of the overview.
 */
const VERIFIER_PROBES = [
 '수학을 못해서 자주 포기함','수학을 어려워해서 자주 포기해요','금방 포기하는 아이','쉽게 포기한다','쉽게 싫증을 낸다','자주 짜증을 낸다','집중을 오래 못 한다',
 '말을 잘 안 듣는다','숙제를 자주 빼먹음','글쓰기에 약하다','글쓰기가 약점이다','코딩 감각이 있다','센스가 있다','센스가 없음','눈치가 빠르다','눈치가 없다',
 '머리가 좋은 편','머리 회전이 빠름','습득이 빠르다','배우는 속도가 느리다','이해 속도가 느림','느린 학습자','공부를 싫어하는 학생','노력파','완벽주의자',
 '수 학 을 잘 해 요','잘   해요','못  해 요','잘하는편','못하는편','소 심 함','똑 똑 함','ㄸㅗㄱㄸㅗㄱ',
 'The learner gives up easily','struggles with math','is slow to learn','very bright kid','not very bright','shy and quiet','impatient','has ADHD','a perfectionist',
 'S m a r t','sm​art','ｓｍａｒｔ','smаrt (cyrillic a)','ownership is high','Ownership score 3','verify가 약함','Taste 높음',
 '수학 is weak','math 실력 low','IQ가 높다','아이큐 150','공감 능력 결여','자존감이 낮다','불안이 많다','우울해 보인다','ADHD 같다','난독증이 있다',
 '틀린 문제가 많아 실망함','항상 늦는다','게임 중독','리더십이 있다','리더 타입','문제아','모범생','우등생','열등생','상위권 학생','하위권',
];

try {
  await t('check: stated facts pass; hand-written ability, personality and capability statements are refused', async () => {
    for (const fact of FACTS) assert.equal(memoryStatementRefusal(fact), null, fact);
    for (const [text, why] of JUDGMENTS) assert.equal(memoryStatementRefusal(text), why, text);
    assert.ok(FACTS.length >= 15);
    const kept = VERIFIER_PROBES.filter(text => memoryStatementRefusal(text) === null);
    assert.deepEqual(kept, [], 'every verifier probe is dropped');
    assert.equal(VERIFIER_PROBES.length, 71);
    console.log(`       dropped ${VERIFIER_PROBES.length}/${VERIFIER_PROBES.length} verifier probes, kept ${FACTS.length}/${FACTS.length} facts`);
  });

  await t('check: every capability key of both models (FRAMING…OWNERSHIP and the legacy seven), in any case, and every listed word is refused', async () => {
    const keys = CAPABILITY_MODELS.flatMap(model => model.capabilities.map(c => c.key));
    assert.ok(keys.includes('FRAMING') && keys.includes('OWNERSHIP') && keys.includes('TASTE') && keys.includes('ITERATE'), 'both models are read');
    for (const key of keys) for (const form of [key, key.toLowerCase(), key[0] + key.slice(1).toLowerCase(), key.split('').join(' ')]) {
      assert.equal(memoryStatementRefusal(`이번 작업은 ${form} 쪽이에요`), 'capability', form);
    }
    for (const word of [...ABILITY_NOUNS, ...EVALUATIVE_WORDS]) for (const form of [word, [...word].join(' ')]) assert.ok(memoryStatementRefusal(`그는 ${form}`), form);
  });

  await t('store: an item kept from a task carries the task on its first line; the text never does', async () => {
    const root = path.join(top, 'store'); fs.mkdirSync(root);
    const store = new ActivityMemory(root);
    const a = await store.append('발표는 금요일이에요.', 1_000, '6f1c2b9e-1111-4a2b-9c3d-000000000001');
    const b = await store.append('색은 초록', 2_000);
    const c = await store.append('줄 바꿈 없는 id', 3_000, 'bad id\n<!--');
    assert.equal(fs.readFileSync(path.join(memDir(root), a), 'utf8'), '<!-- hypeproof-task: 6f1c2b9e-1111-4a2b-9c3d-000000000001 -->\n발표는 금요일이에요.\n');
    assert.equal(fs.readFileSync(path.join(memDir(root), b), 'utf8'), '색은 초록\n', 'no task, no task line');
    assert.equal(fs.readFileSync(path.join(memDir(root), c), 'utf8'), '줄 바꿈 없는 id\n', 'an id that is not plain is not written');
    const listing = await store.list();
    assert.deepEqual(listing.entries.map(e => [e.task, e.text]), [[null, '줄 바꿈 없는 id\n'], [null, '색은 초록\n'], ['6f1c2b9e-1111-4a2b-9c3d-000000000001', '발표는 금요일이에요.\n']]);
    assert.ok((await store.contextItems()).every(item => !item.text.includes('hypeproof-task')), 'a request would never carry the task line');
  });

  await t('build: grouped by task, newest first; unknown and missing tasks named plainly; judgments withheld and counted', async () => {
    const entries = [
      { name: 'a.md', at: 5, task: 't1', text: '발표는 금요일이에요.\n' },
      { name: 'b.md', at: 4, task: 't2', text: '색은 초록' },
      { name: 'c.md', at: 3, task: 't1', text: '글꼴은 고딕체' },
      { name: 'd.md', at: 2, task: 't1', text: '넌 수학을 잘해요' },
      { name: 'e.md', at: 1, task: null, text: '사이트 이름은 숲' },
      { name: 'f.md', at: 6, task: 'gone', text: '목요일 리허설' },
      { name: 'g.md', at: 7, task: 't3', text: '배경은 하늘색' },
      { name: 'h.md', at: 8, task: 't1', text: null },
      { name: 'i.md', at: 9, task: 't1', text: '  \n' },
      { name: 'j.md', at: 10, task: 't2', text: 'OWNERSHIP 관찰' },
    ];
    const overview = buildMemoryOverview(entries, [{ id: 't1', title: '학급 신문' }, { id: 't2', title: '내 홈페이지' }, { id: 't3', title: '나는 천재 디자이너' }]);
    assert.deepEqual(overview, {
      groups: [
        { task: 't3', title: HIDDEN_TITLE, items: [{ name: 'g.md', at: 7, text: '배경은 하늘색' }] },
        { task: 'gone', title: GONE_TASK_TITLE, items: [{ name: 'f.md', at: 6, text: '목요일 리허설' }] },
        { task: 't1', title: '학급 신문', items: [{ name: 'a.md', at: 5, text: '발표는 금요일이에요.' }, { name: 'c.md', at: 3, text: '글꼴은 고딕체' }] },
        { task: 't2', title: '내 홈페이지', items: [{ name: 'b.md', at: 4, text: '색은 초록' }] },
        { task: null, title: NO_TASK_TITLE, items: [{ name: 'e.md', at: 1, text: '사이트 이름은 숲' }] },
      ],
      withheld: 2,
    });
    assert.equal(memoryOverviewPasses(overview), true);
    assert.equal(memoryOverviewPasses({ groups: [{ task: null, title: 'x', items: [{ name: 'z.md', at: 1, text: '검증 역량 향상' }] }], withheld: 0 }), false, 'the check catches a bad item');
    assert.equal(memoryOverviewPasses({ groups: [{ task: 'x', title: '똑똑한 나', items: [] }], withheld: 0 }), false, 'the check catches a bad title');
  });

  await t('pin: a file rewritten in place keeps its inode but not its identity; the remove is refused', async () => {
    // ext4 reuses a freed inode at once, so a file recreated under the same name can carry the pinned dev/ino. An in-place
    // rewrite is the same case on every filesystem: same dev and ino, other bytes. The digest and times must refuse it.
    const root = path.join(top, 'pin'); fs.mkdirSync(root);
    put(root, 'a.md', '색은 초록');
    const store = new ActivityMemory(root);
    const pinned = await store.identify('a.md');
    const fd = fs.openSync(path.join(memDir(root), 'a.md'), 'r+'); fs.writeSync(fd, Buffer.from('색은 파랑'), 0, undefined, 0); fs.closeSync(fd);
    const now = fs.lstatSync(path.join(memDir(root), 'a.md'), { bigint: true });
    assert.equal(now.ino, pinned.ino, 'same inode'); assert.equal(now.size, pinned.size, 'same size');
    await assert.rejects(store.remove('a.md', pinned), /changed/);
    assert.equal(fs.readFileSync(path.join(memDir(root), 'a.md'), 'utf8'), '색은 파랑');
    await store.remove('a.md', await store.identify('a.md'));
    assert.equal(fs.existsSync(path.join(memDir(root), 'a.md')), false);
  });

  // The provider and host module, end to end.
  const work = path.join(top, 'activity'); fs.mkdirSync(work);
  const hostVscode = {
    Uri: { file: fsPath => ({ scheme: 'file', fsPath }) },
    commands: { executeCommand: async () => undefined },
    window: { showWarningMessage: async (_text, _options, ...items) => items.find(i => !i.isCloseAffordance) },
  };
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityMemoryHost.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? hostVscode : require(id), console, Buffer, process, TextDecoder });
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  const ADULT = { profile_id: 'synthetic-personal', game: { template_tier: 'website' } };
  h.cachedProfile = ADULT;
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  h.setActivityMemoryPanel(mod.exports.registerActivityMemory({ binding: () => h.activityMemoryBinding, overview: () => h.activityMemoryOverviewTasks }));
  const last = () => f.posts.filter(m => m.type === 'activityMemoryState').at(-1);
  const list = async () => { await f.handle(f.scoped({ type: 'activityMemoryRequest' })); return last().view; };
  let seq = 0;
  const press = async (action, name, text, extra = {}) => {
    const requestId = `o${++seq}`;
    await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope: extra.scope ?? (await list())?.scope ?? 'none', action, name, ...(text === undefined ? {} : { text }) }));
    assert.equal(last().requestId, requestId);
    return last().result;
  };
  const taskId = f.store.getView().activeTaskId;
  const taskTitle = f.store.getView().tasks.find(task => task.id === taskId).title;
  const store = new ActivityMemory(work);
  const kept = await store.append('발표는 금요일이에요.', 1_000, taskId);
  const judged = await store.append('너는 발표를 잘해요.', 2_000, taskId);
  const loose = await store.append('색은 초록', 3_000);

  await t('panel: an adult seat gets the overview grouped by its real task names; the judgment is withheld, not shown', async () => {
    const view = await list();
    assert.deepEqual(view.overview, {
      groups: [
        { task: null, title: NO_TASK_TITLE, items: [{ name: loose, at: view.overview.groups[0].items[0].at, text: '색은 초록' }] },
        { task: taskId, title: taskTitle, items: [{ name: kept, at: view.overview.groups[1].items[0].at, text: '발표는 금요일이에요.' }] },
      ],
      withheld: 1,
    });
    assert.ok(!JSON.stringify(view.overview).includes('잘해요'));
    assert.equal(view.entries.length, 3, 'the file list still shows every file');
  });

  await t('panel: no overview on a minor cohort or an unknown tier; no panel for an instructor', async () => {
    for (const profile of [{ ...ADULT, minor_cohort: true }, { profile_id: 'p', game: { template_tier: 'kids-quest' } }, { profile_id: 'p' }]) {
      h.cachedProfile = profile;
      const view = await list();
      assert.ok(view, 'the memory files stay listed');
      assert.equal(view.overview, null, JSON.stringify(profile));
    }
    h.cachedProfile = ADULT;
    h._instructorMode = { isInstructor: true }; assert.equal(await list(), null); h._instructorMode = { isInstructor: false };
  });

  await t('correct: a minor cohort is refused and nothing changes', async () => {
    h.cachedProfile = { ...ADULT, minor_cohort: true };
    const before = files(work);
    const r = await press('correct', kept, '발표는 목요일이에요.');
    assert.match(r.error, /기억 요약을 쓸 수 없어요/);
    assert.deepEqual(files(work), before);
    h.cachedProfile = ADULT;
  });

  await t('correct: the same words (or only spacing around them) answer "바뀐 기억이 없어요" and change nothing', async () => {
    const before = files(work);
    const bytes = fs.readFileSync(path.join(memDir(work), kept));
    for (const text of ['발표는 금요일이에요.', '  발표는 금요일이에요.\r\n', '발표는 금요일이에요.​']) {
      const r = await press('correct', kept, text);
      assert.deepEqual(r, { action: 'correct', name: kept, unchanged: true }, JSON.stringify(text));
      assert.equal(memoryResultNotice(r), '바뀐 기억이 없어요.');
    }
    assert.deepEqual(files(work), before);
    assert.deepEqual(fs.readFileSync(path.join(memDir(work), kept)), bytes);
  });

  await t('correct: empty words, a judgment, an item the overview withholds, a stale scope or a missing name are refused', async () => {
    const before = files(work);
    assert.match((await press('correct', kept, '   ')).error, /고칠 내용을 적어 주세요/);
    assert.match((await press('correct', kept, '나는 발표를 잘하는 편이에요.')).error, /능력이나 성격을 말하는 문장/);
    assert.match((await press('correct', kept, 'FRAMING 완료')).error, /능력이나 성격을 말하는 문장/);
    assert.ok((await press('correct', judged, '발표는 월요일')).error, 'a withheld item has no correction');
    assert.match((await press('correct', kept, '발표는 목요일', { scope: '["other",null]' })).error, /작업 상태가 바뀌었어요/);
    assert.ok((await press('correct', 'missing.md', '발표는 목요일')).error);
    assert.ok((await press('correct', kept, 'x'.repeat(2_001))).error, 'over the item cap');
    assert.deepEqual(files(work), before);
  });

  await t('correct: new words replace the item in the same task; the old file is gone from the list and from context', async () => {
    const r = await press('correct', kept, '발표는 목요일이에요.');
    assert.deepEqual(r, { action: 'correct', name: kept });
    assert.equal(memoryResultNotice(r), '기억을 고쳤어요.');
    assert.equal(fs.existsSync(path.join(memDir(work), kept)), false);
    const view = last().view;
    const group = view.overview.groups.find(g => g.task === taskId);
    assert.deepEqual(group.items.map(i => i.text), ['발표는 목요일이에요.']);
    assert.equal(group.title, taskTitle);
    const replaced = group.items[0].name;
    assert.equal(fs.readFileSync(path.join(memDir(work), replaced), 'utf8'), `<!-- hypeproof-task: ${taskId} -->\n발표는 목요일이에요.\n`);
    const context = (await store.contextItems()).map(i => i.text.trim());
    assert.ok(context.includes('발표는 목요일이에요.') && !context.includes('발표는 금요일이에요.'));
  });

  await t('correct: a task switch after the item is read and before the new words are written writes nothing', async () => {
    const target = (await list()).overview.groups.find(g => g.task === taskId).items[0].name;
    const before = files(work);
    const scope = (await list()).scope;
    const fsReaddir = fs.promises.readdir;
    let armed = true;
    // The correction lists the store to read the item; the switch lands right after that read, before the append.
    fs.promises.readdir = async (...args) => {
      const out = await fsReaddir.apply(fs.promises, args);
      if (armed && String(args[0]).endsWith(path.join('.hypeproof', 'memory'))) { armed = false; h.taskChanging = true; }
      return out;
    };
    let r;
    try { r = await press('correct', target, '발표는 수요일이에요.', { scope }); }
    finally { fs.promises.readdir = fsReaddir; h.taskChanging = false; }
    assert.equal(armed, false, 'the switch happened inside the press');
    assert.match(r.error, /작업 상태가 바뀌었어요/);
    assert.deepEqual(files(work), before, 'no new file, the old one kept');
  });

  await t('correct: a file replaced during the press is kept and the new copy is dropped', async () => {
    const target = (await list()).overview.groups.find(g => g.task === null).items[0].name;
    // Swap the file right after the host lists it (between the pinned identity and the remove).
    const before = new Set(files(work));
    const fsReaddir = fs.promises.readdir;
    let swapped = false, seqInPress = false;
    fs.promises.readdir = async (...args) => {
      const out = await fsReaddir.apply(fs.promises, args);
      if (!swapped && String(args[0]).endsWith(path.join('.hypeproof', 'memory')) && out.includes(target) && seqInPress) {
        swapped = true;
        fs.rmSync(path.join(memDir(work), target)); put(work, 'swap-holder.md', '자리'); put(work, target, '색은 파랑');
      }
      return out;
    };
    try {
      const scope = (await list()).scope;
      seqInPress = true;
      const r = await press('correct', target, '색은 노랑', { scope });
      seqInPress = false;
      assert.ok(swapped, 'the swap happened inside the press');
      assert.match(r.error, /바뀌었어요/);
    } finally { fs.promises.readdir = fsReaddir; seqInPress = false; }
    assert.equal(fs.readFileSync(path.join(memDir(work), target), 'utf8'), '색은 파랑');
    assert.deepEqual(files(work).filter(name => !before.has(name)), ['swap-holder.md'], 'no leftover copy of the correction');
  });

  console.log(`memory overview: ${passed} checks PASS`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
