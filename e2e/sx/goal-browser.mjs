// AE-01 (#554) — "내 목표" over time, in the BUILT webview in Chromium (CI: the start-page workflow).
//
// Real here: the built webview (webview-ui/dist: App, ChatPanel, region A's MissionHeader and the goal block) in
// Chromium, with React's effects, re-renders and remount keys as they run in the App. Controlled here: the extension
// host. Its messages (config, goalState) are dispatched as the host posts them, and what the screen sends back is read
// from a stand-in acquireVsCodeApi, the boundary start-page/run.mjs and trial-ux/run.mjs use. Saves are answered by the
// host's own rule (`acceptGoalSave`, `goalViewOf`), the way chatPanelProvider.saveGoal answers them. The real host's
// save and config path is checked in extensions/hypeproof-chat/test/student-goal.smoke.mjs, and the App with the real
// host and two real chat views in e2e/sx/goal-app.spec.ts. No Service, model or network.
//
// What a server render cannot show, because it keeps no state between renders and runs no effect:
//   late lesson   a panel that mounted before its lesson arrived draws the goal of the config that brings the lesson,
//                 and its first save starts from that goal's revision. Two ways in, neither of which remounts the panel
//                 (App.tsx keys it by activity id): a first config without a profile (the Service unreachable) under
//                 the same activity, and no config at all before one without an activity.
//   answers       this view's save answer moves the goal forward and says "저장했어요."; another chat view's save moves
//                 it too and says nothing here; a config built before them cannot move it back.
//   typed text    fields the student has not changed follow another chat view's save. Text typed and not saved stays,
//                 the screen says the goal was changed on another screen, and the save made after it starts from the
//                 newer revision. Text typed after pressing save stays when the answer comes. A refused save keeps the
//                 typed text. Another lesson starts the editor over.
// Every verdict also runs once on a planted DOM and must report it (verification.md rule 2).
//
// Run: npm --prefix extensions/hypeproof-chat/webview-ui run build && npm --prefix e2e run test:goal:browser
// HPS_WEBVIEW_DIST=<dir> runs the same checks on another build of the webview (one carrying a planted defect).
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../../extensions/hypeproof-chat/src/studentGoal.ts';
import { chatConfig, resolvedProfile, weekFixture } from '../../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.resolve(process.env.HPS_WEBVIEW_DIST || path.join(repo, 'extensions/hypeproof-chat/webview-ui/dist'));
assert.ok(existsSync(path.join(dist, 'index.html')), `no built webview at ${dist}: npm --prefix extensions/hypeproof-chat/webview-ui run build`);
const out = path.resolve(process.env.HPS_GOAL_BROWSER_OUT || path.join(repo, 'e2e/test-results/goal-browser'));
await fs.mkdir(out, { recursive: true });

// ── Fixtures: the week-3 lesson the smoke and render checks use; goals are stored by the host's own rule ──────────
const ACT = 'a'.repeat(64);
const profileA = resolvedProfile(3);
const LESSON_A = profileA.lesson;
const profileB = resolvedProfile(1, { lesson: { course_id: 'dental-l2', version: 'm2026.09.20-3', sha256: 'd'.repeat(64), content: weekFixture(1) } });
const GOAL = '예약 버튼이 첫 화면에서 바로 보이게 만들기';
const CRITERIA = ['휴대폰 화면에서도 예약 버튼이 보인다', '원래 진료 시간과 같다'];
const GOAL2 = '예약 버튼을 눌렀을 때 예약 화면이 바로 열리게 만들기';
const CRITERIA2 = [CRITERIA[0], '예약 화면에 진료 시간이 그대로 나온다'];
const GOAL_EDIT = '예약 화면에서 날짜를 먼저 고르게 만들기';
const OTHER = '다른 화면에서 고친 목표';
const OTHER2 = '다른 화면에서 한 번 더 고친 목표';
const OTHER2_C = ['다른 화면에서 정한 기준'];
const TYPED = '여기서 적고 있던 목표';
const TYPED_MORE = '여기서 적고 있던 목표, 저장 누른 뒤 더 적음';

