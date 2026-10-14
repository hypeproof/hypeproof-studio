// A4 (spec §6.1–§6.3, §7, §14): the orchestrator seat's Pre/PostToolUse hooks and the
// stream observer, driven the way the CLI calls them (PreToolUse → the tool → PostToolUse).
//
// - The PostToolUse summary is at most 400 characters, with both the diff and the site
//   check in it, even when each alone is near its own 400 (control: parts that fit come
//   back unchanged).
// - The hooks never approve: no answer carries a decision, and A2's guard has nothing to
//   strip from them (control: the guard does strip a planted `allow`).
// - Archive before a coach Write replaces an existing .html, adults only.
// - Failure events F1–F5, each with a control that does not fire.
//
// Run: node --experimental-strip-types test/orchestrator-hooks.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const H = await import("../src/orchestratorHooks.ts");
const C = await import("../src/consultTool.ts");
const { guardOrchestratorHooks } = await import("../src/sdkCoachHelpers.ts");
const { ADULT_ARCHIVE_DIR } = await import("../src/adultArchive.ts");
const { SITE_CHECK_SUMMARY_MAX } = await import("../src/siteCheck.ts");
const { DIFF_SUMMARY_MAX } = await import("../src/diffGuard.ts");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-a4-hooks-")));
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));
let wsSeq = 0;
const PAGE = [
  "<!doctype html><html lang=\"ko\"><head><meta name=\"viewport\" content=\"width=device-width\"><title>빵집</title>",
  "<style>body{font-size:16px} .hero{padding:2rem}</style></head><body>",
  "<header id=\"top\"><h1>동네 빵집</h1></header>",
  "<!-- 정보블록:시작 -->",
  "<section id=\"hours\"><h2>영업시간</h2><p>매일 9시–18시</p></section>",
  "<section id=\"contact\"><h2>연락처</h2><p>02-000-0000</p></section>",
  "<!-- 정보블록:끝 -->",
  "<section id=\"menu\"><h2>메뉴</h2><p>소금빵 3,000원</p><p>식빵 4,500원</p></section>",
  "<footer id=\"foot\"><p>© 빵집</p></footer>",
  "</body></html>",
].join("\n");
const REWRITE = "<!doctype html><html><head><title>새 빵집</title></head><body><main><h1>완전히 새 페이지</h1><p>전부 다시 썼어요</p></main></body></html>";
function workspace() {
  const ws = path.join(scratch, `ws${++wsSeq}`);
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, "index.html"), PAGE);
  fs.writeFileSync(path.join(ws, "style.css"), "body { color: #222; }\n.hero { padding: 1rem; }\n");
  return ws;
}

// ── A site port whose page answers with a planted measurement ───────────────
const W = (w, extra = {}) => ({
  w, inner: w, scroll: w, root_clips: false, offenders: [], offender_count: 0, clipped: 0, viewport_meta: true,
  img_without_alt: 0, external_urls: 0, external_hosts: [], body_font_px: 16, small_targets: 0, small_target_sample: [], ...extra,
});
const measure = { next: (p) => ({ path: p, widths: [W(390), W(1280)] }) };
const PASS = (p) => ({ path: p, widths: [W(390), W(1280)] });
const OVERFLOW = (p) => ({ path: p, widths: [W(390, { scroll: 520, offenders: ["table.prices"], offender_count: 1 }), W(1280)] });
function sitePort({ hang = false, throws = false } = {}) {
  return {
    livePreviewUrl: async () => "http://127.0.0.1:5173/",
    viewportPage: async (wrapperUrl) => {
      if (throws) throw new Error("no browser");
      const target = decodeURIComponent(new URL(wrapperUrl).searchParams.get("path"));
      return {
        cdp: {
          send: async (method, params = {}) => {
            if (method === "Runtime.evaluate" && !params.awaitPromise) return { result: { value: JSON.stringify({ href: wrapperUrl, ready: "complete" }) } };
            if (method === "Runtime.evaluate") return hang ? new Promise(() => {}) : { result: { value: measure.next(target) } };
            throw new Error(method);
          },
        },
      };
    },
  };
}

