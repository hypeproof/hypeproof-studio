// cr-e2e (#1400) — the PRD §14 Week 1 → Week 2 loop (CR-71), CR-T66's scripted run, in the Studio APP.
//
// The fifteen steps of the §14 procedure (docs/testing/curriculum-runtime.md) in order, on the
// kiosk-practice app. Each step does what the student (or the participant) does, through the
// App's own commands and panels, and passes only when its record exists AND the next step reads
// that record through the product: an App panel, the Service API with the student's token, the
// workspace file the App wrote, or the Service's stored objects. Values the script remembers are
// used only to cross-check what the product answered, never in place of it.
//
// Evidence classes (MC-38): live-host for the App (a prepared copy of the shipped shell with this
// branch's extension and webview injected); synthetic for the Service account, its storage and the
// model (app-service.mjs with `publish`: the real Service router over SQLite D1 and an in-memory
// R2; the scripted coach answers only from what reached it); synthetic for steps 7–8 (Playwright
// Chromium as a 390 px phone, `*.test.invalid` resolved to this Mac). The live run with a real
// phone is Jay's (curriculum-runtime-dev.md, cr-e2e).
//
//   positive   all fifteen steps in order; one line per step with the record it read.
//              Step 15 is PARTIAL by definition until cr-deck stores proposals (CR-56): the
//              Deck Builder skill's proposal is checked (slides 2 and 3 only, with evidence),
//              nothing is stored.
//   negative   the same loop with a planted break after step 8: the participant session is
//              removed from the record behind its back (no tombstone), so the events never
//              reach the Evidence skill. The loop must stop at step 10.
//
// Needs an unlocked screen (recon F7): when locked the run is skipped as NOT RUN.
import { test, expect, chromium, devices, type Browser, type ElectronApplication, type FrameLocator, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type AppContext, chatFrame, closeApp, launchApp, runCommand } from "../fixtures/app";
import { PORT, Service, previewUrl, repo, screenLocked, send } from "./app-helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures/kiosk-practice");
const PREVIEW = "HypeProof: HTML 미리보기 (옆 패널)";
const PICK = "HypeProof: 화면에서 요소 골라 코치에게 묻기";
const RESULTS = "HypeProof: 실험 브라우저 결과 기록 보기";
const TEST = "HypeProof: 내 제품 테스트하기";
const PUBLISH = "HypeProof: 사용자 테스트용으로 공개하기";
const EVIDENCE = "HypeProof: 실험 증거 보기";
const SKILLS = "HypeProof: 커리큘럼 스킬";
const MEMORY = "HypeProof: 프로젝트 기억 보기";
const REVIEW = "HypeProof: 주간 리뷰";
const CRITERIA = ["주문 시작을 누르면 음료 고르기가 보인다", "주문하면 주문이 완료되었어요가 보인다", "주문하는 동안 오류가 없다"];
const HYPOTHESIS = "처음 쓰는 사람도 도움 없이 혼자 주문할 수 있다";
const NOTE = "음료 고르는 화면에서 한참 멈췄다가 친구에게 물어봤다";
const EDITED = "음료를 고르는 화면의 글씨가 작아 처음 쓰는 사람이 멈칫한다";
const DECISION = "음료와 수량을 한 화면에서 고르게 바꾼다";

const svc = new Service();
/** What the scripted model saw and did (app-service.mjs `state`), as this spec reads it. */
type LoopState = {
  requests: Array<{ tools: string[]; userText: string; images: number }>;
  observations: Array<{ is_error: boolean; url: string | null; route: string | null; viewport: string | null; generation: string | null; version: string | null; refs: number; buttons: string[]; screenshot: boolean }>;
  edits: Array<{ kind: string; element?: string }>;
  skills: Array<{ tag: string; cited?: string[]; patches?: Array<{ slide: number; evidence_refs: string[] }> }>;
};
const st = async (): Promise<LoopState> => (await svc.state()) as unknown as LoopState;
/** The Service's own identity-key rule (learning-events.ts IDENTITY_FIELD), applied to what it stored. */
const IDENTITY_KEY = /^(?:name|full_?name|first_?name|last_?name|nick_?name|user_?name|user|user_?id|e_?mail|email_?address|mail|phone|phone_?number|tel|telephone|mobile|address|ip|ip_?address|user_?agent|device_?id|fingerprint|birth_?date|birthday|age)$/i;
const identityKeys = (v: unknown, at = "$"): string[] =>
  v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [...(IDENTITY_KEY.test(k) ? [`${at}.${k}`] : []), ...identityKeys(x, `${at}.${k}`)]) : [];
let ctx: AppContext | undefined;
let phone: Browser | undefined;
const record: Record<string, unknown> = {};