/** The host's goal store for one lesson and activity, answering saves the way chatPanelProvider.saveGoal does. */
class GoalHost {
  constructor(lesson, activity) {
    this.lesson = lesson;
    this.activity = activity;
    this.all = {};
  }
  get view() {
    return G.goalViewOf(this.lesson, this.activity, this.all);
  }
  /** One save, judged by the host's rule; the answer as the host posts it (with the activity it posts under). */
  answer(save) {
    const echo = G.goalRequestIdOf(save) ? { requestId: G.goalRequestIdOf(save) } : {};
    const scope = this.activity ? { activityId: this.activity } : {};
    const r = G.acceptGoalSave(this.lesson, this.activity, save, this.all, Date.now());
    if (!r.ok) return { type: 'goalState', ...(r.code === 'stale' ? { view: this.view } : {}), error: G.GOAL_REFUSAL_SENTENCES[r.code], ...echo, ...scope };
    this.all = r.all;
    return { type: 'goalState', view: this.view, saved: true, ...echo, ...scope };
  }
  /** Another chat view saves from the stored revision: the answer every view gets, naming that view's save. */
  otherView(goal, criteria, requestId) {
    const answer = this.answer({ lesson: this.lesson.sha256, goal, criteria, base: this.view.revision, requestId });
    assert.equal(answer.saved, true, `the other view's save was refused: ${JSON.stringify(answer)}`);
    return answer;
  }
}

const activityOf = (on) => (on ? { id: ACT, name: 'GlobalBuddy', kind: 'classroom', workspace: '/w', verified: true } : undefined);
const config = ({ activity, profile, studentGoal }) => ({ ...chatConfig(3), activity: activityOf(activity), profile, studentGoal });

// ── Instruments: one probe of the screen, and pure verdicts over it ─────────────────────────────────────────────
async function probe(p) {
  return p.evaluate(() => {
    const text = (e) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const line = document.querySelector('header.hp-mission .hp-mission-goal');
    const block = document.querySelector('details.hp-goal');
    const save = block?.querySelector('form.hp-goal-form button[type=submit]') ?? null;
    return {
      header: !!document.querySelector('header.hp-mission'),
      headerGoal: line ? text(line) : null,
      block: !!block,
      revision: block?.getAttribute('data-student-goal') ?? null,
      summary: text(block?.querySelector('summary')),
      railGoal: text(block?.querySelector('.hp-goal-current')),
      criteria: Array.from(block?.querySelectorAll('.hp-goal-criteria li') ?? []).map((li) => text(li)),
      fields: Array.from(block?.querySelectorAll('textarea') ?? []).map((t) => t.value),
      saveEnabled: save ? !save.disabled : null,
      notes: Array.from(block?.querySelectorAll('[role=status], [role=alert]') ?? []).map((e) => text(e)),
    };
  });
}
/** The goal drawn everywhere it is drawn: region A's line, the rail's line and criteria, and the block's revision. */
function goalProblem(s, view) {
  const want = {
    headerGoal: view.goal ? `내 목표 · ${view.goal}` : null,
    railGoal: `내 목표 · ${view.goal || '아직 적지 않았어요'}`,
    criteria: view.criteria,
    revision: String(view.revision),
  };
  const got = { headerGoal: s.headerGoal, railGoal: s.railGoal, criteria: s.criteria, revision: s.revision };
  return JSON.stringify(got) === JSON.stringify(want) ? null : `the goal on screen is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
}
const fieldsProblem = (s, goal, criteria) =>
  JSON.stringify(s.fields) === JSON.stringify([goal, criteria]) ? null : `the fields hold ${JSON.stringify(s.fields)}, expected ${JSON.stringify([goal, criteria])}`;
const notesProblem = (s, notes) => (JSON.stringify(s.notes) === JSON.stringify(notes) ? null : `the block says ${JSON.stringify(s.notes)}, expected ${JSON.stringify(notes)}`);
/** The save this view sent: the fields as typed, from the revision `base`, under the activity the screen holds. */
function saveProblem(sent, want) {
  if (!sent) return 'no save was sent';
  const got = { lesson: sent.lesson, goal: sent.goal, criteria: sent.criteria, base: sent.base, activityId: sent.activityId ?? null };
  return JSON.stringify(got) === JSON.stringify(want) ? null : `the save sent ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
}

