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
  PREVIEW_RECOVERY_COPY, PREVIEW_RECOVERY_ACTIONS,
} from "../src/previewFailure.ts";

const sig = (over = {}) => ({ server: "running", status: 200, path: "/", needsNetwork: false, ...over });
const SPECIFIC = [PREVIEW_RECOVERY_COPY.server_down, PREVIEW_RECOVERY_COPY.offline, "파일이 없어서"];

test("each cause maps to its own sentence and exactly one action", () => {
  const cases = [
    { s: sig({ server: "stopped", status: null }), online: true, cause: "server_down", action: "restart_preview", label: "다시 켜기", text: "미리보기 서버가 꺼져 있어요." },
    { s: sig({ status: 404, path: "/game.html" }), online: true, cause: "not_found", action: "show_files", label: "파일 목록 보기", text: "game.html 파일이 없어서 페이지를 열 수 없어요." },
    { s: sig({ status: null, server: "stopped", needsNetwork: true }), online: false, cause: "offline", action: "retry", label: "다시 시도", text: "인터넷 연결이 끊겨서 미리보기를 열 수 없어요." },
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

test("the server state comes from the process and the answer, not from text", () => {
  const base = "http://127.0.0.1:5123/";
  assert.equal(previewServerState("http://127.0.0.1:5123/game.html", base, 200), "running");
  assert.equal(previewServerState("http://localhost:5123/game.html", base, 404), "running", "the two loopback spellings are one host");
  assert.equal(previewServerState("http://127.0.0.1:5123/", base, null), "stopped", "our server object no longer answers (crash)");
  assert.equal(previewServerState("http://127.0.0.1:4000/", base, null), "stopped", "a port our server used before, nothing answers now");
  assert.equal(previewServerState("http://127.0.0.1:4000/", undefined, null), "stopped", "no server is running at all");
  assert.equal(previewServerState("http://127.0.0.1:4000/", base, 200), "other", "something else answers on the old port");
  assert.equal(previewServerState("http://127.0.0.1:4000/", undefined, 404), "other");
});

test("the 404 line names the file only", () => {
  assert.equal(previewPageFileName("/game.html"), "game.html");
  assert.equal(previewPageFileName("/a/b/c/page.html?x=1#top"), "page.html", "no folders, no query");
  assert.equal(previewPageFileName("/"), "index.html", "the folder's start page");
  assert.equal(previewPageFileName("/sub/"), "index.html");
  assert.equal(previewPageFileName("/%EA%B2%8C%EC%9E%84.html"), "게임.html", "decoded");
  assert.equal(previewPageFileName("/%E0%A4%A.html"), "%E0%A4%A.html", "an undecodable name is shown as is");
  assert.ok(previewPageFileName("/" + "a".repeat(200) + ".html").length <= 60, "a long name is shortened");
  const v = previewRecoveryView(sig({ status: 404, path: "/deep/folder/menu.html" }), true);
  assert.ok(v.text.startsWith("menu.html "), v.text);
  assert.ok(!v.text.includes("deep") && !v.text.includes("/"), "no path in the line");
});

test("the host accepts only the action that fits the current state", () => {
  const down = sig({ server: "stopped", status: null }), missing = sig({ status: 404, path: "/x.html" }), odd = sig({ status: 500 }), fine = sig();
  assert.equal(previewActionFits("restart_preview", down), true);
  assert.equal(previewActionFits("show_files", missing), true);
  assert.equal(previewActionFits("retry", odd), true);
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

test("the handler runs the fitting action once, refuses the rest, and re-posts the state either way", async () => {
  const run = async (action, signals) => {
    const calls = [];
    let reads = 0;
    const r = await runPreviewRecoveryAction(action, {
      signals: async () => { reads++; return signals; },
      restart: async () => { calls.push("restart"); },
      showFiles: async () => { calls.push("showFiles"); },
      retry: async () => { calls.push("retry"); },
      post: async (s) => { calls.push(`post:${s ? previewCause(s, true) : "none"}`); },
    });
    return { r, calls, reads };
  };
  let o = await run("restart_preview", sig({ server: "stopped", status: null }));
  assert.equal(o.r, "done"); assert.deepEqual(o.calls, ["restart", "post:server_down"]);
  o = await run("show_files", sig({ status: 404, path: "/x.html" }));
  assert.equal(o.r, "done"); assert.deepEqual(o.calls, ["showFiles", "post:not_found"]);
  o = await run("retry", sig({ status: 502 }));
  assert.equal(o.r, "done"); assert.deepEqual(o.calls, ["retry", "post:unknown"]);
  // Refused: the state changed under the learner (server came back), so nothing runs; the fresh state goes back.
  o = await run("restart_preview", sig());
  assert.equal(o.r, "refused"); assert.deepEqual(o.calls, ["post:null"], "the page answers now: no cause");
  o = await run("show_files", sig({ server: "stopped", status: null }));
  assert.equal(o.r, "refused"); assert.deepEqual(o.calls, ["post:server_down"]);
  o = await run("retry", null);
  assert.equal(o.r, "refused"); assert.deepEqual(o.calls, ["post:none"]);
  o = await run({ toString: () => "restart_preview" }, sig({ server: "stopped", status: null }));
  assert.equal(o.r, "refused", "only the exact string action is accepted");
});