test.beforeEach(() => {
  const locked = screenLocked();
  test.skip(locked !== false, `NOT RUN: the macOS screen is ${locked === null ? "in an unknown lock state (Quartz missing)" : "locked"}; the integrated browser paints no frames then (recon F7)`);
});
test.afterEach(async () => {
  await phone?.close().catch(() => undefined);
  phone = undefined;
  if (ctx) await closeApp(ctx);
  ctx = undefined;
  svc.stop();
});
test.afterAll(() => {
  const out = path.join(repo, "e2e/test-results/cr-app/loop-result.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
});

// ── the loop's plumbing ───────────────────────────────────────────────────────

type Verdict = "PASS" | "PARTIAL";
interface StepOut {
  /** What this step read of the previous step's record, and through what. */
  read: string;
  /** The record this step produced, by id. */
  record: string;
  verdict?: Verdict;
  note?: string;
}
interface Step {
  n: number;
  name: string;
  evidence: "live-host" | "synthetic" | "live-host App, synthetic model" | "live-host App, synthetic Service";
  run(L: Loop): Promise<StepOut>;
}
interface Line {
  step: number;
  name: string;
  verdict: Verdict | "FAIL" | "NOT RUN";
  evidence: string;
  read: string;
  record: string;
  note?: string;
  ms: number;
}

class Loop {
  lines: Line[] = [];
  failedAt: number | null = null;
  /** Cross-checks only: what earlier steps saw. Every step reads its input from the product. */
  seen: Record<string, unknown> = {};
  constructor(readonly app: ElectronApplication, readonly win: Page, readonly wsDir: string, readonly token: string) {}

  async api<T = any>(method: string, p: string, body?: unknown): Promise<{ status: number; json: T }> {
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/curriculum${p}`, { method, headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, json: (await r.json().catch(() => null)) as T };
  }
  /** The student's Project, as the Service lists it for their token (the App's own lookup). */
  async project(): Promise<any> {
    const list = await this.api<{ projects: Array<{ id: string }> }>("GET", "/projects");
    expect(list.status, "the student's projects").toBe(200);
    expect(list.json.projects.length, "exactly one Project for the team").toBe(1);
    const state = await this.api("GET", `/projects/${list.json.projects[0]!.id}`);
    expect(state.status).toBe(200);
    return state.json;
  }
  async memory(projectId: string): Promise<any> {
    const r = await this.api("GET", `/projects/${projectId}/memory`);
    expect(r.status, "the memory read").toBe(200);
    return r.json.memory;
  }
  async evidence(experimentId: string): Promise<any> {
    const r = await this.api("GET", `/experiments/${experimentId}/evidence`);
    expect(r.status, "the evidence read").toBe(200);
    return r.json.evidence;
  }
  /** The Service's stored objects of the Project's record (app-service control route; the bucket itself). */
  async records(projectId: string): Promise<Array<{ key: string; sha256: string; json: any }>> {
    const r = await fetch(`http://127.0.0.1:${PORT}/__cr/records?project=${encodeURIComponent(projectId)}`);
    return ((await r.json()) as { records: Array<{ key: string; sha256: string; json: any }> }).records;
  }
  /**
   * The chat surface that shows `selector` now. The host posts to every chat surface it has (the
   * "AI와 작업" editor and the sidebar view a panel command focuses, `ChatPanelProvider.post`), so
   * which one draws a panel first is not fixed; the student uses the one they see.
   */
  async showing(selector: string): Promise<FrameLocator | null> {
    await chatTabForward(this.win);
    const n = await this.win.locator("iframe.webview.ready").count();
    for (let i = 0; i < n; i++) {
      const f = this.win.frameLocator("iframe.webview.ready").nth(i).frameLocator("#active-frame");
      if (await f.locator(selector).first().isVisible().catch(() => false)) return f;
    }
    return null;
  }
  /** Run a command until the panel it opens is on screen (the first post can land before a fresh webview listens). */
  async panel(label: string, testid: string): Promise<FrameLocator> {
    let chat: FrameLocator | null = null;
    await expect
      .poll(
        async () => {
          await runCommand(this.win, label);
          await this.win.waitForTimeout(400);
          chat = await this.showing(`[data-testid="${testid}"]`);
          return chat !== null;
        },
        { timeout: 90_000, intervals: [1_500, 3_000, 5_000] },
      )
      .toBe(true);
    return chat!;
  }
  /** The version the App would publish now (the publish panel computes the R4 file set of the open page). */
  async appVersion(): Promise<{ id: string; files: string[]; verified: string }> {
    const chat = await this.panel(PUBLISH, "publish-panel");
    const v = chat.locator('[data-testid="publish-version"]');
    await expect(v).toHaveAttribute("data-version", /^sha256:[0-9a-f]{64}$/, { timeout: 20_000 });
    // The list sits in a closed <details>: read its text, not what is painted.
    const files = (await chat.locator('[data-testid="publish-files"] li').evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim().split(/\s+/)[0]!))).sort();
    return { id: (await v.getAttribute("data-version"))!, files, verified: (await chat.locator('[data-testid="publish-verified"]').getAttribute("data-state"))! };
  }
}

async function chatTabForward(win: Page): Promise<void> {
  const tab = win.locator(".tabs-container .tab", { hasText: "AI와 작업" }).first();
  if ((await tab.count()) > 0) await tab.click().catch(() => undefined);
}

/** Wait until the coach's turn is over: the composer is idle again (its idle placeholder). */
async function turnOver(win: Page): Promise<void> {
  const chat = await chatFrame(win);
  await expect(chat.locator('textarea[placeholder^="메시지를 입력"]').first()).toBeEditable({ timeout: 120_000 });
}

/** Quick-pick rows a command shows, then close the list. */
async function quickPickRows(win: Page, label: string): Promise<string[]> {
  await runCommand(win, label);
  const rows = win.locator(".quick-input-list .monaco-list-row");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const texts = (await rows.allInnerTexts()).map((r) => r.replace(/\s+/g, " ").trim());
  await win.keyboard.press("Escape");
  return texts;
}

const short = (id: string) => id.replace(/^sha256:/, "").slice(0, 12);

// ── the fifteen steps ─────────────────────────────────────────────────────────

