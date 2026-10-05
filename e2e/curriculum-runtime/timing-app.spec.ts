// cr-e2e (#1400) — CR-T55 and CR-T56 timed in the Studio APP on the reference Mac (Jay's
// decision 9: CR-59 and CR-60 are measured here, not in headless Chromium).
//
// Evidence class: live-host for the App (a prepared copy of the shipped shell with this branch's
// extension and webview injected: the real live server, VS Code's file watcher, the integrated
// browser, the element pick over CDP and the chat webview), synthetic for the Service account
// (app-service.mjs, the CR switch on; no model is asked anything here).
//
//   CR-T55   preview refresh after a file save, N samples (default 30). A sample runs from the
//            moment index.html is written to disk to the moment the preview tab shows the new
//            document (readyState complete and the save's own marker in it). p50 under 2 s.
//            Negative control: a planted 3 s delay in the refresh path (the preview session
//            holds every reload of the page's document for 3 s) is reported as a miss.
//   CR-T56   element capture to agent context, N samples. A sample runs from the click on
//            "주문 시작" in the preview (inspect mode on) to the moment the chat shows the element
//            queued for the next message with its crop. p50 under 1 s, and every crop must be
//            the element's box, not the page. Negative control: a planted full-page screenshot
//            in place of the crop (captured from the same tab) is reported as a miss.
//
// Both verdicts and every raw sample are written to e2e/test-results/cr-app/timing-result.json.
// Needs an unlocked screen (recon F7): when locked the run is skipped as NOT RUN.
import { test, expect, type ElectronApplication, type FrameLocator, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type AppContext, closeApp, launchApp, runCommand } from "../fixtures/app";
import { Service, previewUrl, repo, screenLocked, send } from "./app-helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures/kiosk-practice");
const PREVIEW = "HypeProof: HTML 미리보기 (옆 패널)";
const PICK = "HypeProof: 화면에서 요소 골라 코치에게 묻기";
const SAMPLES = Number(process.env.HPS_CR_TIMING_SAMPLES || 30);
const PLANTED_SAMPLES = 3;
const REFRESH_LIMIT_MS = 2000; // CR-59
const CAPTURE_LIMIT_MS = 1000; // CR-60
const PLANTED_DELAY_MS = 3000;

let ctx: AppContext | undefined;
const svc = new Service();
const record: Record<string, unknown> = { machine: machine() };

test.beforeEach(() => {
  const locked = screenLocked();
  test.skip(locked !== false, `NOT RUN: the macOS screen is ${locked === null ? "in an unknown lock state (Quartz missing)" : "locked"}; the integrated browser paints no frames then (recon F7)`);
});
test.afterEach(async () => {
  if (ctx) await closeApp(ctx);
  ctx = undefined;
  svc.stop();
});
test.afterAll(() => {
  const out = path.join(repo, "e2e/test-results/cr-app/timing-result.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
});

// ── the instrument: one verdict for real and planted samples alike ─────────────

export interface TimingVerdict {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  failures: string[];
  misses: string[];
  met: boolean;
}

/** Median (mean of the middle two for an even count). */
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
/** Nearest-rank percentile. */
const rank = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * xs.length) - 1)]!;

/**
 * Met only when every planned sample was taken (a sample that never finished is a failure,
 * not a dropped point), no sample is a miss for another reason (a crop that is not the
 * element), and the median is under the limit.
 */
export function timingVerdict(samples: number[], planned: number, limitMs: number, failures: string[] = [], misses: string[] = []): TimingVerdict {
  const n = samples.length;
  const p50 = n ? median(samples) : null;
  return {
    n,
    p50,
    p95: n ? rank(samples, 0.95) : null,
    max: n ? Math.max(...samples) : null,
    failures,
    misses,
    met: n === planned && failures.length === 0 && misses.length === 0 && p50 !== null && p50 < limitMs,
  };
}

