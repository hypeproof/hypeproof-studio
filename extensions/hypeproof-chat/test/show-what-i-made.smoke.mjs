// REQ-STUDIO-SHOW-WHAT-I-MADE (#3794 slice 1) — "내가 만든 것 보여주기".
// 1. The composition keeps the HyperFrames contract (GSAP-free: one paused Anime.js timeline on window.__hfAnime),
//    stays within 15 s, loads only files beside it (no network URL), and the person's words arrive escaped and
//    never inside a script.
// 2. The question flow: one question at a time, refused answers are not counted, stale events are ignored.
// 3. The host drives the real panel/picker/write path against a temp work folder (vscode stubbed).
// 4. In headless Chromium (when present): Studio's own page capture, then the panel playing the composition
//    offline through the vendored player + runtime, sought to fixed times, with every request local.
// Each positive case has a negative control beside it (verification.md §2).

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  SHOW_COPY, SHOW_TIMING, SHOW_PLAYER_FILE, SHOW_RUNTIME_FILE, SHOW_ANIME_FILE, SHOW_FONT_FILE, SHOW_FOLDER_ASSETS, captureShowPage, showComposition, showDecisionRecord,
  showInitialState, showMaterialKind, showReduce,
} from "../src/showWhatIMade.ts";
import { showPanelHtml, SHOW_POSTER_SECONDS } from "../src/showWhatIMadeView.ts";
import { findChromium, launch } from "./lib/headless-chromium.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const media = path.join(extRoot, "media", "show");

