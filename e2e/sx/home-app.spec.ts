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
//                  nothing opens it. SX-T13: one Primary on the work screen at 1280, while the
//                  coach is answering (the Primary busy, no second one), at the narrowest window,
//                  after a switch to another editor and back, and with a preview open beside it.
//                  SX-T10: the header's four parts (week, mission, completion conditions, steps
//                  remaining) stay on screen while the coach is answering, through a scrolled
//                  conversation, at the narrowest window (where the header wraps instead of being
//                  cut), after the editor switch, and with the preview open. On a short window
//                  (1280×450, as with a terminal panel open) the header is bounded: its week,
//                  mission and Primary stay on screen and the composer is wholly reachable under it.
//                  Then the task is moved to the step "build" (criterion written, step started).
//   reopened       SX-T11's other half (SX-02): "지난번 이어서 · Build pane" is there, is not a
//                  Primary, and brings the recorded step to the front with the keyboard on its
//                  action; pressing that action (a start onto the step the record holds, which
//                  writes nothing) ends the entry.
//   reopened again The record still stands where the first session left it, so the entry is back;
//                  a coach turn that answered (which writes nothing either) ends it. Then the
//                  student moves the task on to "test".
//
// Every instrument here is also run on a planted DOM (a second Primary, a header pushed off the
// screen, a mission line wider than the window, a growth link above the actions or drawn as a
// Primary, a score in the header text, an unbounded header on the short window) and must report
// it: a check that passes a planted defect counts nothing (verification.md rule 2). The entry
// itself has its controls in builds: a host that never sends it fails at the reopen, one that
// always sends it fails in the first session, one that never ends it fails after the Primary.
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
/** A short window: what the chat keeps with a terminal panel open, or at 200% zoom (about 390 px of webview). */
const SHORT = { width: 1280, height: 450 };

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
  /** The next streamed turn holds its reply this long (sx-service.mjs `/__sx/hold`), so the screen can be read mid-turn. */
  async holdNextReply(ms: number): Promise<void> {
    const r = await fetch(`http://127.0.0.1:${PORT}/__sx/hold?ms=${ms}`);
    expect((await r.json()) as unknown, "the Service did not take the hold").toEqual({ hold: ms });
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
  expect(primaryProblem(primaryNarrow)).toBeNull();
  const cutControl = await plantedMust(chat, "header.hp-mission h1.hp-mission-sentence", "el.style.minWidth = '1500px';", "el.style.minWidth = '';", async () => headerProblem(await probeHeader(chat)), "a mission line wider than the window");
  record.header = { ...(record.header as object), narrow, cut_control: cutControl };
  record.primary = { ...(record.primary as object), narrow: primaryNarrow };

  // ── SX-T10 (2b): a short window. The sticky header is bounded, so it never takes region B: its
  //    week, mission and Primary stay on screen and the composer can be reached under it ──
  await resize(ctx.app, SHORT);
  await expect.poll(async () => (await probeHeader(chat)).viewport.height, { timeout: 10_000 }).toBeLessThan(SHORT.height);
  const short = await probeRegionB(chat);
  const shortHeader = await probeHeader(chat);
  record.short_window = { region_b: short, header: shortHeader };
  expect(regionBProblem(short), JSON.stringify(short)).toBeNull();
  expect(shortHeader.parts.week && shortHeader.parts.mission, `the week or the mission left the screen: ${JSON.stringify(shortHeader)}`).toBe(true);
  // Control: the same window with the header unbounded (the review's finding) must be reported.
  const shortControl = await plantedMust(chat, "header.hp-mission", "el.style.maxHeight = 'none';", "el.style.maxHeight = '';", async () => regionBProblem(await probeRegionB(chat)), "an unbounded header on a short window");
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
  const resumeText = await resume.innerText();
  await resume.click();
  await expect(front).toHaveText("Build pane");
  await expect.poll(() => front.evaluate((el) => el === document.activeElement), { timeout: 5_000 }).toBe(true);
  // Following the entry only moves the view; until the student acts on the task it stays.
  await expect(chat.locator(".hp-mission-resume")).toHaveCount(1);
  // The student presses the recorded step's own action: a start onto the step the record already
  // holds, which writes nothing. The entry goes all the same (it stayed all session before the
  // review of 2026-10-05), and the record is untouched.
  await front.click();
  await expect(chat.locator(".hp-mission-resume"), "'지난번 이어서' stays after the student continued the step it names").toHaveCount(0, { timeout: 20_000 });
  expect(recordedStep(ctx.userDataDir), "the start onto the recorded step moved the record").toBe("build");
  record.reopened = { resume: resumeText, front_after: await front.innerText(), focused: true, after_primary: { resume: 0, recorded_step: "build" } };

  // ── Reopened again: nothing was written, so the record still stands where the first session left it ──
  await ctx.app.close();
  ctx = undefined;
  ctx = await launchApp({ reuseUserDataDir: userDataDir, preseedToken: true, preseedCoach: { name: "코치" } });
  await resize(ctx.app, WIDE);
  chat = await focusChat(ctx.win);
  const again = chat.locator("header.hp-mission .hp-mission-resume button");
  await expect(again, "a session that only continued the step lost the entry for the next one").toHaveText("지난번 이어서 · Build pane", { timeout: 20_000 });
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
});