/** Width and height of a PNG from its IHDR chunk. */
export function pngSize(base64: string): { width: number; height: number } | null {
  const b = Buffer.from(base64, "base64");
  if (b.length < 24 || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/**
 * Is this image the element's own box? Its size must be the element's border box at the
 * page's device pixel ratio (within a pixel of rounding per side), and it must not be the
 * whole viewport. A full-page screenshot passed off as the crop fails here.
 */
export function cropProblem(png: { width: number; height: number } | null, el: { width: number; height: number }, viewport: { width: number; height: number }, dpr: number): string | null {
  if (!png) return "no element crop";
  const tol = 2 * dpr + 2;
  if (png.width >= Math.floor(viewport.width * dpr) - tol && png.height >= Math.floor(viewport.height * dpr) - tol) return `crop ${png.width}x${png.height} covers the whole viewport (${viewport.width}x${viewport.height} @${dpr}x), not the element`;
  if (Math.abs(png.width - el.width * dpr) > tol || Math.abs(png.height - el.height * dpr) > tol) return `crop ${png.width}x${png.height} is not the element's box (${Math.round(el.width * dpr)}x${Math.round(el.height * dpr)})`;
  return null;
}

function machine(): Record<string, unknown> {
  const sh = (cmd: string, args: string[]) => {
    try {
      return execFileSync(cmd, args, { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  const app = process.env.HPS_APP_PATH ?? null;
  const manifest = app ? path.join(path.dirname(app.replace(/\/Contents\/MacOS\/.*$/, "")), "manifest.json") : null;
  return {
    model: sh("sysctl", ["-n", "hw.model"]),
    cpu: os.cpus()[0]?.model ?? null,
    macos: sh("sw_vers", ["-productVersion"]),
    app,
    app_build: manifest && fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : null,
    head: sh("git", ["-C", repo, "rev-parse", "HEAD"]),
  };
}

// ── the App ────────────────────────────────────────────────────────────────

/** Launch with the kiosk fixture and open its preview; returns the preview origin. */
async function openKioskPreview(): Promise<{ app: ElectronApplication; win: Page; wsDir: string; origin: string }> {
  await svc.start(true);
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
  const origin = new URL((await previewUrl(app))!).origin;
  await expect.poll(() => pageReady(app, origin), { timeout: 30_000 }).toBe(true);
  return { app, win, wsDir, origin };
}

/** Is the preview tab's document loaded? */
async function pageReady(app: ElectronApplication, origin: string): Promise<boolean> {
  return app.evaluate(async ({ webContents }, o) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`${o}/`));
    if (!wc) return false;
    try {
      return (await wc.executeJavaScript("document.readyState")) === "complete";
    } catch {
      return false;
    }
  }, origin);
}

/**
 * Start a main-process watcher for one save: it asks the preview tab every 10 ms whether the
 * new document carries `marker`, and keeps the wall-clock time it first did.
 */
async function watchForMarker(app: ElectronApplication, origin: string, marker: string): Promise<void> {
  await app.evaluate(({ webContents }, a) => {
    type Watch = { want: string; seenAt: number; stop: boolean; busy: boolean };
    const g = globalThis as unknown as { __crT55?: Watch };
    if (g.__crT55) g.__crT55.stop = true;
    const s: Watch = { want: a.marker, seenAt: 0, stop: false, busy: false };
    g.__crT55 = s;
    const probe = `document.readyState === "complete" && ((document.querySelector('meta[name="hp-save"]') || {}).content || "")`;
    const tick = async () => {
      if (s.stop || s.seenAt) return;
      if (!s.busy) {
        s.busy = true;
        try {
          const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`${a.origin}/`));
          if (wc && (await wc.executeJavaScript(probe)) === s.want) s.seenAt = Date.now();
        } catch {
          /* the document is being replaced; ask again */
        } finally {
          s.busy = false;
        }
      }
      if (!s.seenAt && !s.stop) setTimeout(tick, 10);
    };
    void tick();
  }, { origin, marker });
}

async function markerSeenAt(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as { __crT55?: { seenAt: number } }).__crT55?.seenAt ?? 0);
}
async function stopWatching(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as unknown as { __crT55?: { stop: boolean } };
    if (g.__crT55) g.__crT55.stop = true;
  });
}

