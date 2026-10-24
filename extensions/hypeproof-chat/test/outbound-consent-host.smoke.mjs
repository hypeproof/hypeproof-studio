// REQ-KNOW-09 / CGP-KNOW-R-006 — the host side of the outbound confirmation, with VS Code replaced at the bundle boundary
// and fetch intercepted (nothing reaches a network). What must hold:
//   H1  confirmOutbound opens a MODAL with the exact disclosure text and is true only for "확인하고 보내기"; a dismissed or
//       otherwise answered dialog, or an invalid manifest, authorizes nothing (and an invalid manifest opens nothing).
//   H2  "문제 신고하기" (the real command): recipient, items with sizes and the exclusion line are shown before anything
//       leaves; Cancel → zero POSTs; approve → exactly the listed body, once. Also when the recent turns are not included.
//   H3  gallery publish through the real provider: one dialog lists the page AND the session record (its own recipient,
//       files and sizes); Cancel → no page POST and no log PUT; approve → page, then exactly the listed log bytes.
//   H4  budget request and observation assessment through the real provider: Cancel sends nothing; approve sends once.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url)), ext = path.resolve(here, "..");
const require = createRequire(path.join(ext, "package.json"));
const { build } = require("esbuild");
const EXCLUDED = "포함하지 않는 것: AI 기억, 개인 메모";

/** A VS Code stand-in whose warning dialog records every call and answers with `answer`. */
function fakeVscode() {
  const v = {
    dialogs: [], answer: undefined, inputs: [], picks: [], infos: [], warnings: [], progress: 0,
    window: {
      showWarningMessage: async (message, options, ...actions) => {
        if (options && typeof options === "object" && options.modal) { v.dialogs.push({ message, options, actions }); v.onDialog?.(); return v.answer; }
        v.warnings.push(message); return undefined;
      },
      showInformationMessage: async (m) => { v.infos.push(m); return undefined; },
      showInputBox: async () => v.inputs.shift(),
      showQuickPick: async (items) => items[v.picks.shift()],
      withProgress: async (_o, task) => { v.progress++; return task(); },
    },
    workspace: { getConfiguration: () => ({ get: (k, fallback) => (k === "proxyUrl" ? "https://service.invalid/v1" : k === "siteBase" ? "https://site.invalid" : fallback) }), fs: { readFile: async (uri) => require("node:fs").readFileSync(uri.fsPath) } },
    env: { language: "ko" }, version: "1.0.0-synthetic", ProgressLocation: { Notification: 15 },
    Uri: { file: (fsPath) => ({ fsPath, scheme: "file" }) }, ViewColumn: { One: 1, Two: 2, Beside: 2 },
  };
  return v;
}
async function load(entry, stubs = {}) {
  const plugins = [{ name: "stubs", setup(b) {
    for (const [filter, contents] of Object.entries(stubs)) {
      b.onResolve({ filter: new RegExp(filter) }, () => ({ path: filter, namespace: "stub" }));
      b.onLoad({ filter: new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), namespace: "stub" }, () => ({ contents, loader: "js" }));
    }
  } }];
  const out = await build({ ...(entry.startsWith("export ") ? { stdin: { contents: entry, resolveDir: ext, sourcefile: "entry.ts", loader: "ts" } } : { entryPoints: [path.join(ext, entry)] }), bundle: true, platform: "node", format: "cjs", write: false, external: ["vscode"], plugins, logLevel: "silent" });
  return (vscode, fetchImpl) => {
    const mod = { exports: {} };
    vm.runInNewContext(out.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), fetch: (...a) => fetchImpl(...a),
      console: { log() {}, error() {}, warn() {} }, Buffer, process, setTimeout, clearTimeout, setImmediate, AbortSignal, AbortController, URL, TextEncoder, TextDecoder, Response, crypto: webcrypto, structuredClone });
    return mod.exports;
  };
}
let pass = 0;
const ok = (label) => { pass++; console.log("  ok   " + label); };

