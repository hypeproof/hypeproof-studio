// REQ-STUDIO-JOIN-LINK (CGP-SHELL-R-005 / REQ-SHELL-05, DES-SHELL-04): a Chalk class join link
// `<scheme>://hypeproof.hypeproof-chat/join?class=<id>` opens Studio's ordinary class-join form
// with the class named above an empty code field. The link names a class and nothing else: it
// never carries a code, token, password or learner identity, and it never joins, sends or changes
// a setting by itself.
//
// 1–3 are pure (parse, decision, the code's class). 4 runs the URI host logic against fakes.
// 5 runs the real StartPage (bundled with esbuild) against a fake VS Code surface. 6 locks the
// wiring in extension.ts. Every refusal has a positive control next to it.
//
// Run: node --experimental-strip-types test/join-link.smoke.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const J = await import("../src/joinLink.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const require = createRequire(import.meta.url);
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };

const SCHEME = "hypeproof-studio";
const uri = (query, extra = {}) => ({ scheme: SCHEME, authority: "hypeproof.hypeproof-chat", path: "/join", query, fragment: "", ...extra });
// A student credential has the shape `<base64url payload>.<signature>`; `c` is the cohort.
const code = (c) => Buffer.from(JSON.stringify({ c, u: "synthetic-student", role: "student" })).toString("base64url") + ".sig";