const ADULT = { game: { template_tier: "website" } };
const CHECKS_ALL = ["site_check", "diff_guard", "archive_before_overwrite"];
function hooksFor({ ws = workspace(), checks = CHECKS_ALL, profile = ADULT, port = sitePort(), session } = {}) {
  const events = [];
  const s = session ?? new C.OrchestratorSession();
  if (!session) s.beginTurn("turn_1");
  let t = Date.parse("2026-10-14T06:30:00Z");
  const hooks = H.buildOrchestratorHooks({
    roster: { checks }, session: s, profile, workspaceRoot: ws, sitePort: port, emit: (e) => events.push(e),
    now: () => (t += 1), siteCheckBudgetMs: 2000,
  });
  return { hooks, events, session: s, ws };
}

const outputs = [];
let toolSeq = 0;
/** One tool call, the way the CLI runs it: PreToolUse, the tool, PostToolUse (unless denied). */
async function call(hooks, ws, tool, rel, content, { signal = new AbortController().signal, denied = false, abs } = {}) {
  const id = `toolu_${++toolSeq}`;
  const file = abs ?? path.join(ws, rel);
  const base = { session_id: "s", transcript_path: path.join(scratch, "t.jsonl"), cwd: ws, tool_name: tool, tool_use_id: id };
  const input = tool === "Write" ? { file_path: file, content } : { file_path: file, old_string: "x", new_string: "y" };
  const pre = hooks.PreToolUse ? await hooks.PreToolUse[0].hooks[0]({ ...base, hook_event_name: "PreToolUse", tool_input: input }, id, { signal }) : undefined;
  if (pre !== undefined) outputs.push(pre);
  if (denied) return { pre };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const post = await hooks.PostToolUse[0].hooks[0]({ ...base, hook_event_name: "PostToolUse", tool_input: input, tool_response: { type: "update" } }, id, { signal });
  outputs.push(post);
  return { pre, post, context: post?.hookSpecificOutput?.additionalContext ?? "" };
}
const historyOf = (ws) => {
  const dir = path.join(ws, ...ADULT_ARCHIVE_DIR.split("/"));
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : null;
};

