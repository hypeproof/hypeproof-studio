// Microphone replay e2e (DEC-03). Replays generated WAV files through Chromium's fake capture
// device into a hidden, throwaway copy of the built Studio app, and checks who may capture and
// what the capture carries. The real-Mac check (OS prompt, indicator, real device) is meant to
// come last, after this passes.
//
//   node e2e/mic-replay/run.mjs [--only 1,2,5] [--self-test]
//
// Env: HPS_APP_PATH  a prepared copy of HypeProof Studio.app (default: an APFS clone of the
//                    installed app, made and prepared under HPS_MIC_OUT; never the original)
//      HPS_MIC_OUT   evidence directory (default /tmp/hps-mic-replay)
//
// Isolation (README "Quiet mode"): the copy is LSUIElement, every window is stashed off-screen
// and unfocusable, the profile and workspace are temporary and removed after each launch, and
// secrets are in memory. Each fixture needs its own launch (the WAV is a launch switch), so
// launches run one after another, never in parallel.
//
// Nothing here bypasses permissions: no --use-fake-ui-for-media-stream. The fake device only
// replaces the audio SOURCE; the patch's permission set, iframe allow-lists and Electron's
// handlers decide as they do for a learner.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FIXTURES, RATE, audibleSegments, durationMs, encodeWav, samplesFor } from "./wav.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const extSrc = path.join(repo, "extensions", "hypeproof-chat", "src");
const webviewSrc = path.join(repo, "extensions", "hypeproof-chat", "webview-ui", "src");
const OUT = process.env.HPS_MIC_OUT || "/tmp/hps-mic-replay";
const CHAT_ID = "hypeproof.hypeproof-chat";
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? new Set(argv[argv.indexOf("--only") + 1].split(",")) : null;
const want = id => !only || only.has(String(id));

const results = [];
const record = (id, title, status, detail) => {
  results.push({ id: String(id), title, status, detail });
  console.log(`${status.padEnd(8)} ${String(id).padEnd(4)} ${title}${detail?.why ? ` — ${detail.why}` : ""}`);
};
const check = (id, title, fn) => {
  try {
    const detail = fn();
    record(id, title, "pass", detail);
  } catch (e) {
    record(id, title, "fail", { why: e.message, ...(e.detail || {}) });
  }
};
const fail = (why, detail) => Object.assign(new Error(why), { detail });

// ─── source facts, read at run time ───

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []);

