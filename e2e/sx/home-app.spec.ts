// SX-01 ~ SX-04 — region A, the work screen's home, in the Studio APP (Playwright e2e layer),
// and SX-02's "지난번 이어서" across a real close and reopen.
//
// Evidence class: live-host for the App (a prepared copy of the shipped shell with this branch's
// extension and webview injected), synthetic for the Service (sx-service.mjs: the real router
// over SQLite, a lesson-pinned seat on the one `/2` profile, a model that answers one fixed line).
//
// One student, one task (the week-3 design as written: three completion conditions and the note):
//   first session  SX-T01 (e2e half): the mission and 1–3 actions are on screen within 5 s of the
//                  work screen's first render, and the screen's text carries no score or grade.
//                  SX-T11: actions 1–3, no "지난번 이어서" (no earlier session), no number card.
//                  SX-T12: the growth link is a small link below the actions, not a Primary, and
//                  nothing opens it. SX-T13: one Primary on the work screen at 1280, while the
//                  coach is answering (the Primary busy, no second one), at the narrowest window,
//                  after a switch to another editor and back, and with a preview open beside it.
//                  SX-T10: the header's four parts (week, mission, every completion condition, steps
//                  remaining) stay wholly on screen while the coach is answering, through a scrolled
//                  conversation, at the narrowest window (where the header wraps instead of being
//                  cut), after the editor switch, and with the preview open. On a short window
//                  (1280×450, as with a terminal panel open) the header is bounded and packed: all
//                  four parts and the Primary stay on screen, and the composer is wholly reachable
//                  under it. SX-T13 counts Lime on anything, not only buttons: the student's own
//                  chat bubble beside the Primary is a second Lime element (SX-49 negative). Then
//                  the task is moved to the step "build" (criterion written, step started).
//   reopened       The Service holds the observation context, so the header is drawn from the
//                  profile before the host's first state: its Primary is busy, and pressing it then
//                  leaves the record at "build" (drawn at the first step and startable, it moved the
//                  record back: second review of 2026-10-05). SX-01/SX-02 once the state is there:
//                  the view starts at the step the record holds, so the one Primary is "Build pane",
//                  no earlier step is among the actions, and the steps remaining count from it.
//                  SX-T11's other half: "지난번 이어서 · Build pane" is there, is not a Primary, and
//                  hands the keyboard to the recorded step's action; on the short window it is on
//                  screen with the four parts. Pressing that action (a start onto the step the record
//                  holds, which writes nothing) ends the entry.
//   reopened again The record still stands where the first session left it, so the entry is back
//                  and the view starts at "build" again; a coach turn that answered (which writes
//                  nothing either) ends it. Then the student moves the task on to "test".
//   context failed Reopened while the Service's observation context answers only after the App gave
//                  up: no state, so the Primary stays busy and region D is not drawn; the next coach
//                  turn that answers brings the owed state, and the Primary stands on "test".
//
// Every instrument here is also run on a planted DOM (a second Primary, a Lime Send button, a Lime
// chat bubble, a header pushed off the screen, a mission line wider than the window, a growth link
// above the actions or drawn as a Primary, a score in the header text, an unbounded header on the
// short window, the short window's header stacked as on a tall one, completion conditions 2 and 3
// below the header's edge) and must report it: a check that passes a planted defect counts nothing
// (verification.md rule 2). The entry itself has its controls in builds: a host that never sends it
// fails at the reopen, one that always sends it fails in the first session, one that never ends it
// fails after the Primary, a webview that starts the view at the first step fails at the reopen's
// Primary, a webview whose Primary can be started before the first state fails at the record, and
// a host that never owes the state it could not build fails after the turn that should bring it.
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
/** The design the Service serves (sx-service.mjs), every completion condition kept: the header as it ships. */
const WEEK3 = JSON.parse(fs.readFileSync(new URL(import.meta.resolve("@hypeproof/service-testkit/test/fixtures/session-design/week-3.json")), "utf8")) as {
  steps: Array<{ id: string; title: string }>;
  learning: { completion: Array<{ id: string; text: string }> };
};
const COMPLETION = WEEK3.learning.completion.map((c) => c.id).join(",");
/** "남은 단계 N" when the view stands on `stepId` (a position, counted from it: missionHeaderLogic.ts). */
const remainingAt = (stepId: string) => `남은 단계 ${WEEK3.steps.length - WEEK3.steps.findIndex((s) => s.id === stepId)}`;
/** The Primary's colour: `--hp-bg-accent-default` (webview-ui/src/tokens.css), as Chromium computes it. */
const LIME = "rgb(213, 242, 121)";
const WIDE = { width: 1280, height: 800 };
type Audit = { ok: boolean; findings: Array<{ rule: string; match: string; index: number; label: string }> };
const auditRegionText = auditText as (text: string, opts: { region: "work"; minLength: number }) => Audit;
/** VS Code refuses a window narrower than this (its WindowMinimumSize); the narrowest the App can be. */
const NARROW = { width: 400, height: 800 };
/** A short window: what the chat keeps with a terminal panel open, or at 200% zoom (about 390 px of webview). */
const SHORT = { width: 1280, height: 450 };
/**
 * How long the Service holds the observation context on the reopen, so the screen is drawn from the
 * profile well before the host's first learning state. Under the App's own 5 s limit on that
 * request: past it the App gives up and no state comes until the next coach turn.
 */
