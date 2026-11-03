// REQ-STUDIO-PREVIEW-RECOVERY (CGP-ART-R-009 / REQ-ART-09, DES-ART-09; extends #751 U4) — the pure
// side: which cause a failed preview has, the one sentence and the one action each cause gets, and
// which action the host still accepts. The signals are what the host measured (the live server's
// state for the tab's address, the HTTP status the page answered with, whether the page needs the
// network) plus the webview's navigator.onLine. Nothing here guesses from error text.
//   node --experimental-strip-types --test test/preview-failure.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  previewCause, previewRecoveryView, previewActionFits, previewServerState, previewPageFileName, runPreviewRecoveryAction,
  previewRecoveryNote, measurePreview, PREVIEW_RECOVERY_COPY, PREVIEW_RECOVERY_ACTIONS, PREVIEW_RECOVERY_NOTES,
} from "../src/previewFailure.ts";

const sig = (over = {}) => ({ server: "running", status: 200, path: "/", needsNetwork: false, ...over });
const SPECIFIC = [PREVIEW_RECOVERY_COPY.server_down, PREVIEW_RECOVERY_COPY.offline, PREVIEW_RECOVERY_COPY.slow, "파일이 없어서"];

test("each cause maps to its own sentence and exactly one action", () => {
  const cases = [
    { s: sig({ server: "stopped", status: null }), online: true, cause: "server_down", action: "restart_preview", label: "다시 켜기", text: "미리보기 서버가 꺼져 있어요." },
    { s: sig({ status: 404, path: "/game.html" }), online: true, cause: "not_found", action: "show_files", label: "파일 목록 보기", text: "game.html 파일이 없어서 페이지를 열 수 없어요." },
    { s: sig({ status: null, server: "stopped", needsNetwork: true }), online: false, cause: "offline", action: "retry", label: "다시 시도", text: "인터넷 연결이 끊겨서 미리보기를 열 수 없어요." },
    { s: sig({ server: "slow", status: null }), online: true, cause: "slow", action: "retry", label: "다시 시도", text: "미리보기가 응답이 늦어요." },
    { s: sig({ status: 500 }), online: true, cause: "unknown", action: "retry", label: "다시 시도", text: "미리보기를 열지 못했어요." },
  ];
  for (const c of cases) {
    assert.equal(previewCause(c.s, c.online), c.cause, c.cause);
    const v = previewRecoveryView(c.s, c.online);
    assert.ok(v, c.cause);
    assert.equal(v.cause, c.cause);
    assert.equal(v.text, c.text, `${c.cause} sentence`);
    assert.equal(v.action, c.action, `${c.cause} action`);
    assert.equal(v.actionLabel, c.label, `${c.cause} label`);
    assert.equal(PREVIEW_RECOVERY_ACTIONS[c.cause].action, c.action, "one action per cause in the table");
    assert.ok(!/DNS|proxy|ECONN|localhost|127\.0\.0\.1|404|500/i.test(v.text), `${c.cause}: no technical words in the cause line`);
  }
});

test("a page that answered 2xx is not a failure (positive control: no card)", () => {
  assert.equal(previewCause(sig(), true), null);
  assert.equal(previewRecoveryView(sig(), true), null);
  assert.equal(previewRecoveryView(sig({ status: 204 }), false), null, "a loopback page that answered is fine offline too");
  assert.equal(previewRecoveryView(sig({ server: "other", status: 200 }), true), null);
  assert.equal(previewRecoveryView(null, true), null, "no preview tab, nothing to say");
});

test("an unknown status stays generic and never claims a specific cause", () => {
  const unknowns = [
    sig({ status: 500 }), sig({ status: 503 }), sig({ status: 403 }), sig({ status: 400 }), sig({ status: 302 }),
    // Another process answers on a port our server used to have: its 404 is not the learner's file.
    sig({ server: "other", status: 404, path: "/game.html" }),
    sig({ server: "other", status: 500 }),
  ];
  for (const s of unknowns) {
    const v = previewRecoveryView(s, true);
    assert.equal(v?.cause, "unknown", JSON.stringify(s));
    assert.equal(v.action, "retry");
    for (const phrase of SPECIFIC) assert.ok(!v.text.includes(phrase), `generic line claims "${phrase}" for ${JSON.stringify(s)}`);
    assert.ok(!v.text.includes("game.html"), "never names a file it did not see missing");
  }
});

test("offline is a cause only when the preview needs the network", () => {
  // Negative control: the learner's preview is served from this computer; navigator.onLine=false says nothing about it.
  assert.equal(previewCause(sig({ status: 404, path: "/a.html" }), false), "not_found");
  assert.equal(previewCause(sig({ server: "stopped", status: null }), false), "server_down");
  assert.equal(previewCause(sig({ status: 200, needsNetwork: true }), false), "offline", "network page while offline");
  assert.equal(previewCause(sig({ status: 200, needsNetwork: true }), true), null);
});

