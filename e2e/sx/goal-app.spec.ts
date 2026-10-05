// AE-01 (#554) — "내 목표" in the Studio APP (Playwright e2e layer): the goal half of AE-T01.
//
// Evidence class: live-host for the App (a prepared copy of the shipped shell with this branch's extension and
// webview injected), synthetic for the Service (sx-service.mjs: the real router over SQLite, a lesson-pinned seat on
// the one `/2` profile, a model that answers one fixed line). No model call, no production state.
//
// One student on the week-3 design:
//   first session   The goal block starts empty and closed beside region A's lesson criteria; closed, it adds no field
//                   to the screen, so the composer and the lesson card stay where other scripts find them. The student
//                   opens it, writes a goal and two criteria and saves, then changes the goal and one criterion and
//                   saves again with a double press (one save). After each save the fields hold exactly what was stored
//                   (they follow the host's revision: spaces and blank lines dropped). Region A reads the same lesson
//                   criteria throughout, nothing is checked off, the task record does not move and the completion
//                   button stays closed (AE-01: viewing or writing a goal completes nothing).
//   short window    At 1280×450 the header packs: the goal comes after the lesson's completion conditions, which stay
//                   wholly on screen, and sits inside the header's own scroll (it can be brought on screen there).
//   result screen   index.html opens and the preview opens beside the chat; the student looks at the preview and brings
//                   the chat back to the front while the result stays open beside it: the same NEW goal and the same
//                   lesson criteria, region A's goal line wholly on screen, also with the conversation scrolled to its
//                   end (AE-01: "대화와 결과를 오가도 유지"; the AE design keeps the goal summary fixed with the task).
//   reopened        A new App process on the same device storage: the same new goal and lesson criteria, also in the
//                   editor's fields; the short window again, now with the result beside the chat.
//   two chat views  The sidebar chat opens next to the editor chat. Clearing the goal in the editor chat clears it in
//                   both: region A's line goes, the sidebar's open fields follow, and only the editor chat says
//                   "저장했어요." (a view shows the note of its own save only). Then the student types in the sidebar
//                   without saving while the editor chat saves a new goal: the sidebar keeps the typed text and says
//                   the goal was changed on another screen, and its own save then replaces that goal in both views.
// Every probe also runs once on a planted DOM (a lesson criterion's words changed, a condition checked off, the goal
// text changed, the goal line moved) and must report it (verification.md rule 2).
//
// Not covered here: another lesson revision. A lesson-pinned seat's activity id includes the lesson (Service
// `activityIdentity`), so serving another revision means a new code, a new activity and, through the start page's
// "이 활동 시작하기", possibly another folder: such a run could pass for that reason alone. The revision and activity
// boundary is checked where it can be isolated, against the real host and config path in
// extensions/hypeproof-chat/test/student-goal.smoke.mjs. Also not covered: a refused save on screen (a stale save cannot
// be made from one screen, and the others need a host without its lesson: the smoke's host and render checks, and the
// built webview in Chromium, e2e/sx/goal-browser.mjs), a panel that mounted before its lesson arrived (the Service
// unreachable at first: e2e/sx/goal-browser.mjs), AE-T01's other half (material selection and the request payload,
// AE-02: the `context` item #555), Windows, a real student.
// Needs an unlocked screen: when it is locked the run is skipped as NOT RUN.
import { test, expect, type ElectronApplication, type FrameLocator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type AppContext, chatFrame, closeApp, launchApp, runCommand } from "../fixtures/app";
import { previewUrl, screenLocked } from "../curriculum-runtime/app-helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const PORT = Number(process.env.HPS_SX_APP_PORT || 18951);
const MISSION = "AI가 만든 걸 내가 확인했나?";
const PREVIEW = "HypeProof: HTML 미리보기 (옆 패널)";
const FIXTURE = path.join(repo, "e2e/curriculum-runtime/fixtures/kiosk-practice");
/** The fixture page's own <title>, which labels the preview's tab. */
const PREVIEW_TITLE = "키오스크 연습";
const WIDE = { width: 1280, height: 800 };
/** A short window, as e2e/sx/home-app.spec.ts measures it (about 387 px of webview): the header packs. */
const SHORT = { width: 1280, height: 450 };
/** The lesson the Service serves keeps all three week-3 completion conditions, as the design is written. */
const COMPLETION = "c1,c2,c3";
const GOAL = "예약 버튼이 첫 화면에서 바로 보이게 만들기";
const CRITERIA = ["휴대폰 화면에서도 예약 버튼이 보인다", "원래 진료 시간과 같다"];
/** The change: a new goal, the first criterion kept, the second one replaced. */
const GOAL2 = "예약 버튼을 눌렀을 때 예약 화면이 바로 열리게 만들기";
const CRITERIA2 = [CRITERIA[0], "예약 화면에 진료 시간이 그대로 나온다"];
/** Two views at once: the goal the editor chat saves, and the text typed meanwhile in the sidebar. */
const GOAL3 = "예약 화면에서 날짜를 먼저 고르게 만들기";
const TYPED = "예약을 마치면 확인 문장이 보이게 만들기";
/** The sidebar's sentence (studentGoal.ts `GOAL_CHANGED_ELSEWHERE`; this e2e package cannot import the extension's CommonJS source). */
const CHANGED_ELSEWHERE = /^다른 화면에서 목표가 바뀌었어요\. 적던 내용은 그대로 있으니, 저장하면 이 내용으로 바뀌어요\.$/;
const WEEK3 = JSON.parse(fs.readFileSync(path.join(repo, "worker/test/fixtures/session-design/week-3.json"), "utf8")) as {
  learning: { completion: Array<{ id: string; text: string }> };
};