// ── A coach rewrite of index.html: archive, diff, site check, one context ───
{
  measure.next = PASS;
  const { hooks, events, session, ws } = hooksFor();
  assert.deepEqual(Object.keys(hooks), ["PreToolUse", "PostToolUse"]);
  for (const ev of ["PreToolUse", "PostToolUse"]) {
    assert.equal(hooks[ev].length, 1);
    assert.equal(hooks[ev][0].matcher, "Write|Edit|MultiEdit");
    assert.equal(hooks[ev][0].timeout, H.ORCHESTRATOR_HOOK_TIMEOUT_S, "an explicit timeout above the check's budget");
    assert.equal(guardOrchestratorHooks(hooks)[ev][0].timeout, H.ORCHESTRATOR_HOOK_TIMEOUT_S, "A2's guard keeps it");
  }
  assert.ok(H.ORCHESTRATOR_HOOK_TIMEOUT_S * 1000 > 5000 + 1500, "longer than the site check's budget and CDP slack");
  const { pre, post, context } = await call(hooks, ws, "Write", "index.html", REWRITE);
  assert.deepEqual(pre, {}, "PreToolUse decides nothing");
  const copies = historyOf(ws);
  assert.equal(copies.length, 1);
  assert.match(copies[0], /^index-\d{8}-\d{6}\.html$/);
  assert.equal(fs.readFileSync(path.join(ws, ".hypeproof", "history", copies[0]), "utf8"), PAGE, "the copy is the page before the write");
  assert.deepEqual(Object.keys(post), ["hookSpecificOutput"]);
  assert.deepEqual(Object.keys(post.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
  assert.equal(post.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.ok(context.length <= H.HOOK_CONTEXT_MAX);
  assert.match(context, /^저장 비교\(index\.html\): 이번 저장은 기존 내용의 \d+%를 바꿨습니다/);
  assert.match(context, new RegExp(`이전 버전: \\.hypeproof/history/${copies[0].replace(".", "\\.")}`), "the coach can restore");
  assert.match(context, /\n📏 390·1280px 확인 — 통과 \(index\.html\)/);
  assert.equal(session.lastDiff().verdict, "rewrite");
  assert.equal(session.latestCheck("index.html").verdict, "pass");
  assert.deepEqual(events.map((e) => [e.kind, e.name, e.state]), [["check", "archive", "done"], ["check", "diff", "done"], ["check", "site_check", "done"]]);
  assert.equal(events[2].label, "📏 390·1280px 확인 — 통과");
  assert.match(events[0].label, /^🗂 이전 버전 보관 \(\.hypeproof\/history\)/);
  ok("rewrite of index.html: archived first, then one ≤400-character context with the diff (and the copy's path) and the site check; three timeline lines");
}

// ── An Edit inside the 정보블록, a CSS edit, a new page ─────────────────────
{
  measure.next = PASS;
  const { hooks, events, ws } = hooksFor();
  const hours = PAGE.replace("매일 9시–18시", "매일 10시–19시");
  const { context } = await call(hooks, ws, "Edit", "index.html", hours);
  assert.equal(historyOf(ws), null, "an Edit is not an overwrite: nothing is archived");
  assert.match(context, /^저장 비교\(index\.html\): 정보블록 안만 바뀌었습니다/);
  const css = await call(hooks, ws, "Edit", "style.css", "body { color: #111; }\n.hero { padding: 1rem; }\n");
  assert.match(css.context, /^저장 비교\(style\.css\)/);
  assert.ok(!css.context.includes("📏"), "no site check for a stylesheet");
  const fresh = await call(hooks, ws, "Write", "pages/new.html", "<!doctype html><title>새</title><p>새 페이지</p>");
  assert.ok(!fresh.context.includes("저장 비교"), "a new file has nothing to compare");
  assert.match(fresh.context, /^📏 390·1280px 확인 — 통과 \(pages\/new\.html\)/);
  assert.equal(historyOf(ws), null);
  assert.deepEqual(events.map((e) => e.name), ["diff", "site_check", "diff", "site_check"]);
  ok("Edit inside the 정보블록 reads 'inside' and archives nothing; a stylesheet gets the diff only; a new page gets the site check only");
}

// ── 400 characters at most, both parts kept ─────────────────────────────────
{
  const long = (p) => ({
    path: p,
    widths: [
      W(390, { scroll: 980, offenders: Array.from({ length: 5 }, (_, i) => `section#very-long-section-identifier-${i}-x .card-title`), offender_count: 12, root_clips: true }),
      W(1280, { scroll: 1900, offenders: Array.from({ length: 5 }, (_, i) => `div.wrapper-${i} table.prices-and-hours`), offender_count: 9 }),
    ].map((w) => ({ ...w, viewport_meta: false, img_without_alt: 7, external_urls: 4, external_hosts: ["fonts.googleapis.com", "cdn.example.com", "images.example.org"], body_font_px: 12, small_targets: 9, small_target_sample: ["a.nav-link-very-long"] })),
  });
  measure.next = long;
  const ws = workspace();
  const sections = Array.from({ length: 12 }, (_, i) => `<section id="section-with-a-rather-long-name-${i}"><h2>섹션 ${i}</h2><p>${"내용 ".repeat(20)}</p></section>`).join("\n");
  fs.writeFileSync(path.join(ws, "index.html"), `<!doctype html><html><head><style>.a{}</style></head><body>\n${sections}\n</body></html>`);
  const { hooks } = hooksFor({ ws });
  const { context } = await call(hooks, ws, "Write", "index.html", REWRITE);
  assert.ok(context.length <= H.HOOK_CONTEXT_MAX, `≤ 400 (${context.length})`);
  const [diffPart, checkPart] = context.split("\n");
  assert.match(diffPart, /^저장 비교/, "the diff survives the cut");
  assert.match(diffPart, /이전 버전: \.hypeproof\/history\/index-\d{8}-\d{6}\.html$/, "with its archive path whole");
  assert.match(checkPart, /^📏 390·1280px 확인 — 고칠 곳 있음/, "the check survives the cut");
  // Controls on the fitter itself.
  assert.equal(H.fitHookContext([{ text: "가" }, { text: "나" }]), "가\n나", "parts that fit come back unchanged");
  assert.equal(H.fitHookContext([]), "");
  const single = H.fitHookContext([{ text: "다. ".repeat(500) }]);
  assert.ok(single.length <= 400 && single.endsWith("…"));
  for (let a = 0; a <= 800; a += 37) {
    for (let b = 0; b <= 800; b += 53) {
      const out = H.fitHookContext([{ text: "a".repeat(a), tail: " 이전 버전: x.html" }, { text: "b. ".repeat(b) }]);
      assert.ok(out.length <= 400, `${a}/${b} → ${out.length}`);
    }
  }
  assert.ok(SITE_CHECK_SUMMARY_MAX + DIFF_SUMMARY_MAX > H.HOOK_CONTEXT_MAX, "control: the two parts alone could exceed the limit");
  ok("PostToolUse context ≤ 400 with a ~400-character site check and a long diff, both kept, the archive path whole; the fitter never passes 400 over a grid of lengths");
}

// ── Never an approval ───────────────────────────────────────────────────────
{
  const forbidden = ["permissionDecision", "permissionDecisionReason", "decision", "updatedInput", "updatedToolOutput", "updatedMCPToolOutput", "continue", "systemMessage", "classifierContext"];
  const walk = (v, out = []) => {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), walk(x, out));
    return out;
  };
  assert.ok(outputs.length >= 10, "answers from every scenario above");
  for (const o of outputs) for (const k of walk(o)) assert.ok(!forbidden.includes(k), `a hook answered ${k}`);
  // A2's guard has nothing to strip from them: the same answers through it.
  measure.next = PASS;
  const a = hooksFor();
  const b = hooksFor();
  const guarded = guardOrchestratorHooks(b.hooks);
  const raw = await call(a.hooks, a.ws, "Write", "index.html", REWRITE);
  const viaGuard = await call(guarded, b.ws, "Write", "index.html", REWRITE);
  assert.deepEqual(viaGuard.pre, raw.pre);
  assert.equal(viaGuard.context.replace(/index-\d{8}-\d{6}/g, "X"), raw.context.replace(/index-\d{8}-\d{6}/g, "X"));
  // Control: the guard does strip a planted approval, so passing through it means something.
  const planted = guardOrchestratorHooks({ PreToolUse: [{ matcher: "Write", hooks: [async () => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } })] }] });
  assert.deepEqual(await planted.PreToolUse[0].hooks[0]({}, "x", { signal: new AbortController().signal }), {});
  ok(`never an approval: ${outputs.length} hook answers carry no decision or rewrite; A2's guard passes them unchanged (control: it strips a planted allow)`);
}