test("the server state comes from the server's own socket and the answer, never from a slow answer", () => {
  const base = "http://127.0.0.1:5123/";
  const up = { base, listening: true }, closed = { base, listening: false }, none = { base: undefined, listening: false };
  assert.equal(previewServerState("http://127.0.0.1:5123/game.html", up, 200), "running");
  assert.equal(previewServerState("http://localhost:5123/game.html", up, 404), "running", "the two loopback spellings are one host");
  // F1: our server is listening but did not answer in time: slow, never off.
  assert.equal(previewServerState("http://127.0.0.1:5123/", up, "timeout"), "slow");
  assert.equal(previewCause(sig({ server: previewServerState("http://127.0.0.1:5123/", up, "timeout"), status: null }), true), "slow");
  assert.notEqual(previewCause(sig({ server: "slow", status: null }), true), "server_down", "a slow server is never called off");
  // Off is the server's own state: its socket closed (crash), whatever the probe said.
  assert.equal(previewServerState("http://127.0.0.1:5123/", closed, "timeout"), "stopped");
  assert.equal(previewServerState("http://127.0.0.1:5123/", closed, "refused"), "stopped");
  assert.equal(previewServerState("http://127.0.0.1:5123/", up, "refused"), "stopped", "listening flag stale, port refuses: off");
  // An old Studio port: only a refused connection (nothing listens there) is off.
  assert.equal(previewServerState("http://127.0.0.1:4000/", up, "refused"), "stopped");
  assert.equal(previewServerState("http://127.0.0.1:4000/", none, "refused"), "stopped", "no server is running at all");
  assert.equal(previewServerState("http://127.0.0.1:4000/", up, "timeout"), "other", "something hangs on the old port: not ours");
  assert.equal(previewServerState("http://127.0.0.1:4000/", up, 200), "other", "something else answers on the old port");
  assert.equal(previewServerState("http://127.0.0.1:4000/", none, 404), "other");
});

test("measurePreview reads the server state after the probe and treats a throwing probe as no answer in time", async () => {
  let listening = true;
  const live = () => ({ base: "http://127.0.0.1:5123/", listening });
  let s = await measurePreview("http://127.0.0.1:5123/a.html", live, async () => "timeout");
  assert.deepEqual([s.server, s.status, s.path], ["slow", null, "/a.html"]);
  s = await measurePreview("http://127.0.0.1:5123/a.html", live, async () => { listening = false; return "timeout"; });
  assert.equal(s.server, "stopped", "the server closed while the probe waited");
  listening = true;
  s = await measurePreview("http://127.0.0.1:5123/a.html", live, async () => { throw new Error("boom"); });
  assert.equal(s.server, "slow", "a probe error is not proof the server is off");
});

test("the 404 line names the file only", () => {
  assert.equal(previewPageFileName("/game.html"), "game.html");
  assert.equal(previewPageFileName("/a/b/c/page.html?x=1#top"), "page.html", "no folders, no query");
  assert.equal(previewPageFileName("/"), "index.html", "the folder's start page");
  assert.equal(previewPageFileName("/sub/"), "index.html");
  assert.equal(previewPageFileName("/%EA%B2%8C%EC%9E%84.html"), "게임.html", "decoded");
  assert.equal(previewPageFileName("/%E0%A4%A.html"), "%E0%A4%A.html", "an undecodable name is shown as is");
  // F6: an encoded separator never brings folders into the line.
  assert.equal(previewPageFileName("/%2FUsers%2Fjay%2Fsecret%2Fa.html"), "a.html");
  assert.equal(previewPageFileName("/C%3A%5CUsers%5Cjay%5Cb.html"), "b.html");
  assert.equal(previewPageFileName("/x/%2Fsecret%2F"), "index.html");
  // F7: a long name is shortened in the middle and keeps its extension.
  const long = previewPageFileName("/" + "very-long-page-name-".repeat(6) + "v2.html");
  assert.ok(long.length <= 60, long);
  assert.ok(long.endsWith("v2.html") && long.includes("…") && long.startsWith("very-long-page"), long);
  const v = previewRecoveryView(sig({ status: 404, path: "/deep/folder/menu.html" }), true);
  assert.ok(v.text.startsWith("menu.html "), v.text);
  assert.ok(!v.text.includes("deep") && !v.text.includes("/"), "no path in the line");
});

