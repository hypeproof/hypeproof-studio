// cr-review (#1398) — "주간 리뷰" in the Studio APP (Playwright e2e layer).
//
// Evidence class: live-host for the App (a prepared copy of the shipped shell with this branch's
// extension and webview injected), synthetic for the Service, its storage and the model
// (app-service.mjs with `publish`: the real Service router over SQLite D1 and an in-memory R2;
// the scripted model answers the Experiment skill's prompt only from what the prompt carried).
//
//   CR-T02 in-app   switch off, with a learner's and a director's token both stored: neither
//                   "HypeProof: 주간 리뷰" nor "HypeProof: 주간 리뷰 (디렉터)" is in the palette and
//                   no review panel appears.
//   CR-T48          the team publishes the kiosk and records evidence; "주간 리뷰 준비하기" in the
//                   learner's App prepares the pack; a SEPARATE App signed in with the director's
//                   issuer token only opens "주간 리뷰 (디렉터)", sees the team, opens its pack and
//                   writes the decision and the next experiment from the review screen; the
//                   learner's App is reopened with every workspaceState of its workspace deleted
//                   (chat history and remembered Project with it): "프로젝트 기억" shows the
//                   director's decision and the experiment draft, and the Service's memory read
//                   names the director as the actor and the pack's evidence. This run's own
//                   controls: no director decision exists before the director writes one, and the
//                   chat history is gone after the deletion. The negative (a decision stored
//                   without the director actor fails) is the Service half in
//                   worker/test/cr-review.test.mjs.
//
// Needs an unlocked screen (recon F7): when locked the run is skipped as NOT RUN.
import { test, expect, type FrameLocator, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type AppContext, chatFrame, closeApp, launchApp, runCommand } from "../fixtures/app";
import { PORT, Service, paletteRows, previewUrl, repo, screenLocked, send } from "./app-helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures/kiosk-practice");
const PUBLISH = "HypeProof: 사용자 테스트용으로 공개하기";
const PREVIEW = "HypeProof: HTML 미리보기 (옆 패널)";
const REVIEW = "HypeProof: 주간 리뷰";
const DIRECTOR = "HypeProof: 주간 리뷰 (디렉터)";
const MEMORY = "HypeProof: 프로젝트 기억 보기";

let ctx: AppContext | undefined;
let directorCtx: AppContext | undefined;
const svc = new Service();
const record: Record<string, unknown> = {};

