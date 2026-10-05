// SX-01 ~ SX-04 — region A, the work screen's home, in the Studio APP (Playwright e2e layer),
// and SX-02's "지난번 이어서" across a real close and reopen.
//
// Evidence class: live-host for the App (a prepared copy of the shipped shell with this branch's
// extension and webview injected), synthetic for the Service (sx-service.mjs: the real router
// over SQLite, a lesson-pinned seat on the one `/2` profile, a model that answers one fixed line).
//
// One student, one task (the week-3 design, completion kept to c1):
//   first session  SX-T01 (e2e half): the mission and 1–3 actions are on screen within 5 s of the
//                  work screen's first render, and the screen's text carries no score or grade.
//                  SX-T11: actions 1–3, no "지난번 이어서" (no earlier session), no number card.
//                  SX-T12: the growth link is a small link below the actions, not a Primary, and
//                  nothing opens it. SX-T13: one Primary on the work screen at 1280 and at the
//                  narrowest window. SX-T10: the header's four parts (week, mission, completion
//                  conditions, steps remaining) stay on screen through a scrolled conversation,
//                  the narrowest window (where the header wraps instead of being cut), a switch to
//                  another editor and back, and an open preview beside it.
//                  Then the task is moved to the step "build" (criterion written, step started).
//   reopened       SX-T11's other half (SX-02): "지난번 이어서 · Build pane" is there, is not a
//                  Primary, and brings the recorded step to the front with the keyboard on its
//                  action; once the student moves the task on, the entry goes.
//
// Every instrument here is also run on a planted DOM (a second Primary, a header pushed off the
// screen, a mission line wider than the window, a growth link above the actions or drawn as a
// Primary, a score in the header text) and must report it: a check that passes a planted defect
// counts nothing (verification.md rule 2). The entry itself has its controls in builds: a host
// that never sends it fails at the reopen, one that always sends it fails in the first session.
//
// Not covered: SX-T13's other screens (the reflection does not exist yet — sx-p2; the growth
// record is a separate panel), SX-T01's human half and SX-T60 (people), SX-T12's screenshot
// comparison (sizes and positions are measured here instead).
//
// Needs an unlocked screen: when it is locked the run is skipped as NOT RUN.
import { test, expect, type ElectronApplication, type FrameLocator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type AppContext, chatFrame, closeApp, launchApp, runCommand } from "../fixtures/app";
import { previewUrl, screenLocked, send } from "../curriculum-runtime/app-helpers";
// The render-audit instrument is plain .mjs, shared with the extension's smoke tests (no declarations).
// @ts-expect-error TS7016
import { auditRegionText as auditText } from "../../extensions/hypeproof-chat/test/sx-audit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const PORT = Number(process.env.HPS_SX_APP_PORT || 18951);
const MISSION = "AI가 만든 걸 내가 확인했나?";
const PREVIEW = "HypeProof: HTML 미리보기 (옆 패널)";
const FIXTURE = path.join(repo, "e2e/curriculum-runtime/fixtures/kiosk-practice");
/** The Primary's colour: `--hp-accent` (webview-ui/src/tokens.css), as Chromium computes it. */
const LIME = "rgb(213, 242, 121)";
const WIDE = { width: 1280, height: 800 };
type Audit = { ok: boolean; findings: Array<{ rule: string; match: string; index: number; label: string }> };
const auditRegionText = auditText as (text: string, opts: { region: "work"; minLength: number }) => Audit;
/** VS Code refuses a window narrower than this (its WindowMinimumSize); the narrowest the App can be. */
const NARROW = { width: 400, height: 800 };

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
  stop(): void {
    this.proc?.kill();
  }
}