/** One save → refresh sample (ms), or a failure line. */
async function refreshSample(app: ElectronApplication, wsDir: string, origin: string, original: string, n: string): Promise<number | string> {
  await watchForMarker(app, origin, n);
  const t0 = Date.now();
  fs.writeFileSync(path.join(wsDir, "index.html"), original.replace("<head>", `<head><meta name="hp-save" content="${n}">`));
  const end = t0 + 15_000;
  let seen = 0;
  while (!seen && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 25));
    seen = await markerSeenAt(app);
  }
  await stopWatching(app);
  // The reloaded page opens its live-reload stream again on load; give it time before the next save.
  await new Promise((r) => setTimeout(r, 700));
  return seen ? seen - t0 : `save ${n}: the preview did not show the new document within 15 s`;
}

/**
 * Planted delay (CR-T55 negative): the preview tab's own session holds every document request
 * of the preview origin for 3 s. Refused if that session is the window's default session,
 * whose request handler is VS Code's (installing ours there would replace it).
 */
async function plantRefreshDelay(app: ElectronApplication, origin: string, on: boolean): Promise<string> {
  return app.evaluate(({ webContents, session }, a) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`${a.origin}/`));
    if (!wc) return "no preview tab";
    if (wc.session === session.defaultSession) return "the preview uses the default session; nothing planted";
    if (!a.on) {
      wc.session.webRequest.onBeforeRequest(null);
      return "removed";
    }
    wc.session.webRequest.onBeforeRequest({ urls: [`${a.origin}/*`] }, (details, callback) => {
      const doc = details.resourceType === "mainFrame" || details.resourceType === "subFrame";
      if (doc && !details.url.includes("/__hp_livereload")) setTimeout(() => callback({}), a.delay);
      else callback({});
    });
    return "planted";
  }, { origin, on, delay: PLANTED_DELAY_MS });
}

test("CR-T55 in-app: preview refresh after a file save, p50 under 2 s; a planted 3 s delay is a miss", async () => {
  const { app, wsDir, origin } = await openKioskPreview();
  const original = fs.readFileSync(path.join(wsDir, "index.html"), "utf8");
  // Instrument control: the watcher reads the document the tab shows now (no marker yet).
  await watchForMarker(app, origin, "");
  await expect.poll(() => markerSeenAt(app), { timeout: 10_000 }).toBeGreaterThan(0);
  await stopWatching(app);

  const samples: number[] = [];
  const failures: string[] = [];
  for (let i = 1; i <= SAMPLES; i++) {
    const s = await refreshSample(app, wsDir, origin, original, `s${i}`);
    if (typeof s === "number") samples.push(s);
    else failures.push(s);
  }
  const verdict = timingVerdict(samples, SAMPLES, REFRESH_LIMIT_MS, failures);

  // Negative control: the same instrument, the refresh path delayed by 3 s.
  const planted = await plantRefreshDelay(app, origin, true);
  const slow: number[] = [];
  const slowFailures: string[] = [];
  try {
    for (let i = 1; i <= PLANTED_SAMPLES; i++) {
      const s = await refreshSample(app, wsDir, origin, original, `planted${i}`);
      if (typeof s === "number") slow.push(s);
      else slowFailures.push(s);
    }
  } finally {
    await plantRefreshDelay(app, origin, false);
  }
  const plantedVerdict = timingVerdict(slow, PLANTED_SAMPLES, REFRESH_LIMIT_MS, slowFailures);
  record["CR-T55"] = { limit_ms: REFRESH_LIMIT_MS, verdict, samples, planted: { how: planted, delay_ms: PLANTED_DELAY_MS, verdict: plantedVerdict, samples: slow } };

  expect(planted, "instrument: the delay was planted on the preview's own session").toBe("planted");
  expect(plantedVerdict.met, `negative control: a planted ${PLANTED_DELAY_MS} ms delay is reported as a miss (${JSON.stringify(plantedVerdict)})`).toBe(false);
  expect(slow.every((s) => s >= PLANTED_DELAY_MS), "negative control: every planted sample carries the delay").toBe(true);
  expect(verdict.failures, "every save refreshed the preview").toEqual([]);
  expect(verdict.n).toBe(SAMPLES);
  expect(verdict.met, `CR-59: p50 ${verdict.p50} ms under ${REFRESH_LIMIT_MS} ms (n=${verdict.n}, p95 ${verdict.p95}, max ${verdict.max})`).toBe(true);
});