// ── 1. Parse: the class id is the only thing read ─────────────────────────────────────────────
{
  assert.deepEqual(J.parseJoinLink(uri("class=dental-0729"), SCHEME), { kind: "join", classId: "dental-0729", ignored: [] });
  const max = "a".repeat(J.CLASS_ID_MAX);
  assert.deepEqual(J.parseJoinLink(uri(`class=${max}`), SCHEME), { kind: "join", classId: max, ignored: [] }, "positive control: the longest allowed id");
  assert.deepEqual(J.parseJoinLink(uri("class=A_b-9"), SCHEME), { kind: "join", classId: "A_b-9", ignored: [] });
  // Not a join link: another scheme, another extension, the account return, a near-miss path.
  assert.equal(J.parseJoinLink(uri("class=a", { scheme: "vscode" }), SCHEME).kind, "other");
  assert.equal(J.parseJoinLink(uri("class=a", { authority: "evil.ext" }), SCHEME).kind, "other");
  assert.equal(J.parseJoinLink(uri("state=" + "a".repeat(64), { path: "/account-return" }), SCHEME).kind, "other");
  assert.equal(J.parseJoinLink(uri("class=a", { path: "/join/x" }), SCHEME).kind, "other");
  ok("parse: a valid link yields only the class id; other links are not join links");
}
{
  // Credentials and identity in the link are ignored: never returned, never used, only their names noted.
  const secret = "SECRET-VALUE-" + "z".repeat(20);
  const r = J.parseJoinLink(uri(`class=dental-0729&code=${secret}&token=${secret}&password=${secret}&student=kim&utm_source=x`), SCHEME);
  assert.equal(r.kind, "join");
  assert.equal(r.classId, "dental-0729");
  assert.deepEqual(r.ignored, ["code", "token", "password", "student", "utm_source"]);
  assert.ok(!JSON.stringify(r).includes(secret), "no value of an ignored parameter leaves the parser");
  assert.ok(!JSON.stringify(r).includes("kim"));
  // The class id is not taken from anywhere else (a fragment, a code parameter).
  const f = J.parseJoinLink(uri("class=a", { fragment: "code=" + secret }), SCHEME);
  assert.equal(f.classId, "a"); assert.deepEqual(f.ignored, ["#fragment"]); assert.ok(!JSON.stringify(f).includes(secret));
  // A parameter name is noted in a safe spelling only.
  const weird = J.parseJoinLink(uri("class=a&%3Cscript%3E=1&" + "k".repeat(80) + "=1"), SCHEME);
  assert.ok(weird.ignored.every((n) => /^[A-Za-z0-9_#?-]{1,32}$/.test(n)), JSON.stringify(weird.ignored));
  ok("parse: code=/token=/password=/identity parameters are ignored, their values never leave the parser");
}
{
  // Malformed: refused. Each is the valid link with one thing broken.
  const bad = [
    "", "class=", "klass=a", "class=a&class=b", `class=${"a".repeat(J.CLASS_ID_MAX + 1)}`,
    "class=a%20b", "class=../x", "class=a%2Fb", "class=%EC%88%98%EC%97%85", "class=%3Cscript%3E", "class=a.b",
    "class=a%00", "class=" + "a".repeat(10) + "&" + "x=".repeat(2000),
  ];
  for (const q of bad) assert.equal(J.parseJoinLink(uri(q), SCHEME).kind, "malformed", q.slice(0, 60));
  assert.equal(J.isClassId("dental-0729"), true);
  for (const v of ["", " a", "a ", "수업", "a/b", "a\nb", 7, null, undefined, "a".repeat(129)]) assert.equal(J.isClassId(v), false, String(v));
  ok(`malformed: ${bad.length} broken links refused (empty, duplicate, too long, path, space, Hangul, markup, NUL, oversized)`);
}

// ── 2. Decision: ask before leaving a running turn or another class ───────────────────────────
{
  assert.equal(J.joinLinkDecision({ activeTurn: false, linkClass: "a" }), "open");
  assert.equal(J.joinLinkDecision({ activeTurn: true, linkClass: "a" }), "ask-turn");
  assert.equal(J.joinLinkDecision({ activeTurn: false, currentClass: "b", linkClass: "a" }), "ask-class");
  assert.equal(J.joinLinkDecision({ activeTurn: true, currentClass: "b", linkClass: "a" }), "ask-turn");
  assert.equal(J.joinLinkDecision({ activeTurn: false, currentClass: "a", linkClass: "a" }), "same-class");
  assert.equal(J.joinLinkDecision({ activeTurn: true, currentClass: "a", linkClass: "a" }), "ask-turn");
  ok("decision: open / ask-turn / ask-class / same-class");
}

// ── 3. The class a code belongs to (unverified, presentation only) ────────────────────────────
{
  assert.equal(J.classOfCode(code("dental-0729")), "dental-0729");
  assert.equal(J.classOfCode("not-a-token"), undefined);
  assert.equal(J.classOfCode(undefined), undefined);
  assert.equal(J.classOfCode(Buffer.from(JSON.stringify({ c: 7 })).toString("base64url") + ".s"), undefined);
  assert.equal(J.classOfCode(Buffer.from(JSON.stringify({ c: "a b" })).toString("base64url") + ".s"), undefined);
  ok("classOfCode: reads `c` only when it is a class id");
}

// ── 4. URI host: notice, ask, open — never more ──────────────────────────────────────────────
function fakeHost({ activeTurn = false, currentClass, answer = false } = {}) {
  const h = { opened: [], notices: [], asks: [], logs: [] };
  h.host = {
    scheme: SCHEME,
    activeTurn: () => activeTurn,
    currentClass: async () => currentClass,
    open: async (id) => { h.opened.push(id); },
    notify: (m) => { h.notices.push(m); },
    ask: async (m, detail, action) => { h.asks.push({ m, detail, action }); return answer; },
    log: (l) => { h.logs.push(l); },
  };
  return h;
}
{
  let h = fakeHost();
  assert.equal(await J.handleJoinLink(h.host, uri("class=dental-0729")), true);
  assert.deepEqual(h.opened, ["dental-0729"]); assert.deepEqual(h.notices, []); assert.deepEqual(h.asks, []);
  ok("host: a valid link opens the join form for its class, no notice, no question");

  const secret = "eyJjIjoiZGVudGFsIn0.SECRETSIG";
  h = fakeHost();
  await J.handleJoinLink(h.host, uri(`class=dental-0729&code=${secret}&token=${secret}`));
  assert.deepEqual(h.opened, ["dental-0729"], "only the class id is handed on");
  assert.ok(h.logs.some((l) => /code/.test(l) && /token/.test(l)), "the ignored names are logged");
  assert.ok(!h.logs.join("\n").includes(secret), "no value is logged");
  ok("host: code=/token= are ignored, logged by name only, never handed to the join form");

  h = fakeHost();
  assert.equal(await J.handleJoinLink(h.host, uri("class=a%2Fb&code=" + secret)), true);
  assert.deepEqual(h.opened, []); assert.deepEqual(h.notices, [J.JOIN_LINK_COPY.malformed]);
  assert.match(J.JOIN_LINK_COPY.malformed, /[가-힣]/); assert.ok(!/error|invalid|오류|실패/i.test(J.JOIN_LINK_COPY.malformed), "calm wording");
  assert.ok(!h.logs.join("\n").includes(secret));
  ok("host: a malformed link shows one calm Korean notice and opens nothing");

  h = fakeHost();
  assert.equal(await J.handleJoinLink(h.host, uri("state=x", { path: "/account-return" })), false, "not ours: left to the account handler");
  assert.deepEqual(h.opened, []); assert.deepEqual(h.notices, []);

  for (const [opts, which] of [[{ activeTurn: true }, "turn"], [{ currentClass: "other-class" }, "class"]]) {
    h = fakeHost({ ...opts, answer: false });
    await J.handleJoinLink(h.host, uri("class=dental-0729"));
    assert.equal(h.asks.length, 1, which); assert.deepEqual(h.opened, [], `${which}: declining keeps everything as it was`);
    h = fakeHost({ ...opts, answer: true });
    await J.handleJoinLink(h.host, uri("class=dental-0729"));
    assert.deepEqual(h.opened, ["dental-0729"], `${which}: the learner chose to open the join form`);
    assert.equal(h.asks[0].action, J.JOIN_LINK_COPY.open);
  }
  h = fakeHost({ currentClass: "dental-0729" });
  await J.handleJoinLink(h.host, uri("class=dental-0729"));
  assert.deepEqual(h.opened, []); assert.deepEqual(h.notices, [J.JOIN_LINK_COPY.sameClass]); assert.equal(h.asks.length, 0);
  ok("host: mid-turn or another class asks first (decline = nothing changes); the same class only says so");
}

// ── 5. The real StartPage: preselect the class, never join by itself ─────────────────────────
{
  const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';", resolveDir: extRoot, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
  const profile = { activity_kind: "classroom", profile_id: "dental", display_name: "Dental class", ux: { coach: { naming_mode: "fixed", fallback_name: "Coach" } }, welcome: {}, series_index: 1, series_total: 5 };
  let stored = "stored-old", fetches = 0, writes = 0, starts = 0, shows = 0;
  const states = [], commands = [], externals = [];
  const ctx = { workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => stored, store: async (_k, v) => { stored = v; writes++; }, delete: async () => { stored = undefined; writes++; } }, extension: { packageJSON: { version: "test" } }, extensionUri: {}, subscriptions: [] };
  const chat = { openInEditor: async () => { starts++; }, ensureProfile: async () => null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {}, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => "Coach", coachNameIsChosen: () => true, renderHtml: () => "<html></html>" };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_k, d) => d }) }, window: { createWebviewPanel: () => { throw Error("panel is attached by the test"); } }, commands: { executeCommand: async (id) => commands.push(id) }, env: { openExternal: async (u) => externals.push(u) }, Uri: { joinPath: () => ({}), parse: (u) => u }, ViewColumn: { One: 1 } };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, AbortSignal, URL, URLSearchParams, process, TextEncoder, setTimeout, clearTimeout, fetch: async () => { fetches++; return new Response(JSON.stringify(profile), { status: 200 }); } });
  const page = new mod.exports.StartPage(ctx, chat, async (_p, commit) => { await commit(); return false; });
  page.panel = { reveal() { shows++; }, webview: { postMessage: async (m) => states.push(m) } };
  page.offerWaited = true; page.trialOffer = null; page.products = null;
  const last = () => states.at(-1).state;

  await page.openJoinLink("dental-0729");
  assert.equal(last().joinLink?.classId, "dental-0729", "the class is preselected");
  assert.equal(typeof last().joinLink.seq, "number");
  assert.equal(shows, 1, "the start page is brought forward");
  assert.equal(fetches, 0, "nothing is asked of the Service");
  assert.equal(writes, 0); assert.equal(stored, "stored-old", "no credential or setting changes");
  assert.equal(starts, 0); assert.equal(page.candidate, undefined, "no auto-join");
  assert.deepEqual(commands, []); assert.deepEqual(externals, []);
  assert.ok(!("token" in last().joinLink) && !("code" in last().joinLink));
  const seq1 = last().joinLink.seq;
  await page.openJoinLink("dental-0729");
  assert.ok(last().joinLink.seq > seq1, "a second press of the link refocuses the form");
  ok("StartPage: a link preselects the class with an empty code; no fetch, no write, no entry");

  const before = states.length;
  await page.openJoinLink("a/b");
  await page.openJoinLink("x".repeat(200));
  assert.equal(states.length, before, "an invalid id never reaches the start page");
  assert.equal(page.joinLink.classId, "dental-0729");
  ok("StartPage: refuses an invalid class id even if a caller skipped the parser");

  // The learner types a code for another class: refused before any Service call.
  await page.handle({ type: "connectCourse", token: code("other-class") });
  assert.equal(fetches, 0, "a code for another class is not sent anywhere");
  assert.equal(last().error, J.JOIN_LINK_COPY.mismatch);
  assert.equal(last().joinLink.classId, "dental-0729"); assert.equal(page.candidate, undefined);
  assert.ok(!JSON.stringify(states).includes(code("other-class")), "the code never goes back to the webview");
  // Positive control: the right class's code takes the ordinary path (preview only).
  await page.handle({ type: "connectCourse", token: code("dental-0729") });
  assert.equal(fetches, 1); assert.equal(last().candidate, true); assert.equal(last().error, undefined);
  assert.equal(last().joinLink, undefined, "the link has done its job once the code is confirmed");
  assert.equal(stored, "stored-old"); assert.equal(writes, 0); assert.equal(starts, 0, "still a preview: the learner presses 시작 themselves");
  await page.handle({ type: "cancelCandidate" });
  // A code whose class cannot be read (not this token shape) is left to the Service, as today.
  await page.openJoinLink("dental-0729");
  await page.handle({ type: "connectCourse", token: "opaque-pass-code" });
  assert.equal(fetches, 2); assert.equal(last().candidate, true);
  await page.handle({ type: "cancelCandidate" });
  ok("StartPage: another class's code is refused locally; the linked class's code previews as usual");

  await page.openJoinLink("dental-0729");
  await page.handle({ type: "joinLinkDismiss" });
  assert.equal(last().joinLink, undefined, "링크 닫기 drops the class");
  assert.equal(page.candidate, undefined);
  ok("StartPage: the learner can drop the link");

  stored = code("stored-class");
  assert.equal(await page.currentClassId(), "stored-class");
  stored = undefined;
  assert.equal(await page.currentClassId(), undefined);
  ok("StartPage: currentClassId reads the stored seat's class for the switch question");
}