test("the host accepts only the action that fits the current state", () => {
  const down = sig({ server: "stopped", status: null }), missing = sig({ status: 404, path: "/x.html" }), odd = sig({ status: 500 }), fine = sig();
  assert.equal(previewActionFits("restart_preview", down), true);
  assert.equal(previewActionFits("show_files", missing), true);
  assert.equal(previewActionFits("retry", odd), true);
  assert.equal(previewActionFits("retry", sig({ server: "slow", status: null })), true, "a slow server gets 다시 시도");
  assert.equal(previewActionFits("restart_preview", sig({ server: "slow", status: null })), false, "never 다시 켜기 for a slow server");
  // Negative controls: every other pairing is refused.
  assert.equal(previewActionFits("restart_preview", missing), false, "the server is running: no restart for a missing file");
  assert.equal(previewActionFits("restart_preview", fine), false, "nothing is wrong");
  assert.equal(previewActionFits("restart_preview", odd), false);
  assert.equal(previewActionFits("show_files", down), false);
  assert.equal(previewActionFits("show_files", odd), false);
  assert.equal(previewActionFits("retry", down), false, "a stopped server gets 다시 켜기, not 다시 시도");
  assert.equal(previewActionFits("retry", missing), false);
  assert.equal(previewActionFits("retry", fine), false);
  assert.equal(previewActionFits("retry", null), false, "no preview tab");
  assert.equal(previewActionFits("delete_files", down), false, "unknown action");
  // The host cannot see navigator.onLine: a network page may be offline, so 다시 시도 fits there.
  assert.equal(previewActionFits("retry", sig({ status: 200, needsNetwork: true })), true);
});

test("the handler runs the fitting action once, refuses the rest, and always posts once with the result", async () => {
  const run = async (action, signals, over = {}) => {
    const calls = [];
    const r = await runPreviewRecoveryAction(action, {
      signals: async () => signals,
      restart: async () => { calls.push("restart"); return true; },
      showFiles: async () => { calls.push("showFiles"); },
      retry: async () => { calls.push("retry"); },
      post: async (s, result) => { calls.push(`post:${s ? previewCause(s, true) : "none"}:${result}`); },
      ...over,
    });
    return { r, calls };
  };
  const down = sig({ server: "stopped", status: null });
  let o = await run("restart_preview", down);
  assert.equal(o.r, "done"); assert.deepEqual(o.calls, ["restart", "post:server_down:done"]);
  o = await run("show_files", sig({ status: 404, path: "/x.html" }));
  assert.equal(o.r, "done"); assert.deepEqual(o.calls, ["showFiles", "post:not_found:done"]);
  o = await run("retry", sig({ status: 502 }));
  assert.equal(o.r, "done"); assert.deepEqual(o.calls, ["retry", "post:unknown:done"]);
  // Refused: the state changed under the learner, so nothing runs; the fresh state goes back with the result.
  o = await run("restart_preview", sig());
  assert.equal(o.r, "refused"); assert.deepEqual(o.calls, ["post:null:refused"]);
  o = await run("show_files", down);
  assert.equal(o.r, "refused"); assert.deepEqual(o.calls, ["post:server_down:refused"]);
  o = await run("retry", null);
  assert.equal(o.r, "refused"); assert.deepEqual(o.calls, ["post:none:refused"]);
  o = await run({ toString: () => "restart_preview" }, down);
  assert.equal(o.r, "refused", "only the exact string action is accepted");
  // Failed: the start path did not run, or the action threw. Still exactly one post, so the button comes back.
  o = await run("restart_preview", down, { restart: async () => false });
  assert.equal(o.r, "failed"); assert.deepEqual(o.calls, ["post:server_down:failed"]);
  o = await run("retry", sig({ status: 500 }), { retry: async () => { throw new Error("Page.navigate rejected"); } });
  assert.equal(o.r, "failed"); assert.deepEqual(o.calls, ["post:unknown:failed"]);
  let first = true;
  o = await run("retry", sig({ status: 500 }), { signals: async () => { if (first) { first = false; throw new Error("probe crashed"); } return sig({ status: 500 }); } });
  assert.equal(o.r, "failed"); assert.deepEqual(o.calls, ["post:unknown:failed"], "a measurement that throws still answers the press");
});

test("a press that did not run gets one line saying so", () => {
  assert.equal(previewRecoveryNote("done", sig({ status: 500 })), null);
  assert.equal(previewRecoveryNote(undefined, sig({ status: 500 })), null, "a pushed state carries no note");
  assert.equal(previewRecoveryNote("failed", sig({ status: 500 })), PREVIEW_RECOVERY_NOTES.failed);
  assert.equal(previewRecoveryNote("refused", sig({ server: "stopped", status: null })), PREVIEW_RECOVERY_NOTES.refused);
  assert.equal(previewRecoveryNote("refused", null), PREVIEW_RECOVERY_NOTES.refusedGone, "the tab closed or the page came back meanwhile");
  assert.equal(previewRecoveryNote("refused", sig()), PREVIEW_RECOVERY_NOTES.refusedGone);
});