const STEPS: Step[] = [
  {
    n: 1,
    name: "open v0 of the kiosk-practice HTML app",
    evidence: "live-host",
    async run(L) {
      const { win, app } = L;
      await win.locator(".monaco-workbench .part.titlebar").first().click({ position: { x: 10, y: 10 }, force: true });
      await win.keyboard.press("Meta+P");
      await win.locator(".quick-input-widget input.input").first().fill("index.html");
      await win.waitForTimeout(600);
      await win.keyboard.press("Enter");
      await win.waitForTimeout(800);
      await runCommand(win, PREVIEW);
      await expect.poll(() => previewUrl(app), { timeout: 30_000 }).not.toBeNull();
      const v0 = await L.appVersion();
      expect(v0.files, "v0 is the page and the two files it loads").toEqual(["app.js", "index.html", "style.css"]);
      L.seen.v0 = v0.id;
      return { read: "-", record: `artifact version v0 ${short(v0.id)} (${v0.files.join(", ")}), as the App computes it for the open page` };
    },
  },
  {
    n: 2,
    name: "v0 runs in the Experiment Browser",
    evidence: "live-host App, synthetic model",
    async run(L) {
      const before = (await st()).observations?.length ?? 0;
      await send(L.win, "[cr:observe] 지금 미리보기 화면을 봐 줘");
      await expect.poll(async () => (await st()).observations?.length ?? 0, { timeout: 120_000 }).toBeGreaterThan(before);
      await turnOver(L.win);
      const o = (await st()).observations!.at(-1)!;
      // The record step 1 made, read again from the App: the observation must be bound to it.
      const v = await L.appVersion();
      expect(o.is_error, "the observation is a result, not an error").toBe(false);
      expect(o.version, "the observation names the App's current version (v0)").toBe(v.id);
      expect(v.id, "cross-check: still step 1's v0").toBe(L.seen.v0);
      expect(o.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(o.route).toBeTruthy();
      expect(o.viewport).toMatch(/^\d+x\d+$/);
      expect(o.generation).toBeTruthy();
      // The kiosk's first screen: three buttons, each with its ref (the menu is still hidden).
      expect([...o.buttons].sort(), "a semantic snapshot with the first screen's buttons and their refs").toEqual(["도움말 보기", "주문 시작", "큰 글씨로 보기"].sort());
      expect(o.screenshot, "the screenshot rides with the observation").toBe(true);
      // The App's own store: the result is listed as taken on the current version.
      const rows = await quickPickRows(L.win, RESULTS);
      expect(rows.some((r) => r.includes("현재 버전")), `the stored result reads 현재 버전 (${JSON.stringify(rows.slice(0, 3))})`).toBe(true);
      return { read: `App version ${short(v.id)} (publish panel)`, record: `observation of ${o.url} · ${o.viewport} · generation ${o.generation} · ${o.refs} refs · screenshot · bound to ${short(o.version ?? "")}; stored result "현재 버전"` };
    },
  },
  {
    n: 3,
    name: "select one rendered element and request an AI edit",
    evidence: "live-host App, synthetic model",
    async run(L) {
      const { app, win } = L;
      const origin = new URL((await previewUrl(app))!).origin;
      await chatTabForward(win);
      await runCommand(win, PICK);
      await win.waitForTimeout(900);
      await app.evaluate(async ({ webContents }, o) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`${o}/`))!;
        const [x, y] = await wc.executeJavaScript(`(() => { const r = document.getElementById("begin").getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
        wc.sendInputEvent({ type: "mouseMove", x, y });
        wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
        wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      }, origin);
      let chat: FrameLocator | null = null;
      await expect.poll(async () => (chat = await L.showing('[data-testid="element-context"]')) !== null, { timeout: 20_000 }).toBe(true);
      const sent = (await chat!.locator('[data-testid="element-context-sent"]').textContent())!.trim();
      // The record step 2 made (the observed version): the payload is bound to it.
      const v0 = await L.appVersion();
      expect(sent, "the payload names the version the observation was bound to").toContain(`산출물 버전: ${v0.id}`);
      expect(sent).toMatch(/소스 위치: index\.html:\d+/);
      const before = (await st()).requests.length;
      const edits = (await st()).edits?.length ?? 0;
      await send(win, "[cr:edit] 이 버튼을 어르신도 잘 보이게 더 크게 해 줘");
      await expect.poll(async () => (await st()).edits?.length ?? 0, { timeout: 120_000 }).toBeGreaterThan(edits);
      const asked = (await st()).requests[before]!;
      expect(asked.userText.startsWith(sent.slice(0, 40)), "the coach received exactly the payload the student saw").toBe(true);
      expect(asked.images, "with the element's crop").toBeGreaterThan(0);
      await turnOver(win);
      // The App wrote the coach's page to the workspace; the version changed.
      await expect.poll(() => fs.readFileSync(path.join(L.wsDir, "index.html"), "utf8").includes('id="begin" type="button" class="big"'), { timeout: 30_000 }).toBe(true);
      // The panel recomputes the version when it opens; wait for the edited files to be read.
      await expect.poll(async () => (await L.appVersion()).id, { timeout: 30_000, message: "the edit is a new version v0′" }).not.toBe(v0.id);
      const v1 = await L.appVersion();
      L.seen.v0prime = v1.id;
      return { read: `element payload bound to ${short(v0.id)} (chip text the coach received)`, record: `edited index.html (#begin class="big") = version v0′ ${short(v1.id)}` };
    },
  },
  {
    n: 4,
    name: "define three observable acceptance criteria",
    evidence: "live-host App, synthetic model",
    async run(L) {
      const chat = await L.panel(TEST, "verify-panel");
      // The record step 3 made: v0′ has never been tested.
      await expect(chat.locator('[data-testid="verify-status"]')).toHaveAttribute("data-state", "not_verified", { timeout: 20_000 });
      const inputs = chat.locator('[data-testid="verify-criterion-input"]');
      for (let i = 0; i < CRITERIA.length; i++) {
        if ((await inputs.count()) <= i) await chat.getByRole("button", { name: "조건 더하기" }).click();
        await inputs.nth(i).fill(CRITERIA[i]!);
      }
      await chat.locator('[data-testid="verify-start"]').click();
      const report = chat.locator('[data-testid="verify-report"]');
      await expect(report).toBeVisible({ timeout: 180_000 });
      const v = await report.getAttribute("data-version");
      const rows = chat.locator('[data-testid="verify-result"]');
      await expect(rows).toHaveCount(3, { timeout: 180_000 });
      const texts = await rows.allInnerTexts();
      for (const c of CRITERIA) expect(texts.some((t) => t.includes(c)), `criterion "${c}" is the student's own`).toBe(true);
      await expect(chat.locator('[data-testid="verify-ai-badge"]'), "no criterion is a coach proposal").toHaveCount(0);
      expect(v, "the criteria were set on v0′").toBe(L.seen.v0prime);
      const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-criterion")));
      return { read: `v0′ ${short(v!)} untested (verify panel)`, record: `3 criterion_set events (${ids.map((x) => String(x).slice(0, 8)).join(", ")}), student actor, on ${short(v!)}` };
    },
  },
  {
    n: 5,
    name: "AI Verify runs the criteria",
    evidence: "live-host App, synthetic model",
    async run(L) {
      const chat = (await L.showing('[data-testid="verify-report"]')) ?? (await L.panel(TEST, "verify-panel"));
      await expect(chat.locator('[data-testid="verify-running"]')).toHaveCount(0, { timeout: 180_000 });
      // The first run on a freshly opened preview can read its page log as started late and leave
      // one criterion "확인 안 됨" (pre-existing, cr-verify follow-up); the student re-tests.
      let retests = 0;
      const first = await chat.locator('[data-testid="verify-result"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
      for (let attempt = 0; attempt < 2; attempt++) {
        if ((await chat.locator('[data-testid="verify-status"]').getAttribute("data-state")) === "verified") break;
        retests++;
        const run = await chat.locator('[data-testid="verify-report"]').getAttribute("data-run");
        await chat.locator('[data-testid="verify-retest"]').click();
        await expect.poll(async () => chat.locator('[data-testid="verify-report"]').getAttribute("data-run"), { timeout: 180_000 }).not.toBe(run);
        await expect(chat.locator('[data-testid="verify-running"]')).toHaveCount(0, { timeout: 180_000 });
      }
      await expect(chat.locator('[data-testid="verify-status"]')).toHaveAttribute("data-state", "verified", { timeout: 30_000 });
      const report = chat.locator('[data-testid="verify-report"]');
      const runId = (await report.getAttribute("data-run"))!;
      const version = (await report.getAttribute("data-version"))!;
      // The record step 4 made: the same three criteria, now with verdicts and steps.
      const rows = chat.locator('[data-testid="verify-result"]');
      const statuses = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
      expect(statuses, "every criterion passed").toEqual(["pass", "pass", "pass"]);
      for (const c of CRITERIA) expect((await rows.allInnerTexts()).some((t) => t.includes(c))).toBe(true);
      expect(await rows.locator("details ol li").count(), "each verdict lists the steps the runner took").toBeGreaterThanOrEqual(3);
      expect(version).toBe(L.seen.v0prime);
      L.seen.run = runId;
      return { read: "the 3 criteria of step 4 (report rows)", record: `hps-verification/1 run ${runId.slice(0, 12)} on ${short(version)}: pass ×3, verified (first run ${first.join("/")}, ${retests} re-test${retests === 1 ? "" : "s"})` };
    },
  },
  {
    n: 6,
    name: "publish the verified version and start the test",
    evidence: "live-host App, synthetic Service",
    async run(L) {
      const chat = await L.panel(PUBLISH, "publish-panel");
      // The record step 5 made: the App reads it as verified, for this exact version (CR-81).
      await expect(chat.locator('[data-testid="publish-verified"]')).toHaveAttribute("data-state", "verified", { timeout: 20_000 });
      const version = (await chat.locator('[data-testid="publish-version"]').getAttribute("data-version"))!;
      expect(version).toBe(L.seen.v0prime);
      const form = chat.locator('[data-testid="publish-form"]');
      await form.locator('textarea[aria-label="가설"]').fill(HYPOTHESIS);
      await form.locator('input[aria-label="질문"]').fill("도움 없이 주문을 마칠 수 있나?");
      await form.locator('textarea[aria-label="성공 기준"]').fill("5명 중 3명이 도움 없이 주문 완료");
      await form.locator('input[aria-label="채널"]').fill("학교 게시판");
      await chat.locator('[data-testid="publish-expiry-3"]').check();
      const t0 = Date.now();
      await chat.locator('[data-testid="publish-submit"]').click();
      const shareLine = chat.locator('[data-testid="publish-share-url"]');
      await expect(shareLine).toBeVisible({ timeout: 30_000 });
      L.seen.publishMs = Date.now() - t0;
      L.seen.publishedAt = Date.now();
      await expect(chat.locator('[data-testid="publish-qr"]').first(), "the link has its QR code").toBeVisible();
      // What the Service stored, read with the student's token.
      const s = await L.project();
      const v = s.versions.find((x: { id: string }) => x.id === version);
      expect(v, "the test version is keyed by v0′'s digest").toBeTruthy();
      expect(v.verification_report, "the version carries the step 5 report").toBe(L.seen.run);
      expect(s.experiments).toHaveLength(1);
      const exp = s.experiments[0];
      expect(exp.product_version_id, "the experiment is pinned to v0′").toBe(version);
      expect(exp.status).toBe("running");
      const h = s.hypotheses.find((x: { id: string }) => x.id === exp.hypothesis_id);
      expect(h?.statement, "its hypothesis_id names the hypothesis stored with it").toBe(HYPOTHESIS);
      const link = s.links.find((l: { experiment_id: string }) => l.experiment_id === exp.id);
      expect(link?.share_url, "the panel shows the Service's share URL").toBe((await shareLine.locator("code").innerText()).trim());
      L.seen.project = s.project.id;
      return { read: `verified ${short(version)}, run ${String(L.seen.run).slice(0, 12)} (publish panel)`, record: `project ${s.project.id} · version ${short(version)} (report attached) · experiment ${exp.id} → hypothesis ${h.id} · link ${link.id} + QR` };
    },
  },
  {
    n: 7,
    name: "a participant opens the link from a phone",
    evidence: "synthetic",
    async run(L) {
      // The record step 6 made: the share URL, read from the panel the student sees.
      const chat = await L.panel(PUBLISH, "publish-panel");
      const shareUrl = (await chat.locator('[data-testid="publish-link-url"]').first().innerText()).trim();
      const origin = new URL(shareUrl).origin;
      phone = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP *.test.invalid 127.0.0.1", `--unsafely-treat-insecure-origin-as-secure=${origin}`] });
      const context = await phone.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const t0 = Date.now();
      await page.goto(shareUrl);
      await expect(page.getByRole("heading", { name: "어르신도 쉬운 키오스크" })).toBeVisible({ timeout: 30_000 });
      const renderMs = Date.now() - t0;
      expect(await page.evaluate(() => innerWidth), "a 390 px phone viewport").toBe(390);
      await expect(page.locator('input[type="password"]'), "no login").toHaveCount(0);
      const sessionId = await page.evaluate(() => (window as unknown as { hypeproof?: { test?: { session_id?: string } } }).hypeproof?.test?.session_id ?? null);
      expect(sessionId, "the page's snippet holds a participant session").toMatch(/^ps-/);
      L.seen.phonePage = page;
      // The Service opened that session (the evidence read lists it).
      const exp = (await L.project()).experiments[0];
      await expect.poll(async () => (await L.evidence(exp.id)).sessions.map((x: { session_id: string }) => x.session_id), { timeout: 20_000 }).toContain(sessionId);
      L.seen.session = sessionId;
      record["CR-20-synthetic"] = { publish_click_to_share_url_ms: L.seen.publishMs, share_url_to_first_render_ms: renderMs, note: "Chromium on this Mac as a 390 px phone; not a real phone, not CR-T20" };
      return { read: `share URL ${shareUrl} (publish panel)`, record: `first render at 390 px in ${renderMs} ms · participant session ${sessionId}` };
    },
  },
  {
    n: 8,
    name: "Studio records the anonymous session and events",
    evidence: "synthetic",
    async run(L) {
      const page = L.seen.phonePage as Page;
      await page.getByRole("button", { name: "주문 시작" }).click();
      await page.getByLabel("음료 고르기").selectOption("tea");
      await page.getByRole("button", { name: "수량 늘리기" }).click();
      await page.getByRole("button", { name: "장바구니에 담기" }).click();
      await page.getByRole("button", { name: "주문하기" }).click();
      await expect(page.getByRole("heading", { name: "주문이 완료되었어요" })).toBeVisible();
      // The record step 7 made: that session, now with the participant's events.
      const s = await L.project();
      const exp = s.experiments[0];
      let session: any = null;
      await expect
        .poll(async () => {
          session = (await L.evidence(exp.id)).sessions.find((x: { session_id: string }) => x.session_id === L.seen.session) ?? null;
          return session?.clicks ?? 0;
        }, { timeout: 30_000 })
        .toBeGreaterThanOrEqual(4);
      expect(session.pseudonym, "an anonymous pseudonym").toMatch(/^pp-[0-9a-f]{32}$/);
      expect(session.product_version, "attributed to the version under test").toBe(exp.product_version_id);
      expect(session.channel).toBe("학교 게시판");
      // The stored events themselves: source_state real, the session's attribution, no identity field.
      const events = (await L.records(s.project.id)).filter((r) => r.key.startsWith(`observations/published/${exp.id}/${L.seen.session}/`) && r.json);
      expect(events.length, "the participant's events are on the record").toBeGreaterThanOrEqual(session.events);
      // Each object is the record's observation envelope (local-record.ts `ObservationRecord`); the event is inside.
      const evs = events.map((r) => r.json.event).filter(Boolean);
      expect(evs.length, "every stored object holds one participant event").toBe(events.length);
      for (const e of evs) {
        expect(e.source_state, "recorded from a served session").toBe("real");
        expect(e.attribution?.project).toBe(s.project.id);
        expect(e.attribution?.experiment).toBe(exp.id);
        expect(e.attribution?.product_version).toBe(exp.product_version_id);
        expect(identityKeys(e), "no identity-like key at any depth").toEqual([]);
      }
      return { read: `participant session ${L.seen.session} (evidence read)`, record: `${session.events} events (${session.pages} page views, ${session.clicks} clicks) · pseudonym ${session.pseudonym.slice(0, 9)}… · version ${short(session.product_version)} · source_state real` };
    },
  },
  {
    n: 9,
    name: "add one manual observation",
    evidence: "live-host App, synthetic Service",
    async run(L) {
      const chat = await L.panel(EVIDENCE, "evidence-panel");
      // The record step 6 made: the running experiment, as the panel lists it.
      const s = await L.project();
      const exp = s.experiments[0];
      await expect(chat.locator('[data-testid="evidence-experiment"]')).toHaveValue(exp.id, { timeout: 20_000 });
      await chat.locator('[data-testid="evidence-note-form"] summary').click();
      const form = chat.locator('[data-testid="evidence-note-form"]');
      await form.locator('select[aria-label="기록 종류"]').selectOption("observer_note");
      await form.locator('textarea[aria-label="내용"]').fill(NOTE);
      await form.locator('input[aria-label="누가"]').fill("관찰자 지민");
      await form.locator('input[aria-label="언제"]').fill("1주차 수업 2교시");
      await form.locator('input[aria-label="어떤 상황"]').fill("교실 키오스크 앞, 처음 써 보는 친구");
      await form.getByRole("radio", { name: "실제로 있었던 일", exact: true }).check();
      await chat.locator('[data-testid="evidence-note-save"]').click();
      let note: any = null;
      await expect.poll(async () => {
        note = (await L.evidence(exp.id)).notes.find((n: { text?: string }) => n.text === NOTE) ?? null;
        return !!note;
      }, { timeout: 20_000 }).toBe(true);
      expect(note.source_state).toBe("real");
      expect(note.note_kind).toBe("observer_note");
      expect(JSON.stringify(note.provenance ?? {})).toMatch(/관찰자 지민/);
      L.seen.note = note.id;
      return { read: `experiment ${exp.id} (evidence panel)`, record: `observer note ${note.id} · provenance who/when/where · source_state real` };
    },
  },
  {
    n: 10,
    name: "the Evidence skill drafts Observation / Interpretation / Assumption",
    evidence: "live-host App, synthetic model",
    async run(L) {
      const s = await L.project();
      const exp = s.experiments[0];
      const chat = await L.panel(SKILLS, "skills-panel");
      await chat.locator('[data-testid="skill-evidence"]').check();
      await chat.locator('select[aria-label="정리할 실험"]').selectOption(exp.id);
      await chat.locator('[data-testid="skill-run"]').click();
      const result = chat.locator('[data-testid="skill-result"]');
      await expect(result).toHaveAttribute("data-ok", "true", { timeout: 120_000 });
      await expect(result).toHaveAttribute("data-tag", /^evidence@/);
      await expect(chat.locator('[data-testid="skill-written"]')).toHaveCount(1);
      // The records steps 8 and 9 made must reach the draft: its observations cite them.
      const ev = await L.evidence(exp.id);
      const draft = [...ev.drafts].reverse().find((d: { author?: string; revision: number }) => d.author === "ai" && d.revision === 1);
      expect(draft, "an AI evidence draft is stored").toBeTruthy();
      expect(draft.skill).toMatch(/^evidence@/);
      const observed = draft.items.filter((i: { section: string }) => i.section === "observation");
      const cites = observed.flatMap((i: { source_refs: string[] }) => i.source_refs);
      const sessionCited = cites.some((r: string) => r === `session:${L.seen.session}` || r.startsWith(`event:${L.seen.session}/`));
      expect(sessionCited, `the draft's observations cite the step 8 participant session (cited: ${JSON.stringify(cites)})`).toBe(true);
      expect(cites, "and the step 9 note").toContain(`note:${L.seen.note}`);
      expect(draft.items.some((i: { section: string }) => i.section === "interpretation")).toBe(true);
      expect(draft.items.some((i: { section: string }) => i.section === "assumption")).toBe(true);
      for (const i of observed) expect(i.sources.every((x: { state: string }) => x.state === "ok"), "every cited record resolves").toBe(true);
      L.seen.draft = draft.id;
      return { read: `session ${L.seen.session} and note ${L.seen.note} (the draft's source refs)`, record: `AI draft ${draft.id}@1: ${observed.length} observed, 1 interpretation, 1 assumption, 1 next experiment` };
    },
  },
  {
    n: 11,
    name: "accept or edit the interpretation",
    evidence: "live-host App, synthetic Service",
    async run(L) {
      const s = await L.project();
      const exp = s.experiments[0];
      const raw = async () => (await L.records(s.project.id)).filter((r) => r.key.startsWith("observations/") || r.key.startsWith("sessions/")).map((r) => `${r.key} ${r.sha256}`);
      const rawBefore = await raw();
      const chat = await L.panel(EVIDENCE, "evidence-panel");
      // The record step 10 made: the AI draft, waiting for review.
      const draftBox = chat.locator(`[data-testid="evidence-draft"][data-draft="${L.seen.draft}"]`);
      await expect(draftBox).toBeVisible({ timeout: 20_000 });
      const act = async (section: string, action: "accept" | "edit") => {
        const box = chat.locator(`[data-testid="evidence-draft"][data-draft="${L.seen.draft}"]`);
        const rev = Number(await box.getAttribute("data-revision"));
        const item = box.locator(`[data-testid="evidence-item"][data-section="${section}"][data-review="draft"]`).first();
        if (action === "accept") await item.locator('[data-testid="evidence-accept"]').click();
        else {
          await item.locator('[data-testid="evidence-edit"]').click();
          await item.locator('textarea[aria-label="고친 문장"]').fill(EDITED);
          await item.getByRole("button", { name: "저장" }).click();
        }
        await expect(box).toHaveAttribute("data-revision", String(rev + 1), { timeout: 20_000 });
      };
      while ((await draftBox.locator('[data-testid="evidence-item"][data-section="observation"][data-review="draft"]').count()) > 0) await act("observation", "accept");
      await act("interpretation", "edit");
      await act("assumption", "accept");
      const ev = await L.evidence(exp.id);
      const latest = ev.drafts.filter((d: { id: string }) => d.id === L.seen.draft).at(-1);
      const interp = latest.items.find((i: { section: string }) => i.section === "interpretation");
      expect(interp.text, "the student's wording").toBe(EDITED);
      expect(interp.review).toBe("edited");
      expect(latest.items.filter((i: { section: string; review: string }) => i.section === "observation").every((i: { review: string }) => i.review === "accepted")).toBe(true);
      expect(await raw(), "no raw participant event, session or note changed a byte").toEqual(rawBefore);
      return { read: `AI draft ${L.seen.draft}@1 (evidence panel)`, record: `draft ${L.seen.draft}@${latest.revision}: observations accepted, interpretation edited, assumption accepted · ${rawBefore.length} raw objects unchanged` };
    },
  },
  {
    n: 12,
    name: "Venture Memory stores hypothesis, experiment, evidence and decision",
    evidence: "live-host App, synthetic Service",
    async run(L) {
      const projectId = String(L.seen.project);
      const chat = await L.panel(MEMORY, "memory-panel");
      // The records steps 10–11 made: reviewed evidence items, offered as a decision's grounds.
      const m0 = await L.memory(projectId);
      const usable = m0.evidence_items.filter((i: { id: string; confidence: string; pending_review: boolean }) => i.id.includes(`/${L.seen.draft}/`) && i.confidence !== "assumed" && !i.pending_review);
      expect(usable.length, "the reviewed observations and the edited interpretation are evidence now").toBeGreaterThanOrEqual(3);
      await chat.locator('[data-testid="memory-decision-form"] summary').click();
      const form = chat.locator('[data-testid="memory-decision-form"]');
      await form.locator('textarea[aria-label="결정"]').fill(DECISION);
      for (const it of usable) await form.locator(`[data-testid="memory-item"][data-ref="${it.id}"] input[aria-label="근거로 고르기"]`).check();
      for (const n of ["2", "3"]) await form.getByRole("checkbox", { name: n, exact: true }).check();
      await chat.locator('[data-testid="memory-decide"]').click();
      const line = chat.locator('[data-testid="memory-decision"]');
      await expect(line).toHaveCount(1, { timeout: 20_000 });
      const decisionId = (await line.getAttribute("data-id"))!;
      const m = await L.memory(projectId);
      expect(m.hypotheses, "no second hypothesis").toHaveLength(1);
      expect(m.experiments, "no second experiment").toHaveLength(1);
      const d = m.decisions.find((x: { id: string }) => x.id === decisionId);
      expect(d.actor, "the team's own decision").toBe("student");
      expect([...d.evidence_refs].sort()).toEqual(usable.map((i: { id: string }) => i.id).sort());
      expect(d.affected_deck_slides).toEqual([2, 3]);
      // The chain: the step 6 hypothesis → the step 6 experiment → the evidence → this decision.
      const exp = m.experiments[0];
      expect(d.evidence_refs.every((r: string) => r.startsWith(`ev:${exp.id}/`)), "every ground is an item of the step 6 experiment").toBe(true);
      expect(m.hypotheses[0].id).toBe(exp.hypothesis_id);
      L.seen.decision = decisionId;
      return { read: `${usable.length} reviewed evidence items of draft ${L.seen.draft} (memory read)`, record: `team decision ${decisionId} on ${d.evidence_refs.length} evidence items, slides 2, 3 · hypothesis ${exp.hypothesis_id} → experiment ${exp.id} unchanged` };
    },
  },
  {
    n: 13,
    name: "produce v1",
    evidence: "live-host App, synthetic model",
    async run(L) {
      const projectId = String(L.seen.project);
      // The record step 12 made: the decision, with no version yet.
      const d0 = (await L.memory(projectId)).decisions.find((x: { id: string }) => x.id === L.seen.decision);
      expect(d0.resulting_version_id, "no version made yet").toBeNull();
      const edits = (await st()).edits?.length ?? 0;
      await send(L.win, `[cr:apply] 결정대로 고쳐 줘: ${d0.statement}`);
      await expect.poll(async () => (await st()).edits?.length ?? 0, { timeout: 120_000 }).toBeGreaterThan(edits);
      await turnOver(L.win);
      await expect.poll(() => fs.readFileSync(path.join(L.wsDir, "index.html"), "utf8").includes("음료와 수량을 이 화면에서 한 번에 골라요"), { timeout: 30_000 }).toBe(true);
      await expect.poll(async () => (await L.appVersion()).id, { timeout: 30_000, message: "v1 is a new version" }).not.toBe(L.seen.v0prime);
      const v1 = await L.appVersion();
      // Register v1 with the App's own set builder and upload, and name it on the decision
      // (register-version.mjs: no panel offers a version without starting a test of it).
      const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(here, "register-version.mjs"), `http://127.0.0.1:${PORT}/v1`, process.env.HPS_E2E_TOKEN_FILE!, projectId, L.wsDir, "--link-decision", String(L.seen.decision)], { cwd: repo, encoding: "utf8" });
      const up = JSON.parse(out.trim().split("\n").at(-1)!);
      expect(up.ok, out).toBe(true);
      expect(up.version, "the uploaded set is the App's v1").toBe(v1.id);
      expect(up.decision).toBe(L.seen.decision);
      const m = await L.memory(projectId);
      expect(m.versions.map((v: { id: string }) => v.id)).toEqual([L.seen.v0prime, v1.id]);
      expect(m.decisions.find((x: { id: string }) => x.id === L.seen.decision).resulting_version_id, "the decision names v1").toBe(v1.id);
      const chat = await L.panel(MEMORY, "memory-panel");
      await expect(chat.locator(`[data-testid="memory-decision"][data-id="${L.seen.decision}"]`)).toContainText(`버전 ${v1.id.replace(/^sha256:/, "").slice(0, 8)}`);
      L.seen.v1 = v1.id;
      return { read: `decision ${L.seen.decision} (memory read)`, record: `v1 ${short(v1.id)} written by the coach, registered (created ${up.created}), named by the decision's resulting_version_id` };
    },
  },
  {
    n: 14,
    name: "the Weekly Review shows v0 → test → evidence → decision → v1",
    evidence: "live-host App, synthetic model",
    async run(L) {
      const projectId = String(L.seen.project);
      const chat = await L.panel(REVIEW, "review-panel");
      await expect(chat.locator('[data-testid="review-panel"]')).toHaveAttribute("data-mode", "student");
      await chat.locator('[data-testid="review-prepare"]').click();
      await expect(chat.locator('[data-testid="review-status"]')).toHaveAttribute("data-status", "fresh", { timeout: 120_000 });
      await expect(chat.locator('[data-testid="review-section"]')).toHaveCount(10);
      // The records of steps 5–13, as the cached pack links them (the Service's open, no model call).
      const calls = (await st()).requests.length;
      const open = await L.api("GET", `/projects/${projectId}/review`);
      expect(open.status).toBe(200);
      const review = open.json.review ?? open.json;
      expect(review.status).toBe("fresh");
      const section = (id: string) => review.pack.sections.find((x: { id: string }) => x.id === id);
      const sources = (id: string) => section(id).items.flatMap((i: { sources: string[] }) => i.sources);
      const m = await L.memory(projectId);
      const exp = m.experiments[0];
      expect(sources("experiment"), "the test (step 6) and the version it pinned").toEqual(expect.arrayContaining([`experiment:${exp.id}`, `version:${L.seen.v0prime}`]));
      expect(m.versions.find((v: { id: string }) => v.id === L.seen.v0prime).verification_report, "the tested version carries the step 5 report").toBe(L.seen.run);
      const observedRefs = sources("observed");
      expect(observedRefs.length).toBeGreaterThan(0);
      expect(observedRefs.every((r: string) => r.startsWith(`ev:${exp.id}/${L.seen.draft}/`)), "observed claims are the step 10–11 items").toBe(true);
      expect(section("interpretation").items.map((i: { text: string }) => i.text)).toContain(EDITED);
      const product = section("product_change").items;
      expect(product.some((i: { sources: string[] }) => i.sources.includes(`version:${L.seen.v0prime}`)), "v0′ as the version the week tested").toBe(true);
      expect(product.some((i: { sources: string[] }) => i.sources.includes(`version:${L.seen.v1}`)), "v1 as the new version").toBe(true);
      expect(product.some((i: { sources: string[] }) => i.sources.includes(`decision:${L.seen.decision}`) && i.sources.includes(`version:${L.seen.v1}`)), "the decision that made v1").toBe(true);
      expect(sources("deck_slides")).toContain(`decision:${L.seen.decision}`);
      for (const ref of Object.keys(review.sources ?? {})) expect(review.sources[ref].found, `${ref} resolves`).toBe(true);
      // CR-50: reopening the cached pack calls no model.
      const reopened = await L.panel(REVIEW, "review-panel");
      await expect(reopened.locator('[data-testid="review-status"]')).toHaveAttribute("data-status", "fresh", { timeout: 20_000 });
      expect((await st()).requests.length, "opening the pack asked no model").toBe(calls);
      return { read: "steps 5–13 records (pack sources resolved)", record: `pack week ${review.week} rev ${review.pack.revision}: v0′ ${short(String(L.seen.v0prime))} tested → ${observedRefs.length} observed → decision ${L.seen.decision} → v1 ${short(String(L.seen.v1))}; reopened with 0 model calls` };
    },
  },
  {
    n: 15,
    name: "the Deck Builder proposes changes to the relevant slides only",
    evidence: "live-host App, synthetic model",
    async run(L) {
      const chat = await L.panel(SKILLS, "skills-panel");
      await chat.locator('[data-testid="skill-deck-builder"]').check();
      // The record step 12 made: the team's decision on slides 2 and 3, offered by the panel.
      await chat.locator('select[aria-label="팀의 결정"]').selectOption(String(L.seen.decision));
      await chat.locator('[data-testid="skill-run"]').click();
      const result = chat.locator('[data-testid="skill-result"]');
      await expect(result).toHaveAttribute("data-tag", /^deck-builder@/, { timeout: 120_000 });
      await expect(result).toHaveAttribute("data-ok", "true");
      const skill = (await st()).skills.at(-1) as unknown as { tag: string; patches?: Array<{ slide: number; evidence_refs: string[] }> };
      expect(skill.tag).toMatch(/^deck-builder@/);
      expect(skill.patches?.map((p) => p.slide), "patches for the decision's slides only").toEqual([2, 3]);
      for (const p of skill.patches ?? []) expect(p.evidence_refs.length, `slide ${p.slide} cites evidence`).toBeGreaterThan(0);
      await expect(chat.locator('[data-testid="skill-written"]'), "nothing is stored: cr-deck stores and accepts proposals (CR-56)").toHaveCount(0);
      return { read: `decision ${L.seen.decision} (skills panel)`, record: "slide patch proposals for slides 2 and 3 with evidence refs, accepted by the Service's gate; not stored", verdict: "PARTIAL", note: "CR-56 (stored proposals, accept/reject, pending in the pack) waits for cr-deck" };
    },
  },
];

async function runLoop(plantAfter: number | null): Promise<Loop> {
  await svc.start(true, "publish");
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" } });
  fs.cpSync(FIXTURE, ctx.wsDir, { recursive: true });
  await send(ctx.win, "안녕");
  await expect.poll(async () => (await st()).requests.length, { timeout: 60_000 }).toBeGreaterThan(0);
  const L = new Loop(ctx.app, ctx.win, ctx.wsDir, fs.readFileSync(process.env.HPS_E2E_TOKEN_FILE!, "utf8").trim());
  for (const step of STEPS) {
    if (L.failedAt !== null) {
      L.lines.push({ step: step.n, name: step.name, verdict: "NOT RUN", evidence: step.evidence, read: "-", record: "-", note: `stopped at step ${L.failedAt}`, ms: 0 });
      continue;
    }
    if (plantAfter !== null && step.n === plantAfter + 1) {
      // Planted break: the participant session disappears from the record behind its back.
      const planted = await (await fetch(`http://127.0.0.1:${PORT}/__cr/plant-dangling`, { method: "POST", body: JSON.stringify({ project: L.seen.project, session: L.seen.session }) })).json();
      L.lines.push({ step: plantAfter, name: "PLANTED: the participant session removed from the record (no tombstone)", verdict: planted.removed ? "PASS" : "FAIL", evidence: "synthetic", read: "-", record: JSON.stringify(planted), ms: 0 });
    }
    const t0 = Date.now();
    try {
      const out = await step.run(L);
      const line: Line = { step: step.n, name: step.name, verdict: out.verdict ?? "PASS", evidence: step.evidence, read: out.read, record: out.record, ...(out.note ? { note: out.note } : {}), ms: Date.now() - t0 };
      L.lines.push(line);
      console.log(`§14 step ${step.n} ${line.verdict} · read ${line.read} · record ${line.record}`);
    } catch (e) {
      L.failedAt = step.n;
      // eslint-disable-next-line no-control-regex
      const message = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 24).join(" | ");
      L.lines.push({ step: step.n, name: step.name, verdict: "FAIL", evidence: step.evidence, read: "-", record: "-", note: message, ms: Date.now() - t0 });
      console.log(`§14 step ${step.n} FAIL · ${message}`);
    }
  }
  return L;
}