class GoalService {
  private proc?: ChildProcess;
  async start(completion: string): Promise<void> {
    fs.mkdirSync(path.dirname(process.env.HPS_E2E_TOKEN_FILE!), { recursive: true });
    this.proc = spawn(
      process.execPath,
      ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", path.join(here, "sx-service.mjs"), String(PORT), process.env.HPS_E2E_TOKEN_FILE!, completion],
      { cwd: repo, stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("sx service did not start")), 30_000);
      this.proc!.stdout!.on("data", (d) => {
        if (/READY/.test(String(d))) {
          clearTimeout(t);
          resolve();
        }
      });
      this.proc!.on("exit", (c) => reject(new Error(`sx service exited ${c}`)));
    });
  }
  /** The lesson revision this Service serves (`/__sx/state`). */
  async lesson(): Promise<{ course_id: string; version: string; sha256: string }> {
    return ((await (await fetch(`http://127.0.0.1:${PORT}/__sx/state`)).json()) as { lesson: { course_id: string; version: string; sha256: string } }).lesson;
  }
  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc || proc.exitCode !== null) return;
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    proc.kill();
    await exited;
  }
}

// ── Instruments: one probe of the chat frame, and pure verdicts over what it read ─────────────

type GoalProbe = {
  /** Region A's goal line ("내 목표 · …", fixed with the header), or null when none is drawn. */
  headerGoal: string | null;
  /** Is that line wholly on screen: inside the header's visible box and the frame, its centre not covered. */
  headerGoalOnScreen: boolean;
  /** The rail block: its summary, the goal it shows and the personal criteria inside it. */
  summary: string;
  railGoal: string;
  criteria: string[];
  /** Region A's lesson criteria: the week's completion conditions and the current step's acceptance sentence. */
  lesson: string[];
  acceptance: string;
  /** Region A's conditions checked off, and whether the completion button can be pressed (null: not drawn). */
  met: number;
  completeEnabled: boolean | null;
  /**
   * What scripts that drive the chat by its first field or first rail card meet: the fields inside the goal block, whether
   * the chat's first text field is the goal editor's, and the summary of the first `.hp-rail-lesson`.
   */
  goalFields: number;
  firstFieldIsGoal: boolean;
  firstRailCard: string;
};
async function probeGoal(chat: FrameLocator): Promise<GoalProbe> {
  return chat.locator("body").evaluate(() => {
    const text = (e: Element | null | undefined) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
    const header = document.querySelector("header.hp-mission");
    const line = header?.querySelector(".hp-mission-goal") ?? null;
    const onScreen = (part: Element | null) => {
      if (!part || !header) return false;
      const box = header.getBoundingClientRect();
      const r = part.getBoundingClientRect();
      const vh = document.documentElement.clientHeight;
      const vw = document.documentElement.clientWidth;
      if (r.width === 0 || r.height === 0) return false;
      if (r.top < Math.max(box.top, 0) - 0.5 || r.bottom > Math.min(box.bottom, vh) + 0.5 || r.left < -0.5 || r.right > vw + 0.5) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (part === hit || part.contains(hit));
    };
    const goal = document.querySelector("details.hp-goal");
    const complete = document.querySelector(".hp-complete button") as HTMLButtonElement | null;
    const firstField = document.querySelector("textarea, input, select");
    const firstRail = document.querySelector(".hp-rail-lesson");
    return {
      headerGoal: line ? text(line) : null,
      headerGoalOnScreen: onScreen(line),
      summary: text(goal?.querySelector("summary")),
      railGoal: text(goal?.querySelector(".hp-goal-current")),
      criteria: Array.from(goal?.querySelectorAll(".hp-goal-criteria li") ?? []).map((li) => text(li)),
      lesson: Array.from(document.querySelectorAll("header.hp-mission .hp-mission-completion-text")).map((e) => text(e)),
      acceptance: text(document.querySelector("header.hp-mission .hp-mission-acceptance")),
      met: document.querySelectorAll("header.hp-mission .hp-mission-completion li[data-met='yes']").length,
      completeEnabled: complete ? !complete.disabled : null,
      goalFields: goal?.querySelectorAll("textarea, input, select").length ?? 0,
      firstFieldIsGoal: !!goal && !!firstField && goal.contains(firstField),
      firstRailCard: text(firstRail?.querySelector(":scope > summary")),
    };
  });
}
/** The saved goal everywhere it is drawn: region A's line, the rail's line and the rail's criteria. */
const goalProblem = (p: GoalProbe, goal: string, criteria: string[]): string | null =>
  p.headerGoal === `내 목표 · ${goal}` && p.railGoal === `내 목표 · ${goal}` && JSON.stringify(p.criteria) === JSON.stringify(criteria)
    ? null
    : `goal reads "${p.headerGoal}" in region A and "${p.railGoal}" with ${JSON.stringify(p.criteria)} in the rail, expected "${goal}" with ${JSON.stringify(criteria)}`;
