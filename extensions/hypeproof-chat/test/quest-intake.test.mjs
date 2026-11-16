// REQ-QUEST-* (#4283) — a stated work intent gets at most N key questions, then a "퀘스트 생성하기" offer; the
// click's one structured answer becomes an ordered quest whose steps only the learner completes.
//   node --experimental-strip-types --test test/quest-intake.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { QuestIntakeSession, questIntakePolicy, parseGoalSummary, questFromModel, questGenerationPrompt, questChoicesAllowed } from '../src/questIntake.ts';
import { renderQuestHtml, LEARNER_QUEST_COPY } from '../src/automationQuest.ts';

let ids = 0;
const session = () => new QuestIntakeSession({ newId: () => `offer-${++ids}` });
const seat = (over = {}) => ({ eligible: true, firstTurn: false, fresh: true, maxQuestions: 2, ...over });
const QUESTION = '어떤 메일을 주로 보내시나요?\n아래에서 골라 주세요.\n1. 서류 제출 요청\n2. 일정 안내\n3. 미응답자 재안내';
const SUMMARY = '좋아요. 정리해 볼게요.\n\n**목표 정리:** 명단의 사람마다 서류 제출 요청 메일을 정중하게 보내기';
const STEPS = JSON.stringify({ title: '서류 요청 메일 자동화', steps: [
  { title: '업무 정리', description: '보낼 메일의 목적과 받는 사람을 정해요.' },
  { title: 'Google 연결', description: '내 계정으로 메일을 보낼 준비를 해요.' },
  { title: '명단 연결', description: '시트의 이름과 마감일을 불러와요.' },
  { title: '미리보기·수정', description: '세 명에게 갈 메일을 보고 고쳐요.' },
  { title: '저장·완료', description: '다음에도 쓰도록 저장해요.' },
] });

test('policy: absent means two questions; explicit false turns it off; the cap is clamped', () => {
  assert.deepEqual(questIntakePolicy(null), { enabled: true, maxQuestions: 2 });
  assert.deepEqual(questIntakePolicy({ ux: {} }), { enabled: true, maxQuestions: 2 });
  assert.deepEqual(questIntakePolicy({ ux: { quest_intake: { enabled: false } } }), { enabled: false, maxQuestions: 2 });
  assert.equal(questIntakePolicy({ ux: { quest_intake: { max_questions: 1 } } }).maxQuestions, 1);
  assert.equal(questIntakePolicy({ ux: { quest_intake: { max_questions: 9 } } }).maxQuestions, 3);
  assert.equal(questIntakePolicy({ ux: { quest_intake: { max_questions: -1 } } }).maxQuestions, 0);
});

test('two questions, then the host forces the offer even when the coach keeps asking', () => {
  const s = session();
  const first = s.beginTurn('t', '매번 비슷한 메일을 보내는데, 좀 편하게 할 수 있을까?', seat({ firstTurn: true }));
  assert.match(first, /2개까지, 지금 2개 남음/);
  assert.equal(s.afterReply('t', QUESTION), false);
  assert.match(s.beginTurn('t', '서류 제출 요청', seat()), /지금 1개 남음/);
  assert.equal(s.afterReply('t', QUESTION), false);
  assert.equal(s.viewFor('t').phase, 'clarifying');
  // The third coach turn is told to stop asking; if it asks anyway, the offer still appears.
  assert.match(s.beginTurn('t', '정중하고 짧게', seat()), /질문은 여기까지/);
  assert.equal(s.afterReply('t', QUESTION), true);
  const view = s.viewFor('t');
  assert.equal(view.phase, 'offered');
  assert.match(view.summary, /메일을 보내는데.*서류 제출 요청.*정중하고 짧게/);
});

test('a clear intent may get fewer questions: a summary line offers at once', () => {
  const s = session();
  s.beginTurn('t', '명단 사람들에게 서류 제출 요청 메일을 정중하게 보내고 싶어', seat({ firstTurn: true }));
  assert.equal(s.afterReply('t', SUMMARY), true);
  assert.deepEqual({ phase: s.viewFor('t').phase, summary: s.viewFor('t').summary }, { phase: 'offered', summary: '명단의 사람마다 서류 제출 요청 메일을 정중하게 보내기' });
});

test('a one-off request that is answered directly leaves the task alone', () => {
  const s = session();
  s.beginTurn('t', '오늘 날짜 알려 줘', seat({ firstTurn: true }));
  assert.equal(s.afterReply('t', '오늘은 2026년 11월 16일이에요.'), false);
  assert.equal(s.viewFor('t').phase, null);
  assert.equal(s.beginTurn('t', '고마워', seat()), null);
});

test('a coach that stops asking and simply answers ends the flow without an offer', () => {
  const s = session();
  s.beginTurn('t', '이 파일 요약해 줘', seat({ firstTurn: true }));
  s.afterReply('t', '어떤 파일인가요?');
  s.beginTurn('t', 'report.pdf', seat());
  assert.equal(s.afterReply('t', '요약했어요. 핵심은 세 가지예요.'), false);
  assert.equal(s.viewFor('t').phase, null);
});