// ── H1 confirmOutbound ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const make = await load("src/outboundConsentHost.ts");
  const v = fakeVscode(), { confirmOutbound } = make(v, async () => { throw Error("no network"); });
  const manifest = { recipient: "수업 기록 운영자 · service.invalid", items: [{ name: "events.jsonl", bytes: 2048 }] };
  v.answer = undefined; assert.equal(await confirmOutbound(manifest), false, "closing the dialog authorizes nothing");
  assert.equal(v.dialogs.length, 1); const d = v.dialogs[0];
  assert.equal(d.options.modal, true, "the dialog is modal");
  assert.equal(d.message, "보내기 전에 확인해 주세요");
  assert.equal(d.options.detail, ["받는 곳: 수업 기록 운영자 · service.invalid", "보낼 항목:", "• events.jsonl (2,048 바이트)", "ⓘ 받는 사람의 AI 기억: 확인 안 됨", "", EXCLUDED].join("\n"));
  assert.deepEqual(d.actions, ["확인하고 보내기"], "one send action; Cancel is the dialog's own");
  v.answer = "취소"; assert.equal(await confirmOutbound(manifest), false, "any other answer is not consent");
  v.answer = "확인하고 보내기"; assert.equal(await confirmOutbound(manifest), true);
  const before = v.dialogs.length; assert.equal(await confirmOutbound({ recipient: "", items: [{ name: "a", bytes: 1 }] }), false);
  assert.equal(v.dialogs.length, before, "an invalid manifest opens no dialog");
  ok("H1 confirmOutbound: modal, exact disclosure text, true only for 확인하고 보내기");
}

// ── H2 the real 문제 신고하기 command ─────────────────────────────────────────────────────────────────────────────────────
{
  const make = await load("src/reportProblem.ts", { "^\\./extension$": 'export const TOKEN_KEY = "synthetic.token.key";' });
  const turns = [{ role: "system", content: "SYSTEM" }, { role: "user", content: "내 질문 PRIVATE-TURN" }, { role: "assistant", content: "AI 답" }];
  const run = async ({ answer, includeTurns }) => {
    const v = fakeVscode(), posts = [];
    v.answer = answer; v.inputs = ["버튼을 눌러도 아무 일도 없어요 PRIVATE-DESC", "010-0000-0000"]; v.picks = [includeTurns ? 1 : 0];
    const { runReportProblemCommand } = make(v, async (url, init) => { posts.push({ url, body: init.body, method: init.method }); return Response.json({ report_id: "R-1" }); });
    await runReportProblemCommand({ context: { secrets: { get: async () => undefined }, extension: { packageJSON: { version: "0.0.0-synthetic" } } }, getLastRequestId: () => "req-1", getProfileId: () => "profile-1", getRecentTurns: () => turns, getAudience: () => "classroom" });
    return { v, posts };
  };
  for (const includeTurns of [true, false]) {
    const cancelled = await run({ answer: undefined, includeTurns });
    assert.equal(cancelled.posts.length, 0, "Cancel: zero POSTs to /report");
    assert.equal(cancelled.v.progress, 0, "no 접수 중 toast before approval");
    assert.equal(cancelled.v.dialogs.length, 1, "the report asks before it leaves");
    const lines = cancelled.v.dialogs[0].options.detail.split("\n");
    assert.equal(lines[0], "받는 곳: Studio 운영팀 (문제 신고 채널) · service.invalid", "recipient line");
    assert.equal(lines.at(-1), EXCLUDED, "exclusion line");
    assert.ok(lines.some((l) => /^• 내가 쓴 문제 설명 \([\d,]+ 바이트\)$/.test(l)) && lines.some((l) => /^• 내가 적은 연락처 \([\d,]+ 바이트\)$/.test(l)));
    assert.equal(lines.filter((l) => l.startsWith("• 최근 대화")).length, includeTurns ? 2 : 0, "each included turn is its own sized line");
    const sent = await run({ answer: "확인하고 보내기", includeTurns });
    assert.equal(sent.posts.length, 1, "approved: one POST"); assert.equal(sent.posts[0].url, "https://service.invalid/v1/report");
    const body = JSON.parse(sent.posts[0].body);
    assert.equal(body.description, "버튼을 눌러도 아무 일도 없어요 PRIVATE-DESC");
    assert.deepEqual(body.recent_turns?.map((t) => t.role), includeTurns ? ["user", "assistant"] : undefined);
    const detail = sent.v.dialogs[0].options.detail, item = (name, v) => new RegExp(`• ${name} \\(${Buffer.byteLength(JSON.stringify(v)).toLocaleString("ko-KR")} 바이트\\)`);
    assert.match(detail, item("내가 쓴 문제 설명", body.description), "the size shown is the size sent");
    if (includeTurns) assert.match(detail, item("최근 대화 1 · 내가 보낸 말", body.recent_turns[0]));
    assert.match(sent.v.infos[0] ?? "", /R-1/);
  }
  ok("H2 문제 신고하기: recipient, sized items, exclusion line before any POST; Cancel sends nothing, approve sends the listed body once");
}