test.beforeEach(() => {
  const locked = screenLocked();
  test.skip(locked !== false, `NOT RUN: the macOS screen is ${locked === null ? "in an unknown lock state (Quartz missing)" : "locked"}; the integrated browser paints no frames then (recon F7)`);
});
test.afterEach(async () => {
  for (const c of [ctx, directorCtx]) if (c) await closeApp(c);
  ctx = undefined;
  directorCtx = undefined;
  svc.stop();
});
test.afterAll(() => {
  const out = path.join(repo, "e2e/test-results/cr-app/review-result.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
});

const tokenFile = () => process.env.HPS_E2E_TOKEN_FILE!;

/** The Service's own answer, read with a token (what the panels read); never a variable this spec kept. */
async function api(token: string, method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/curriculum${p}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function focusChat(win: Page): Promise<void> {
  const tab = win.locator(".tabs-container .tab", { hasText: "AI와 작업" }).first();
  if ((await tab.count()) > 0) await tab.click().catch(() => undefined);
}

async function publishKiosk(): Promise<{ win: Page; chat: FrameLocator }> {
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" } });
  const { app, win, wsDir } = ctx;
  fs.cpSync(FIXTURE, wsDir, { recursive: true });
  await send(win, "안녕");
  await expect.poll(async () => (await svc.state()).requests.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await win.locator(".monaco-workbench .part.titlebar").first().click({ position: { x: 10, y: 10 }, force: true });
  await win.keyboard.press("Meta+P");
  await win.locator(".quick-input-widget input.input").first().fill("index.html");
  await win.waitForTimeout(600);
  await win.keyboard.press("Enter");
  await win.waitForTimeout(800);
  await runCommand(win, PREVIEW);
  await expect.poll(() => previewUrl(app), { timeout: 30_000 }).not.toBeNull();
  const chat = await chatFrame(win);
  await runCommand(win, PUBLISH);
  await focusChat(win);
  const form = chat.locator('[data-testid="publish-form"]');
  await expect(form).toBeVisible({ timeout: 20_000 });
  await form.locator('textarea[aria-label="가설"]').fill("처음 쓰는 사람도 혼자 주문할 수 있다");
  await form.locator('input[aria-label="질문"]').fill("도움 없이 주문을 마칠 수 있나?");
  await form.locator('textarea[aria-label="성공 기준"]').fill("5명 중 3명이 주문 완료");
  await chat.locator('[data-testid="publish-expiry-3"]').check();
  await chat.locator('[data-testid="publish-submit"]').click();
  await expect(chat.locator('[data-testid="publish-share-url"]')).toBeVisible({ timeout: 30_000 });
  return { win, chat };
}

/** Run a command until the panel it opens is on screen (the first post can land before a fresh webview listens). */
async function openPanel(win: Page, label: string, testid: string): Promise<FrameLocator> {
  let chat: FrameLocator | null = null;
  await expect
    .poll(
      async () => {
        await runCommand(win, label);
        await focusChat(win);
        chat = await chatFrame(win).catch(() => null);
        return chat ? await chat.locator(`[data-testid="${testid}"]`).isVisible().catch(() => false) : false;
      },
      { timeout: 90_000, intervals: [2_000, 4_000, 6_000] },
    )
    .toBe(true);
  return chat!;
}

test("CR-T02 in-app, switch off: neither review command is reachable, with a learner's and a director's token both stored", async () => {
  await svc.start(false, "publish");
  const issuer = fs.readFileSync(`${tokenFile()}.issuer`, "utf8").trim();
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" }, preseedIssuerToken: issuer, stayOnStart: true });
  await ctx.win.waitForTimeout(3_000);
  const control = await paletteRows(ctx.win, PREVIEW);
  expect(control.some((r) => r.includes("HTML 미리보기")), "control: the palette instrument finds an existing command").toBe(true);
  const rows = [...(await paletteRows(ctx.win, REVIEW)), ...(await paletteRows(ctx.win, DIRECTOR))];
  expect(rows.some((r) => r.includes("주간 리뷰")), "both review commands are hidden with the switch off").toBe(false);
  const issuerProbe = await api(issuer, "GET", "/director/projects");
  expect(issuerProbe.status, "the Service answers the director's probe as an unknown route").toBe(404);
  record["CR-T02-off"] = { rows, director_probe_status: issuerProbe.status };
});

test("CR-T48 in-app: the director writes the decision and the next experiment from the review screen; after reopening both are in Venture Memory with the director as the actor", async () => {
  await svc.start(true, "publish");
  const learner = fs.readFileSync(tokenFile(), "utf8").trim();
  const issuer = fs.readFileSync(`${tokenFile()}.issuer`, "utf8").trim();
  const { win } = await publishKiosk();

  // Evidence through the Service with the learner's token: what the evidence panel writes
  // (a manual record, a draft, the student's review of it).
  const projectId = (await api(learner, "GET", "/projects")).json.projects[0].id as string;
  const experiment = (await api(learner, "GET", `/projects/${projectId}`)).json.experiments[0];
  const note = await api(learner, "POST", `/experiments/${experiment.id}/notes`, { note_kind: "observer_note", text: "옵션 고르는 화면에서 멈칫함", provenance: { who: "관찰자 A", when: "2주차 수업", where: "교실 키오스크 앞" }, source_state: "real" });
  expect(note.status).toBe(201);
  const draft = await api(learner, "POST", `/experiments/${experiment.id}/drafts`, { author: "user", items: [{ id: "o1", section: "observation", text: "옵션 선택에서 멈췄다", source_refs: [`note:${note.json.note.id}`], review: "draft" }, { id: "a1", section: "assumption", text: "한 단계면 혼자 주문한다", source_refs: [], review: "draft" }] });
  expect(draft.status).toBe(201);
  const reviewed = await api(learner, "POST", `/experiments/${experiment.id}/drafts/${draft.json.draft.id}/review`, { revision: 1, actions: [{ item: "o1", action: "accept" }, { item: "a1", action: "accept" }], reason: "학생이 읽고 고름" });
  expect(reviewed.status).toBe(201);

  // The learner prepares the week's pack in the App.
  const chat = await openPanel(win, REVIEW, "review-panel");
  await expect(chat.locator('[data-testid="review-panel"]')).toHaveAttribute("data-mode", "student");
  await chat.locator('[data-testid="review-prepare"]').click();
  await expect(chat.locator('[data-testid="review-status"]')).toHaveAttribute("data-status", "fresh", { timeout: 60_000 });
  await expect(chat.locator('[data-testid="review-section"]')).toHaveCount(10);
  const skillHeaders = (await svc.state() as unknown as { skillHeaders: unknown[] }).skillHeaders;
  // Control: no director decision before the director writes one.
  const before = (await api(learner, "GET", `/projects/${projectId}/memory`)).json.memory;
  expect(before.decisions.filter((d: { actor: string }) => d.actor === "director")).toHaveLength(0);
  const chatBefore = await chat.locator("text=안녕").count();
  expect(chatBefore, "control: the chat history holds the earlier message").toBeGreaterThan(0);
  const userDataDir = ctx!.userDataDir;
  await ctx!.app.close();
  ctx = undefined;

  // The director's own App: the issuer token only, no learner token.
  directorCtx = await launchApp({ preseedToken: false, preseedIssuerToken: issuer });
  const dwin = directorCtx.win;
  await expect.poll(async () => (await paletteRows(dwin, DIRECTOR)).some((r) => r.includes("주간 리뷰 (디렉터)")), { timeout: 60_000, intervals: [3_000] }).toBe(true);
  const dchat = await openPanel(dwin, DIRECTOR, "review-teams");
  const team = dchat.locator(`[data-testid="review-team"][data-project="${projectId}"]`);
  await expect(team).toHaveAttribute("data-status", "fresh");
  await team.locator("button").click();
  const form = dchat.locator('[data-testid="review-decision-form"]');
  await expect(form).toBeVisible({ timeout: 20_000 });
  await form.locator('textarea[aria-label="결정"]').fill("옵션을 한 화면에 모은 v1으로 다음 주에 다시 시험한다");
  await form.locator('[data-testid="review-pick-evidence"]').first().check();
  await form.locator('[data-testid="review-pick-slide"][data-slide="2"]').check();
  // The next experiment is prefilled from the AI's suggestion; the director still writes its question.
  await form.locator('input[aria-label="다음 실험 질문"]').fill("옵션이 한 단계면 혼자 주문할 수 있나?");
  await expect(form.locator('textarea[aria-label="새 가설"]')).not.toHaveValue("");
  await form.locator('[data-testid="review-decide"]').click();
  await expect(dchat.locator('[data-testid="review-done"]')).toHaveText("결정과 다음 실험을 프로젝트 기억에 기록했어요.", { timeout: 20_000 });
  await expect(dchat.locator('[data-testid="review-decision"][data-actor="director"]')).toHaveCount(1);
  await closeApp(directorCtx);
  directorCtx = undefined;

  // The learner's App, reopened with every workspaceState of its workspace deleted.
  const storage = path.join(userDataDir, "User", "workspaceStorage");
  expect(fs.existsSync(storage), "control: the chat history store exists before the deletion").toBe(true);
  fs.rmSync(storage, { recursive: true, force: true });
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  const mchat = await openPanel(ctx.win, MEMORY, "memory-panel");
  await expect(mchat.locator("text=안녕"), "the chat history is gone").toHaveCount(0, { timeout: 20_000 });
  const decision = mchat.locator('[data-testid="memory-decision"][data-shown-as="director_decision"]');
  await expect(decision).toHaveCount(1, { timeout: 20_000 });
  await expect(decision).toContainText("디렉터 결정: 옵션을 한 화면에 모은 v1으로 다음 주에 다시 시험한다");
  await expect(mchat.locator('[data-testid="memory-experiment"][data-status="draft"]')).toContainText("옵션이 한 단계면 혼자 주문할 수 있나?");
  // The Service's own read: actor, the pack's evidence, the draft named by the decision.
  const after = (await api(learner, "GET", `/projects/${projectId}/memory`)).json.memory;
  const stored = after.decisions.find((d: { actor: string }) => d.actor === "director");
  expect(stored.decided_by).toBe("cr-director");
  expect(stored.evidence_refs).toHaveLength(1);
  expect(stored.affected_deck_slides).toEqual([2]);
  const draftExp = after.experiments.find((e: { id: string }) => e.id === stored.next_experiment_id);
  expect(draftExp.status).toBe("draft");
  record["CR-T48"] = { project: projectId, skill_headers: skillHeaders, decision: { id: stored.id, actor: stored.actor, decided_by: stored.decided_by, evidence_refs: stored.evidence_refs, review: stored.review, next_experiment_id: stored.next_experiment_id }, draft: { id: draftExp.id, status: draftExp.status, week: draftExp.week, question: draftExp.question }, chat_before: chatBefore };
});