// ── Outside the workspace, minors, a denied call, an abort, a broken port ───
{
  measure.next = PASS;
  const { hooks, ws, events } = hooksFor();
  const outsideDir = path.join(scratch, "elsewhere");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "index.html"), PAGE);
  const out = await call(hooks, ws, "Write", "x", REWRITE, { abs: path.join(outsideDir, "index.html") });
  assert.deepEqual(out.pre, {});
  assert.deepEqual(out.post, {}, "a file outside the workspace gets no context");
  assert.equal(fs.existsSync(path.join(outsideDir, ".hypeproof")), false, "and nothing is archived there");
  assert.equal(events.length, 0);

  for (const profile of [{ game: { template_tier: "kids-basic" } }, { minor_cohort: true, game: { template_tier: "website" } }, { game: { template_tier: "kids-quest" } }]) {
    const m = hooksFor({ profile });
    await call(m.hooks, m.ws, "Write", "index.html", REWRITE);
    assert.equal(historyOf(m.ws), null, `${JSON.stringify(profile)}: no adult archive`);
    assert.equal(fs.existsSync(path.join(m.ws, ".hypeproof")), false);
  }

  // A denied Write leaves no state behind for the next call.
  const d = hooksFor();
  await call(d.hooks, d.ws, "Write", "index.html", REWRITE, { denied: true });
  const next = await call(d.hooks, d.ws, "Edit", "index.html", PAGE.replace("소금빵", "버터빵"));
  assert.match(next.context, /^저장 비교\(index\.html\): 기존 내용의/, "the Edit is compared with the file as it was, not a stale snapshot");

  // The turn stops while the check runs: the hook returns at once, and never says pass.
  const hung = hooksFor({ port: sitePort({ hang: true }) });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const t0 = Date.now();
  const aborted = await call(hung.hooks, hung.ws, "Write", "index.html", REWRITE, { signal: controller.signal });
  assert.ok(Date.now() - t0 < 1500, "the hook ends with the turn");
  assert.match(aborted.context, /미확인/);
  assert.ok(!aborted.context.includes("통과 ("), "an aborted check is never a pass");
  const broken = hooksFor({ port: sitePort({ throws: true }) });
  const bk = await call(broken.hooks, broken.ws, "Write", "index.html", REWRITE);
  assert.match(bk.context, /📏 390·1280px 확인 — 미확인\(브라우저 연결 없음\)/);
  const noPort = hooksFor({ port: null });
  assert.match((await call(noPort.hooks, noPort.ws, "Write", "index.html", REWRITE)).context, /미확인\(미리보기 꺼짐\)/);
  ok("outside the workspace: no context, no archive; minors: no archive; a denied call leaves no snapshot; an abort or a broken port reads 미확인, never 통과");
}