/**
 * Every chat surface the App has drawn: the "AI와 작업" editor and, once a pick has focused it, the
 * sidebar view. The host posts the queued element to both (`ChatPanelProvider.post`), so the clock
 * runs in each and the earliest one counts.
 */
async function chatSurfaces(win: Page): Promise<FrameLocator[]> {
  const out: FrameLocator[] = [];
  const n = await win.locator("iframe.webview.ready").count();
  for (let i = 0; i < n; i++) {
    const f = win.frameLocator("iframe.webview.ready").nth(i).frameLocator("#active-frame");
    if ((await f.locator(".hps-shell").count().catch(() => 0)) > 0) out.push(f);
  }
  return out;
}

/** Arm the chat-side clock in every surface: the wall-clock time the queued element first shows with its crop. */
async function armChipClocks(win: Page): Promise<void> {
  for (const chat of await chatSurfaces(win)) {
    await chat.locator(".hps-shell").evaluate(() => {
      const w = window as unknown as { __crChipAt?: number; __crChipObs?: MutationObserver };
      w.__crChipAt = 0;
      const seen = () => !!document.querySelector('[data-testid="element-context"] img.hps-element-crop');
      if (!w.__crChipObs) {
        w.__crChipObs = new MutationObserver(() => {
          if (!w.__crChipAt && seen()) w.__crChipAt = Date.now();
        });
        w.__crChipObs.observe(document.body, { subtree: true, childList: true, attributes: true });
      }
    });
  }
}

/** The earliest surface that showed the element, with its crop's data URL; 0 when none has yet. */
async function firstChip(win: Page): Promise<{ at: number; src: string | null }> {
  let best = { at: 0, src: null as string | null };
  for (const chat of await chatSurfaces(win)) {
    const at = await chat.locator(".hps-shell").evaluate(() => (window as unknown as { __crChipAt?: number }).__crChipAt ?? 0).catch(() => 0);
    if (at && (!best.at || at < best.at)) best = { at, src: await chat.locator('[data-testid="element-context"] img.hps-element-crop').first().getAttribute("src").catch(() => null) };
  }
  return best;
}

/** Take the queued element off with the student's own ✕ (on whichever surface shows it) and wait until no surface shows it. */
async function removeQueuedElement(win: Page): Promise<void> {
  for (const chat of await chatSurfaces(win)) {
    const x = chat.locator('[data-testid="element-context"] .hps-element-remove');
    if (await x.isVisible().catch(() => false)) {
      await x.click();
      break;
    }
  }
  await expect.poll(async () => {
    let n = 0;
    for (const chat of await chatSurfaces(win)) n += await chat.locator('[data-testid="element-context"]').count().catch(() => 0);
    return n;
  }, { timeout: 15_000 }).toBe(0);
}

/** Bring the "AI와 작업" editor tab forward (opening index.html covers it); the preview sits in the other group. */
async function chatTabForward(win: Page): Promise<void> {
  const tab = win.locator(".tabs-container .tab", { hasText: "AI와 작업" }).first();
  if ((await tab.count()) > 0) await tab.click().catch(() => undefined);
}

