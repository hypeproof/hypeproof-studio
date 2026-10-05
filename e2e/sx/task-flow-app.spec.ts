// SX-55 — the task flow in the Studio APP (Playwright e2e layer).
//
// Evidence class: live-host for the App (a prepared copy of the shipped shell with this branch's
// extension and webview injected), synthetic for the Service (sx-service.mjs: the real router
// over SQLite, a lesson-pinned seat on the one `/2` profile, a model that answers one fixed line).
//
// One student, one task (the week-3 design, completion kept to c1 "기대 조건을 시험 전에 적었다"):
//   assigned   the work screen opens on the mission; c1 unchecked; completion closed, and the
//              reason says the task has not started
//   working    one message and the coach's answer: "not started" is gone, the gate still closes it
//   gate met   the criterion written in the evidence drawer: c1 checked off, completion opens
//   submitted  completion pressed: a state line and no button; the task record on disk names the
//              phases assigned → working → submitted
//   reopened   the app closed and opened again on the same profile: still submitted, read back
//              from the record
// Not covered here: reflected and the next task (the boundary reflection, sx-p2), and the host's
// refusal of a submit sent around the disabled button (extensions/hypeproof-chat/test/
// sx-task-flow.smoke.mjs and sx-evidence-gate.smoke.mjs judge those without the app).
//
// Needs an unlocked screen: when it is locked the run is skipped as NOT RUN.
import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type AppContext, chatFrame, closeApp, launchApp } from "../fixtures/app";
import { screenLocked, send } from "../curriculum-runtime/app-helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const PORT = Number(process.env.HPS_SX_APP_PORT || 18951);
const MISSION = "AI가 만든 걸 내가 확인했나?";

class SxService {
  private proc?: ChildProcess;
  async start(): Promise<void> {
    fs.mkdirSync(path.dirname(process.env.HPS_E2E_TOKEN_FILE!), { recursive: true });
    this.proc = spawn(
      process.execPath,
      ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", path.join(here, "sx-service.mjs"), String(PORT), process.env.HPS_E2E_TOKEN_FILE!],
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
  async state(): Promise<{ turns: Array<{ system_has_mission: boolean }> }> {
    return (await fetch(`http://127.0.0.1:${PORT}/__sx/state`)).json() as Promise<{ turns: Array<{ system_has_mission: boolean }> }>;
  }
  stop(): void {
    this.proc?.kill();
  }
}

type TaskRecord = { id: string; status: string; curriculum?: { phase: string; current_step: string }; history: Array<{ change: string }> };
/** The Task records the extension wrote to its local measurement-core record (one JSON file per key). */
function taskRecords(userDataDir: string): TaskRecord[] {
  const root = path.join(userDataDir, "User", "globalStorage", "hypeproof.hypeproof-chat", "local-review-v1");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => /^[a-f0-9]{64}\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8")) as { key: string; value: string })
    .filter((r) => r.key.startsWith("tasks/"))
    .map((r) => JSON.parse(r.value) as TaskRecord);
}
const phasesOf = (t: TaskRecord) => t.history.filter((h) => h.change.startsWith("curriculum:phase:")).map((h) => h.change.slice("curriculum:phase:".length));

let ctx: AppContext | undefined;
const svc = new SxService();
const record: Record<string, unknown> = {};

test.beforeEach(() => {
  const locked = screenLocked();
  test.skip(locked !== false, `NOT RUN: the macOS screen is ${locked === null ? "in an unknown lock state (Quartz missing)" : "locked"}`);
});
test.afterEach(async () => {
  if (ctx) await closeApp(ctx);
  ctx = undefined;
  svc.stop();
});
test.afterAll(() => {
  const out = path.join(repo, "e2e/test-results/sx-app/task-flow-result.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
});

async function focusChat(win: Page): Promise<void> {
  const tab = win.locator(".tabs-container .tab", { hasText: "AI와 작업" }).first();
  if ((await tab.count()) > 0) await tab.click().catch(() => undefined);
}

test("SX-55: assigned → working → submitted on the work screen, and the record survives a restart", async () => {
  await svc.start();
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" } });
  let chat = await chatFrame(ctx.win);
  await focusChat(ctx.win);

  // assigned — the work screen opens on the mission; nothing is checked off, nothing can be submitted.
  const mission = chat.locator("header.hp-mission");
  await expect(mission.locator("h1.hp-mission-sentence")).toHaveText(MISSION);
  const c1 = mission.locator(".hp-mission-completion li[data-met]");
  await expect(c1).toHaveCount(1);
  await expect(c1).toHaveAttribute("data-met", "no");
  const region = chat.locator(".hp-evidence-region");
  const complete = region.getByRole("button", { name: "이 과제 완료하기" });
  await expect(complete).toBeDisabled();
  await expect(region.locator(".hp-complete-why")).toContainText("아직 시작 전이에요");
  record.assigned = { reasons: await region.locator(".hp-complete-why li").allInnerTexts(), c1: await c1.getAttribute("data-met") };

  // working — one message, one answer. "Not started" goes; the gate still closes completion.
  await send(ctx.win, "시작할게요");
  await expect(chat.getByText("[로컬 시험 응답] 받았어요.").first()).toBeVisible({ timeout: 60_000 });
  await expect(region.locator(".hp-complete-why")).not.toContainText("아직 시작 전이에요", { timeout: 30_000 });
  await expect(region.locator(".hp-complete-why")).toContainText("아직 안 한 것: 기대 조건을 시험 전에 적었다");
  await expect(complete).toBeDisabled();
  record.working = { reasons: await region.locator(".hp-complete-why li").allInnerTexts() };

  // gate met — the student's own criterion, from the evidence drawer.
  await region.locator("details.hp-evidence > summary").click();
  await region.locator("textarea#hp-criterion").fill("시간표가 학교 규정 원문과 같아야 한다");
  await region.getByRole("button", { name: "기대 조건 남기기" }).click();
  await expect(c1).toHaveAttribute("data-met", "yes");
  await expect(complete).toBeEnabled();
  record.gate_met = { c1: await c1.getAttribute("data-met") };

  // submitted — a state line, no button; the record on disk says so.
  await complete.click();
  await expect(region.locator(".hp-complete-done")).toContainText("이 과제를 제출했어요");
  await expect(region.getByRole("button", { name: "이 과제 완료하기" })).toHaveCount(0);
  await expect.poll(() => taskRecords(ctx!.userDataDir).filter((t) => t.curriculum?.phase === "submitted").length).toBe(1);
  const task = taskRecords(ctx.userDataDir).find((t) => t.curriculum)!;
  expect(phasesOf(task)).toEqual(["assigned", "working", "submitted"]);
  expect(task.status, "the flow touched the work axis (Task.status)").toBe("open");
  record.submitted = { task: task.id, phases: phasesOf(task), current_step: task.curriculum!.current_step };

  // reopened — same profile, new app process: still submitted, read back from the record.
  const userDataDir = ctx.userDataDir;
  await ctx.app.close();
  ctx = undefined;
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  chat = await chatFrame(ctx.win);
  await focusChat(ctx.win);
  await expect(chat.locator(".hp-evidence-region .hp-complete-done")).toContainText("이 과제를 제출했어요");
  await expect(chat.locator(".hp-evidence-region").getByRole("button", { name: "이 과제 완료하기" })).toHaveCount(0);
  expect(taskRecords(userDataDir).filter((t) => t.curriculum).length, "the reopen made a second task").toBe(1);
  const turns = (await svc.state()).turns;
  record.reopened = { submitted_line: true };
  record.model = { turns: turns.length, system_has_mission: turns.every((t) => t.system_has_mission) };
});