/** With a result open beside the chat, or the conversation scrolled: region A's goal line is still on screen. */
const goalOffScreen = (p: GoalProbe): string | null => (p.headerGoalOnScreen ? null : `region A's goal line is not on screen (${JSON.stringify(p.headerGoal)})`);
const lessonProblem = (p: GoalProbe, lesson: { lesson: string[]; acceptance: string }): string | null =>
  JSON.stringify(p.lesson) === JSON.stringify(lesson.lesson) && p.acceptance === lesson.acceptance
    ? null
    : `region A's lesson criteria changed: ${JSON.stringify({ lesson: p.lesson, acceptance: p.acceptance })} vs ${JSON.stringify(lesson)}`;
const completionProblem = (p: GoalProbe): string | null =>
  p.met === 0 && p.completeEnabled !== true ? null : `something completed: ${p.met} condition(s) checked off, completion button enabled=${p.completeEnabled}`;
/** The closed block adds no field, and the first rail card is the lesson's (e2e/classroom/ops-lesson-settings.mjs, e2e/lesson-studio/mac.mjs). */
const layoutProblem = (p: GoalProbe): string | null =>
  p.goalFields === 0 && !p.firstFieldIsGoal && p.firstRailCard.startsWith("이번 단계 안내")
    ? null
    : `the closed goal block holds ${p.goalFields} field(s), first field is the goal editor's=${p.firstFieldIsGoal}, first .hp-rail-lesson reads "${p.firstRailCard}"`;

type ShortProbe = {
  viewport: { width: number; height: number };
  /** Region A's parts that must stay wholly on screen on a short window (home-app's SX-T10), with the goal saved. */
  parts: Record<string, boolean>;
  goalInHeader: boolean;
  /** The goal line's top is at or below the last completion condition's bottom. */
  goalAfterConditions: boolean;
  goalOnScreenNow: boolean;
  /** After scrolling the header's own scroll to it (then back): wholly on screen. */
  goalReachable: boolean;
};
async function probeShort(chat: FrameLocator): Promise<ShortProbe> {
  return chat.locator("header.hp-mission").evaluate((el) => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const whole = (part: Element | null) => {
      if (!part) return false;
      const box = el.getBoundingClientRect();
      const r = part.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.top < Math.max(box.top, 0) - 0.5 || r.bottom > Math.min(box.bottom, vh) + 0.5 || r.left < -0.5 || r.right > vw + 0.5) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (part === hit || part.contains(hit));
    };
    const conditions = Array.from(el.querySelectorAll(".hp-mission-completion li:not(.hp-mission-completion-note)"));
    const line = el.querySelector(".hp-mission-goal");
    const parts = {
      week: whole(el.querySelector(".hp-mission-week")),
      mission: whole(el.querySelector(".hp-mission-sentence")),
      completion: conditions.length > 0 && conditions.every(whole),
      remaining: whole(el.querySelector(".hp-mission-remaining")),
      primary: whole(el.querySelector(".hp-cta-primary")),
    };
    const lastCondition = Math.max(...conditions.map((c) => c.getBoundingClientRect().bottom));
    const goalOnScreenNow = whole(line);
    let goalReachable = false;
    if (line) {
      const before = el.scrollTop;
      const box = el.getBoundingClientRect();
      const r = line.getBoundingClientRect();
      if (r.bottom > box.bottom) el.scrollTop += r.bottom - box.bottom + 1;
      if (r.top < box.top) el.scrollTop -= box.top - r.top + 1;
      goalReachable = whole(line);
      el.scrollTop = before;
    }
    return {
      viewport: { width: vw, height: vh },
      parts,
      goalInHeader: !!line,
      goalAfterConditions: !!line && conditions.length > 0 && line.getBoundingClientRect().top >= lastCondition - 0.5,
      goalOnScreenNow,
      goalReachable,
    };
  });
}
/** The short window's verdict: region A's parts whole, the goal after the conditions and reachable in the header's scroll. */
const shortGoalProblem = (p: ShortProbe): string | null => {
  const problems = Object.entries(p.parts).filter(([, ok]) => !ok).map(([k]) => `${k} not on screen`);
  if (!p.goalInHeader) problems.push("no goal line in the header");
  if (!p.goalAfterConditions) problems.push("the goal line is not after the completion conditions");
  if (!p.goalReachable) problems.push("the goal line cannot be brought on screen inside the header");
  return problems.length ? problems.join("; ") : null;
};