// Pure controls: each verdict reports a screen or a message that is wrong.
const V0 = { goal: GOAL, criteria: CRITERIA, revision: 2 };
const fine = { headerGoal: `내 목표 · ${GOAL}`, railGoal: `내 목표 · ${GOAL}`, criteria: CRITERIA, revision: '2', fields: [GOAL, CRITERIA.join('\n')], notes: [] };
assert.equal(goalProblem(fine, V0), null);
assert.notEqual(goalProblem({ ...fine, headerGoal: null }, V0), null);
assert.notEqual(goalProblem({ ...fine, revision: '0' }, V0), null);
assert.equal(fieldsProblem(fine, GOAL, CRITERIA.join('\n')), null);
assert.notEqual(fieldsProblem({ ...fine, fields: ['', ''] }, GOAL, CRITERIA.join('\n')), null);
assert.notEqual(notesProblem({ ...fine, notes: ['저장했어요.'] }, []), null);
const wantSave = { lesson: LESSON_A.sha256, goal: GOAL, criteria: CRITERIA, base: 2, activityId: ACT };
assert.equal(saveProblem({ type: 'goalSave', ...wantSave, requestId: 'x' }, wantSave), null);
assert.notEqual(saveProblem({ type: 'goalSave', ...wantSave, base: 0 }, wantSave), null, 'a save from revision 0 must be reported');
assert.notEqual(saveProblem(undefined, wantSave), null);

const server = http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://local').pathname.replace(/^\/$/, '/index.html').slice(1);
    const file = path.resolve(dist, name);
    if (!file.startsWith(dist + path.sep)) throw Error('outside dist');
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const errors = [];
const passed = [];
const controls = [];
const ok = (name) => {
  passed.push(name);
  console.log(`PASS ${name}`);
};

/** A fresh chat view: the built webview with a stand-in host bridge that records what the screen sends. */
async function openView() {
  const p = await browser.newPage({ viewport: { width: 420, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => {
    window.sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => undefined, setState: () => {} });
  });
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  await p.waitForFunction(() => window.sent.some((m) => m.type === 'ready'));
  return p;
}
const post = (p, data) => p.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), data);
const saves = (p) => p.evaluate(() => window.sent.filter((m) => m.type === 'goalSave'));
/** Wait until the verdict over a fresh probe is null; on timeout the last problem is the failure message. */
async function settle(p, verdict, what) {
  await expect.poll(async () => verdict(await probe(p)), { timeout: 5_000, message: what }).toBeNull();
  return probe(p);
}
/** Plant a defect in the page, run the verdict, undo it. The verdict must report the defect. */
async function plantedMust(p, selector, plant, undo, verdict, what) {
  const target = p.locator(selector).first();
  await target.evaluate((el, code) => new Function('el', code)(el), plant);
  try {
    const problem = verdict(await probe(p));
    assert.notEqual(problem, null, `planted ${what} was not reported — the instrument counts nothing`);
    controls.push({ what, reported: problem });
  } finally {
    await target.evaluate((el, code) => new Function('el', code)(el), undo);
  }
}
async function typeInto(p, index, text) {
  await p.locator('details.hp-goal textarea').nth(index).fill(text);
}
async function pressSave(p) {
  const before = (await saves(p)).length;
  await p.locator('details.hp-goal').getByRole('button', { name: '목표 저장' }).click();
  await expect.poll(async () => (await saves(p)).length, { timeout: 5_000, message: 'pressing 목표 저장 sent no save' }).toBe(before + 1);
  return (await saves(p)).at(-1);
}