// ── 6. Wiring ────────────────────────────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(extRoot, "src/extension.ts"), "utf8");
  const reg = src.indexOf("registerUriHandler(");
  assert.ok(reg > 0);
  assert.equal(src.indexOf("registerUriHandler(", reg + 1), -1, "one URI handler for the extension");
  const handler = src.slice(reg, src.indexOf("}));", reg));
  assert.ok(handler.indexOf("handleJoinLink(") >= 0 && handler.indexOf("handleJoinLink(") < handler.indexOf("account-return"), "the join link is handled first");
  // The handler is registered whether or not accounts are enabled.
  const before = src.slice(0, reg);
  const openIf = before.lastIndexOf("if (accounts) {");
  assert.ok(openIf < 0 || before.slice(openIf).split("{").length - 1 <= before.slice(openIf).split("}").length - 1, "registerUriHandler is not inside `if (accounts)`");
  const pkg = JSON.parse(fs.readFileSync(path.join(extRoot, "package.json"), "utf8"));
  assert.ok(pkg.activationEvents.includes("onUri"), "a link can wake the extension");
  assert.equal(`${pkg.publisher}.${pkg.name}`, J.JOIN_LINK_AUTHORITY);
  // Chalk builds the same link this parser reads.
  const manage = fs.readFileSync(path.join(extRoot, "../../chalk/src/ui/manage.html"), "utf8");
  assert.ok(manage.includes(`://${J.JOIN_LINK_AUTHORITY}${J.JOIN_LINK_PATH}?class=`), "Chalk's link matches the handler");
  ok("wiring: one URI handler, join first, not gated on accounts; onUri; Chalk link shape matches");
}

console.log(`\nPASS join-link: ${passed} checks`);