// ── Which hooks exist ───────────────────────────────────────────────────────
{
  assert.equal(H.buildOrchestratorHooks({ roster: { checks: [] }, session: new C.OrchestratorSession(), profile: ADULT, workspaceRoot: workspace() }), undefined, "no checks → no hooks");
  const siteOnly = hooksFor({ checks: ["site_check"] }).hooks;
  assert.deepEqual(Object.keys(siteOnly), ["PostToolUse"], "the site check alone needs no PreToolUse");
  const archiveOnly = hooksFor({ checks: ["archive_before_overwrite"] });
  assert.deepEqual(Object.keys(archiveOnly.hooks), ["PreToolUse", "PostToolUse"]);
  const ar = await call(archiveOnly.hooks, archiveOnly.ws, "Write", "index.html", REWRITE);
  assert.match(ar.context, /^저장 전 내용을 보관했습니다: \.hypeproof\/history\/index-/, "without the diff guard the copy's path is still reported");
  assert.ok(!ar.context.includes("📏") && !ar.context.includes("저장 비교"));
  ok("hooks follow the roster's checks: none → no hooks; site check only → PostToolUse only; archive only → the copy's path");
}

// ── Failure events (spec §7) ────────────────────────────────────────────────
{
  // F1: the same width fails twice in a row on one page with an edit between.
  measure.next = OVERFLOW;
  const f1 = hooksFor();
  await call(f1.hooks, f1.ws, "Write", "index.html", REWRITE);
  assert.deepEqual(f1.session.failuresThisTurn(), [], "one fail is not F1");
  await call(f1.hooks, f1.ws, "Edit", "index.html", REWRITE + "<!-- 고침 -->");
  assert.deepEqual(f1.session.failuresThisTurn().map((f) => [f.id, f.path]), [["F1", "index.html"]]);
  // Controls: fail → pass; fail → a check without an edit; fail@390 → fail@1280.
  const s1 = new C.OrchestratorSession();
  s1.beginTurn("t");
  const result = (reasons) => ({ verdict: reasons.length ? "fail" : "pass", fail_reasons: reasons });
  s1.recordSiteCheck("a.html", result(["overflow@390"]));
  s1.recordEdit("a.html");
  assert.equal(s1.recordSiteCheck("a.html", result([])), null, "fixed: no F1");
  s1.recordSiteCheck("b.html", result(["overflow@390"]));
  assert.equal(s1.recordSiteCheck("b.html", result(["overflow@390"])), null, "no edit between: no F1");
  s1.recordSiteCheck("c.html", result(["overflow@390"]));
  s1.recordEdit("c.html");
  assert.equal(s1.recordSiteCheck("c.html", result(["overflow@1280"])), null, "another width: no F1");
  s1.recordSiteCheck("d.html", result(["img_without_alt"]));
  s1.recordEdit("d.html");
  assert.equal(s1.recordSiteCheck("d.html", result(["img_without_alt"])), null, "not a width failure: no F1");
  s1.recordSiteCheck("e.html", result(["clipped@390"]));
  s1.recordEdit("e.html");
  assert.equal(s1.recordSiteCheck("e.html", result(["overflow@390"])).id, "F1", "clipped then overflow at the same width is F1");
  // F1 spans turns: the second fail is recorded in the turn it happens in.
  const s1b = new C.OrchestratorSession();
  s1b.beginTurn("t1");
  s1b.recordSiteCheck("x.html", result(["overflow@390"]));
  s1b.beginTurn("t2");
  s1b.recordEdit("x.html");
  assert.equal(s1b.recordSiteCheck("x.html", result(["overflow@390"])).id, "F1");
  assert.deepEqual(s1b.failuresThisTurn().map((f) => f.id), ["F1"]);

  // F2: the structure guard blocks two HTML saves in one turn (an unterminated comment).
  measure.next = PASS;
  const f2 = hooksFor();
  const broken = "<!doctype html><body><p>a</p><!-- 주석이 닫히지 않음 <footer>끝</footer></body></html>";
  await call(f2.hooks, f2.ws, "Write", "index.html", broken);
  assert.deepEqual(f2.session.failuresThisTurn(), [], "one block is not F2");
  await call(f2.hooks, f2.ws, "Write", "index.html", broken + " ");
  assert.deepEqual(f2.session.failuresThisTurn().map((f) => f.id), ["F2"]);
  const f2c = hooksFor();
  await call(f2c.hooks, f2c.ws, "Write", "index.html", REWRITE);
  await call(f2c.hooks, f2c.ws, "Write", "index.html", REWRITE + " ");
  assert.deepEqual(f2c.session.failuresThisTurn(), [], "control: well-formed saves are not blocked");

  // F3, F4, F5 from the stream.
  const ws = workspace();
  const s = new C.OrchestratorSession();
  s.beginTurn("t1");
  const obs = new H.OrchestratorStreamObserver({ session: s, workspaceRoot: ws });
  const use = (id, name, file, msgId = "m1", stop) => ({ type: "assistant", message: { id: msgId, ...(stop ? { stop_reason: stop } : {}), content: [{ type: "tool_use", id, name, input: { file_path: path.join(ws, file) } }] } });
  const result2 = (id, isError) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "x" }] } });
  obs.observe(use("e1", "Edit", "index.html"));
  obs.observe(result2("e1", true));
  obs.observe(use("e2", "Edit", "style.css"));
  obs.observe(result2("e2", true));
  obs.observe(use("e3", "Write", "index.html"));
  obs.observe(result2("e3", true));
  obs.observe(use("e4", "Edit", "index.html"));
  obs.observe(result2("e4", false));
  assert.deepEqual(s.failuresThisTurn(), [], "control: one failed Edit per file, a failed Write and a good Edit are not F3");
  obs.observe(use("e5", "MultiEdit", "index.html"));
  obs.observe(result2("e5", true));
  assert.deepEqual(s.failuresThisTurn().map((f) => [f.id, f.path]), [["F3", "index.html"]]);
  obs.observe(use("w1", "Write", "style.css", "m2", "max_tokens"));
  assert.equal(s.failuresThisTurn().length, 1, "control: max_tokens on a CSS write is not F4");
  obs.observe(use("w2", "Write", "index.html", "m3"));
  obs.observe({ type: "assistant", message: { id: "m3", stop_reason: "max_tokens", content: [{ type: "text", text: "…" }] } });
  assert.deepEqual(s.failuresThisTurn().map((f) => f.id), ["F3", "F4"]);
  obs.observe({ type: "result", subtype: "error_max_turns", stop_reason: null });
  obs.observe("not a message");
  obs.observe({ type: "assistant", message: { content: "odd" } });
  s.beginTurn("t2");
  assert.deepEqual(s.failuresThisTurn().map((f) => f.id), ["F5"], "the previous turn ran out of turns");
  s.noteTurnEnd("success");
  s.beginTurn("t3");
  assert.deepEqual(s.failuresThisTurn(), [], "control: a turn after a normal end starts clean");
  // F4 from the result: a turn that wrote HTML ended at max_tokens.
  const s4 = new C.OrchestratorSession();
  s4.beginTurn("t");
  const o4 = new H.OrchestratorStreamObserver({ session: s4, workspaceRoot: ws });
  o4.observe(use("w9", "Write", "index.html", "m9"));
  o4.observe({ type: "result", subtype: "success", stop_reason: "max_tokens" });
  assert.deepEqual(s4.failuresThisTurn().map((f) => f.id), ["F4"]);
  const s4c = new C.OrchestratorSession();
  s4c.beginTurn("t");
  new H.OrchestratorStreamObserver({ session: s4c, workspaceRoot: ws }).observe({ type: "result", subtype: "success", stop_reason: "max_tokens" });
  assert.deepEqual(s4c.failuresThisTurn(), [], "control: max_tokens in a turn that wrote no HTML is not F4");
  ok("failure events: F1 (same width twice with an edit between, across turns), F2 (two structure blocks), F3 (two failed edits of one file), F4 (an HTML write cut at max_tokens), F5 (next turn) — each with controls that do not fire");
}

console.log(`\n${passed} orchestrator-hooks checks passed`);