/** Click an element of the preview tab like a person: returns the wall-clock time of the press and the element's geometry. */
async function clickInPreview(app: ElectronApplication, origin: string, id: string) {
  return app.evaluate(async ({ webContents }, a) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`${a.origin}/`))!;
    const geo = await wc.executeJavaScript(`(() => { const r = document.getElementById(${JSON.stringify(a.id)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), width: r.width, height: r.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio }; })()`);
    wc.sendInputEvent({ type: "mouseMove", x: geo.x, y: geo.y });
    const pressedAt = Date.now();
    wc.sendInputEvent({ type: "mouseDown", x: geo.x, y: geo.y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x: geo.x, y: geo.y, button: "left", clickCount: 1 });
    return { pressedAt, geo };
  }, { origin, id });
}

test("CR-T56 in-app: element capture to agent context, p50 under 1 s with the element's crop; a planted full-page screenshot is a miss", async () => {
  const { app, win, origin } = await openKioskPreview();
  const samples: number[] = [];
  const failures: string[] = [];
  const misses: string[] = [];
  const crops: Array<{ png: { width: number; height: number } | null; el: { width: number; height: number }; dpr: number }> = [];
  let last: { geo: { width: number; height: number; vw: number; vh: number; dpr: number } } | null = null;
  for (let i = 1; i <= SAMPLES; i++) {
    await chatTabForward(win);
    if (i > 1) await removeQueuedElement(win);
    await armChipClocks(win);
    await runCommand(win, PICK);
    // Inspect mode starts right after the host's notice; the clock starts at the click, not here.
    await win.waitForTimeout(900);
    const { pressedAt, geo } = await clickInPreview(app, origin, "begin");
    last = { geo };
    const end = Date.now() + 20_000;
    let chip = { at: 0, src: null as string | null };
    while (!chip.at && Date.now() < end) {
      await win.waitForTimeout(10);
      chip = await firstChip(win);
    }
    if (!chip.at) {
      const notices: string[] = [];
      for (const chat of await chatSurfaces(win)) notices.push(...(await chat.locator(".hps-page-notice").allInnerTexts().catch(() => [])));
      failures.push(`pick ${i}: no element reached the chat within 20 s (notices: ${JSON.stringify(notices)})`);
      continue;
    }
    samples.push(chip.at - pressedAt);
    const png = chip.src ? pngSize(chip.src.replace(/^data:image\/png;base64,/, "")) : null;
    crops.push({ png, el: { width: geo.width, height: geo.height }, dpr: geo.dpr });
    const problem = cropProblem(png, geo, { width: geo.vw, height: geo.vh }, geo.dpr);
    if (problem) misses.push(`pick ${i}: ${problem}`);
  }
  const verdict = timingVerdict(samples, SAMPLES, CAPTURE_LIMIT_MS, failures, misses);

  // Negative control: the same crop check, fed a full-page screenshot of the same tab in place of the crop.
  const full = await app.evaluate(async ({ webContents }, o) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`${o}/`))!;
    return (await wc.capturePage()).toPNG().toString("base64");
  }, origin);
  const fullPng = pngSize(full);
  const plantedProblem = last ? cropProblem(fullPng, last.geo, { width: last.geo.vw, height: last.geo.vh }, last.geo.dpr) : "no sample";
  const plantedVerdict = timingVerdict(samples, SAMPLES, CAPTURE_LIMIT_MS, failures, plantedProblem ? [...misses, `planted: ${plantedProblem}`] : misses);
  record["CR-T56"] = { limit_ms: CAPTURE_LIMIT_MS, verdict, samples, crops: crops.slice(0, 3), planted: { full_page: fullPng, problem: plantedProblem, verdict: plantedVerdict } };

  expect(plantedProblem, "negative control: a full-page screenshot in place of the crop is reported").toMatch(/whole viewport/);
  expect(plantedVerdict.met, "negative control: the sample set with the planted crop is a miss").toBe(false);
  expect(verdict.failures, "every pick reached the chat").toEqual([]);
  expect(verdict.misses, "every crop is the element's box").toEqual([]);
  expect(verdict.met, `CR-60: p50 ${verdict.p50} ms under ${CAPTURE_LIMIT_MS} ms (n=${verdict.n}, p95 ${verdict.p95}, max ${verdict.max})`).toBe(true);
});