// ---------------------------------------------------------------------------------------------------------------
// 0. Vendored files are exactly the pinned ones, each with its license file, and GSAP is not among them.
{
  const manifest = JSON.parse(fs.readFileSync(path.join(media, "VENDORED.json"), "utf8"));
  assert.deepEqual(manifest.files.map((f) => f.path).sort(), [SHOW_ANIME_FILE, SHOW_FONT_FILE, SHOW_PLAYER_FILE, SHOW_RUNTIME_FILE].sort());
  for (const f of manifest.files) {
    const bytes = fs.readFileSync(path.join(media, f.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, `${f.path} sha256`);
    assert.equal(bytes.length, f.bytes, `${f.path} size`);
    for (const l of [].concat(f.license_file)) assert.ok(fs.statSync(path.join(media, l)).size > 500, l);
  }
  assert.ok(!fs.readdirSync(media).some((f) => /gsap/i.test(f)), "GSAP is not vendored");
  for (const f of manifest.files.filter((x) => x.path.endsWith(".js"))) assert.ok(!fs.readFileSync(path.join(media, f.path), "utf8").includes("GreenSock"), `${f.path} bundles no GSAP`);
  assert.match(fs.readFileSync(path.join(media, SHOW_ANIME_FILE), "utf8").slice(0, 200), /@version v4\.5\.0[\s\S]*@license MIT/);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Composition contract
const hostile = `<img src=x onerror=alert(1)> "따옴표" & 'sq' https://evil.example/x </script><script>steal()</script>`;
const disk = showComposition({ headline: hostile, audience: "엄마</p><script>x()</script>", materialFile: "material-1.png" });
{
  const root = /<div id="root"([^>]*)>/.exec(disk)?.[1] ?? "";
  const attr = (str, name) => new RegExp(`${name}="([^"]*)"`).exec(str)?.[1];
  assert.equal(attr(root, "data-composition-id"), "main");
  assert.equal(attr(root, "data-width"), "1920");
  assert.equal(attr(root, "data-height"), "1080");
  assert.match(root, /\bdata-no-timeline\b/, "opted out of the GSAP registry, as lint requires for adapter-only motion");
  const total = Number(attr(root, "data-duration"));
  assert.ok(total > 0 && total <= SHOW_TIMING.max, "duration within 15 s");
  // Scripts: the vendored Anime.js beside the file, then one inline timeline. No other script.
  const scripts = [...disk.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  assert.equal(attr(scripts[0][1], "src"), SHOW_ANIME_FILE);
  const timeline = scripts[1][2];
  assert.match(timeline, /anime\.createTimeline\(\{ autoplay: false/, "paused: HyperFrames owns the clock");
  assert.match(timeline, /window\.__hfAnime\.push\(tl\)/, "registered for the animejs adapter");
  const code = disk.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(!/gsap|__timelines|Date\.now|Math\.random|performance\.now|setTimeout|setInterval|fetch\(/i.test(code), "no GSAP and nothing nondeterministic");
  // Every Anime.js position ends inside the composition.
  for (const m of timeline.matchAll(/duration: (\d+)[^\n]*\}, (\d+)\);/g)) assert.ok(Number(m[1]) + Number(m[2]) <= total * 1000, m[0]);
  // Only files beside the composition: material, Anime.js, font. No network URL anywhere.
  const refs = [...disk.matchAll(/\b(?:src|href)="([^"]*)"|url\("([^"]*)"\)/g)].map((m) => m[1] ?? m[2]).sort();
  assert.deepEqual(refs, [SHOW_FONT_FILE, SHOW_ANIME_FILE, "material-1.png"].sort());
  assert.ok(!/https?:\/\/|@import|(^|[^:])\/\/[a-z]/i.test(disk.replace("https://evil.example/x", "")), "no network URL");
  // Escaped person text, one span per word, never inside a script.
  assert.ok(!disk.includes("<img src=x") && disk.includes("&lt;img"), "headline escaped");
  assert.ok(!disk.includes("</p><script>x()") && disk.includes("엄마&lt;/p&gt;&lt;script&gt;x()&lt;/script&gt;에게"), "audience escaped in the closing card");
  assert.ok(disk.includes('<span class="w">&quot;따옴표&quot;</span> <span class="w">&amp;</span> <span class="w">&#39;sq&#39;</span>'));
  assert.ok(!/steal|따옴표|엄마/.test(timeline), "person text never reaches the script");
  assert.ok(disk.includes(`<p id="closing-line">내가 만든 것<span class="sep">·</span>`), "closing card wording");
  // Deterministic: same input, same bytes.
  assert.equal(showComposition({ headline: hostile, audience: "엄마</p><script>x()</script>", materialFile: "material-1.png" }), disk);
  // Negative controls: a path or URL as the material is refused.
  for (const bad of ["../secret.png", "https://cdn.example/a.png", "material-1.png\" onload=\"x", "/etc/passwd", "material-0.png", "material-1.svg"]) {
    assert.throws(() => showComposition({ headline: "a", audience: "b", materialFile: bad }), /show_material_file/, bad);
  }
  // Playback copy: runtime first in <head>, every script nonced, files from the show folder's resource URI.
  const play = showComposition({ headline: "a", audience: "b", materialFile: "material-1.png", playback: { base: "https://res/show/", runtimeSrc: "https://res/m/" + SHOW_RUNTIME_FILE, nonce: "n1" } });
  assert.match(play, new RegExp(`<head>\\n<script nonce="n1" src="https://res/m/${SHOW_RUNTIME_FILE.replace(/\./g, "\\.")}"></script>`));
  assert.equal([...play.matchAll(/<script(?![^>]*nonce="n1")/g)].length, 0, "every script carries the nonce");
  assert.ok(play.includes(`src="https://res/show/material-1.png"`) && play.includes(`url("https://res/show/${SHOW_FONT_FILE}")`) && play.includes(`src="https://res/show/${SHOW_ANIME_FILE}"`));
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Flow state machine
{
  let s = showInitialState();
  const step = (e) => { const r = showReduce(s, e); s = r.state; return r; };
  // Out-of-step events are ignored (same object): no skipping a question.
  for (const e of [{ type: "accept" }, { type: "redo" }, { type: "headline", text: "x" }, { type: "material", material: { source: "a.png", file: "material-1.png" } }, { type: "back" }]) {
    const before = s; assert.equal(step(e).state, before, `${e.type} ignored at audience`);
  }
  assert.equal(step({ type: "answer", text: "   \n " }).error, SHOW_COPY.emptyAnswer);
  assert.equal(step({ type: "answer", text: "가".repeat(41) }).error, SHOW_COPY.tooLong(40));
  assert.equal(s.decisions.audience, 0, "refused answers are not counted");
  step({ type: "answer", text: "  우리 반\n친구들 " });
  assert.equal(s.step, "glance"); assert.equal(s.audience, "우리 반 친구들");
  step({ type: "back" }); assert.equal(s.step, "audience"); assert.equal(s.audience, "우리 반 친구들", "back keeps the answer");
  step({ type: "answer", text: "우리 반 친구들" });
  step({ type: "answer", text: "내가 만든 점프 게임" });
  assert.equal(s.step, "material");
  step({ type: "material", material: { source: "game/index.html", file: "material-1.jpg" } });
  assert.equal(s.step, "draft"); assert.equal(s.headline, "내가 만든 점프 게임", "headline starts as the person's own words");
  assert.equal(step({ type: "headline", text: "내가 만든 점프 게임" }).state.decisions.headlineEdits, 0, "unchanged title is not an edit");
  assert.equal(step({ type: "headline", text: "" }).error, SHOW_COPY.emptyAnswer);
  step({ type: "headline", text: "3초 만에 점프!" }); assert.equal(s.decisions.headlineEdits, 1);
  step({ type: "redo" }); assert.equal(s.step, "glance"); assert.equal(s.audience, "우리 반 친구들", "redo keeps the audience");
  step({ type: "answer", text: "점프 게임" }); step({ type: "material", material: { source: "a.png", file: "material-2.png" } });
  assert.equal(s.headline, "점프 게임", "a redo drafts from the new answer");
  step({ type: "accept" }); assert.equal(s.step, "accepted");
  const before = s; assert.equal(step({ type: "redo" }).state, before, "nothing changes after accept");
  assert.deepEqual(s.decisions, { audience: 2, glance: 2, material: 2, headlineEdits: 1, accept: 1, redo: 1 });
  const record = showDecisionRecord(s, new Date("2026-11-12T12:00:00Z"));
  assert.equal(record.total, 9); assert.equal(record.outcome, "accepted");
  assert.ok(!JSON.stringify(record).includes("점프"), "the record holds counts, not the person's words");
  assert.equal(showMaterialKind("a/B.PNG"), "image"); assert.equal(showMaterialKind("x.htm"), "page");
  assert.equal(showMaterialKind("x.svg"), null); assert.equal(showMaterialKind("png"), null);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Host: real panel messages, picker, folder writes (vscode stubbed)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
{
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "hp-show-")));
  fs.mkdirSync(path.join(root, "art")); fs.writeFileSync(path.join(root, "art", "drawing.png"), PNG);
  fs.writeFileSync(path.join(root, "art", "fake.png"), "<svg onload=alert(1)>");
  fs.writeFileSync(path.join(root, "page.html"), "<h1>hi</h1>");
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hp-out-")), "o.png"); fs.writeFileSync(outside, PNG);
  fs.symlinkSync(outside, path.join(root, "art", "link.png"));
  let panel, picks = [], infos = [], enabled = true, refusal = null, captured = [];
  const Uri = { file: (p) => ({ scheme: "file", fsPath: p, toString: () => "file://" + p }), joinPath: (u, ...p) => Uri.file(path.join(u.fsPath, ...p)) };
  const vscode = { Uri, ViewColumn: { Active: -1 }, window: {
    showInformationMessage: async (m) => { infos.push(m); },
    showOpenDialog: async () => { const p = picks.shift(); return p ? [Uri.file(p)] : undefined; },
    createWebviewPanel(...args) {
      let received, closed;
      panel = { args, disposed: false, webview: { html: "", cspSource: "https://res.test", asWebviewUri: (u) => ({ toString: () => "https://res.test" + u.fsPath }),
        onDidReceiveMessage(fn) { received = fn; return { dispose() {} }; } },
        onDidDispose(fn) { closed = fn; return { dispose() {} }; }, reveal() {}, dispose() { panel.disposed = true; closed?.(); },
        async send(m) { await received(m); } };
      return panel;
    } } };
  const built = await build({ entryPoints: [path.join(here, "..", "src", "showWhatIMadeHost.ts")], bundle: true, platform: "node", format: "cjs", write: false, external: ["vscode"] });
  const mod = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)((id) => (id === "vscode" ? vscode : require(id)), mod, mod.exports);
  const { runShowWhatIMade } = mod.exports;
  const ports = { enabled: () => enabled, root: () => root, refusal: () => refusal, capturePage: async (r, abs) => { captured.push(abs); return null; },
    now: () => new Date(2026, 10, 12, 20, 50, 12) };

  const ext = Uri.file(extRoot);
  enabled = false; await runShowWhatIMade(ext, ports); assert.deepEqual(infos, [SHOW_COPY.off]); assert.equal(panel, undefined, "flag off: no panel");
  enabled = true;
  const done = runShowWhatIMade(ext, ports);
  assert.deepEqual(panel.args[3].localResourceRoots.map((u) => u.fsPath), [media, path.join(root, ".hypeproof", "show")]);
  const nonce = () => /'nonce-([a-f0-9]+)'/.exec(panel.webview.html)[1];
  const send = (m) => panel.send({ nonce: nonce(), ...m });
  const shown = () => panel.webview.html;
  assert.ok(shown().includes(SHOW_COPY.audienceQuestion) && !shown().includes(SHOW_COPY.glanceQuestion), "one question at a time");
  await panel.send({ nonce: "forged", type: "answer", text: "x" }); assert.ok(shown().includes(SHOW_COPY.audienceQuestion), "forged nonce ignored");
  await send({ type: "answer", text: "" }); assert.ok(shown().includes(SHOW_COPY.emptyAnswer));
  await send({ type: "answer", text: "할머니" }); assert.ok(shown().includes(SHOW_COPY.glanceQuestion));
  await send({ type: "pick" }); assert.ok(shown().includes(SHOW_COPY.glanceQuestion), "pick ignored before the material question");
  await send({ type: "answer", text: `<b>"내 그림"</b> & 색깔` }); assert.ok(shown().includes(SHOW_COPY.materialQuestion));
  const showDir = path.join(root, ".hypeproof", "show");
  for (const [file, copy] of [[outside, SHOW_COPY.notInFolder], [path.join(root, "art", "link.png"), SHOW_COPY.notInFolder], [path.join(root, "art", "fake.png"), SHOW_COPY.notMaterial], [path.join(root, "page.html"), SHOW_COPY.pageFailed]]) {
    picks.push(file); await send({ type: "pick" });
    assert.ok(shown().includes(copy), `${path.basename(file)} → ${copy}`);
    assert.ok(!fs.existsSync(showDir), "nothing written for a refused pick");
  }
  assert.deepEqual(captured, [path.join(root, "page.html")], "an HTML page goes through Studio's page capture");
  refusal = "이 폴더에는 쓸 수 없어요."; picks.push(path.join(root, "art", "drawing.png")); await send({ type: "pick" });
  assert.ok(shown().includes(refusal) && !fs.existsSync(showDir), "folder consent refusal writes nothing"); refusal = null;
  await send({ type: "pick" }); assert.ok(shown().includes(SHOW_COPY.materialQuestion), "cancelled picker stays on the question");
  picks.push(path.join(root, "art", "drawing.png")); await send({ type: "pick" });
  const dir = path.join(showDir, "20261112-205012");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["decisions.json", "index.html", "material-1.png", ...SHOW_FOLDER_ASSETS].sort());
  for (const asset of SHOW_FOLDER_ASSETS) assert.deepEqual(fs.readFileSync(path.join(dir, asset)), fs.readFileSync(path.join(media, asset)), `${asset} copied beside the composition`);
  assert.deepEqual(fs.readFileSync(path.join(dir, "material-1.png")), PNG, "the person's own bytes");
  const index = () => fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.ok(index().includes('<span class="w">&lt;b&gt;&quot;내</span> <span class="w">그림&quot;&lt;/b&gt;</span> <span class="w">&amp;</span> <span class="w">색깔</span>'), "the person's words, escaped");
  assert.ok(index().includes("할머니에게") && !/https?:\/\//.test(index()));
  assert.ok(shown().includes("<hyperframes-player") && shown().includes(`https://res.test${media}/${SHOW_PLAYER_FILE}`));
  assert.ok(shown().includes(`https://res.test${media}/${SHOW_RUNTIME_FILE}`), "playback injects the vendored runtime");
  assert.ok(shown().includes(`https://res.test${dir}/${SHOW_ANIME_FILE}`), "playback loads the folder's own Anime.js copy");
  assert.ok(!/jsdelivr|https:\/\/(?!res\.test)/.test(shown().replace(/https:\/\/res\.test/g, "")), "panel names no other origin");
  await send({ type: "headline", text: "내 그림을 봐 주세요" });
  assert.ok(index().includes('<span class="w">내</span> <span class="w">그림을</span> <span class="w">봐</span> <span class="w">주세요</span>'), "headline edit rewrites the composition");
  await send({ type: "redo" }); assert.ok(shown().includes(SHOW_COPY.glanceQuestion));
  await send({ type: "answer", text: "색깔" }); picks.push(path.join(root, "art", "drawing.png")); await send({ type: "pick" });
  assert.ok(fs.existsSync(path.join(dir, "material-2.png")) && index().includes('src="material-2.png"'));
  await send({ type: "accept" }); assert.ok(shown().includes(SHOW_COPY.acceptedHeading) && shown().includes(".hypeproof/show/20261112-205012"));
  const record = JSON.parse(fs.readFileSync(path.join(dir, "decisions.json"), "utf8"));
  assert.deepEqual(record.counts, { audience: 1, glance: 2, material: 2, headlineEdits: 1, accept: 1, redo: 1 });
  assert.equal(record.outcome, "accepted");
  assert.ok(!fs.readFileSync(path.join(dir, "decisions.json"), "utf8").includes("할머니"), "no person text in the record");
  await send({ type: "close" }); await done; assert.equal(panel.disposed, true);
  // Flag turned off mid-flow closes the panel at the next message.
  const again = runShowWhatIMade(ext, ports); enabled = false; await send({ type: "answer", text: "x" }); await again;
  assert.equal(panel.disposed, true, "flag off mid-flow closes"); enabled = true;
  console.log("PASS show host: flag gate, one question at a time, forged nonce, refused picks (outside, link, fake image, page capture fail, folder consent), writes, headline edit, redo, accept, decision counts");
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Browser: page capture, offline playback, panel layout
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === "1") throw new Error("Browser required");
  console.log("NOT RUN show browser checks (no headless Chromium)");
} else {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "hp-show-site-"));
  fs.writeFileSync(path.join(site, "page.html"), `<!doctype html><html><body style="margin:0;background:#1d4ed8;color:#fff;font:bold 140px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">점프 게임 ★</body></html>`);
  const types = { ".js": "text/javascript", ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2" };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = url.startsWith("/media/") ? path.join(media, url.slice(7)) : path.join(site, url.slice(1));
    if (!file.startsWith(media) && !file.startsWith(site)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(data); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch(bin);
  const shots = process.env.SHOW_SCREENSHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shoot = async (name) => { if (!shots) return; const s = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(s.data, "base64")); };
  const requests = [], problems = [];
  // Collect every protocol event of interest for the whole run (the predicate never matches).
  browser.waitForEvent((m) => {
    if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails?.exception?.description ?? "exception");
    // Keep the URL with the text: Chromium's 404 log line does not name the resource, and some builds
    // request /favicon.ico on their own (CI does, the snts build does not), which is not a show error.
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push(`${m.params.entry.text} ${m.params.entry.url ?? ""}`.trim());
    return false;
  }, "collector", 600_000).catch(() => {});
  try {
    await browser.send("Network.enable"); await browser.send("Log.enable");
    // 4a. Studio's own page capture (the HTML material path) on a served page.
    await browser.send("Page.navigate", { url: `${origin}/page.html` });
    const jpeg = await captureShowPage(browser.send, { expectedUrl: `${origin}/page.html` });
    assert.ok(jpeg && jpeg[0] === 0xff && jpeg[1] === 0xd8, "captured a JPEG");
    assert.equal(await captureShowPage(browser.send, { expectedUrl: `${origin}/other.html`, loadTimeoutMs: 300 }), null, "a different page is not captured");
    // The show folder as the host leaves it: material copy plus Anime.js and the font beside the composition.
    fs.writeFileSync(path.join(site, "material-1.jpg"), jpeg);
    for (const asset of SHOW_FOLDER_ASSETS) fs.copyFileSync(path.join(media, asset), path.join(site, asset));
    // 4b. The draft panel, served from the resource origin like a webview, playing the composition offline.
    const nonce = "testnonce";
    const draftView = { step: "draft", audience: "우리 반 친구들", glance: "AI가 답을 먼저 내놓는 시대에, 스스로 판단하며 자라는 법", headline: "AI가 답을 먼저 내놓는 시대에, 스스로 판단하며 자라는 법" };
    const composition = showComposition({ headline: draftView.headline, audience: draftView.audience, materialFile: "material-1.jpg",
      playback: { base: `${origin}/`, runtimeSrc: `${origin}/media/${SHOW_RUNTIME_FILE}`, nonce } });
    const page = (view, comp) => showPanelHtml(view, { nonce, cspSource: origin, playerSrc: `${origin}/media/${SHOW_PLAYER_FILE}`, composition: comp })
      .replace("const api=acquireVsCodeApi()", "const api={postMessage:m=>(window.posts??=[]).push(m)}");
    fs.writeFileSync(path.join(site, "draft.html"), page(draftView, composition));
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.navigate", { url: `${origin}/draft.html` });
    const inner = `document.querySelector('hyperframes-player').shadowRoot.querySelector('iframe').contentDocument`;
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) { await new Promise((r) => setTimeout(r, 100)); ready = await browser.evaluate(`(()=>{const p=document.querySelector('hyperframes-player');try{const d=${inner};return !!p&&p.duration===${SHOW_TIMING.total}&&!!d.getElementById('headline')&&(d.defaultView.__hfAnime||[]).length===1}catch{return false}})()`); }
    assert.ok(ready, "player loaded the composition (15 s) and the Anime.js timeline registered");
    const at = async (t) => {
      await browser.evaluate(`document.querySelector('hyperframes-player').seek(${t})`);
      await new Promise((r) => setTimeout(r, 250));
      return browser.evaluate(`(()=>{const d=${inner},w=d.defaultView,cs=e=>w.getComputedStyle(e),o=sel=>Number(cs(d.querySelector(sel)).opacity);
        return {first:o('#headline .w'),last:o('#headline .w:last-child'),rule:cs(d.getElementById('rule')).transform,scene:o('#scene-inner'),closing:o('#closing-inner'),
          words:d.querySelectorAll('#headline .w').length,text:d.getElementById('headline').textContent,closingText:d.getElementById('closing-line').textContent,
          font:d.fonts.check('700 40px "Noto Sans KR"','판단'),img:d.getElementById('material').naturalWidth}})()`);
    };
    const t0 = await at(0.1), t5 = await at(5), t13 = await at(13), t5b = await at(5);
    assert.equal(t5.text, draftView.headline); assert.equal(t5.words, 9, "one span per word");
    assert.equal(t13.closingText, "내가 만든 것·우리 반 친구들에게");
    assert.ok(t5.img >= 1920, "material image loaded from the show folder");
    assert.equal(t5.font, true, "the shipped Noto Sans KR is loaded");
    assert.ok(t0.first < 0.2 && t0.last < 0.2 && t5.first > 0.99 && t5.last > 0.99, `headline arrives word by word (t0 ${t0.last}, t5 ${t5.last})`);
    assert.ok(t0.rule !== t5.rule && t5.rule === "matrix(1, 0, 0, 1, 0, 0)", `lime rule draws (t0 ${t0.rule}, t5 ${t5.rule})`);
    assert.ok(t5.closing < 0.01 && t13.closing > 0.99 && t13.scene < 0.01, `closing card replaces the scene (t5 ${JSON.stringify(t5)}, t13 ${JSON.stringify(t13)})`);
    assert.deepEqual(t5b, t5, "seeking back to the same time gives the same state (deterministic)");
    await at(5); await shoot("draft-t5");
    await at(13); await shoot("draft-t13");
    const external = requests.filter((u) => !u.startsWith(origin) && !/^(data|blob|about):/.test(u));
    assert.deepEqual(external, [], "every request stays local");
    assert.ok(!requests.some((u) => /jsdelivr/.test(u)), "player did not fetch its CDN runtime");
    assert.deepEqual(problems.filter((p) => !/favicon/.test(p)), [], "no script errors or CSP refusals");
    // 4c. Panel layout for every step: no sideways scroll, 44px targets, visible focus ring.
    let cases = 0;
    const accepted = { ...draftView, step: "accepted", savedRel: ".hypeproof/show/20261112-205012" };
    const views = [["audience", { step: "audience", audience: "", glance: "", headline: "" }], ["glance", { step: "glance", audience: "우리 반 친구들", glance: "", headline: "", error: SHOW_COPY.emptyAnswer }],
      ["material", { step: "material", audience: "a", glance: "b", headline: "" }], ["draft", draftView], ["accepted", accepted]];
    for (const [name, view] of views) for (const width of [360, 800, 1420]) {
      const comp = view.step === "draft" || view.step === "accepted" ? composition : undefined;
      fs.writeFileSync(path.join(site, `${name}.html`), page(view, comp));
      await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.send("Page.navigate", { url: `${origin}/${name}.html` });
      await new Promise((r) => setTimeout(r, comp ? 900 : 150));
      const m = await browser.evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('button,input')].filter(e=>e.getBoundingClientRect().height<44).map(e=>e.id),h1:document.querySelectorAll('h1').length,questions:[${JSON.stringify(SHOW_COPY.audienceQuestion)},${JSON.stringify(SHOW_COPY.glanceQuestion)},${JSON.stringify(SHOW_COPY.materialQuestion)}].filter(q=>document.body.innerText.includes(q)).length})`);
      assert.equal(m.overflow, false, `${name}@${width} no sideways scroll`);
      assert.deepEqual(m.small, [], `${name}@${width} 44px targets`);
      assert.equal(m.h1, 1);
      assert.ok(m.questions <= 1, "never more than one question on screen");
      if (comp) {
        // A paused player opens on the poster frame (headline and material in place), not the black frame at 0 s.
        let shownAt = 0;
        for (let i = 0; i < 30 && shownAt === 0; i++) { shownAt = await browser.evaluate("document.getElementById('player').currentTime||0"); if (!shownAt) await new Promise((r) => setTimeout(r, 100)); }
        assert.equal(shownAt, SHOW_POSTER_SECONDS, `${name}@${width} opens on the ${SHOW_POSTER_SECONDS} s poster frame`);
      }
      const ring = await browser.focusVisibleStyle("button"); assert.equal(ring["outline-width"], "2px");
      await shoot(`${name}-${width}`);
      cases++;
    }
    // The panel posts one bound action per view.
    await browser.send("Page.navigate", { url: `${origin}/audience.html` }); await new Promise((r) => setTimeout(r, 150));
    await browser.evaluate(`document.getElementById('audience').value='할머니';document.getElementById('next').click();document.getElementById('next').click()`);
    assert.deepEqual(await browser.evaluate("window.posts"), [{ type: "answer", text: "할머니", nonce }]);
    console.log(`PASS show browser: page capture, offline playback (${requests.length} local requests, 0 external), seek t=0.1/5/13, ${cases} panel layouts`);
  } finally {
    await browser.close();
    server.close();
  }
}
console.log("PASS show-what-i-made: vendored pins, composition contract, flow state machine");
// The protocol-event collector above holds a long timer; nothing else is pending, so end now.
process.exit(0);