const CONTEXT_HOLD_MS = 4_000;
/** ...and how long it holds it to make that request fail: past the App's 5 s limit. */
const CONTEXT_FAIL_MS = 6_500;

class SxService {
  private proc?: ChildProcess;
  async start(): Promise<void> {
    fs.mkdirSync(path.dirname(process.env.HPS_E2E_TOKEN_FILE!), { recursive: true });
    this.proc = spawn(
      process.execPath,
      ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", path.join(here, "sx-service.mjs"), String(PORT), process.env.HPS_E2E_TOKEN_FILE!, COMPLETION],
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
  /** The next streamed turn holds its reply this long (sx-service.mjs `/__sx/hold`), so the screen can be read mid-turn. */
  async holdNextReply(ms: number): Promise<void> {
    const r = await fetch(`http://127.0.0.1:${PORT}/__sx/hold?ms=${ms}`);
    expect((await r.json()) as unknown, "the Service did not take the hold").toEqual({ hold: ms });
  }
  /**
   * Every observation-context request from now on is answered this late (`/__sx/hold-context`; 0
   * ends it). The host builds no learning state before that request is answered, so the screen can
   * be read, and pressed, before the host's first state.
   */
  async holdContext(ms: number): Promise<void> {
    const r = await fetch(`http://127.0.0.1:${PORT}/__sx/hold-context?ms=${ms}`);
    expect((await r.json()) as unknown, "the Service did not take the context hold").toEqual({ hold_context: ms });
  }
  /** How many observation-context requests arrived, and how many were answered. */
  async context(): Promise<{ requests: number; answered: number }> {
    const r = await fetch(`http://127.0.0.1:${PORT}/__sx/state`);
    return ((await r.json()) as { context: { requests: number; answered: number } }).context;
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

type HeaderProbe = {
  present: boolean;
  parts: Record<"week" | "mission" | "completion" | "remaining", boolean>;
  /** Each completion condition (the note after them is not one), in order: wholly on screen or not. */
  conditions: boolean[];
  /** Region A's Primary and "지난번 이어서" (null: not drawn), measured the same way; not SX-T10's four parts. */
  primary: boolean;
  resume: boolean | null;
  cut: string[];
  viewport: { width: number; height: number };
};

/**
 * Is each of the header's four parts wholly on screen — every completion condition, not only the
 * first (third review of 2026-10-05: the first one's corner was all that was read) — and does
 * anything in it run past the right edge? "Wholly": the box is inside the header's visible box (a
 * bounded header scrolls inside itself, and what it scrolled away is not on screen) and the
 * frame's viewport, and its centre is not covered.
 */
async function probeHeader(chat: FrameLocator): Promise<HeaderProbe> {
  const header = chat.locator("header.hp-mission");
  if ((await header.count()) === 0) return { present: false, parts: { week: false, mission: false, completion: false, remaining: false }, conditions: [], primary: false, resume: null, cut: [], viewport: { width: 0, height: 0 } };
  return header.evaluate((el) => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const box = el.getBoundingClientRect();
    const whole = (part: Element | null) => {
      if (!part) return false;
      const r = part.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.top < Math.max(box.top, 0) - 0.5 || r.bottom > Math.min(box.bottom, vh) + 0.5 || r.left < -0.5 || r.right > vw + 0.5) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (part === hit || part.contains(hit));
    };
    const cut = Array.from(el.querySelectorAll("*"))
      .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > vw + 1)
      .map((node) => `${node.tagName.toLowerCase()}.${node.className}`.slice(0, 80));
    if (el.scrollWidth > el.clientWidth + 1) cut.push(`header scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
    const conditions = Array.from(el.querySelectorAll(".hp-mission-completion li:not(.hp-mission-completion-note)")).map(whole);
    return {
      present: true,
      parts: {
        week: whole(el.querySelector(".hp-mission-week")),
        mission: whole(el.querySelector(".hp-mission-sentence")),
        completion: conditions.length > 0 && conditions.every(Boolean),
        remaining: whole(el.querySelector(".hp-mission-remaining")),
      },
      conditions,
      primary: whole(el.querySelector(".hp-cta-primary")),
      resume: el.querySelector(".hp-mission-resume button") ? whole(el.querySelector(".hp-mission-resume button")) : null,
      cut,
      viewport: { width: vw, height: vh },
    };
  });
}
/** SX-T10's verdict: all four parts wholly on screen (every completion condition), nothing cut at the right edge. */
const headerProblem = (p: HeaderProbe): string | null => {
  if (!p.present) return "no mission header";
  const off = Object.entries(p.parts).filter(([, ok]) => !ok).map(([k]) => (k === "completion" ? `completion [${p.conditions.map((ok, i) => `c${i + 1}:${ok ? "on" : "off"}`).join(" ")}]` : k));
  return off.length ? `not on screen: ${off.join(", ")}` : p.cut.length ? `cut at the right edge: ${p.cut.join(" | ")}` : null;
};
/** The short window's verdict: SX-T10's, and region A's Primary (SX-04) and, when drawn, "지난번 이어서" (SX-02) on screen too. */
const shortHeaderProblem = (p: HeaderProbe): string | null =>
  headerProblem(p) ?? (!p.primary ? "region A's Primary is not on screen" : p.resume === false ? "'지난번 이어서' is not on screen" : null);

type PrimaryProbe = { byClass: number; byColour: number; lime: string[]; limeOther: string[] };
/**
 * SX-04: buttons drawn as the Primary — by its class, and by a Lime background wherever that
 * came from (the theme paints `--vscode-button-background` Lime, so a class count alone misses a
 * button the theme coloured). Lime on something that is not a control (a chat bubble) is listed
 * apart, and fails the screen too: SX-49's negative makes Lime on two elements of one viewport an
 * SX-04 failure, whatever the second one is (third review of 2026-10-05: the student's own bubble).
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
const primaryProblem = (p: PrimaryProbe): string | null =>
  p.byClass === 1 && p.byColour === 1 && p.limeOther.length === 0
    ? null
    : `Primary by class ${p.byClass}, Lime buttons ${p.byColour}, Lime on other elements ${p.limeOther.length}: ${[...p.lime, ...p.limeOther].join(" | ")}`;

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

type RegionBProbe = {
  viewport: number;
  header: { top: number; bottom: number; height: number } | null;
  composer: { top: number; bottom: number } | null;
  textarea: string[];
  send: string;
  primary: boolean;
};
/**
 * SX-01 against region B: with everything scrolled to the end (where the composer is), is the
 * composer wholly on screen below the header, can the textarea (top, middle, bottom) and Send be
 * hit, and is region A's Primary still on screen? A sticky header covers what scrolls under it, so
 * this is what a header too tall for the window breaks.
 */
async function probeRegionB(chat: FrameLocator): Promise<RegionBProbe> {
  return chat.locator("body").evaluate(() => {
    for (const el of [document.scrollingElement, document.querySelector(".hps-shell")]) if (el) el.scrollTop = el.scrollHeight;
    const vh = document.documentElement.clientHeight;
    const reach = (el: Element | null, fy: number) => {
      if (!el) return "missing";
      const b = el.getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height * fy;
      if (b.width === 0 || y < 0 || y >= vh) return `off screen (y=${Math.round(y)})`;
      const hit = document.elementFromPoint(x, y);
      if (hit === el || el.contains(hit)) return "ok";
      return hit?.closest("header.hp-mission") ? "under the mission header" : `covered by ${hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(/\s+/)[0]}` : "nothing"}`;
    };
    const header = document.querySelector("header.hp-mission")?.getBoundingClientRect() ?? null;
    const area = document.querySelector(".hps-input-area")?.getBoundingClientRect() ?? null;
    const ta = document.querySelector(".hps-input textarea");
    return {
      viewport: vh,
      header: header ? { top: Math.round(header.top), bottom: Math.round(header.bottom), height: Math.round(header.height) } : null,
      composer: area ? { top: Math.round(area.top), bottom: Math.round(area.bottom) } : null,
      textarea: [reach(ta, 0.1), reach(ta, 0.5), reach(ta, 0.9)],
      send: reach(document.querySelector(".hps-input .hps-btn-send"), 0.5),
      primary: reach(document.querySelector("header.hp-mission .hp-cta-primary"), 0.5) === "ok",
    };
  });
}
/** The verdict: the composer wholly below the header and inside the window, the textarea and Send reachable, the Primary on screen. */
const regionBProblem = (p: RegionBProbe): string | null =>
  !p.header || !p.composer ? "no mission header or no composer"
  : p.composer.top < p.header.bottom - 1 ? `the composer (from ${p.composer.top} px) runs under the mission header (to ${p.header.bottom} px)`
  : p.composer.bottom > p.viewport + 1 ? `the composer runs off the window (${p.composer.bottom} > ${p.viewport})`
  : p.textarea.some((r) => r !== "ok") ? `the textarea cannot be reached: ${p.textarea.join(" | ")}`
  : p.send !== "ok" ? `Send cannot be reached: ${p.send}`
  : !p.primary ? "region A's Primary is not on screen"
  : null;

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