/** Plant a defect in the frame, run the measure, undo it. The measure must report the defect. */
async function plantedMust(chat: FrameLocator, selector: string, plant: string, undo: string, measure: () => Promise<string | null>, what: string): Promise<string> {
  const target = chat.locator(selector).first();
  await target.evaluate((el, code) => new Function("el", code)(el), plant);
  try {
    const problem = await measure();
    expect(problem, `planted ${what} was not reported — the instrument counts nothing`).not.toBeNull();
    return problem!;
  } finally {
    await target.evaluate((el, code) => new Function("el", code)(el), undo);
  }
}

type TaskRecord = { id: string; curriculum?: { phase: string; current_step: string } };
/** The Task records the extension wrote to its local measurement-core record (one JSON file per key). */
function taskPhase(userDataDir: string): string | null {
  const root = path.join(userDataDir, "User", "globalStorage", "hypeproof.hypeproof-chat", "local-review-v1");
  if (!fs.existsSync(root)) return null;
  for (const f of fs.readdirSync(root).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(root, f), "utf8")) as { key: string; value: string };
      const task = r.key.startsWith("tasks/") ? (JSON.parse(r.value) as TaskRecord) : null;
      if (task?.curriculum) return task.curriculum.phase;
    } catch {
      // A file being replaced while this reads (atomic rename) is read on the next poll.
    }
  }
  return null;
}

async function resize(app: ElectronApplication, size: { width: number; height: number }): Promise<void> {
  await app.evaluate(({ BrowserWindow }, s) => {
    for (const w of BrowserWindow.getAllWindows()) w.setSize(s.width, s.height);
  }, size);
}
async function viewportHeight(chat: FrameLocator): Promise<number> {
  return chat.locator("body").evaluate(() => document.documentElement.clientHeight);
}
async function focusChat(win: Page): Promise<FrameLocator> {
  const tab = win.locator(".tabs-container .tab", { hasText: "AI와 작업" }).first();
  if ((await tab.count()) > 0) await tab.click().catch(() => undefined);
  return chatFrame(win);
}
/** The outer webview frames whose document draws a chat (`.hps-shell`) right now, by their frame name. */
async function chatFrameNames(win: Page): Promise<string[]> {
  const frames = win.locator("iframe.webview.ready");
  const names: string[] = [];
  for (let i = 0; i < (await frames.count()); i++) {
    const inner = win.frameLocator("iframe.webview.ready").nth(i).frameLocator("#active-frame");
    if (await inner.locator(".hps-shell").isVisible().catch(() => false)) {
      const name = await frames.nth(i).getAttribute("name");
      if (name) names.push(name);
    }
  }
  return names;
}
const frameNamed = (win: Page, name: string): FrameLocator => win.frameLocator(`iframe.webview.ready[name="${name}"]`).frameLocator("#active-frame");
/**
 * A picture of the window for the run record. Best effort: quiet mode hides the app once the workbench is ready, and a
 * hidden app composites no frames, so a screenshot only works with `HPS_QUIET_NO_HIDE=1` (the window stays off-screen,
 * shown inactive and never focusable). Without it the record says so; every verdict here reads the DOM, not a picture.
 */