test('only a fresh first turn on an eligible seat starts; retries record no answer', () => {
  const s = session();
  assert.equal(s.beginTurn('t', '메일 자동화', seat({ eligible: false, firstTurn: true })), null);
  assert.equal(s.beginTurn('t', '메일 자동화', seat({ firstTurn: false })), null);
  assert.equal(s.beginTurn(null, '메일 자동화', seat({ firstTurn: true })), null);
  s.beginTurn('t', '메일 자동화', seat({ firstTurn: true }));
  s.afterReply('t', QUESTION);
  s.beginTurn('t', '서류 제출 요청', seat({ fresh: false }));
  s.afterReply('t', SUMMARY);
  assert.match(s.startGeneration('t', s.viewFor('t').offerId), /처음 요청: 메일 자동화$/);
});

test('max_questions 0 offers on the first reply, even when the coach asks', () => {
  const s = session();
  assert.match(s.beginTurn('t', '보고서 정리 자동화', seat({ firstTurn: true, maxQuestions: 0 })), /질문은 여기까지/);
  assert.equal(s.afterReply('t', QUESTION), true, 'a question beyond the cap still ends in the offer');
  assert.equal(s.viewFor('t').phase, 'offered');
});

test('max_questions 0 still leaves an ordinary first request alone', () => {
  const s = session();
  s.beginTurn('t', '오늘 날짜 알려 줘', seat({ firstTurn: true, maxQuestions: 0 }));
  assert.equal(s.afterReply('t', '오늘은 2026년 11월 16일이에요.'), false);
  assert.equal(s.viewFor('t').phase, null);
});

test('the click makes one prompt, a stale or repeated click makes none, and the quest starts on step 1', () => {
  const s = session();
  s.beginTurn('t', '메일 자동화', seat({ firstTurn: true }));
  s.afterReply('t', SUMMARY);
  const { offerId } = s.viewFor('t');
  assert.equal(s.startGeneration('t', 'stale'), null);
  const prompt = s.startGeneration('t', offerId);
  assert.match(prompt, /JSON 객체 하나만/);
  assert.match(prompt, /목표: 명단의 사람마다/);
  assert.equal(s.startGeneration('t', offerId), null, 'a second click while generating sends nothing');
  const made = s.finishGeneration('t', offerId, STEPS);
  assert.equal(made.first, '업무 정리');
  const view = s.viewFor('t');
  assert.equal(view.phase, 'quest');
  assert.deepEqual(view.quest.steps.map(step => [step.id, step.status]), [['step-1', 'current'], ['step-2', 'pending'], ['step-3', 'pending'], ['step-4', 'pending'], ['step-5', 'pending']]);
  assert.match(s.beginTurn('t', '시작할게요', seat()), /0\/5 완료 · 지금 단계 1\. 업무 정리/);
});

test('an unusable answer brings the offer back with a retry line', () => {
  const s = session();
  s.beginTurn('t', '메일 자동화', seat({ firstTurn: true }));
  s.afterReply('t', SUMMARY);
  const { offerId } = s.viewFor('t');
  s.startGeneration('t', offerId);
  assert.equal(s.finishGeneration('t', offerId, '죄송해요, 만들 수 없어요.'), null);
  assert.deepEqual([s.viewFor('t').phase, s.viewFor('t').error], ['offered', '퀘스트를 만들지 못했어요. 다시 눌러 주세요.']);
  assert.ok(s.startGeneration('t', offerId), 'the same offer can be clicked again');
});

test('only the learner check completes a step, in order; ids stay stable', () => {
  const s = session();
  s.beginTurn('t', '메일 자동화', seat({ firstTurn: true }));
  s.afterReply('t', SUMMARY);
  const { offerId } = s.viewFor('t');
  s.startGeneration('t', offerId);
  s.finishGeneration('t', offerId, STEPS);
  assert.equal(s.completeStep('t', 'step-2'), null, 'a pending step cannot be checked');
  const quest = s.completeStep('t', 'step-1');
  assert.deepEqual(quest.nodes.slice(0, 2).map(node => node.status), ['succeeded', 'current']);
  assert.equal(s.completeStep('t', 'step-1'), null, 'a completed step stays completed');
  assert.deepEqual(s.viewFor('t').quest.steps.map(step => step.id), ['step-1', 'step-2', 'step-3', 'step-4', 'step-5']);
  // The coach is told the learner completes steps; the reply never changes them.
  s.beginTurn('t', '다 했어요', seat());
  assert.equal(s.afterReply('t', '좋아요! 2단계도 완료로 표시할게요.'), false);
  assert.equal(s.viewFor('t').quest.steps[1].status, 'current');
});

test('dismiss ends the flow; the state survives a reload except an in-flight click', () => {
  let saved;
  const s = new QuestIntakeSession({ newId: () => 'o1', onChange: snapshot => { saved = JSON.parse(JSON.stringify(snapshot)); } });
  s.beginTurn('t', '메일 자동화', seat({ firstTurn: true }));
  s.afterReply('t', SUMMARY);
  s.startGeneration('t', 'o1');
  const reloaded = new QuestIntakeSession({ newId: () => 'o2', restore: saved });
  assert.equal(reloaded.viewFor('t').phase, 'offered');
  assert.equal(reloaded.dismiss('t', 'o1'), true);
  assert.equal(reloaded.viewFor('t').phase, null);
});