  // ── SX-T10 + SX-T13 while the coach is answering (SX-01 "코치 응답 중에도", SX-04 "처리 중에는 그
  //    하나가 busy"): the first reply is held so the screen can be read mid-turn ──
  const replies = chat.locator(".hps-msg-body", { hasText: "[로컬 시험 응답]" });
  await svc.holdNextReply(8_000);
  await send(ctx.win, "시작할게요");
  const stop = chat.locator(".hps-input .hps-btn-stop");
  await expect(stop, "the held turn never showed as running").toBeVisible({ timeout: 10_000 });
  const midTurn = { header: await probeHeader(chat), primary: await probePrimary(chat), primaryBusy: await chat.locator("header.hp-mission .hp-cta-primary").isDisabled() };
  // Still mid-turn after reading: otherwise the probes above saw an idle screen and prove nothing.
  expect(await stop.isVisible(), "the turn ended before the screen was read").toBe(true);
  expect(await replies.count(), "the reply arrived before the screen was read").toBe(0);
  record.mid_turn = midTurn;
  expect(headerProblem(midTurn.header), JSON.stringify(midTurn.header)).toBeNull();
  expect(primaryProblem(midTurn.primary), JSON.stringify(midTurn.primary)).toBeNull();
  expect(midTurn.primaryBusy, "region A's Primary is not busy while the coach answers").toBe(true);
  await expect(replies).toHaveCount(1, { timeout: 60_000 });

