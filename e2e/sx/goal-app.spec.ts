// AE-01 (#554) — "내 목표" in the Studio APP (Playwright e2e layer): the goal half of AE-T01.
//
// Evidence class: live-host for the App (a prepared copy of the shipped shell with this branch's extension and
// webview injected), synthetic for the Service (sx-service.mjs: the real router over SQLite, a lesson-pinned seat on
// the one `/2` profile, a model that answers one fixed line). No model call, no production state.
//
// One student on the week-3 design:
//   first session   The goal block starts empty beside region A's lesson criteria. The student opens it, writes a
//                   goal and two criteria and saves. Region A reads the same lesson criteria before and after, nothing
//                   is checked off, the task record does not move and the completion button stays closed (AE-01:
//                   viewing or writing a goal completes nothing).
//   result screen   index.html opens and the preview opens beside the chat; the student looks at the preview and brings
//                   the chat back to the front while the result stays open beside it: the same goal and the same lesson
//                   criteria, and region A's goal line wholly on screen, also with the conversation scrolled to its end
//                   (AE-01: "대화와 결과를 오가도 유지"; the AE design keeps the goal summary fixed with the task).
//   reopened        A new App process on the same device storage: the same goal and lesson criteria.
// Every probe also runs once on a planted DOM (a lesson criterion's words changed, a condition checked off, the goal
// text changed) and must report it (verification.md rule 2).
//
// Not covered here: another lesson revision. A lesson-pinned seat's activity id includes the lesson (Service
// `activityIdentity`), so serving another revision means a new code, a new activity and, through the start page's
// "이 활동 시작하기", possibly another folder: such a run could pass for that reason alone. The revision and activity
// boundary is checked where it can be isolated, against the real host and config path in
// extensions/hypeproof-chat/test/student-goal.smoke.mjs. Also not covered: AE-T01's other half (material selection and
// the request payload, AE-02: the `context` item #555), Windows, a real student. Needs an unlocked screen: when it is
// locked the run is skipped as NOT RUN.
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
/** The lesson the Service serves keeps all three week-3 completion conditions, as the design is written. */
const COMPLETION = "c1,c2,c3";
const GOAL = "예약 버튼이 첫 화면에서 바로 보이게 만들기";
const CRITERIA = ["휴대폰 화면에서도 예약 버튼이 보인다", "원래 진료 시간과 같다"];
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
async function focusChat(win: Page): Promise<FrameLocator> {
  const tab = win.locator(".tabs-container .tab", { hasText: "AI와 작업" }).first();
  if ((await tab.count()) > 0) await tab.click().catch(() => undefined);
  return chatFrame(win);
}
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

test("AE-01 goal: kept beside the lesson's criteria through the preview and a reopen", async () => {
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
  record.first_session = { lesson: served, phase, before, shot: await shot(ctx.win, "1-before") };

  // The student opens the block (viewing), writes a goal and two criteria and saves.
  const goal = chat.locator("details.hp-goal");
  await goal.locator("summary").click();
  await expect(goal).toHaveAttribute("open", "");
  const opened = await probeGoal(chat);
  expect(completionProblem(opened), "opening the goal block completed something").toBeNull();
  await goal.locator("textarea").nth(0).fill(GOAL);
  await goal.locator("textarea").nth(1).fill(CRITERIA.join("\n"));
  await goal.getByRole("button", { name: "목표 저장" }).click();
  await expect(chat.locator("header.hp-mission .hp-mission-goal")).toHaveText(`내 목표 · ${GOAL}`, { timeout: 20_000 });
  await expect(goal.getByRole("status")).toHaveText("저장했어요.");
  const saved = await probeGoal(chat);
  expect(goalProblem(saved, GOAL, CRITERIA), JSON.stringify(saved)).toBeNull();
  expect(lessonProblem(saved, lesson), JSON.stringify(saved)).toBeNull();
  expect(completionProblem(saved), JSON.stringify(saved)).toBeNull();
  // The task did not move: the same phase the screen opened it in.
  expect(taskPhase(ctx.userDataDir), "saving a goal moved the task").toBe(phase);
  // Controls: each verdict on a planted screen must report it.
  const controls = [
    await plantedMust(chat, "header.hp-mission .hp-mission-completion-text", "const s = document.createElement('span'); s.className = 'sx-planted'; s.textContent = ' (학생이 고침)'; el.appendChild(s);", "el.querySelector('.sx-planted')?.remove();", async () => lessonProblem(await probeGoal(chat), lesson), "a lesson criterion's words changed"),
    await plantedMust(chat, "header.hp-mission .hp-mission-completion li[data-met]", "el.dataset.sxWas = el.dataset.met; el.dataset.met = 'yes';", "el.dataset.met = el.dataset.sxWas; delete el.dataset.sxWas;", async () => completionProblem(await probeGoal(chat)), "a condition checked off"),
    await plantedMust(chat, "header.hp-mission .hp-mission-goal-text", "const s = document.createElement('span'); s.className = 'sx-planted'; s.textContent = ' 다른 목표'; el.appendChild(s);", "el.querySelector('.sx-planted')?.remove();", async () => goalProblem(await probeGoal(chat), GOAL, CRITERIA), "the goal text changed"),
    await plantedMust(chat, "header.hp-mission .hp-mission-goal", "el.style.transform = 'translateY(-5000px)';", "el.style.transform = '';", async () => goalOffScreen(await probeGoal(chat)), "the goal line pushed off the screen"),
  ];
  record.saved = { probe: saved, phase: taskPhase(ctx.userDataDir), controls, shot: await shot(ctx.win, "2-saved") };

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
  expect(goalProblem(beside, GOAL, CRITERIA), JSON.stringify(beside)).toBeNull();
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
  expect(goalProblem(afterScroll, GOAL, CRITERIA), JSON.stringify(afterScroll)).toBeNull();
  record.result_screen = { preview: await previewUrl(ctx.app), beside, scrolled: { ...scrolled, probe: afterScroll }, shot: withPreview, shot_scrolled: await shot(ctx.win, "3b-scrolled") };

  // ── Reopened: a new App process on the same device storage ──
  const userDataDir = ctx.userDataDir;
  await ctx.app.close();
  ctx = undefined;
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  chat = await focusChat(ctx.win);
  await expect(chat.locator("header.hp-mission h1.hp-mission-sentence")).toHaveText(MISSION);
  await expect(chat.locator("header.hp-mission .hp-mission-goal")).toHaveText(`내 목표 · ${GOAL}`, { timeout: 20_000 });
  const reopened = await probeGoal(chat);
  expect(goalProblem(reopened, GOAL, CRITERIA), JSON.stringify(reopened)).toBeNull();
  expect(lessonProblem(reopened, lesson), JSON.stringify(reopened)).toBeNull();
  expect(completionProblem(reopened), JSON.stringify(reopened)).toBeNull();
  expect(taskPhase(ctx.userDataDir), "the reopen moved the task").toBe(phase);
  record.reopened = { probe: reopened, phase: taskPhase(ctx.userDataDir), shot: await shot(ctx.win, "4-reopened") };
});