type TaskRecord = { id: string; curriculum?: { phase: string; current_step: string } };
/** The Task records the extension wrote to its local measurement-core record (one JSON file per key). */
function taskRecords(userDataDir: string): TaskRecord[] {
  const root = path.join(userDataDir, "User", "globalStorage", "hypeproof.hypeproof-chat", "local-review-v1");
  if (!fs.existsSync(root)) return [];
  const out: TaskRecord[] = [];
  for (const f of fs.readdirSync(root).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(root, f), "utf8")) as { key: string; value: string };
      if (r.key.startsWith("tasks/")) out.push(JSON.parse(r.value) as TaskRecord);
    } catch {
      // A file being replaced while this reads (atomic rename) is read on the next poll.
    }
  }
  return out;
}
const recordedStep = (userDataDir: string) => taskRecords(userDataDir).find((t) => t.curriculum)?.curriculum?.current_step ?? null;

// ── Instruments: a probe of the frame, and a pure verdict over what it measured ──────────────

type HeaderProbe = { present: boolean; parts: Record<"week" | "mission" | "completion" | "remaining", boolean>; cut: string[]; viewport: { width: number; height: number } };

/** Is each of the header's four parts inside the frame's viewport and not covered; does anything in it run past the right edge? */
async function probeHeader(chat: FrameLocator): Promise<HeaderProbe> {
  const header = chat.locator("header.hp-mission");
  if ((await header.count()) === 0) return { present: false, parts: { week: false, mission: false, completion: false, remaining: false }, cut: [], viewport: { width: 0, height: 0 } };
  return header.evaluate((el) => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const seen = (part: Element | null) => {
      if (!part) return false;
      const r = part.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
      const x = Math.min(Math.max(r.left + Math.min(r.width, 24) / 2, 0), vw - 1);
      const y = Math.min(Math.max(r.top + Math.min(r.height, 24) / 2, 0), vh - 1);
      const hit = document.elementFromPoint(x, y);
      return !!hit && (part === hit || part.contains(hit));
    };
    const cut = Array.from(el.querySelectorAll("*"))
      .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > vw + 1)
      .map((node) => `${node.tagName.toLowerCase()}.${node.className}`.slice(0, 80));
    if (el.scrollWidth > el.clientWidth + 1) cut.push(`header scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
    return {
      present: true,
      parts: {
        week: seen(el.querySelector(".hp-mission-week")),
        mission: seen(el.querySelector(".hp-mission-sentence")),
        completion: seen(el.querySelector(".hp-mission-completion li")),
        remaining: seen(el.querySelector(".hp-mission-remaining")),
      },
      cut,
      viewport: { width: vw, height: vh },
    };
  });
}
/** SX-T10's verdict: all four parts on screen, nothing cut at the right edge. */
const headerProblem = (p: HeaderProbe): string | null =>
  !p.present ? "no mission header" : Object.entries(p.parts).filter(([, ok]) => !ok).map(([k]) => k).join(", ") ? `not on screen: ${Object.entries(p.parts).filter(([, ok]) => !ok).map(([k]) => k).join(", ")}` : p.cut.length ? `cut at the right edge: ${p.cut.join(" | ")}` : null;

type PrimaryProbe = { byClass: number; byColour: number; lime: string[]; limeOther: string[] };
/**
 * SX-04: buttons drawn as the Primary — by its class, and by a Lime background wherever that
 * came from (the theme paints `--vscode-button-background` Lime, so a class count alone misses a
 * button the theme coloured). Lime on something that is not a control (a chat bubble) is listed
 * apart: SX-04 counts emphasised buttons; that is SX-49's token-role question.
 */
async function probePrimary(chat: FrameLocator): Promise<PrimaryProbe> {
  return chat.locator("body").evaluate((body, lime) => {
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const describe = (e: Element) => {
      const named = e.closest("[class]:not(button)");
      return `${e.tagName.toLowerCase()}.${String(e.className).replace(/\s+/g, ".")} "${(e as HTMLElement).innerText.slice(0, 30)}" in .${String(named?.className ?? "").split(/\s+/)[0]}`;
    };
    const control = (e: Element) => e.matches("button, a[href], [role='button'], input[type='button'], input[type='submit']");
    const limes = Array.from(body.querySelectorAll("*")).filter((e) => shown(e) && getComputedStyle(e).backgroundColor === lime);
    return {
      byClass: Array.from(body.querySelectorAll(".hp-cta-primary")).filter(shown).length,
      byColour: limes.filter(control).length,
      lime: limes.filter(control).map(describe),
      limeOther: limes.filter((e) => !control(e)).map(describe),
    };
  }, LIME);
}
const primaryProblem = (p: PrimaryProbe): string | null => (p.byClass === 1 && p.byColour === 1 ? null : `Primary by class ${p.byClass}, Lime buttons ${p.byColour}: ${p.lime.join(" | ")}`);

type GrowthProbe = { present: boolean; primary: boolean; belowActions: boolean; fontPx: number; missionFontPx: number; text: string };
async function probeGrowth(chat: FrameLocator): Promise<GrowthProbe> {
  return chat.locator("header.hp-mission").evaluate((el) => {
    const link = el.querySelector(".hp-mission-growth");
    const actions = el.querySelector(".hp-mission-actions");
    const mission = el.querySelector(".hp-mission-sentence");
    if (!link || !actions || !mission) return { present: false, primary: false, belowActions: false, fontPx: 0, missionFontPx: 0, text: "" };
    return {
      present: true,
      primary: link.classList.contains("hp-cta-primary") || getComputedStyle(link).backgroundColor === "rgb(213, 242, 121)",
      belowActions: link.getBoundingClientRect().top >= actions.getBoundingClientRect().bottom - 1,
      fontPx: parseFloat(getComputedStyle(link).fontSize),
      missionFontPx: parseFloat(getComputedStyle(mission).fontSize),
      text: (link as HTMLElement).innerText,
    };
  });
}
/** SX-T12's verdict: a link-size entry below the actions, smaller than the mission, no Primary style, no count. */
const growthProblem = (g: GrowthProbe): string | null =>
  !g.present ? "no growth link" : g.primary ? "the growth link is drawn as a Primary" : !g.belowActions ? "the growth link is above the actions" : !(g.fontPx < g.missionFontPx) ? `growth link ${g.fontPx}px is not smaller than the mission ${g.missionFontPx}px` : /\d/.test(g.text) ? `a count on the growth link: ${g.text}` : null;

/** Run `measure` on a DOM the planted change makes wrong, require `verdict` to report it, then undo the change. */
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
  const out = path.join(repo, "e2e/test-results/sx-app/home-result.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
});

test("SX home: region A on the work screen, and 지난번 이어서 after a reopen", async () => {
  await svc.start();
  ctx = await launchApp({ preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  fs.cpSync(FIXTURE, ctx.wsDir, { recursive: true });

  // ── SX-T01 (e2e half): mission and actions within 5 s of the work screen's first render ──
  let chat = await chatFrame(ctx.win);
  const t0 = Date.now();
  const mission = chat.locator("header.hp-mission h1.hp-mission-sentence");
  const actions = chat.locator("header.hp-mission .hp-mission-actions > li");
  await expect(mission).toHaveText(MISSION, { timeout: 5_000 });
  await expect(actions.first()).toBeVisible({ timeout: Math.max(1, 5_000 - (Date.now() - t0)) });
  const firstRenderMs = Date.now() - t0;
  expect(firstRenderMs, "the mission and its actions took longer than 5 s after the work screen rendered").toBeLessThan(5_000);
  const screenText = await chat.locator("body").innerText();
  const headerText = await chat.locator("header.hp-mission").innerText();
  const screenAudit = auditRegionText(screenText, { region: "work", minLength: 60 });
  const headerAudit = auditRegionText(headerText, { region: "work", minLength: 40 });
  record.first_render = { ms: firstRenderMs, screen_chars: screenText.length, screen_findings: screenAudit.findings, header_findings: headerAudit.findings, screen_text: screenText };
  expect(headerAudit.ok, `score or grade text in the mission header: ${JSON.stringify(headerAudit.findings)}`).toBe(true);
  expect(screenAudit.ok, `score or grade text on the work screen: ${JSON.stringify(screenAudit.findings)}`).toBe(true);
  // Control: the same audit on the same screen with a score planted in the header must fail.
  const planted = await plantedMust(
    chat, "header.hp-mission h1.hp-mission-sentence",
    "const s = document.createElement('span'); s.className = 'sx-planted'; s.textContent = ' · 검증 점수 62점'; el.appendChild(s);", "el.querySelector('.sx-planted')?.remove();",
    async () => { const r = auditRegionText(await chat.locator("body").innerText(), { region: "work", minLength: 60 }); return r.ok ? null : JSON.stringify(r.findings.map((f) => f.match)); },
    "score in the header",
  );
  record.first_render_control = planted;

  // ── SX-T11, first condition: 1–3 actions, no earlier session → no 지난번 이어서, no number card ──
  const actionCount = await actions.count();
  expect(actionCount).toBeGreaterThanOrEqual(1);
  expect(actionCount).toBeLessThanOrEqual(3);
  await expect(chat.locator(".hp-mission-resume")).toHaveCount(0);
  await expect(chat.locator(".hp-stat")).toHaveCount(0);
  record.first_session = { actions: actionCount, resume: 0 };

  // ── SX-T12: the growth link ──
  const growth = await probeGrowth(chat);
  expect(growthProblem(growth), JSON.stringify(growth)).toBeNull();
  await expect(ctx.win.locator(".tabs-container .tab", { hasText: "나의 변화 기록" })).toHaveCount(0);
  const growthControls = [
    await plantedMust(chat, "header.hp-mission .hp-mission-growth", "el.classList.add('hp-cta-primary');", "el.classList.remove('hp-cta-primary');", async () => growthProblem(await probeGrowth(chat)), "growth link as a Primary"),
    await plantedMust(chat, "header.hp-mission", "el.style.display = 'flex'; el.style.flexDirection = 'column'; el.querySelector('.hp-mission-foot').style.order = '-1';", "el.style.display = ''; el.style.flexDirection = ''; el.querySelector('.hp-mission-foot').style.order = '';", async () => growthProblem(await probeGrowth(chat)), "growth link above the actions"),
  ];
  record.growth = { ...growth, controls: growthControls };

  // ── SX-T13 at 1280: one Primary ──
  const primaryWide = await probePrimary(chat);
  expect(primaryProblem(primaryWide)).toBeNull();
  const primaryControl = [
    await plantedMust(chat, "header.hp-mission .hp-mission-growth", "el.classList.add('hp-cta-primary');", "el.classList.remove('hp-cta-primary');", async () => primaryProblem(await probePrimary(chat)), "a second Primary"),
    // The theme's way in: a button with no Primary class, painted Lime.
    await plantedMust(chat, ".hps-input .hps-btn-send", `el.style.background = '${LIME}';`, "el.style.background = '';", async () => primaryProblem(await probePrimary(chat)), "a Lime Send button"),
  ];
  record.primary = { wide: primaryWide, control: primaryControl };

  // ── SX-T10 (1): the conversation scrolled ──
  // Turns until the message list overflows (a list that does not scroll measures nothing here).
  const messages = chat.locator(".hps-messages");
  let turns = 0;
  for (const line of ["시작할게요", "기대 조건부터 적어 볼게요", "하나 더 물어볼게요", "그다음은요", "하나만 더요", "마지막으로요"]) {
    await send(ctx.win, line);
    turns += 1;
    await expect(chat.locator(".hps-msg-body", { hasText: "[로컬 시험 응답]" })).toHaveCount(turns, { timeout: 60_000 });
    if (await messages.evaluate((el) => el.scrollHeight > el.clientHeight + 40)) break;
  }
  const scrolled = await messages.evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node) { node.scrollTop = node.scrollHeight; node = node.parentElement; }
    const chain: string[] = [];
    for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
      chain.push(`${n.tagName.toLowerCase()}.${String(n.className).split(/\s+/)[0]} h=${n.clientHeight}/${n.scrollHeight} top=${n.scrollTop} oy=${getComputedStyle(n).overflowY}`);
    }
    const header = document.querySelector("header.hp-mission")?.getBoundingClientRect();
    return { turns: el.querySelectorAll(".hps-msg").length, scrollTop: el.scrollTop, overflow: el.scrollHeight > el.clientHeight, chain, header: header ? { top: header.top, bottom: header.bottom } : null };
  });
  expect(scrolled.overflow, "the conversation never overflowed: the scrolled state was not reached").toBe(true);
  expect(scrolled.scrollTop, "the conversation did not scroll").toBeGreaterThan(0);
  const afterScroll = await probeHeader(chat);
  record.header = { scrolled: { ...scrolled, probe: afterScroll } };
  expect(headerProblem(afterScroll), JSON.stringify({ afterScroll, scrolled })).toBeNull();
  const headerControl = await plantedMust(chat, "header.hp-mission", "el.style.transform = 'translateY(-5000px)';", "el.style.transform = '';", async () => headerProblem(await probeHeader(chat)), "header pushed off the screen");
  record.header = { scrolled: { ...scrolled, probe: afterScroll }, control: headerControl };

  // ── SX-T10 (2) + SX-T13 at the narrowest window (one editor group: the chat alone) ──
  await resize(ctx.app, NARROW);
  await expect.poll(async () => (await probeHeader(chat)).viewport.width, { timeout: 10_000 }).toBeLessThanOrEqual(NARROW.width);
  const narrow = await probeHeader(chat);
  expect(headerProblem(narrow), JSON.stringify(narrow)).toBeNull();
  const primaryNarrow = await probePrimary(chat);
  expect(primaryProblem(primaryNarrow)).toBeNull();
  const cutControl = await plantedMust(chat, "header.hp-mission h1.hp-mission-sentence", "el.style.minWidth = '1500px';", "el.style.minWidth = '';", async () => headerProblem(await probeHeader(chat)), "a mission line wider than the window");
  record.header = { ...(record.header as object), narrow, cut_control: cutControl };
  record.primary = { ...(record.primary as object), narrow: primaryNarrow };
  await resize(ctx.app, WIDE);
  await expect.poll(async () => (await probeHeader(chat)).viewport.width, { timeout: 10_000 }).toBeGreaterThan(NARROW.width);

  // ── SX-T10 (3): another editor in front, then back ──
  await ctx.win.locator(".monaco-workbench .part.titlebar").first().click({ position: { x: 10, y: 10 }, force: true });
  await ctx.win.keyboard.press("Meta+P");
  await ctx.win.locator(".quick-input-widget input.input").first().fill("index.html");
  await ctx.win.waitForTimeout(600);
  await ctx.win.keyboard.press("Enter");
  await expect(ctx.win.locator(".tabs-container .tab.active", { hasText: "index.html" })).toHaveCount(1, { timeout: 15_000 });
  chat = await focusChat(ctx.win);
  const afterSwitch = await probeHeader(chat);
  expect(headerProblem(afterSwitch), JSON.stringify(afterSwitch)).toBeNull();

  // ── SX-T10 (4): a preview open beside it ──
  await ctx.win.locator(".tabs-container .tab", { hasText: "index.html" }).first().click();
  await runCommand(ctx.win, PREVIEW);
  await expect.poll(() => previewUrl(ctx!.app), { timeout: 30_000 }).not.toBeNull();
  chat = await focusChat(ctx.win);
  const withPreview = await probeHeader(chat);
  expect(headerProblem(withPreview), JSON.stringify(withPreview)).toBeNull();
  record.header = { ...(record.header as object), switched: afterSwitch, preview: withPreview };

  // ── Move the task to "build": the student's criterion, then the step started ──
  const region = chat.locator(".hp-evidence-region");
  await region.locator("details.hp-evidence > summary").click();
  await region.locator("textarea#hp-criterion").fill("시간표가 학교 규정 원문과 같아야 한다");
  await region.getByRole("button", { name: "기대 조건 남기기" }).click();
  await expect(chat.locator(".hp-mission-completion li[data-met]")).toHaveAttribute("data-met", "yes");
  await chat.locator("header.hp-mission .hp-mission-actions button", { hasText: "Build pane" }).click();
  await chat.locator("header.hp-mission .hp-mission-actions .hp-cta-primary", { hasText: "Build pane" }).click();
  await expect.poll(() => recordedStep(ctx!.userDataDir), { timeout: 30_000 }).toBe("build");
  // Still this session: moving the task here offers no "last time".
  await expect(chat.locator(".hp-mission-resume")).toHaveCount(0);

  // ── Reopened: the same seat (same Service process, same token), a new App process ──
  const userDataDir = ctx.userDataDir;
  await ctx.app.close();
  ctx = undefined;
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  chat = await focusChat(ctx.win);
  await expect(chat.locator("header.hp-mission h1.hp-mission-sentence")).toHaveText(MISSION);
  const resume = chat.locator("header.hp-mission .hp-mission-resume button");
  await expect(resume).toHaveText("지난번 이어서 · Build pane", { timeout: 20_000 });
  await expect(resume).toHaveAttribute("data-resume-step", "build");
  await expect(resume).not.toHaveClass(/hp-cta-primary/);
  // Where it sits (SX-02, PROJECT_RULES order): below the actions and the completion conditions,
  // above the growth link — measured on the screen, not read from the markup.
  const placement = await chat.locator("header.hp-mission").evaluate((el) => {
    const box = (s: string) => el.querySelector(s)?.getBoundingClientRect() ?? null;
    const resumeBox = box(".hp-mission-resume"), actionsBox = box(".hp-mission-actions"), completionBox = box(".hp-mission-completion"), growthBox = box(".hp-mission-growth");
    return resumeBox && actionsBox && completionBox && growthBox
      ? { belowActions: resumeBox.top >= actionsBox.bottom - 1, belowCompletion: resumeBox.top >= completionBox.bottom - 1, aboveGrowth: resumeBox.bottom <= growthBox.top + 1 }
      : null;
  });
  expect(placement, "the entry is not between the completion conditions and the growth link").toEqual({ belowActions: true, belowCompletion: true, aboveGrowth: true });
  // The view starts at the first step; the entry is what brings the recorded one to the front.
  const front = chat.locator("header.hp-mission .hp-mission-actions .hp-cta-primary");
  await expect(front).toHaveText("기대 조건");
  expect(primaryProblem(await probePrimary(chat))).toBeNull();
  await resume.click();
  await expect(front).toHaveText("Build pane");
  await expect.poll(() => front.evaluate((el) => el === document.activeElement), { timeout: 5_000 }).toBe(true);
  record.reopened = { resume: await resume.innerText(), front_after: await front.innerText(), focused: true };

  // The student moves on (build has no gate): the record changes in this session and the entry goes.
  await chat.locator("header.hp-mission .hp-mission-actions button", { hasText: "Preview / Test" }).click();
  await chat.locator("header.hp-mission .hp-mission-actions .hp-cta-primary", { hasText: "Preview / Test" }).click();
  await expect.poll(() => recordedStep(ctx!.userDataDir), { timeout: 30_000 }).toBe("test");
  await expect(chat.locator(".hp-mission-resume")).toHaveCount(0, { timeout: 20_000 });
  record.moved_on = { recorded_step: "test", resume: 0 };
});