function webviewSurfaces() {
  const panels = [];
  const views = [];
  for (const file of walk(extSrc)) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const rel = path.relative(extSrc, file);
    for (const m of src.matchAll(/createWebviewPanel\s*\(\s*(?:(["'`])([^"'`]+)\1)?/g)) panels.push({ file: rel, viewType: m[2] || "<computed>" });
    for (const m of src.matchAll(/registerWebviewViewProvider\s*\(\s*(?:(["'`])([^"'`]+)\1)?/g)) views.push({ file: rel, viewId: m[2] || "<computed>" });
  }
  return { panels, views };
}

// How the harness opens each panel. A panel file with no entry fails scenario 2, so a new
// panel cannot slip past the count.
const OPENERS = {
  "startPage.ts": { command: "hypeproof-chat.start" },
  "localReviewPanel.ts": { command: "hypeproof-chat.localReview" },
  // The normal preview (hypeproof-chat.previewActiveFile -> openBrowser) shows the learner page in
  // VS Code's browser view, measured as scenario 3. This webview panel is the srcdoc fallback.
  "previewProvider.ts": { unreachable: "srcdoc fallback: opens only when the live server fails, or from a page card after a coach turn; the normal preview path is scenario 3" },
  "artifactHistoryPanel.ts": { command: "hypeproof-chat.artifactHistory", fileArg: true, mayNotOpen: "opens only when the activity enables artifact history" },
  "imageEditCommands.ts": { unreachable: "opens after a coach image edit completes (hypeproof-chat.editImage needs a model round trip)" },
  "personalContinuationHost.ts": { unreachable: "opens from the personal Claude Code hand-off flow, which needs a signed-in session" },
  "slideStudioHost.ts": { unreachable: "opens from a deck draft (hypeproof-chat.deckDraft needs a wiki plan and a model)" },
  "visitorPreviewHost.ts": { unreachable: "opens from the publish flow after a site is staged (needs Service publish state)" },
  "workTakeawayPanel.ts": { unreachable: "opens from hypeproof-chat.takeMyWork after a destination is chosen in a native dialog" },
};

// Voice product code that does not exist yet. Each becomes a failing scenario the moment the
// source shows it is wired, so it cannot stay "pending" silently.
const PENDING = [
  { id: "P1", title: "VoicePanel mounted in the chat view replays the WAV into its level meter",
    hook: "webview-ui/src/VoicePanel.tsx imported by a mounted component",
    wired: () => grepWebview(/from\s+["']\.\/VoicePanel["']/, f => !/VoicePanel\.tsx$/.test(f)) },
  { id: "P2", title: "dictation: replayed speech becomes a composer draft (STT transcript)",
    hook: "getUserMedia in webview-ui/src outside voiceProbe.ts (the capture path STT will read)",
    wired: () => grepWebview(/getUserMedia/, f => !/voiceProbe\.ts$/.test(f)) },
  { id: "P3", title: "read-aloud: TTS playback stops on output mute while capture stays live (CGP-VOICE-R-002)",
    hook: "speechSynthesis / new Audio( / createBufferSource in webview-ui/src outside voiceProbe.ts",
    wired: () => grepWebview(/speechSynthesis|new Audio\(|createBufferSource/, f => !/voiceProbe\.ts$/.test(f)) },
];
function grepWebview(re, keep) {
  return walk(webviewSrc).filter(keep).filter(f => re.test(stripComments(fs.readFileSync(f, "utf8")))).map(f => path.relative(webviewSrc, f));
}

/** Panels the app under test actually ships (its bundled extension), to show skew against source. */
function shippedPanelCount() {
  try {
    const bundle = path.join(preparedApp(), "Contents", "Resources", "app", "extensions", "hypeproof-chat", "dist", "extension.js");
    return (fs.readFileSync(bundle, "utf8").match(/createWebviewPanel\(/g) || []).length;
  } catch { return null; }
}

// ─── disk watch (scenario 8) ───

const AUDIO_MAGIC = [["RIFF", 0], ["OggS", 0], ["fLaC", 0], ["ID3", 0], ["ftypM4A", 4]].map(([s, at]) => ({ bytes: Buffer.from(s), at }));
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const AUDIO_EXT = /\.(wav|webm|ogg|oga|opus|m4a|mp3|flac|aac|pcm|caf)$/i;

function snapshot(dirs) {
  const map = new Map();
  for (const d of dirs) {
    const stack = [d];
    while (stack.length) {
      const cur = stack.pop();
      let entries;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) { try { const s = fs.statSync(p); map.set(p, `${s.size}:${s.mtimeMs}`); } catch { /* gone */ } }
      }
    }
  }
  return map;
}
function audioWrites(before, after) {
  const changed = [...after.keys()].filter(p => before.get(p) !== after.get(p));
  const hits = [];
  for (const p of changed) {
    let head;
    try { const fd = fs.openSync(p, "r"); head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd); } catch { continue; }
    const magic = AUDIO_MAGIC.find(m => head.subarray(m.at, m.at + m.bytes.length).equals(m.bytes) && !(m.bytes.toString() === "RIFF" && head.subarray(8, 12).toString() !== "WAVE"));
    if (magic || head.subarray(0, 4).equals(EBML) || AUDIO_EXT.test(p)) hits.push(p);
  }
  return { changed: changed.length, hits };
}

// ─── in-page capture probe ───

// Runs inside one webview frame. Raw observations only; the harness judges.
const CAPTURE = `async (o) => {
  const r = { href: location.href.slice(0, 160), stage: "start" };
  const within = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(label + " did not settle in " + ms + " ms"), { name: "Timeout" })), ms))]);
  try { const pp = document.permissionsPolicy || document.featurePolicy; r.policy = pp ? pp.allowsFeature("microphone") : null; } catch (e) { r.policy = "error"; }
  const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
  const analyse = (chunks, rate) => {
    const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n);
    let k = 0; for (const c of chunks) { all.set(c, k); k += c.length; }
    let sum = 0, peak = 0, rail = 0; for (const v of all) { sum += v * v; const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) rail++; }
    const B = Math.round(rate * 0.05), blocks = [];
    for (let i = 0; i + B <= n; i += B) { let s = 0, z = 0; for (let j = i; j < i + B; j++) { s += all[j] * all[j]; if (j > i && (all[j - 1] < 0) !== (all[j] < 0)) z++; } blocks.push([Math.round(Math.sqrt(s / B) * 1e4) / 1e4, Math.round(z / 2 / 0.05)]); }
    return { samples: n, rms: n ? Math.sqrt(sum / n) : 0, peak, railFraction: n ? rail / n : 0, blocks };
  };
  const open = async (ctx) => {
    const t0 = performance.now();
    const s = await within(navigator.mediaDevices.getUserMedia(constraints), 8000, "getUserMedia");
    const chunks = [], tail = []; let phase = "rec";
    const src = ctx.createMediaStreamSource(s), proc = ctx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = e => { const c = new Float32Array(e.inputBuffer.getChannelData(0)); if (phase === "rec") chunks.push(c); else if (phase === "tail") tail.push({ t: performance.now(), max: c.reduce((m, v) => Math.max(m, Math.abs(v)), 0) }); };
    src.connect(proc); proc.connect(ctx.destination);
    return { s, track: s.getAudioTracks()[0], gumMs: performance.now() - t0, chunks, tail, setPhase: p => { phase = p; }, close: () => { src.disconnect(); proc.disconnect(); } };
  };
  r.title = (document.title || document.querySelector("h1,h2")?.textContent || "").trim().slice(0, 80);
  r.stage = "audiocontext";
  const ctx = new AudioContext(); try { await within(ctx.resume(), 1500, "AudioContext.resume"); } catch (e) { r.resumeError = e.message; }
  r.ctxState = ctx.state; r.rate = ctx.sampleRate;
  r.stage = "getUserMedia";
  let cap;
  try { cap = await open(ctx); } catch (e) { r.error = { name: e.name, message: String(e.message).slice(0, 200) }; await ctx.close(); return r; }
  r.stage = "recording";
  r.gumMs = cap.gumMs; r.label = cap.track.label; r.readyState = cap.track.readyState;
  try { r.devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput").map(d => d.label); } catch {}
  await new Promise(res => setTimeout(res, o.ms));
  cap.setPhase("tail");
  const stopAt = performance.now();
  cap.s.getTracks().forEach(t => t.stop());
  r.readyStateAfterStop = cap.track.readyState;
  await new Promise(res => setTimeout(res, 400));
  const quiet = cap.tail.find(x => x.t > stopAt && x.max < 1e-6);
  r.silentAfterStopMs = quiet ? quiet.t - stopAt : null;
  cap.close();
  Object.assign(r, analyse(cap.chunks, ctx.sampleRate));
  if (o.reopen) { const t1 = performance.now(); try { const again = await open(ctx); r.reopenMs = performance.now() - t1; again.s.getTracks().forEach(t => t.stop()); again.close(); } catch (e) { r.reopenError = e.name; } }
  if (o.cycles) {
    const tracks = [], levels = [];
    for (let i = 0; i < o.cycles; i++) {
      const c = await open(ctx); tracks.push(c.track);
      await new Promise(res => setTimeout(res, 150));
      levels.push(analyse(c.chunks, ctx.sampleRate).rms);
      c.s.getTracks().forEach(t => t.stop()); c.close();
    }
    r.cycles = { n: tracks.length, live: tracks.filter(t => t.readyState !== "ended").length, levels };
  }
  try { await within(ctx.close(), 1500, "AudioContext.close"); } catch {}
  r.stage = "done";
  return r;
}`;

// ─── CDP over the app's remote debugging port ───

async function cdpTargets(port) {
  return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
}
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p[1](new Error(m.error.message)) : p[0](m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, [res, rej]); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Page.enable");
  const { frameTree } = await send("Page.getFrameTree");
  const frames = [];
  const visit = (t, depth) => { frames.push({ id: t.frame.id, url: t.frame.url, name: t.frame.name || "", depth }); for (const c of t.childFrames || []) visit(c, depth + 1); };
  visit(frameTree, 0);
  const evaluate = async (frameId, fn, arg) => {
    const { executionContextId } = await send("Page.createIsolatedWorld", { frameId, worldName: "hps-mic-replay" });
    const out = await withTimeout(send("Runtime.evaluate", { expression: `(${fn})(${JSON.stringify(arg)})`, contextId: executionContextId, returnByValue: true, awaitPromise: true, userGesture: true }), 120000, "Runtime.evaluate");
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    return out.result.value;
  };
  return { frames, evaluate, close: () => ws.close() };
}

const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms))]);
const step = msg => console.log(`  · ${msg}`);

const webviewParams = url => { try { return new URL(url).searchParams; } catch { return new URLSearchParams(); } };
const isWebviewShell = t => t.type === "iframe" && t.url.startsWith("vscode-webview://");

// VS Code writes the extension's HTML into the shell's child iframe, named active-frame
// (pending-frame while it loads). Its URL is the shell's, so the name and depth pick it.
const contentFrame = frames => frames.find(f => f.name === "active-frame") || frames.filter(f => f.depth > 0).sort((a, b) => b.depth - a.depth)[0];

/** Capture in the extension's content frame, or in the frame `pickFrame` selects. */
async function captureIn(target, opts, pickFrame) {
  const c = await connect(target);
  try {
    const frame = pickFrame ? c.frames.find(pickFrame) : contentFrame(c.frames);
    if (!frame) throw new Error(`no matching frame in ${target.url.slice(0, 120)} (frames: ${JSON.stringify(c.frames.map(f => ({ name: f.name, depth: f.depth, url: f.url.slice(0, 200) })))})`);
    return { frameUrl: frame.url.slice(0, 120), ...(await c.evaluate(frame.id, CAPTURE, opts)) };
  } finally { c.close(); }
}

// ─── app launch ───

function preparedApp() {
  if (process.env.HPS_APP_PATH) {
    const app = process.env.HPS_APP_PATH.split("/Contents/MacOS/")[0];
    assert(!/^\/Applications\//.test(fs.realpathSync(app)), "HPS_APP_PATH must be a prepared copy, never /Applications");
    return app;
  }
  const source = "/Applications/HypeProof Studio.app";
  const version = execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", `${source}/Contents/Info.plist`], { encoding: "utf8" }).trim();
  const dir = path.join(OUT, `app-${version}`);
  const copy = path.join(dir, "HypeProof Studio.app");
  if (!fs.existsSync(path.join(dir, ".prepared"))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("cp", ["-cR", source, dir]); // APFS clone: no extra disk until written
    execFileSync("bash", [path.join(repo, "scripts", "prep-test-app.sh"), copy], { stdio: "inherit" });
    fs.writeFileSync(path.join(dir, ".prepared"), version);
  }
  return copy;
}

let portSeq = 9400 + (process.pid % 200);

async function withApp(fixtureName, fn) {
  const fixture = FIXTURES[fixtureName];
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `hps-mic-${fixtureName}-`)));
  const userData = path.join(work, "user-data"), extDir = path.join(work, "extensions"), ws = path.join(work, "ws"), probeDir = path.join(work, "probe");
  for (const d of [path.join(userData, "User"), extDir, ws, probeDir]) fs.mkdirSync(d, { recursive: true });
  const wav = path.join(work, `${fixtureName}.wav`);
  fs.writeFileSync(wav, encodeWav(samplesFor(fixture)));
  fs.writeFileSync(path.join(ws, "index.html"), "<!doctype html><html><head><meta charset=\"utf-8\"><title>learner page</title></head><body><h1>learner page</h1></body></html>");
  fs.writeFileSync(path.join(userData, "User", "settings.json"), JSON.stringify({
    "hypeproofChat.proxyUrl": "http://127.0.0.1:9/v1", // never production
    "workbench.startupEditor": "none", "update.mode": "none", "telemetry.telemetryLevel": "off",
    "security.workspace.trust.enabled": false, "window.restoreWindows": "none",
    "hpsMicProbe.dir": probeDir,
  }));
  const port = portSeq++;
  const appPath = preparedApp();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(API_KEY|AUTH_TOKEN|SECRET|PASSWORD|TOKEN)/.test(k)));
  const { _electron: electron } = await import("@playwright/test");
  let app;
  try {
    app = await electron.launch({
      executablePath: path.join(appPath, "Contents", "MacOS", "HypeProof Studio"),
      args: [
        `--user-data-dir=${userData}`, `--extensions-dir=${extDir}`, `--extensionDevelopmentPath=${path.join(here, "probe-extension")}`,
        "--use-inmemory-secretstorage", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-updates",
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
        // The audio service sandbox cannot read the WAV path, so the fake device delivered
        // zeros (measured). This changes the audio SOURCE process only, not any permission gate.
        "--disable-features=AudioServiceSandbox",
        "--autoplay-policy=no-user-gesture-required",
        ...(process.env.HPS_MIC_EXTRA_ARGS ? process.env.HPS_MIC_EXTRA_ARGS.split(" ") : []),
        "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}${fixture.loop ? "" : "%noloop"}`,
        `--remote-debugging-port=${port}`, "--folder-uri", pathToFileURL(ws).href,
      ],
      env: { ...env, HPS_MIC_PROBE_DIR: probeDir },
      timeout: 60000,
    });
    await app.evaluate(({ app: a, BrowserWindow }) => {
      try { a.dock?.hide(); } catch {}
      const stash = w => { try { w.setFocusable(false); w.setPosition(-4000, -4000); w.showInactive?.(); } catch {} };
      const wire = w => { stash(w); if (w.__hps) return; w.once?.("ready-to-show", () => stash(w)); w.on?.("show", () => stash(w)); w.__hps = true; };
      BrowserWindow.getAllWindows().forEach(wire);
      a.on("browser-window-created", (_e, w) => wire(w));
    });
    await app.firstWindow();
    step(`launched ${fixtureName} (CDP ${port})`);
    const deadline = Date.now() + 60000;
    while (!fs.existsSync(path.join(probeDir, "ready.json"))) {
      if (Date.now() > deadline) throw new Error("probe extension never activated");
      await new Promise(r => setTimeout(r, 200));
    }
    let n = 0;
    const op = async req => {
      const i = n++;
      fs.writeFileSync(path.join(probeDir, `req-${i}.json`), JSON.stringify(req));
      const res = path.join(probeDir, `res-${i}.json`), end = Date.now() + 30000;
      while (!fs.existsSync(res)) { if (Date.now() > end) throw new Error(`probe op timed out: ${JSON.stringify(req)}`); await new Promise(r => setTimeout(r, 100)); }
      const out = JSON.parse(fs.readFileSync(res, "utf8"));
      if (!out.ok) throw new Error(`${JSON.stringify(req)}: ${out.error}`);
      return out.value;
    };
    const waitNewTargets = async (before, ms = 8000) => {
      const end = Date.now() + ms;
      let fresh = [];
      while (Date.now() < end) {
        fresh = (await cdpTargets(port)).filter(t => isWebviewShell(t) && !before.has(t.id));
        if (fresh.length) { await new Promise(r => setTimeout(r, 1500)); return (await cdpTargets(port)).filter(t => isWebviewShell(t) && !before.has(t.id)); }
        await new Promise(r => setTimeout(r, 250));
      }
      return fresh;
    };
    return await fn({ port, op, waitNewTargets, fixture, dirs: { userData, extDir, ws, work } });
  } catch (e) {
    // Keep the logs (not the profile) as evidence before the profile is removed.
    const logs = path.join(OUT, `logs-${fixtureName}-${Date.now()}`);
    try { fs.cpSync(path.join(userData, "logs"), logs, { recursive: true }); console.error(`logs kept: ${logs}`); } catch {}
    throw e;
  } finally {
    if (app) { try { await app.close(); } catch (e) { console.error("close failed:", e.message); } }
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ─── judgments ───

const expectedRms = name => { const s = samplesFor(FIXTURES[name]); return Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length); };
const loudBlocks = r => r.blocks.filter(([rms]) => rms > 0.02);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const denied = r => {
  if (!r.error) throw fail(`capture was GRANTED (label ${r.label}, readyState ${r.readyState})`, r);
  if (r.error.name !== "NotAllowedError") throw fail(`expected NotAllowedError, got ${r.error.name}: ${r.error.message}`, r);
  return { policy: r.policy, error: r.error };
};
const granted = r => {
  if (r.error) throw fail(`capture failed: ${r.error.name}: ${r.error.message}`, r);
  if (r.readyState !== "live") throw fail(`track readyState ${r.readyState}`, r);
  if (!/fake/i.test(r.label || "")) throw fail(`track label "${r.label}" is not the fake device: the switch was not honoured`, r);
};

function judgeEnvelope(name, r) {
  // Played-once fixtures: the audible blocks must line up with the file's segments, in order,
  // and after the end the file must not start again. Measured on Chromium's fake device: with
  // %noloop it HOLDS the last frame after the end (the last tone continues) instead of going
  // silent, so the restart test looks for the file's beginning (its leading silence, and its
  // first tone when that differs from the last), not for silence.
  const segs = audibleSegments(FIXTURES[name]);
  const blocks = r.blocks.map(([rms, f], i) => ({ i, rms, f }));
  const first = blocks.find(b => b.rms > 0.02);
  if (!first) throw fail("no audible block captured", r);
  const offset = first.i * 50 - segs[0].startMs; // capture started after the device did
  const seen = segs.map(s => {
    const inside = blocks.filter(b => b.i * 50 - offset >= s.startMs + 50 && (b.i + 1) * 50 - offset <= s.endMs - 50);
    return { freq: s.freq, blocks: inside.length, medianFreq: median(inside.map(b => b.f)), minRms: Math.min(...inside.map(b => b.rms)) };
  });
  for (const s of seen) {
    if (!s.blocks) throw fail(`segment ${s.freq} Hz has no captured blocks (truncated)`, { seen, offset });
    if (s.minRms < 0.1) throw fail(`segment ${s.freq} Hz truncated or dropped out (min rms ${s.minRms})`, { seen, offset });
    if (Math.abs(s.medianFreq - s.freq) > s.freq * 0.08) throw fail(`segment ${s.freq} Hz measured ${s.medianFreq} Hz (out of order or not this file)`, { seen, offset });
  }
  const endMs = segs.at(-1).endMs;
  const after = blocks.filter(b => b.i * 50 - offset > endMs + 100);
  if (!after.length) throw fail("capture window ended before the file did", { seen, offset });
  const firstFreq = segs[0].freq, lastFreq = segs.at(-1).freq;
  const gap = after.findIndex(b => b.rms < 0.02);
  const soundAfterGap = gap >= 0 && after.slice(gap).some(b => b.rms > 0.02); // the lead-in silence, then the file again
  const firstToneAgain = firstFreq !== lastFreq && after.some(b => b.rms > 0.02 && Math.abs(b.f - firstFreq) < firstFreq * 0.08);
  const restarted = soundAfterGap || firstToneAgain;
  if (restarted) throw fail("the file started again after its end: it looped (%noloop not honoured)", { seen, offset, tail: after.slice(0, 8) });
  // Every audible block after the end must be the last tone (held); anything else is foreign audio.
  if (after.some(b => b.rms > 0.02 && Math.abs(b.f - lastFreq) >= lastFreq * 0.08)) throw fail("unexpected audio after the file's end", { seen, offset, tail: after.slice(0, 8) });
  const tail = after.every(b => b.rms < 0.005) ? "silent" : "holds last frame";
  return { offsetMs: offset, segments: seen.map(x => `${x.freq}Hz:${x.medianFreq}`), fileMs: durationMs(FIXTURES[name]), afterEnd: tail };
}

// ─── self-test: controls for the judges, no app ───

function selfTest() {
  const tone = { error: null, readyState: "live", label: "Fake Default Audio Input" };
  assert.doesNotThrow(() => granted(tone));
  assert.throws(() => granted({ ...tone, label: "MacBook Pro Microphone" }), /not the fake device/);
  assert.throws(() => granted({ error: { name: "NotAllowedError", message: "x" } }), /capture failed/);
  assert.doesNotThrow(() => denied({ error: { name: "NotAllowedError", message: "x" } }));
  assert.throws(() => denied(tone), /GRANTED/);
  assert.throws(() => denied({ error: { name: "NotFoundError", message: "x" } }), /expected NotAllowedError/);
  // Envelope judge against a synthetic perfect capture of `long`, then against a looped and a truncated one.
  const blocksOf = (samples, leadMs) => {
    const pad = new Array(Math.round(RATE * leadMs / 1000)).fill(0).concat(samples, new Array(RATE).fill(0));
    const B = RATE * 0.05, out = [];
    for (let i = 0; i + B <= pad.length; i += B) { let s = 0, z = 0; for (let j = i; j < i + B; j++) { s += pad[j] ** 2; if (j > i && (pad[j - 1] < 0) !== (pad[j] < 0)) z++; } out.push([Math.sqrt(s / B), Math.round(z / 2 / 0.05)]); }
    return out;
  };
  const long = samplesFor(FIXTURES.long);
  assert.doesNotThrow(() => judgeEnvelope("long", { blocks: blocksOf(long, 0) }), "positive control: a faithful capture with a silent tail passes");
  const holdLast = long.concat(Array.from({ length: RATE }, (_, i) => long[long.length - 2400 + (i % 2400)]));
  assert.doesNotThrow(() => judgeEnvelope("long", { blocks: blocksOf(holdLast, 0) }), "positive control: a tail that holds the last frame passes (measured fake-device behaviour)");
  const short = samplesFor(FIXTURES.short);
  assert.throws(() => judgeEnvelope("short", { blocks: blocksOf(short.concat(short, short), 0) }), /started again/, "negative control: a looped short file fails on its repeated lead-in silence");
  assert.throws(() => judgeEnvelope("long", { blocks: blocksOf(long.concat(long), 0) }), /started again/, "negative control: a looped capture fails");
  assert.throws(() => judgeEnvelope("long", { blocks: blocksOf(long.slice(0, long.length / 2), 0) }), /truncated|ended before/, "negative control: a truncated capture fails");
  assert.throws(() => judgeEnvelope("long", { blocks: blocksOf(samplesFor({ segments: [...FIXTURES.long.segments].reverse() }), 0) }), /measured/, "negative control: segments out of order fail");
  // Disk watch: an audio file written between snapshots must be found; a text file must not.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-mic-disk-"));
  try {
    const before = snapshot([tmp]);
    fs.writeFileSync(path.join(tmp, "notes.txt"), "hello");
    assert.deepEqual(audioWrites(before, snapshot([tmp])).hits, [], "positive control: a text write is not audio");
    fs.writeFileSync(path.join(tmp, "blob"), encodeWav([0, 0.1, 0.2]));
    fs.writeFileSync(path.join(tmp, "chunk"), Buffer.concat([EBML, Buffer.alloc(32)]));
    assert.equal(audioWrites(before, snapshot([tmp])).hits.length, 2, "negative control: WAV and WebM writes are caught by magic, not name");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log("self-test ok: judges and disk watch pass their positive and negative controls");
}

// ─── scenarios ───

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  selfTest();
  if (argv.includes("--self-test")) return;

  const { panels, views } = webviewSurfaces();
  for (const p of PENDING) {
    const wiredIn = p.wired();
    if (wiredIn.length) record(p.id, p.title, "fail", { why: `wired in ${wiredIn.join(", ")}: write this replay case now (hook: ${p.hook})` });
    else record(p.id, p.title, "pending", { why: `not wired yet; switches on when ${p.hook}` });
  }

  if (["1", "2", "3", "4", "6", "7", "8"].some(want)) {
    await withApp("tone", async ({ port, op, waitNewTargets, dirs }) => {
      const before = snapshot([dirs.userData, dirs.extDir, dirs.ws]);
      const known = () => cdpTargets(port).then(ts => new Set(ts.map(t => t.id)));

      // Chat view: the one surface the patch grants.
      let seen = await known();
      await op({ op: "command", command: "hypeproof-chat.panel.focus" });
      const chatTargets = (await waitNewTargets(seen, 20000)).filter(t => webviewParams(t.url).get("extensionId") === CHAT_ID && webviewParams(t.url).get("purpose") === "webviewView");
      const chat = chatTargets[0];
      step(`chat view target: ${chat ? chat.url.slice(0, 140) : "none"}`);
      let first;
      if (want(1) || want(7) || want(6)) first = chat ? await captureIn(chat, { ms: 1500, reopen: true, cycles: want(6) ? 10 : 0 }) : null;
      if (want(1)) check(1, "chat view: live track from the fake device, replayed tone has the file's level and pitch", () => {
        if (!chat) throw fail(`no hypeproof-chat webviewView target appeared (views in source: ${views.map(v => v.viewId).join(", ")})`);
        granted(first);
        const exp = expectedRms("tone"), loud = loudBlocks(first), f = median(loud.map(b => b[1]));
        if (first.policy !== true) throw fail(`allowsFeature('microphone') = ${first.policy}`, first);
        if (Math.abs(first.rms - exp) > exp * 0.25) throw fail(`rms ${first.rms.toFixed(4)} vs file ${exp.toFixed(4)}`, first);
        if (Math.abs(f - 523) > 40) throw fail(`dominant frequency ${f} Hz, file is 523 Hz`, first);
        return { rms: first.rms, expectedRms: exp, freq: f, label: first.label, gumMs: Math.round(first.gumMs), devices: first.devices };
      });
      if (want(6)) check(6, "10 start/stop cycles leave no live track and each cycle captured signal", () => {
        granted(first);
        const c = first.cycles;
        if (!c || c.n !== 10) throw fail(`ran ${c?.n} cycles`, first);
        if (c.live) throw fail(`${c.live} track(s) still live after stop`, c);
        if (c.levels.some(l => l < 0.02)) throw fail(`a cycle captured silence: ${c.levels.map(l => l.toFixed(3))}`, c);
        return c;
      });
      if (want(7)) check(7, "stop: track ends at once, pipeline silent within 250 ms, device reopens within 1000 ms", () => {
        granted(first);
        if (first.readyStateAfterStop !== "ended") throw fail(`readyState after stop: ${first.readyStateAfterStop}`, first);
        if (first.silentAfterStopMs == null || first.silentAfterStopMs > 250) throw fail(`pipeline silent after ${first.silentAfterStopMs} ms`, first);
        if (first.reopenError || !(first.reopenMs < 1000)) throw fail(`reopen ${first.reopenError || Math.round(first.reopenMs) + " ms"}`, first);
        return { silentAfterStopMs: Math.round(first.silentAfterStopMs), reopenMs: Math.round(first.reopenMs) };
      });

      // Every other hypeproof-chat webview, counted from source at run time.
      if (want(2) || want(3)) {
        const learner = null;
        // Open every reachable panel, then measure EVERY hypeproof-chat webview that is not the chat
        // view. Per-step attribution was unreliable (a panel's iframe can appear late or on reveal),
        // and the claim under test is about all of them anyway.
        const openers = [];
        const order = [...panels].sort((a, b) => (path.basename(b.file) === "startPage.ts") - (path.basename(a.file) === "startPage.ts"));
        for (const p of order) {
          const how = OPENERS[path.basename(p.file)];
          if (!how) { openers.push({ ...p, status: "fail", why: "new webview panel with no opener in OPENERS: add one" }); continue; }
          if (how.unreachable) { openers.push({ ...p, status: "not-reached", why: how.unreachable }); continue; }
          const req = how.preview
            ? { op: "command", command: "hypeproof-chat.previewActiveFile", args: [{ $uri: path.join(dirs.ws, "index.html") }] }
            : { op: "command", command: how.command, args: how.fileArg ? [{ $uri: path.join(dirs.ws, "index.html") }] : [] };
          try {
            await op(req);
            await new Promise(r => setTimeout(r, how.preview ? 6000 : 2000));
            if (!how.preview) await op(req); // reveal: a panel's iframe exists only once it is shown
            openers.push({ ...p, status: how.mayNotOpen ? "maybe-opened" : "opened" });
          } catch (e) {
            const missing = /not found/.test(e.message);
            openers.push({ ...p, status: missing || how.mayNotOpen ? "not-reached" : "fail", why: missing ? `not in this build: ${e.message}` : e.message });
          }
        }
        await new Promise(r => setTimeout(r, 3000));
        const surfaces = [];
        for (const t of (await cdpTargets(port)).filter(t => isWebviewShell(t) && webviewParams(t.url).get("extensionId") === CHAT_ID && t.id !== chat?.id)) {
          const purpose = webviewParams(t.url).get("purpose");
          try {
            const r = await captureIn(t, { ms: 300 });
            denied(r);
            surfaces.push({ status: "pass", purpose, title: r.title, policy: r.policy, error: r.error.name });
          } catch (e) { surfaces.push({ status: "fail", purpose, why: e.message }); }
        }
        const shipped = shippedPanelCount();
        if (want(2)) check(2, `every other hypeproof-chat webview is denied (${panels.length} panels in source, ${shipped ?? "?"} in the shipped bundle)`, () => {
          const bad = [...openers, ...surfaces].filter(o => o.status === "fail");
          if (bad.length) throw fail(bad.map(o => `${o.file || o.title || o.purpose}: ${o.why}`).join("; "), { openers, surfaces });
          if (surfaces.some(s => s.purpose === "webviewView")) throw fail("a second webviewView of hypeproof-chat exists", { surfaces });
          const opened = openers.filter(o => o.status === "opened").length;
          if (surfaces.length < opened) throw fail(`${opened} panels opened but only ${surfaces.length} webview(s) measured`, { openers, surfaces });
          return { panelsInSource: panels.length, panelsInShippedBundle: shipped, opened, denied: surfaces.length, surfaces,
            notReached: openers.filter(o => o.status === "not-reached").map(o => `${o.file}: ${o.why}`) };
        });
        if (want(3)) await (async () => {
          let r = null, where = null;
          try {
            await op({ op: "command", command: "hypeproof-chat.previewActiveFile", args: [{ $uri: path.join(dirs.ws, "index.html") }] });
            // The learner page is an http frame: an out-of-process target, or a frame inside the preview webview.
            const end = Date.now() + 15000;
            while (!r && Date.now() < end) {
              // VS Code 1.116 shows the live-server page in its own browser view: a top-level
              // `page` target, or an http iframe in older layouts.
              const oop = (await cdpTargets(port)).find(t => (t.type === "iframe" || t.type === "page") && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(t.url));
              if (oop) { where = oop.url; r = await captureIn(oop, { ms: 300 }, f => f.depth === 0); break; }
              if (learner) {
                const c = await connect(learner);
                const f = c.frames.find(x => /^https?:\/\/(127\.0\.0\.1|localhost)/.test(x.url));
                if (f) { where = f.url; r = await c.evaluate(f.id, CAPTURE, { ms: 300 }); }
                c.close();
              }
              if (!r) await new Promise(res => setTimeout(res, 500));
            }
          } catch (e) { r = { error: { name: "HarnessError", message: e.message } }; }
          check(3, "a learner page in the preview is denied", () => {
            if (!r) throw fail("no learner-page frame (http://127.0.0.1) appeared in the preview");
            return { where, ...denied(r) };
          });
        })();
      }

      // Another extension: the probe's own view (same purpose as chat) and panel.
      if (want(4)) {
        const out = {};
        seen = await known();
        await op({ op: "command", command: "hpsMicProbe.view.focus" });
        const v = (await waitNewTargets(seen)).find(t => webviewParams(t.url).get("extensionId") === "hps-e2e.mic-probe");
        out.view = v ? await captureIn(v, { ms: 300 }) : null;
        out.viewPurpose = v ? webviewParams(v.url).get("purpose") : null;
        seen = await known();
        await op({ op: "probePanel" });
        const p = (await waitNewTargets(seen)).find(t => webviewParams(t.url).get("extensionId") === "hps-e2e.mic-probe");
        out.panel = p ? await captureIn(p, { ms: 300 }) : null;
        check(4, "another extension's webview view (purpose webviewView) and panel are denied", () => {
          if (!out.view || !out.panel) throw fail(`probe surfaces missing: view ${!!out.view}, panel ${!!out.panel}`);
          if (out.viewPurpose !== "webviewView") throw fail(`probe view purpose ${out.viewPurpose}: it does not isolate the extension-id key`);
          return { view: denied(out.view), panel: denied(out.panel), viewPurpose: out.viewPurpose };
        });
      }

      if (want(8)) {
        const after = snapshot([dirs.userData, dirs.extDir, dirs.ws]);
        const w = audioWrites(before, after);
        check(8, "no audio bytes written to the profile, extensions or workspace during capture (DEC-05)", () => {
          if (w.hits.length) throw fail(`audio-like files written: ${w.hits.join(", ")}`, w);
          return { changedFiles: w.changed, audioFiles: 0, watched: ["user-data", "extensions", "workspace"] };
        });
      }
    });
  }

  const single = async (id, fixture, title, judge, ms) => {
    if (!want(id)) return;
    await withApp(fixture, async ({ port, op, waitNewTargets }) => {
      const seen = new Set((await cdpTargets(port)).map(t => t.id));
      await op({ op: "command", command: "hypeproof-chat.panel.focus" });
      const chat = (await waitNewTargets(seen, 20000)).find(t => webviewParams(t.url).get("extensionId") === CHAT_ID && webviewParams(t.url).get("purpose") === "webviewView");
      const r = chat ? await captureIn(chat, { ms }) : null;
      check(id, title, () => { if (!r) throw fail("no chat view target"); granted(r); return judge(r); });
    });
  };
  await single(5, "silence", "silence WAV: live track, rms about 0", r => {
    if (r.rms > 1e-4 || r.peak > 1e-3) throw fail(`rms ${r.rms} peak ${r.peak}: silence came through as signal`, r);
    return { rms: r.rms, peak: r.peak, samples: r.samples };
  }, 1000);
  await single("9a", "short", "short WAV (300 ms tone) plays through end to end and never restarts", r => judgeEnvelope("short", r), 1500);
  await single("9b", "long", "long WAV (8 s, 8 tones in order) plays through end to end and never restarts", r => judgeEnvelope("long", r), durationMs(FIXTURES.long) + 1500);
  await single(10, "clipping", "clipping WAV reaches the page unaltered (no gain control squashes it)", r => {
    const exp = samplesFor(FIXTURES.clipping).filter(v => Math.abs(v) >= 0.999).length / samplesFor(FIXTURES.clipping).length;
    if (r.peak < 0.99) throw fail(`peak ${r.peak}: the rail was not reached`, r);
    if (Math.abs(r.railFraction - exp) > 0.1) throw fail(`rail fraction ${r.railFraction.toFixed(3)} vs file ${exp.toFixed(3)}`, r);
    return { peak: r.peak, railFraction: r.railFraction, expected: exp };
  }, 1000);

  const file = path.join(OUT, "mic-replay-result.json");
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), app: process.env.HPS_APP_PATH || "clone of /Applications/HypeProof Studio.app", results }, null, 2));
  const failed = results.filter(r => r.status === "fail");
  console.log(`\n${results.filter(r => r.status === "pass").length} pass, ${failed.length} fail, ${results.filter(r => r.status === "pending").length} pending — ${file}`);
  if (failed.length) process.exitCode = 1;
}

await main();