test("CR-T66 scripted run: the fifteen §14 steps in order, each reading the previous step's record", async () => {
  test.setTimeout(1_500_000);
  const L = await runLoop(null);
  record["positive"] = { failed_at: L.failedAt, steps: L.lines };
  expect(L.failedAt, `the loop stopped at step ${L.failedAt}: ${JSON.stringify(L.lines.find((l) => l.verdict === "FAIL"))}`).toBeNull();
  expect(L.lines.map((l) => l.verdict)).toEqual([...Array(14).fill("PASS"), "PARTIAL"]);
});

test("CR-T66 negative: a planted break between steps 8 and 10 (events not reaching the Evidence skill) stops the loop at step 10", async () => {
  test.setTimeout(1_200_000);
  const L = await runLoop(8);
  record["planted"] = { failed_at: L.failedAt, steps: L.lines };
  expect(L.lines.find((l) => l.name.startsWith("PLANTED"))?.verdict, "the plant took effect").toBe("PASS");
  expect(L.lines.filter((l) => l.step <= 9 && !l.name.startsWith("PLANTED")).map((l) => l.verdict), "steps 1–9 pass as in the positive run").toEqual(Array(9).fill("PASS"));
  expect(L.failedAt, "the loop stops at step 10").toBe(10);
  expect(L.lines.find((l) => l.step === 10)?.note).toMatch(/cite the step 8 participant session/);
});