async function shot(win: Page, name: string): Promise<{ file: string; sha256: string } | { skipped: string }> {
  const file = path.join(repo, "e2e/test-results/sx-app", `goal-${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const bytes = await win.screenshot({ path: file, timeout: 8_000 });
    const { createHash } = await import("node:crypto");
    return { file: path.relative(repo, file), sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    return { skipped: `no frame (${process.env.HPS_QUIET_NO_HIDE === "1" ? "" : "app hidden by quiet mode; "}${String((error as Error).message).split("\n")[0]})` };
  }
}

/** At the short window: region A's parts whole, the goal after the conditions, reachable; a planted order must be reported. */
async function shortWindow(app: ElectronApplication, chat: FrameLocator): Promise<Record<string, unknown>> {
  await resize(app, SHORT);
  await expect.poll(() => viewportHeight(chat), { timeout: 10_000 }).toBeLessThan(SHORT.height);
  const probe = await probeShort(chat);
  expect(shortGoalProblem(probe), JSON.stringify(probe)).toBeNull();
  // Control: the goal line drawn first in the packed header (its order rule gone) must be reported.
  const control = await plantedMust(chat, "header.hp-mission .hp-mission-goal", "el.style.order = '0';", "el.style.order = '';", async () => shortGoalProblem(await probeShort(chat)), "the goal line moved ahead of the conditions");
  await resize(app, WIDE);
  await expect.poll(() => viewportHeight(chat), { timeout: 10_000 }).toBeGreaterThan(SHORT.height);
  return { probe, control };
}

let ctx: AppContext | undefined;
const svc = new GoalService();
const record: Record<string, unknown> = {};

test.beforeEach(() => {
  const locked = screenLocked();
  test.skip(locked !== false, `NOT RUN: the macOS screen is ${locked === null ? "in an unknown lock state (Quartz missing)" : "locked"}`);
});
test.afterEach(async () => {
  if (ctx) await closeApp(ctx);
  ctx = undefined;
  await svc.stop();
});
test.afterAll(() => {
  const out = path.join(repo, "e2e/test-results/sx-app/goal-result.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
});

test("AE-01 goal: kept beside the lesson's criteria through a change, the preview, a reopen and a second chat view", async () => {
  await svc.start(COMPLETION);
  const served = await svc.lesson();
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  fs.cpSync(FIXTURE, ctx.wsDir, { recursive: true });
  let chat = await chatFrame(ctx.win);
  await expect(chat.locator("header.hp-mission h1.hp-mission-sentence")).toHaveText(MISSION);
  // The task record exists before anything is written: the screen opened it. Its phase is what the goal must not move.
  await expect.poll(() => taskPhase(ctx!.userDataDir), { timeout: 30_000 }).not.toBeNull();
  const phase = taskPhase(ctx.userDataDir)!;
  expect(phase, "the task was already submitted before the student did anything").not.toBe("submitted");

  // ── First session: region A's lesson criteria, then the empty goal block ──
  const before = await probeGoal(chat);
  const lesson = { lesson: before.lesson, acceptance: before.acceptance };
  expect(lesson.lesson, "region A does not draw the served lesson's completion conditions").toEqual(WEEK3.learning.completion.map((c) => c.text));
  expect(lesson.acceptance.length, "region A draws no step acceptance").toBeGreaterThan(0);
  expect([before.headerGoal, before.summary, before.railGoal]).toEqual([null, "내 목표와 완료 기준 적기", "내 목표 · 아직 적지 않았어요"]);
  expect(completionProblem(before), JSON.stringify(before)).toBeNull();
  // Closed, the block adds no field: the chat's first field and its first rail card are what they were before AE-01.
  expect(layoutProblem(before), JSON.stringify(before)).toBeNull();
  const layoutControl = [
    await plantedMust(chat, "details.hp-goal > summary", "const t = document.createElement('textarea'); t.className = 'sx-planted'; el.after(t);", "el.parentElement.querySelector('.sx-planted')?.remove();", async () => layoutProblem(await probeGoal(chat)), "a field in the closed goal block"),
    await plantedMust(chat, "details.hp-goal", "el.classList.add('hp-rail-lesson');", "el.classList.remove('hp-rail-lesson');", async () => layoutProblem(await probeGoal(chat)), "the goal block under the lesson card's class"),
  ];
  record.first_session = { lesson: served, phase, before, layout_control: layoutControl, shot: await shot(ctx.win, "1-before") };

  // The student opens the block (viewing): the editor appears, holding the stored (empty) goal.
  const goal = chat.locator("details.hp-goal");
  const goalField = goal.locator("textarea").nth(0);
  const criteriaField = goal.locator("textarea").nth(1);
  const saveButton = goal.getByRole("button", { name: "목표 저장" });
  await goal.locator("summary").click();
  await expect(goal).toHaveAttribute("open", "");
  await expect(goalField).toHaveValue("");
  await expect(criteriaField).toHaveValue("");
  await expect(saveButton, "nothing written yet, and the save button can be pressed").toBeDisabled();
  const opened = await probeGoal(chat);
  expect(completionProblem(opened), "opening the goal block completed something").toBeNull();

  // ── The first save ──
  await goalField.fill(GOAL);
  await criteriaField.fill(CRITERIA.join("\n"));
  await saveButton.click();
  await expect(chat.locator("header.hp-mission .hp-mission-goal")).toHaveText(`내 목표 · ${GOAL}`, { timeout: 20_000 });
  await expect(goal.getByRole("status")).toHaveText("저장했어요.");
  await expect(goal).toHaveAttribute("data-student-goal", "1");
  await expect(saveButton, "nothing new to save, yet the save button can be pressed").toBeDisabled();
  const saved = await probeGoal(chat);
  expect(goalProblem(saved, GOAL, CRITERIA), JSON.stringify(saved)).toBeNull();
  expect(lessonProblem(saved, lesson), JSON.stringify(saved)).toBeNull();
  expect(completionProblem(saved), JSON.stringify(saved)).toBeNull();
  // The task did not move: the same phase the screen opened it in.
  expect(taskPhase(ctx.userDataDir), "saving a goal moved the task").toBe(phase);

  // ── The change: a new goal and one criterion replaced, typed with spaces and a blank line, saved with a double press ──
  await goalField.fill(`  ${GOAL2}  `);
  await criteriaField.fill(`  ${CRITERIA2[0]}  \n\n${CRITERIA2[1]}`);
  await expect(saveButton).toBeEnabled();
  // Two submits in one task: the second must not send a second save (it would be refused as stale and say so).
  await goal.locator("form.hp-goal-form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(chat.locator("header.hp-mission .hp-mission-goal")).toHaveText(`내 목표 · ${GOAL2}`, { timeout: 20_000 });
  await expect(goal.getByRole("status")).toHaveText("저장했어요.");
  await expect(goal.locator(".hp-goal-error"), "a double press sent a second save").toHaveCount(0);
  await expect(goal).toHaveAttribute("data-student-goal", "2");
  // The fields hold exactly what the host stored (they follow its new revision): spaces and the blank line are gone.
  await expect(goalField).toHaveValue(GOAL2);
  await expect(criteriaField).toHaveValue(CRITERIA2.join("\n"));
  await expect(saveButton).toBeDisabled();
  const changed = await probeGoal(chat);
  expect(goalProblem(changed, GOAL2, CRITERIA2), JSON.stringify(changed)).toBeNull();
  expect(lessonProblem(changed, lesson), JSON.stringify(changed)).toBeNull();
  expect(completionProblem(changed), JSON.stringify(changed)).toBeNull();
  expect(taskPhase(ctx.userDataDir), "changing the goal moved the task").toBe(phase);
  // Controls: each verdict on a planted screen must report it.
  const controls = [
    await plantedMust(chat, "header.hp-mission .hp-mission-completion-text", "const s = document.createElement('span'); s.className = 'sx-planted'; s.textContent = ' (학생이 고침)'; el.appendChild(s);", "el.querySelector('.sx-planted')?.remove();", async () => lessonProblem(await probeGoal(chat), lesson), "a lesson criterion's words changed"),
    await plantedMust(chat, "header.hp-mission .hp-mission-completion li[data-met]", "el.dataset.sxWas = el.dataset.met; el.dataset.met = 'yes';", "el.dataset.met = el.dataset.sxWas; delete el.dataset.sxWas;", async () => completionProblem(await probeGoal(chat)), "a condition checked off"),
    await plantedMust(chat, "header.hp-mission .hp-mission-goal-text", "const s = document.createElement('span'); s.className = 'sx-planted'; s.textContent = ' 다른 목표'; el.appendChild(s);", "el.querySelector('.sx-planted')?.remove();", async () => goalProblem(await probeGoal(chat), GOAL2, CRITERIA2), "the goal text changed"),
    await plantedMust(chat, "header.hp-mission .hp-mission-goal", "el.style.transform = 'translateY(-5000px)';", "el.style.transform = '';", async () => goalOffScreen(await probeGoal(chat)), "the goal line pushed off the screen"),
  ];
  record.saved = { first: saved, changed, phase: taskPhase(ctx.userDataDir), controls, shot: await shot(ctx.win, "2-changed") };

  // ── Short window, the chat alone (1280 wide) ──
  record.short_window = await shortWindow(ctx.app, chat);

  // ── Result screen: index.html, the preview beside the chat, the preview in front, then the chat again ──
  await ctx.win.locator(".monaco-workbench .part.titlebar").first().click({ position: { x: 10, y: 10 }, force: true });
  await ctx.win.keyboard.press("Meta+P");
  await ctx.win.locator(".quick-input-widget input.input").first().fill("index.html");
  await ctx.win.waitForTimeout(600);
  await ctx.win.keyboard.press("Enter");
  await expect(ctx.win.locator(".tabs-container .tab.active", { hasText: "index.html" })).toHaveCount(1, { timeout: 15_000 });
  await runCommand(ctx.win, PREVIEW);
  await expect.poll(() => previewUrl(ctx!.app), { timeout: 30_000 }).not.toBeNull();
  // The preview's tab is labelled with the page's own title (verification.md: "라벨은 페이지 제목이다").
  const previewTab = ctx.win.locator(".tabs-container .tab", { hasText: PREVIEW_TITLE }).first();
  await expect(previewTab, "the preview tab is not open").toHaveCount(1, { timeout: 30_000 });
  await previewTab.click();
  await expect(ctx.win.locator(".tabs-container .tab.active", { hasText: PREVIEW_TITLE }).first()).toBeVisible();
  // The chat comes back to the front of its own group, the result stays open beside it: both on screen at once.
  chat = await focusChat(ctx.win);
  await expect(ctx.win.locator(".tabs-container .tab.active", { hasText: PREVIEW_TITLE }).first(), "the result closed when the chat came back").toBeVisible();
  const beside = await probeGoal(chat);
  expect(goalProblem(beside, GOAL2, CRITERIA2), JSON.stringify(beside)).toBeNull();
  expect(goalOffScreen(beside), JSON.stringify(beside)).toBeNull();
  expect(lessonProblem(beside, lesson), JSON.stringify(beside)).toBeNull();
  expect(completionProblem(beside), JSON.stringify(beside)).toBeNull();
  expect(taskPhase(ctx.userDataDir), "looking at the result moved the task").toBe(phase);
  const withPreview = await shot(ctx.win, "3-result-beside");
  // The conversation scrolled to its end (where the composer is): region A's goal line stays on screen with the header.
  const scrolled = await chat.locator(".hps-messages").evaluate((el) => {
    for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) node.scrollTop = node.scrollHeight;
    const shell = document.querySelector(".hps-shell") as HTMLElement | null;
    return { shellScrollTop: shell?.scrollTop ?? 0, shellScrolls: !!shell && shell.scrollHeight > shell.clientHeight };
  });
  expect(scrolled.shellScrolls && scrolled.shellScrollTop > 0, `the work screen did not scroll — the check proves nothing: ${JSON.stringify(scrolled)}`).toBe(true);
  const afterScroll = await probeGoal(chat);
  expect(goalOffScreen(afterScroll), JSON.stringify({ afterScroll, scrolled })).toBeNull();
  expect(goalProblem(afterScroll, GOAL2, CRITERIA2), JSON.stringify(afterScroll)).toBeNull();
  record.result_screen = { preview: await previewUrl(ctx.app), beside, scrolled: { ...scrolled, probe: afterScroll }, shot: withPreview, shot_scrolled: await shot(ctx.win, "3b-scrolled") };

  // ── Reopened: a new App process on the same device storage ──
  const userDataDir = ctx.userDataDir;
  await ctx.app.close();
  ctx = undefined;
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  chat = await focusChat(ctx.win);
  await expect(chat.locator("header.hp-mission h1.hp-mission-sentence")).toHaveText(MISSION);
  await expect(chat.locator("header.hp-mission .hp-mission-goal")).toHaveText(`내 목표 · ${GOAL2}`, { timeout: 20_000 });
  const reopened = await probeGoal(chat);
  expect(goalProblem(reopened, GOAL2, CRITERIA2), JSON.stringify(reopened)).toBeNull();
  expect(lessonProblem(reopened, lesson), JSON.stringify(reopened)).toBeNull();
  expect(completionProblem(reopened), JSON.stringify(reopened)).toBeNull();
  expect(layoutProblem(reopened), JSON.stringify(reopened)).toBeNull();
  expect(taskPhase(ctx.userDataDir), "the reopen moved the task").toBe(phase);
  // The editor, opened again, holds the stored goal and criteria.
  const editorGoal = chat.locator("details.hp-goal");
  await editorGoal.locator("summary").click();
  await expect(editorGoal.locator("textarea").nth(0)).toHaveValue(GOAL2);
  await expect(editorGoal.locator("textarea").nth(1)).toHaveValue(CRITERIA2.join("\n"));
  await expect(editorGoal.getByRole("button", { name: "목표 저장" })).toBeDisabled();
  // The short window again, the result beside the chat as the first session left it (the chat about 640 wide).
  const shortReopened = await shortWindow(ctx.app, chat);
  record.reopened = { probe: reopened, phase: taskPhase(ctx.userDataDir), short_window: shortReopened, shot: await shot(ctx.win, "4-reopened") };

  // ── Two chat views: the sidebar chat beside the editor chat ──
  const [editorName] = await chatFrameNames(ctx.win);
  expect(editorName, "no chat frame before the sidebar opened").toBeTruthy();
  await runCommand(ctx.win, "View: Show HypeProof Chat");
  await expect.poll(async () => (await chatFrameNames(ctx!.win)).length, { timeout: 30_000, message: "the sidebar chat did not open beside the editor chat" }).toBe(2);
  const sidebarName = (await chatFrameNames(ctx.win)).find((name) => name !== editorName)!;
  const editor = frameNamed(ctx.win, editorName);
  const sidebar = frameNamed(ctx.win, sidebarName);
  await expect(sidebar.locator("header.hp-mission .hp-mission-goal")).toHaveText(`내 목표 · ${GOAL2}`, { timeout: 20_000 });
  const sidebarGoal = sidebar.locator("details.hp-goal");
  await sidebarGoal.locator("summary").click();
  await expect(sidebarGoal.locator("textarea").nth(0)).toHaveValue(GOAL2);
  // The student clears the goal in the editor chat (try-it step 6).
  const clearGoal = editor.locator("details.hp-goal");
  await clearGoal.locator("textarea").nth(0).fill("");
  await clearGoal.locator("textarea").nth(1).fill("");
  await clearGoal.getByRole("button", { name: "목표 저장" }).click();
  await expect(clearGoal.getByRole("status")).toHaveText("저장했어요.", { timeout: 20_000 });
  for (const view of [editor, sidebar]) {
    await expect(view.locator("header.hp-mission .hp-mission-goal"), "the cleared goal stayed in region A").toHaveCount(0, { timeout: 20_000 });
    await expect(view.locator("details.hp-goal > summary")).toHaveText("내 목표와 완료 기준 적기");
    await expect(view.locator("details.hp-goal")).toHaveAttribute("data-student-goal", "3");
  }
  // The sidebar's open fields followed the editor chat's save; it did not save, so it says nothing about saving.
  await expect(sidebarGoal.locator("textarea").nth(0)).toHaveValue("");
  await expect(sidebarGoal.locator("textarea").nth(1)).toHaveValue("");
  await expect(sidebarGoal.getByText("저장했어요."), "a view that did not save says it saved").toHaveCount(0);
  const cleared = { editor: await probeGoal(editor), sidebar: await probeGoal(sidebar) };
  for (const p of [cleared.editor, cleared.sidebar]) {
    expect([p.headerGoal, p.railGoal, p.criteria], JSON.stringify(p)).toEqual([null, "내 목표 · 아직 적지 않았어요", []]);
    expect(lessonProblem(p, lesson), JSON.stringify(p)).toBeNull();
    expect(completionProblem(p), JSON.stringify(p)).toBeNull();
  }
  expect(taskPhase(ctx.userDataDir), "clearing the goal moved the task").toBe(phase);
  const clearedShot = await shot(ctx.win, "5-two-views-cleared");

  // The student types in the sidebar and does not save; meanwhile the editor chat saves a new goal (revision 4).
  await sidebarGoal.locator("textarea").nth(0).fill(TYPED);
  await clearGoal.locator("textarea").nth(0).fill(GOAL3);
  await clearGoal.getByRole("button", { name: "목표 저장" }).click();
  await expect(clearGoal.getByRole("status")).toHaveText("저장했어요.", { timeout: 20_000 });
  for (const view of [editor, sidebar]) {
    await expect(view.locator("header.hp-mission .hp-mission-goal")).toHaveText(`내 목표 · ${GOAL3}`, { timeout: 20_000 });
    await expect(view.locator("details.hp-goal")).toHaveAttribute("data-student-goal", "4");
  }
  // The sidebar keeps what was typed there and says the goal changed on another screen; nothing is lost or saved.
  await expect(sidebarGoal.locator("textarea").nth(0), "the editor chat's save dropped the text typed in the sidebar").toHaveValue(TYPED);
  await expect(sidebarGoal.locator(".hp-goal-elsewhere")).toHaveText(CHANGED_ELSEWHERE);
  await expect(sidebarGoal.getByText("저장했어요."), "a view that did not save says it saved").toHaveCount(0);
  await expect(clearGoal.locator(".hp-goal-elsewhere"), "the view that saved says another screen changed the goal").toHaveCount(0);
  const typedKept = { editor: await probeGoal(editor), sidebar: await probeGoal(sidebar), shot: await shot(ctx.win, "6-two-views-typed-kept") };
  // The sidebar's save, made after it said so, replaces the editor chat's goal in both views (revision 5); the editor
  // chat's fields held its own saved goal, untouched, so they follow.
  await sidebarGoal.getByRole("button", { name: "목표 저장" }).click();
  await expect(sidebarGoal.getByRole("status")).toHaveText("저장했어요.", { timeout: 20_000 });
  for (const view of [editor, sidebar]) {
    await expect(view.locator("header.hp-mission .hp-mission-goal")).toHaveText(`내 목표 · ${TYPED}`, { timeout: 20_000 });
    await expect(view.locator("details.hp-goal")).toHaveAttribute("data-student-goal", "5");
    await expect(view.locator(".hp-goal-elsewhere")).toHaveCount(0);
  }
  await expect(clearGoal.locator("textarea").nth(0)).toHaveValue(TYPED);
  await expect(clearGoal.getByText("저장했어요."), "the editor chat still says it saved after the sidebar's save").toHaveCount(0);
  const replaced = { editor: await probeGoal(editor), sidebar: await probeGoal(sidebar) };
  for (const p of [replaced.editor, replaced.sidebar]) {
    expect(lessonProblem(p, lesson), JSON.stringify(p)).toBeNull();
    expect(completionProblem(p), JSON.stringify(p)).toBeNull();
  }
  expect(taskPhase(ctx.userDataDir), "saving from two views moved the task").toBe(phase);
  record.two_views = { cleared, typed_kept: typedKept, replaced, phase: taskPhase(ctx.userDataDir), shot: clearedShot, shot_replaced: await shot(ctx.win, "7-two-views-replaced") };
});