// ── H3/H4 the real provider ─────────────────────────────────────────────────────────────────────────────────────────────
const makeProvider = await load('export { ChatPanelProvider } from "./src/chatPanelProvider.ts"; export { setOutboundPresenter } from "./src/outboundConsentHost.ts"; export { outboundDetails } from "./src/outboundConsent.ts";', { 'visitorPreviewHost$': 'import * as vscode from "vscode"; export const showVisitorPreview = async snapshot => { vscode.window.previewSnapshot = snapshot; return vscode.window.previewAnswer !== false; };' });
const root = mkdtempSync(path.join(os.tmpdir(), "hps-outbound-host-"));
try {
  const work = path.join(root, "work"), sessionDir = path.join(root, "spool", "2026-10-20", "session-synthetic");
  mkdirSync(work, { recursive: true }); mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(work, "index.html"), "<!doctype html><title>내 세상</title><p>한😀</p>");
  writeFileSync(path.join(sessionDir, "session.meta.json"), "{}"); writeFileSync(path.join(sessionDir, "events.jsonl"), '{"text":"PRIVATE-EVENT"}\n');
  const provider = (answer) => {
    const v = fakeVscode(), calls = [], posts = [];
    v.answer = answer;
    const { ChatPanelProvider, setOutboundPresenter, outboundDetails } = makeProvider(v, async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body });
      if (url.endsWith("/api/gallery/publish")) return Response.json({ ok: true, url: "/w/1", displayName: "synthetic" });
      if (url.includes("/logs/")) return Response.json({ key: "k" });
      if (url.endsWith("/access/requests")) return Response.json({ ok: true });
      if (url.endsWith("/observations/assess")) return Response.json({ findings: [] });
      return Response.json({});
    });
    const h = Object.create(ChatPanelProvider.prototype);
    Object.assign(h, {
      context: { secrets: { get: async () => "synthetic-token" }, workspaceState: { get: (k, fallback) => (/world/i.test(k) ? "kq-synthetic" : fallback), update: async () => {} }, globalStorageUri: { fsPath: root } },
      cachedProfile: { publishing: { enabled: true, strategy: "hypeproof_gallery" }, analytics: { upload_session_logs: true } },
      profileGeneration: 1, resolveCoachCwd: () => work, inlineEngineIfNeeded: async (html) => html,
      spool: { currentSessionDir: () => sessionDir }, post: async (m) => { posts.push(m); return true; },
      activeStreams: new Map(), pendingSends: 0, draftWrites: Promise.resolve(), postConfig: async () => {}, loadAccess: async () => {},
    });
    // CGP-KNOW-R-007: public sends are only ever asked in the panel. `panel` answers each step like the in-panel dialogs:
    // `panel.content` / `panel.public` (true, false or null = no visible panel); `panel.asked` records [step, details].
    const panel = { content: answer === "확인하고 보내기", public: answer === "확인하고 보내기", asked: [], on: null };
    setOutboundPresenter(async (m, step) => { if (!m.public) return null; panel.asked.push([step, outboundDetails(m)]); panel.on?.(step); return panel[step]; });
    return { h, v, calls, posts, panel };
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));

  // H3 gallery
  {
    const previewCancel = provider("확인하고 보내기"); previewCancel.v.window.previewAnswer = false;
    await previewCancel.h.publishToGallery(); await settle();
    assert.equal(previewCancel.panel.asked.length, 0, "cancel preview never reaches send consent");
    assert.deepEqual(previewCancel.calls.filter(x => x.method !== "GET"), [], "cancel preview sends neither page nor record");
    assert.equal(previewCancel.v.window.previewSnapshot.entry, "index.html");
    assert.match(previewCancel.v.window.previewSnapshot.audience, /site.invalid.*인터넷의 누구나/);
    assert.ok(previewCancel.v.window.previewSnapshot.files[0].data.toString().includes("내 세상"));
    const c = provider(undefined); await c.h.publishToGallery(); await settle();
    assert.deepEqual(c.panel.asked.map(x => x[0]), ["content"], "one checklist for the whole action; Cancel ends it");
    assert.equal(c.v.dialogs.length, 0, "a public send never opens a native modal");
    assert.deepEqual(c.calls.filter((x) => x.method !== "GET"), [], "Cancel: no page POST and no log PUT");
    const lines = c.panel.asked[0][1].split("\n");
    assert.equal(lines[0], "받는 곳: 갤러리 · site.invalid"); assert.equal(lines[1], "누구나 볼 수 있어요");
    assert.equal(lines[2], "공개 페이지에 내 이름이 함께 보여요 (수업 명단에 적힌 이름을 갤러리가 붙여요)", "F7: the name on the public page is said");
    const at = lines.indexOf("함께 보내는 것 — 받는 곳: 수업 기록 운영자 · service.invalid");
    assert.equal(lines[at + 1], "ⓘ 받는 사람의 AI 기억: 확인 안 됨", "secondary recipient has its own unknown policy");
    assert.ok(at > 0, "the session record is its own block with its own recipient: " + lines.join(" | "));
    assert.deepEqual(lines.slice(at + 2, at + 4), ["• 이번 활동 기록 session.meta.json (2 바이트)", `• 이번 활동 기록 events.jsonl (${Buffer.byteLength('{"text":"PRIVATE-EVENT"}\n')} 바이트)`]);
    assert.equal(lines.at(-1), EXCLUDED);
    const secondCancel = provider("확인하고 보내기"); secondCancel.panel.public = false;
    await secondCancel.h.publishToGallery(); await settle();
    assert.deepEqual(secondCancel.panel.asked.map(x => x[0]), ["content", "public"], "the public step is asked separately, after the checklist");
    assert.deepEqual(secondCancel.calls.filter(x => x.method !== "GET"), [], "second Cancel sends neither page nor logs");
    const hidden = provider("확인하고 보내기"); hidden.panel.content = null; hidden.v.answer = "확인하고 보내기";
    await hidden.h.publishToGallery(); await settle();
    assert.equal(hidden.v.dialogs.length, 0, "panel hidden: no native modal even though it would answer yes");
    assert.deepEqual(hidden.calls.filter(x => x.method !== "GET"), [], "panel hidden: nothing published");
    const a = provider("확인하고 보내기");
    // The learner keeps working while the dialog is open: the spool grows. What was listed is what goes up.
    a.panel.on = (step) => { if (step === "content") writeFileSync(path.join(sessionDir, "events.jsonl"), '{"text":"PRIVATE-EVENT"}\n{"text":"LATER"}\n'); };
    await a.h.publishToGallery(); await settle();
    const writes = a.calls.filter((x) => x.method !== "GET");
    assert.equal(writes[0].url, "https://site.invalid/api/gallery/publish", "the page goes first");
    assert.deepEqual(writes.slice(1).map((x) => new URL(x.url).pathname), ["/v1/logs/session-synthetic/session.meta.json", "/v1/logs/session-synthetic/events.jsonl"], "then the listed session record (2026-08-21 decision kept)");
    assert.equal(Buffer.from(writes[2].body).toString(), '{"text":"PRIVATE-EVENT"}\n', "exactly the listed bytes, not what the spool holds later");
    assert.equal(a.posts.at(-1)?.state, "done");
    writeFileSync(path.join(sessionDir, "events.jsonl"), '{"text":"PRIVATE-EVENT"}\n');
    const off = provider(undefined); off.h.cachedProfile = { publishing: { enabled: true, strategy: "hypeproof_gallery" }, analytics: { upload_session_logs: false } };
    await off.h.publishToGallery(); assert.ok(!off.panel.asked[0][1].includes("함께 보내는 것"), "no record block when the profile does not upload logs");
    ok("H3 gallery: one dialog lists page and session record; Cancel sends neither; approve sends page then exactly the listed log bytes");
  }

  // H4 budget request and observation assessment
  {
    for (const [answer, n] of [[undefined, 0], ["확인하고 보내기", 1]]) {
      const c = provider(answer); c.h.accessState = { selected: "src-synthetic" };
      await c.h.handleMessage({ type: "requestBudget", note: "마지막 검증을 하고 싶어요 PRIVATE-NOTE" });
      assert.equal(c.calls.filter((x) => x.url.endsWith("/access/requests")).length, n, "budget request after " + answer);
      assert.match(c.v.dialogs[0]?.options.detail ?? "", /^받는 곳: 이용권을 관리하는 강사 · service\.invalid\n보낼 항목:\n• 추가 사용이 필요한 이유 \(내가 쓴 글\) \(\d+ 바이트\)/);
      assert.equal(c.h.accessState.notice, n ? "강사에게 추가 사용 요청을 보냈습니다." : "보내지 않았습니다.");
    }
    for (const [answer, n] of [[undefined, 0], ["확인하고 보내기", 1]]) {
      const c = provider(answer), events = [{ id: "e1", kind: "user", text: "PRIVATE-OBS" }, { id: "e2", kind: "assistant", text: "AI" }];
      const batch = { scope: "scope-1", program: "p", events, incomplete: false };
      c.h.prepareObservation = async () => ({ batch, missing: [], snapshot: () => batch });
      c.h.ensureProfile = async () => ({}); c.h.nativeObservation = { batch };
      await c.h.handleMessage({ type: "observationAssess", scope: "scope-1", eventIds: ["e1", "e2"] });
      assert.equal(c.calls.filter((x) => x.url.endsWith("/observations/assess")).length, n, "observation assessment after " + answer);
      const lines = (c.v.dialogs[0]?.options.detail ?? "").split("\n");
      assert.equal(lines[0], "받는 곳: 관찰 평가 API (원문은 저장하지 않음) · service.invalid");
      assert.deepEqual(lines.slice(2, 4), [`• 기록 1 · 내가 보낸 말 (${Buffer.byteLength(JSON.stringify(events[0]))} 바이트)`, `• 기록 2 · AI의 답 (${Buffer.byteLength(JSON.stringify(events[1]))} 바이트)`]);
      if (!n) assert.match(c.posts.at(-1)?.error ?? "", /보내지 않았습니다/);
    }
    ok("H4 budget request and observation assessment: listed and confirmed on the host; Cancel sends nothing");
  }
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`PASS ${pass}/4 outbound confirmation host checks`);