  // ── SX-T10 (1): the conversation scrolled ──
  // Turns until the message list overflows (a list that does not scroll measures nothing here).
  const messages = chat.locator(".hps-messages");
  let turns = 1;
  for (const line of ["기대 조건부터 적어 볼게요", "하나 더 물어볼게요", "그다음은요", "하나만 더요", "마지막으로요"]) {
    if (await messages.evaluate((el) => el.scrollHeight > el.clientHeight + 40)) break;
    await send(ctx.win, line);
    turns += 1;
    await expect(replies).toHaveCount(turns, { timeout: 60_000 });
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
  expect(primaryProblem(primaryNarrow), JSON.stringify(primaryNarrow)).toBeNull();
  const cutControl = await plantedMust(chat, "header.hp-mission h1.hp-mission-sentence", "el.style.minWidth = '1500px';", "el.style.minWidth = '';", async () => headerProblem(await probeHeader(chat)), "a mission line wider than the window");
  // Control: the student's own bubble painted Lime again (the third review's finding: it took the
  // theme's button colour beside region A's Primary) must be reported.
  const bubbleControl = await plantedMust(chat, ".hps-msg-user .hps-msg-body", `el.style.background = '${LIME}';`, "el.style.background = '';", async () => primaryProblem(await probePrimary(chat)), "a Lime chat bubble beside the Primary");
  record.header = { ...(record.header as object), narrow, cut_control: cutControl };
  record.primary = { ...(record.primary as object), narrow: primaryNarrow, bubble_control: bubbleControl };

  // ── SX-T10 (2b): a short window. The sticky header is bounded, so it never takes region B, and
  //    packed, so all four parts and the Primary stay inside it; the composer can be reached under it ──
  await resize(ctx.app, SHORT);
  await expect.poll(async () => (await probeHeader(chat)).viewport.height, { timeout: 10_000 }).toBeLessThan(SHORT.height);
  const short = await probeRegionB(chat);
  const shortHeader = await probeHeader(chat);
  record.short_window = { region_b: short, header: shortHeader };
  expect(regionBProblem(short), JSON.stringify(short)).toBeNull();
  expect(shortHeaderProblem(shortHeader), JSON.stringify(shortHeader)).toBeNull();
  // Controls: the same window with the header unbounded (the first review's finding) must be
  // reported, and so must the header stacked as on a tall window (the second review's finding: the
  // completion conditions and the steps remaining scrolled inside it), and completion conditions 2
  // and 3 moved below the header's edge while the first stays (the third review's finding: only the
  // first condition was read). That one must name exactly those two.
  const shortControl = [
    await plantedMust(chat, "header.hp-mission", "el.style.maxHeight = 'none';", "el.style.maxHeight = '';", async () => regionBProblem(await probeRegionB(chat)), "an unbounded header on a short window"),
    await plantedMust(chat, "header.hp-mission", "el.style.display = 'block';", "el.style.display = '';", async () => shortHeaderProblem(await probeHeader(chat)), "a stacked header on a short window"),
    await plantedMust(
      chat, "header.hp-mission .hp-mission-completion",
      "for (const li of Array.from(el.querySelectorAll('li:not(.hp-mission-completion-note)')).slice(1)) li.style.transform = 'translateY(400px)';",
      "for (const li of Array.from(el.querySelectorAll('li'))) li.style.transform = '';",
      async () => shortHeaderProblem(await probeHeader(chat)), "completion conditions 2 and 3 below the header's edge",
    ),
  ];
  expect(shortControl[2], "the planted conditions were not told apart from the first").toContain("c1:on c2:off c3:off");
  record.short_window = { region_b: short, header: shortHeader, control: shortControl };
  await resize(ctx.app, WIDE);
  await expect.poll(async () => (await probeHeader(chat)).viewport.width, { timeout: 10_000 }).toBeGreaterThan(NARROW.width);
  await expect.poll(async () => (await probeHeader(chat)).viewport.height, { timeout: 10_000 }).toBeGreaterThan(SHORT.height);

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
  // SX-T13 "화면 전환 후에도": still one Primary.
  const primarySwitched = await probePrimary(chat);
  expect(primaryProblem(primarySwitched), JSON.stringify(primarySwitched)).toBeNull();

  // ── SX-T10 (4): a preview open beside it ──
  await ctx.win.locator(".tabs-container .tab", { hasText: "index.html" }).first().click();
  await runCommand(ctx.win, PREVIEW);
  await expect.poll(() => previewUrl(ctx!.app), { timeout: 30_000 }).not.toBeNull();
  chat = await focusChat(ctx.win);
  const withPreview = await probeHeader(chat);
  expect(headerProblem(withPreview), JSON.stringify(withPreview)).toBeNull();
  const primaryPreview = await probePrimary(chat);
  expect(primaryProblem(primaryPreview), JSON.stringify(primaryPreview)).toBeNull();
  record.header = { ...(record.header as object), switched: afterSwitch, preview: withPreview };
  record.primary = { ...(record.primary as object), switched: primarySwitched, preview: primaryPreview };

  // ── Move the task to "build": the student's criterion, then the step started ──
  const region = chat.locator(".hp-evidence-region");
  await region.locator("details.hp-evidence > summary").click();
  await region.locator("textarea#hp-criterion").fill("시간표가 학교 규정 원문과 같아야 한다");
  await region.getByRole("button", { name: "기대 조건 남기기" }).click();
  // c1 ("기대 조건을 시험 전에 적었다", the first condition) is met by the criterion; the others are not.
  await expect(chat.locator(".hp-mission-completion li[data-met]").first()).toHaveAttribute("data-met", "yes");
  await expect(chat.locator(".hp-mission-completion li[data-met='yes']")).toHaveCount(1);
  await chat.locator("header.hp-mission .hp-mission-actions button", { hasText: "Build pane" }).click();
  await chat.locator("header.hp-mission .hp-mission-actions .hp-cta-primary", { hasText: "Build pane" }).click();
  await expect.poll(() => recordedStep(ctx!.userDataDir), { timeout: 30_000 }).toBe("build");
  // Still this session: moving the task here offers no "last time".
  await expect(chat.locator(".hp-mission-resume")).toHaveCount(0);

  // ── Reopened: the same seat (same Service process, same token), a new App process. The Service
  //    holds every observation-context answer, so the header is drawn from the profile (at the
  //    first step) for seconds before the host's first learning state can show the record ──
  const userDataDir = ctx.userDataDir;
  await ctx.app.close();
  ctx = undefined;
  await svc.holdContext(CONTEXT_HOLD_MS);
  // The Service's counts are for its whole life; this App's requests are the ones after this.
  const contextBefore = await svc.context();
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  chat = await focusChat(ctx.win);
  await expect(chat.locator("header.hp-mission h1.hp-mission-sentence")).toHaveText(MISSION);
  // First paint, measured: the Primary and whether it can be started, before any state.
  const front = chat.locator("header.hp-mission .hp-mission-actions .hp-cta-primary");
  const firstPaint = { primary: await front.innerText(), busy: await front.isDisabled(), resume: await chat.locator(".hp-mission-resume").count(), context: await svc.context() };
  record.reopened_first_paint = { ...firstPaint, context_before_launch: contextBefore };
  expect(firstPaint.context.answered - contextBefore.answered, "this App had an observation-context request answered before the first paint was read: the first state may be on screen").toBe(0);
  expect(firstPaint.resume, "'지난번 이어서' is on screen before the host's first state").toBe(0);
  // The student presses that Primary before the state (second review of 2026-10-05: drawn at the
  // first step, it moved a task left at "build" back to "expect"). A click a busy button refuses.
  await front.click({ force: true });
  const pressedBefore = await svc.context();
  expect(pressedBefore.answered - contextBefore.answered, "the press came after the host could have shown the record — it proves nothing").toBe(0);
  await svc.holdContext(0);
  // A step start the press reached the host with waits on its own context request: let every one
  // be answered, and the write that would follow it land, before reading the record. (Read first:
  // such a start also ends "지난번 이어서", which would otherwise be the first thing to fail.)
  await expect.poll(async () => { const c = await svc.context(); return c.answered >= c.requests; }, { timeout: 20_000 }).toBe(true);
  await ctx.win.waitForTimeout(1_500);
  record.reopened_press_before_state = { pressed: firstPaint.primary, context_at_press: pressedBefore, recorded_step_after: recordedStep(ctx.userDataDir) };
  expect(recordedStep(ctx.userDataDir), "a press of the Primary before the host's first state moved the record").toBe("build");
  // SX-01/SX-02 — and that Primary could not be started: it was busy until the state came.
  expect(firstPaint.busy, `region A's Primary ("${firstPaint.primary}") could be started before the host had shown the record's step`).toBe(true);
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
  // SX-01/SX-02: the view starts at the step the record holds. Its action is the one Primary, no
  // earlier step is offered as an action, and the steps remaining count from it. Started at the
  // first step, the Primary was "기대 조건", and pressing it moved the record back to that step
  // (review of 2026-10-05).
  await expect(front, "the reopened screen's Primary is not the step the record holds").toHaveText("Build pane");
  await expect(front, "the Primary is still busy after the host's state showed the record").toBeEnabled();
  const frontOnState = await front.innerText();
  for (const step of WEEK3.steps.slice(0, WEEK3.steps.findIndex((s) => s.id === "build"))) {
    await expect(chat.locator("header.hp-mission .hp-mission-actions button", { hasText: step.title }), `an earlier step (${step.title}) is offered as an action after the reopen`).toHaveCount(0);
  }
  await expect(chat.locator("header.hp-mission .hp-mission-remaining")).toHaveText(remainingAt("build"));
  const remainingOnState = await chat.locator("header.hp-mission .hp-mission-remaining").innerText();
  expect(primaryProblem(await probePrimary(chat))).toBeNull();
  // The short window with the entry drawn: the four parts, the Primary and the entry on screen. The
  // layout comes back with the preview the first session opened, so the chat is about 640 px wide here.
  await resize(ctx.app, SHORT);
  await expect.poll(async () => (await probeHeader(chat)).viewport.height, { timeout: 10_000 }).toBeLessThan(SHORT.height);
  const shortReopened = { region_b: await probeRegionB(chat), header: await probeHeader(chat) };
  record.short_window_reopened = shortReopened;
  expect(regionBProblem(shortReopened.region_b), JSON.stringify(shortReopened.region_b)).toBeNull();
  expect(shortReopened.header.resume, "the entry is not drawn on the short window — the check proves nothing").not.toBeNull();
  expect(shortHeaderProblem(shortReopened.header), JSON.stringify(shortReopened.header)).toBeNull();
  await resize(ctx.app, WIDE);
  await expect.poll(async () => (await probeHeader(chat)).viewport.height, { timeout: 10_000 }).toBeGreaterThan(SHORT.height);
  // The recorded step is already in front, so following the entry hands the keyboard to its action.
  const resumeText = await resume.innerText();
  await resume.click();
  await expect(front).toHaveText("Build pane");
  await expect.poll(() => front.evaluate((el) => el === document.activeElement), { timeout: 5_000 }).toBe(true);
  // Following the entry only moves the focus; until the student acts on the task it stays.
  await expect(chat.locator(".hp-mission-resume")).toHaveCount(1);
  // The student presses the recorded step's own action: a start onto the step the record already
  // holds, which writes nothing. The entry goes all the same (it stayed all session before the
  // review of 2026-10-05), and the record is untouched.
  await front.click();
  await expect(chat.locator(".hp-mission-resume"), "'지난번 이어서' stays after the student continued the step it names").toHaveCount(0, { timeout: 20_000 });
  expect(recordedStep(ctx.userDataDir), "the start onto the recorded step moved the record").toBe("build");
  record.reopened = { front_at_first_paint: firstPaint.primary, busy_at_first_paint: firstPaint.busy, front_on_state: frontOnState, remaining_on_state: remainingOnState, resume: resumeText, front_after: await front.innerText(), focused: true, after_primary: { resume: 0, recorded_step: recordedStep(ctx.userDataDir) } };

  // ── Reopened again: nothing was written, so the record still stands where the first session left it ──
  await ctx.app.close();
  ctx = undefined;
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  chat = await focusChat(ctx.win);
  const again = chat.locator("header.hp-mission .hp-mission-resume button");
  await expect(again, "a session that only continued the step lost the entry for the next one").toHaveText("지난번 이어서 · Build pane", { timeout: 20_000 });
  await expect(chat.locator("header.hp-mission .hp-mission-actions .hp-cta-primary"), "the view did not start at the recorded step again").toHaveText("Build pane");
  // The student talks to the coach first: an answered turn on a task already working writes nothing,
  // and ends the entry.
  const answered = await chat.locator(".hps-msg-body", { hasText: "[로컬 시험 응답]" }).count();
  await send(ctx.win, "이어서 해 볼게요");
  await expect(chat.locator(".hps-msg-body", { hasText: "[로컬 시험 응답]" })).toHaveCount(answered + 1, { timeout: 60_000 });
  await expect(chat.locator(".hp-mission-resume"), "'지난번 이어서' stays after the student worked on the task").toHaveCount(0, { timeout: 20_000 });
  expect(recordedStep(ctx.userDataDir), "a coach turn moved the recorded step").toBe("build");
  record.reopened_again = { resume_before: "지난번 이어서 · Build pane", after_turn: { resume: 0, recorded_step: "build" } };

  // The student moves on (build has no gate): the record changes in this session; no entry comes back.
  await chat.locator("header.hp-mission .hp-mission-actions button", { hasText: "Preview / Test" }).click();
  await chat.locator("header.hp-mission .hp-mission-actions .hp-cta-primary", { hasText: "Preview / Test" }).click();
  await expect.poll(() => recordedStep(ctx!.userDataDir), { timeout: 30_000 }).toBe("test");
  await expect(chat.locator(".hp-mission-resume")).toHaveCount(0);
  record.moved_on = { recorded_step: "test", resume: 0 };

  // ── Reopened while the Service's observation context does not answer in time (the App gives up
  //    after 5 s): no state can show the record, so the Primary stays busy, and nothing else of the
  //    task (region D) is drawn. The next coach turn that answers sends the state that was owed
  //    (chatPanelProvider `learningStateOwed`); without it the Primary stayed busy until the webview
  //    was made again ──
  await ctx.app.close();
  ctx = undefined;
  await svc.holdContext(CONTEXT_FAIL_MS);
  const failingBefore = await svc.context();
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  chat = await focusChat(ctx.win);
  await expect(chat.locator("header.hp-mission h1.hp-mission-sentence")).toHaveText(MISSION);
  // The Service has been done with every request this App made (each after the App gave up on it).
  await expect.poll(async () => { const c = await svc.context(); return c.requests > failingBefore.requests && c.answered >= c.requests; }, { timeout: 30_000 }).toBe(true);
  await svc.holdContext(0);
  const failingFront = chat.locator("header.hp-mission .hp-mission-actions .hp-cta-primary");
  const failing = { primary: await failingFront.innerText(), busy: await failingFront.isDisabled(), region_d: await chat.locator(".hp-evidence-region").count(), context: await svc.context() };
  record.context_failed = { ...failing, context_before_launch: failingBefore };
  expect(failing.region_d, "a learning state arrived although the context request failed — the check proves nothing").toBe(0);
  expect(failing.busy, `region A's Primary ("${failing.primary}") can be started though no state has shown the record`).toBe(true);
  // The student talks to the coach: that turn's own context request is answered now.
  const answeredBefore = await chat.locator(".hps-msg-body", { hasText: "[로컬 시험 응답]" }).count();
  await send(ctx.win, "다시 해 볼게요");
  await expect(chat.locator(".hps-msg-body", { hasText: "[로컬 시험 응답]" })).toHaveCount(answeredBefore + 1, { timeout: 60_000 });
  await expect(failingFront, "the state owed since the failed read never came: the Primary stays busy").toBeEnabled({ timeout: 20_000 });
  await expect(failingFront, "the owed state did not show the recorded step").toHaveText("Preview / Test");
  await expect(chat.locator(".hp-evidence-region")).toHaveCount(1);
  expect(recordedStep(ctx.userDataDir), "the turn after a failed read moved the recorded step").toBe("test");
  record.context_failed = { ...(record.context_failed as object), after_turn: { primary: await failingFront.innerText(), busy: await failingFront.isDisabled(), recorded_step: recordedStep(ctx.userDataDir) } };
});