try {
  // ── 1. One activity: the first config has no profile (the Service unreachable), the next one brings the lesson ──
  const hostA = new GoalHost(LESSON_A, ACT);
  hostA.otherView(GOAL, CRITERIA, 'earlier-1');
  hostA.otherView(GOAL2, CRITERIA2, 'earlier-2');
  const stored = hostA.view;
  assert.equal(stored.revision, 2, 'the goal stored before this view opened');
  const p = await openView();
  await post(p, { type: 'config', config: config({ activity: true, profile: null, studentGoal: null }) });
  let s = await settle(p, (s) => (s.header ? null : 'the chat did not draw region A'), 'no chat screen under the activity');
  assert.deepEqual([s.block, s.headerGoal], [false, null], 'a goal was drawn before the lesson arrived');
  await post(p, { type: 'config', config: config({ activity: true, profile: profileA, studentGoal: stored }) });
  s = await settle(p, (s) => goalProblem(s, stored), 'the goal of the config that brought the lesson is not drawn (the panel did not remount)');
  assert.equal(s.summary, '내 목표와 완료 기준 보기·고치기');
  await plantedMust(p, 'header.hp-mission .hp-mission-goal-text', "el.dataset.sxWas = el.textContent; el.textContent = '다른 목표';", 'el.textContent = el.dataset.sxWas; delete el.dataset.sxWas;', (s) => goalProblem(s, stored), 'region A drawing another goal');
  await plantedMust(p, 'details.hp-goal', "el.setAttribute('data-student-goal', '0');", `el.setAttribute('data-student-goal', '${stored.revision}');`, (s) => goalProblem(s, stored), 'the block at revision 0');
  ok('late lesson under one activity: the goal of the config that brought the lesson is drawn in region A and the rail');

  // The student opens the block: the fields hold that goal, and the first save starts from its revision.
  await p.locator('details.hp-goal > summary').click();
  s = await settle(p, (s) => fieldsProblem(s, GOAL2, CRITERIA2.join('\n')), 'the opened editor does not hold the goal');
  assert.equal(s.saveEnabled, false, 'nothing changed, yet the save button can be pressed');
  await plantedMust(p, 'details.hp-goal textarea', "el.dataset.sxWas = el.value; el.value = '';", 'el.value = el.dataset.sxWas; delete el.dataset.sxWas;', (s) => fieldsProblem(s, GOAL2, CRITERIA2.join('\n')), 'an emptied goal field');
  await typeInto(p, 0, GOAL_EDIT);
  let sent = await pressSave(p);
  assert.equal(saveProblem(sent, { lesson: LESSON_A.sha256, goal: GOAL_EDIT, criteria: CRITERIA2, base: 2, activityId: ACT }), null, saveProblem(sent, { lesson: LESSON_A.sha256, goal: GOAL_EDIT, criteria: CRITERIA2, base: 2, activityId: ACT }));
  let answer = hostA.answer(sent);
  assert.equal(answer.saved, true, `the host refused the first save: ${JSON.stringify(answer)}`);
  await post(p, answer);
  s = await settle(p, (s) => goalProblem(s, hostA.view) ?? notesProblem(s, ['저장했어요.']), "this view's save is not drawn with its note");
  assert.equal(fieldsProblem(s, GOAL_EDIT, CRITERIA2.join('\n')), null, fieldsProblem(s, GOAL_EDIT, CRITERIA2.join('\n')));
  assert.equal(s.saveEnabled, false);
  ok('the first save starts from the revision the config carried (2) and its answer moves the goal to 3 with "저장했어요."');

  // ── 2. Another chat view saves: untouched fields follow, typed text stays with a sentence ──
  await post(p, hostA.otherView(OTHER, [], 'another-view-1'));
  s = await settle(p, (s) => goalProblem(s, hostA.view) ?? fieldsProblem(s, OTHER, '') ?? notesProblem(s, []), "untouched fields did not follow another view's save");
  ok("another view's save: region A, the rail and the untouched fields follow it, and this view says nothing");

  await typeInto(p, 0, TYPED);
  await post(p, hostA.otherView(OTHER2, OTHER2_C, 'another-view-2'));
  const elsewhere = hostA.view;
  s = await settle(p, (s) => goalProblem(s, elsewhere) ?? fieldsProblem(s, TYPED, OTHER2_C.join('\n')) ?? notesProblem(s, [G.GOAL_CHANGED_ELSEWHERE]), "text typed here was not kept with the sentence when another view saved");
  assert.equal(s.saveEnabled, true);
  await plantedMust(p, 'details.hp-goal .hp-goal-elsewhere', "el.dataset.sxWas = el.getAttribute('role'); el.removeAttribute('role');", "el.setAttribute('role', el.dataset.sxWas); delete el.dataset.sxWas;", (s) => notesProblem(s, [G.GOAL_CHANGED_ELSEWHERE]), 'the sentence gone');
  await p.screenshot({ path: path.join(out, 'goal-typed-kept.png'), fullPage: true });
  // The save made after that starts from the newer revision; text typed while it is on its way stays when it is answered.
  sent = await pressSave(p);
  assert.equal(saveProblem(sent, { lesson: LESSON_A.sha256, goal: TYPED, criteria: OTHER2_C, base: elsewhere.revision, activityId: ACT }), null, JSON.stringify(sent));
  await typeInto(p, 0, TYPED_MORE);
  answer = hostA.answer(sent);
  assert.equal(answer.saved, true, `the host refused the save made after the sentence: ${JSON.stringify(answer)}`);
  await post(p, answer);
  s = await settle(p, (s) => goalProblem(s, hostA.view) ?? fieldsProblem(s, TYPED_MORE, OTHER2_C.join('\n')) ?? notesProblem(s, []), 'the own answer dropped the text typed after pressing save, or said another screen changed it');
  assert.equal(s.saveEnabled, true, 'the text typed after pressing save cannot be saved');
  ok('typed text: kept with the sentence when another view saved, saved from the newer revision, and text typed after pressing save stays');

  // ── 3. A config built before these saves cannot move the goal back ──
  await post(p, { type: 'config', config: config({ activity: true, profile: profileA, studentGoal: stored }) });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  s = await settle(p, (s) => goalProblem(s, hostA.view) ?? fieldsProblem(s, TYPED_MORE, OTHER2_C.join('\n')), 'an older config moved the goal back');
  ok('a config built before the saves (revision 2) leaves the goal at the newest revision and the typed text as it is');

  // ── 4. A refused save keeps the typed text; another lesson starts the editor over ──
  sent = await pressSave(p);
  await post(p, { type: 'goalState', error: G.GOAL_REFUSAL_SENTENCES.no_lesson, requestId: sent.requestId, activityId: ACT });
  s = await settle(p, (s) => goalProblem(s, hostA.view) ?? fieldsProblem(s, TYPED_MORE, OTHER2_C.join('\n')) ?? notesProblem(s, [G.GOAL_REFUSAL_SENTENCES.no_lesson]), 'a refusal changed the goal or the typed text');
  const hostB = new GoalHost(profileB.lesson, ACT);
  await post(p, { type: 'config', config: config({ activity: true, profile: profileB, studentGoal: hostB.view }) });
  s = await settle(p, (s) => goalProblem(s, hostB.view) ?? fieldsProblem(s, '', '') ?? notesProblem(s, []), "another lesson kept lesson A's goal, typed text or note");
  assert.equal(s.summary, '내 목표와 완료 기준 적기');
  ok('a refusal keeps the goal and the typed text; another lesson under the same activity starts the editor over');
  await p.close();

  // ── 5. No config yet, then a config without an activity: the panel keyed "disconnected" is not remounted ──
  const hostN = new GoalHost(LESSON_A, null);
  hostN.otherView(GOAL, CRITERIA, 'earlier-1');
  hostN.otherView(GOAL2, CRITERIA2, 'earlier-2');
  const q = await openView();
  await q.getByRole('heading', { name: '시작할 준비가 됐나요?' }).waitFor();
  await post(q, { type: 'config', config: config({ activity: false, profile: profileA, studentGoal: hostN.view }) });
  s = await settle(q, (s) => goalProblem(s, hostN.view), 'the goal of the first config is not drawn on the panel that mounted without one');
  await q.locator('details.hp-goal > summary').click();
  await settle(q, (s) => fieldsProblem(s, GOAL2, CRITERIA2.join('\n')), 'the opened editor does not hold the goal');
  await typeInto(q, 0, GOAL_EDIT);
  sent = await pressSave(q);
  assert.equal(saveProblem(sent, { lesson: LESSON_A.sha256, goal: GOAL_EDIT, criteria: CRITERIA2, base: 2, activityId: null }), null, JSON.stringify(sent));
  answer = hostN.answer(sent);
  assert.equal(answer.saved, true, `the host refused the first save: ${JSON.stringify(answer)}`);
  await post(q, answer);
  await settle(q, (s) => goalProblem(s, hostN.view) ?? notesProblem(s, ['저장했어요.']), "this view's save is not drawn with its note");
  ok('no config, then one without an activity: its goal is drawn and the first save starts from its revision');
  await q.close();

  assert.deepEqual(errors, [], 'the page threw');
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ scope: 'built webview in Chromium, controlled host messages answered by the host rule', dist: path.relative(repo, dist) || dist, passed, controls, errors }, null, 2));
  console.log(`PASS goal-browser: ${passed.length} checks, ${controls.length} planted-DOM controls reported`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