test('model text is cleaned instead of failing; nothing usable means no quest', () => {
  const quest = questFromModel('```json\n{"title":"보고서 <정리>","steps":[{"title":"자료 모으기 https://x.example","description":"me@example.com 에게 물어요"},{"title":"","description":"빈 제목"},{"title":"초안 쓰기"}]}\n```', '대체 제목');
  assert.deepEqual(quest.nodes.map(node => [node.id, node.label, node.dependsOn]), [['step-1', '자료 모으기', []], ['step-2', '초안 쓰기', ['step-1']]]);
  assert.equal(quest.title, '보고서 정리');
  assert.equal(questFromModel('{"steps":[]}', 'x'), null);
  assert.equal(questFromModel('not json', 'x'), null);
  assert.equal(questFromModel(JSON.stringify({ steps: Array.from({ length: 20 }, (_, i) => ({ title: `단계 ${i + 1}` })) }), 'x').nodes.length, 12);
});

test('goal summary line: bold or plain, the last one wins', () => {
  assert.equal(parseGoalSummary('목표 정리: 주간 보고서 초안을 자동으로 만들기'), '주간 보고서 초안을 자동으로 만들기');
  assert.equal(parseGoalSummary('**목표 정리**: A\n\n**목표 정리:** B'), 'B');
  assert.equal(parseGoalSummary('목표를 정리하면 좋겠어요.'), null);
  assert.ok(questGenerationPrompt({ summary: 's', intent: 'i', answers: [] }).length < 700, 'the structured call stays small');
});

test('the quest canvas uses quest copy, not the automation wording', () => {
  const s = session();
  s.beginTurn('t', '메일 자동화', seat({ firstTurn: true }));
  s.afterReply('t', SUMMARY);
  const { offerId } = s.viewFor('t');
  s.startGeneration('t', offerId);
  const { quest } = s.finishGeneration('t', offerId, STEPS);
  const html = renderQuestHtml(quest, LEARNER_QUEST_COPY);
  assert.match(html, /<div class="eyebrow">QUEST<\/div>/);
  assert.match(html, /data-node-id="step-1"[^>]*aria-current="step"/);
  assert.doesNotMatch(html, /AUTOMATION WORKFLOW/);
  assert.match(renderQuestHtml(quest), /AUTOMATION WORKFLOW/, 'existing callers keep their copy');
});

test('a retry gives back the question its reply counted; an edit replaces the latest answer', () => {
  const s = session();
  s.beginTurn('t', '메일 자동화', seat({ firstTurn: true }));
  s.afterReply('t', QUESTION);
  // "다시 받기" of question 1: still two questions in total.
  assert.match(s.beginTurn('t', '메일 자동화', seat({ fresh: false })), /지금 2개 남음/);
  s.afterReply('t', QUESTION);
  assert.match(s.beginTurn('t', '일정 안내', seat()), /지금 1개 남음/);
  s.afterReply('t', QUESTION);
  // The learner edits that answer: the question is given back and the edited words replace the old ones.
  assert.match(s.beginTurn('t', '서류 제출 요청', seat({ fresh: false, edited: true })), /지금 1개 남음/);
  s.afterReply('t', SUMMARY);
  const prompt = s.startGeneration('t', s.viewFor('t').offerId);
  assert.match(prompt, /- 서류 제출 요청/);
  assert.doesNotMatch(prompt, /일정 안내/);
});

test('the numbered-answer UI is not drawn while the offer waits or the quest is being made', () => {
  assert.equal(questChoicesAllowed({ phase: 'offered' }), false);
  assert.equal(questChoicesAllowed({ phase: 'generating' }), false);
  assert.equal(questChoicesAllowed({ phase: 'clarifying' }), true);
  assert.equal(questChoicesAllowed({ phase: 'quest' }), true);
  assert.equal(questChoicesAllowed({ phase: null }), true);
});

test('a bare scheme without slashes is cleaned instead of failing the quest', () => {
  const quest = questFromModel(JSON.stringify({ steps: [{ title: '자료 모으기 https:example', description: 'mailto:x 참고' }, { title: '초안' }] }), 'x');
  assert.deepEqual(quest.nodes.map(node => node.label), ['자료 모으기', '초안']);
});

test('a retry of a stopped answer turn gives back nothing: the cap holds', () => {
  const s = session();
  s.beginTurn('t', '메일 자동화', seat({ firstTurn: true }));
  s.afterReply('t', QUESTION); // question 1 counted
  s.beginTurn('t', '서류 제출 요청', seat()); // its answer; the reply is stopped, so afterReply never runs
  assert.match(s.beginTurn('t', '서류 제출 요청', seat({ fresh: false })), /지금 1개 남음/);
  s.afterReply('t', QUESTION); // question 2
  assert.match(s.beginTurn('t', '정중하게', seat()), /질문은 여기까지/);
  assert.equal(s.afterReply('t', QUESTION), true, 'a third question still ends in the offer');
});
