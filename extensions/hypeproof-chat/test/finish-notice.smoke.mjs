// REQ-STUDIO-FINISH-NOTICE (CGP-AGENT-R-023): a coach turn that ends while the chat is not on
// screen shows one calm, non-modal notice with "채팅 열기"; never while the chat is visible, never
// for a stopped turn, never in a classroom/lesson/instructor seat, never with answer text, and at
// most one at a time.
//
// 1–3 are pure (finishNotice.ts). 4 runs the real host module (finishNoticeHost.ts, bundled with
// esbuild) against a fake VS Code. 5 locks the wiring in chatPanelProvider.ts.
//
// Run: node --experimental-strip-types test/finish-notice.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const FN = await import("../src/finishNotice.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const require = createRequire(import.meta.url);
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const tick = () => new Promise((r) => setImmediate(r));

const personal = { activity_kind: "personal" };
const hidden = (status, seat = personal, extra = {}) => ({ status, chatVisible: false, seat, ...extra });

// ── 1. Seats ──
{
  const yes = [{ activity_kind: "personal" }, { activity_kind: "trial" }, { pass: { id: "p" } }];
  for (const s of yes) assert.equal(FN.finishNoticeApplies(s), true, JSON.stringify(s));
  const no = [
    null, undefined, {},
    { activity_kind: "classroom" },
    { activity_kind: "classroom", pass: { id: "p" } },
    { activity_kind: "personal", lesson: { content: { title: "수업" } } },
    { activity_kind: "trial", lesson_binding: { enforced: true } },
  ];
  for (const s of no) assert.equal(FN.finishNoticeApplies(s), false, JSON.stringify(s));
  assert.equal(FN.finishNoticeApplies(personal, true), false, "never on the instructor surface");
  ok("seats: personal / trial / pass notify; classroom, lesson-bound, unknown and instructor stay quiet");
}

// ── 2. Kind: visible and stopped give nothing (negative controls), hidden gives done / error ──
{
  assert.equal(FN.finishNoticeKind(hidden("ok")), "done");
  assert.equal(FN.finishNoticeKind(hidden("error")), "error");
  assert.equal(FN.finishNoticeKind({ ...hidden("ok"), chatVisible: true }), null, "visible chat: no notice");
  assert.equal(FN.finishNoticeKind({ ...hidden("error"), chatVisible: true }), null, "visible chat: no error notice");
  assert.equal(FN.finishNoticeKind(hidden("aborted")), null, "a stopped turn: no notice");
  assert.equal(FN.finishNoticeKind(hidden("ok", { activity_kind: "classroom" })), null, "class seat: no notice");
  assert.equal(FN.finishNoticeKind(hidden("ok", personal, { instructor: true })), null, "instructor: no notice");
  ok("kind: hidden → done / error; visible, stopped, class and instructor → none");
}

// ── 3. Copy: calm Korean, distinct for an error, never answer text ──
{
  const C = FN.FINISH_NOTICE_COPY;
  assert.equal(C.done, "AI 답이 준비됐어요.");
  assert.equal(C.open, "채팅 열기");
  assert.notEqual(C.error, C.done, "an error has its own line");
  for (const s of Object.values(C)) {
    assert.match(s, /[가-힣]/, `Korean: ${s}`);
    assert.doesNotMatch(s, /!|오류|에러|실패|error/i, `calm, no alarm words: ${s}`);
  }
  ok("copy: calm Korean, separate error line, fixed strings only");
}

// ── 4. The real host module against a fake VS Code ──
{
  const bundle = await build({ entryPoints: [path.join(extRoot, "src/finishNoticeHost.ts")], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
  const ui = { info: [], answer: undefined, resolve: [], commands: [], reveals: [] };
  const vscode = {
    ViewColumn: { One: 1 },
    window: {
      showInformationMessage: (message, ...rest) => {
        ui.info.push({ message, rest });
        // Stays open until the test answers it, like a real notification.
        return new Promise((r) => ui.resolve.push(r));
      },
      showWarningMessage: () => { throw new Error("must not use a warning / modal"); },
      showErrorMessage: () => { throw new Error("must not use an error message"); },
    },
    commands: { executeCommand: async (id) => { ui.commands.push(id); } },
  };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, process, Promise, setImmediate });
  const host = mod.exports;

  const surfaces = { viewVisible: false, editor: undefined };
  const s = {
    view: () => ({ visible: surfaces.viewVisible }),
    editor: () => surfaces.editor,
  };
  assert.equal(host.chatVisible(s), false);
  surfaces.viewVisible = true;
  assert.equal(host.chatVisible(s), true, "sidebar view visible");
  surfaces.viewVisible = false;
  surfaces.editor = { visible: true, reveal: () => {} };
  assert.equal(host.chatVisible(s), true, "editor panel visible counts too");
  surfaces.editor = undefined;

  const n = host.createFinishNotifier(s);
  const answerText = "비밀 답: 우리 집 주소는 서울시 어딘가";

  // Visible → nothing.
  assert.equal(n.turnEnded({ status: "ok", chatVisible: host.chatVisible({ view: () => ({ visible: true }), editor: () => undefined }), seat: personal }), null);
  // Stopped → nothing.
  assert.equal(n.turnEnded({ status: "aborted", chatVisible: false, seat: personal }), null);
  assert.equal(ui.info.length, 0, "visible and stopped turns show nothing");

  // Hidden → exactly one non-modal notice with the action, no answer text.
  assert.equal(n.turnEnded({ status: "ok", chatVisible: false, seat: personal, text: answerText }), "done");
  assert.equal(ui.info.length, 1);
  assert.equal(ui.info[0].message, "AI 답이 준비됐어요.");
  assert.deepEqual(ui.info[0].rest, ["채팅 열기"], "one action, no { modal: true } options");
  assert.ok(!JSON.stringify(ui.info).includes("비밀 답"), "the notice never carries answer text");

  // Second turn (even an error) while the first notice is open → coalesced.
  assert.equal(n.turnEnded({ status: "error", chatVisible: false, seat: personal }), null);
  assert.equal(n.turnEnded({ status: "ok", chatVisible: false, seat: personal }), null);
  assert.equal(ui.info.length, 1, "two or more turns give one notice");
  assert.equal(n.isPending, true);

  // Action → reveal the sidebar view through its focus command.
  ui.resolve.shift()("채팅 열기");
  await tick(); await tick();
  assert.deepEqual(ui.commands, ["hypeproof-chat.panel.focus"], "the action reveals the chat view");
  assert.equal(n.isPending, false);

  // After it closes, an error turn gets its own calm line; dismissing reveals nothing.
  assert.equal(n.turnEnded({ status: "error", chatVisible: false, seat: personal }), "error");
  assert.equal(ui.info[1].message, FN.FINISH_NOTICE_COPY.error);
  ui.resolve.shift()(undefined);
  await tick(); await tick();
  assert.equal(ui.commands.length, 1, "dismissing does not reveal");

  // With the editor panel open (hidden behind another tab), the action reveals that panel.
  surfaces.editor = { visible: false, reveal: (col) => ui.reveals.push(col) };
  assert.equal(n.turnEnded({ status: "ok", chatVisible: host.chatVisible(s), seat: personal }), "done");
  ui.resolve.shift()("채팅 열기");
  await tick(); await tick();
  assert.deepEqual(ui.reveals, [1], "editor chat revealed in column One");
  assert.equal(ui.commands.length, 1, "no sidebar focus when the editor chat exists");

  // Class seat while hidden → nothing.
  assert.equal(n.turnEnded({ status: "ok", chatVisible: false, seat: { activity_kind: "classroom" } }), null);
  assert.equal(ui.info.length, 3);
  ok("host: non-modal info message, one action, coalesced, action reveals view or editor panel, no answer text");

  // ── 4b. A notice that never settles (its toast timed out into the bell) must not silence later turns ──
  {
    const opened = [];
    let now = 1_000;
    const fakeVs = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = (message) => { opened.push(message); return new Promise(() => {}); };
    const ev = () => { const fns = []; return { on: (fn) => { fns.push(fn); return { dispose() {} }; }, fire: () => fns.forEach((f) => f()) }; };
    const viewEv = ev(), panelEv = ev();
    const view = { visible: false, onDidChangeVisibility: viewEv.on };
    const panel = { visible: false, onDidChangeViewState: panelEv.on, reveal() {} };
    const fresh = () => host.createFinishNotifier({ view: () => view, editor: () => undefined }, { now: () => now });
    const end = (nn) => nn.turnEnded({ status: "ok", chatVisible: false, seat: personal });

    // Sidebar view becomes visible (activity bar, not the button) → the next hidden turn notifies again.
    const a = fresh();
    host.watchChatSurface(view, a);
    assert.equal(end(a), "done");
    assert.equal(end(a), null, "still coalesced while nobody looked");
    view.visible = true; viewEv.fire();
    view.visible = false; viewEv.fire();
    assert.equal(end(a), "done", "chat seen → the next hidden turn notifies again");
    // Negative control: a visibility event while still hidden releases nothing.
    viewEv.fire();
    assert.equal(end(a), null, "a hidden-state event is not 'seen'");

    // Editor panel becomes visible → released too.
    const b = fresh();
    host.watchChatSurface(panel, b);
    assert.equal(end(b), "done");
    panel.visible = true; panelEv.fire(); panel.visible = false;
    assert.equal(end(b), "done", "editor chat seen → notifies again");

    // Next turn start (release) → released.
    const c = fresh();
    assert.equal(end(c), "done");
    assert.equal(end(c), null);
    c.release();
    assert.equal(end(c), "done", "a new turn start ends the hold");

    // Safety timeout: at 2 minutes the hold ends on its own.
    const d = fresh();
    assert.equal(end(d), "done");
    now += 119_999;
    assert.equal(end(d), null, "within the hold: coalesced");
    now += 1;
    assert.equal(end(d), "done", "after FINISH_NOTICE_HOLD_MS the next hidden turn notifies");
    assert.equal(FN.FINISH_NOTICE_HOLD_MS, 120_000);

    // An older notice settling late does not release a newer one.
    let settleOld;
    vscode.window.showInformationMessage = () => new Promise((r) => { settleOld = r; });
    const e = fresh();
    assert.equal(end(e), "done");
    const oldSettle = settleOld;
    e.release();
    assert.equal(end(e), "done");
    oldSettle(undefined);
    await tick(); await tick();
    assert.equal(end(e), null, "a stale notice settling does not end the newer hold");

    // A surface without the event (test fixtures) is tolerated.
    host.watchChatSurface({ visible: false }, fresh());
    vscode.window.showInformationMessage = fakeVs;
    assert.ok(opened.length >= 7);
    ok("hold: released by the view or editor panel becoming visible, by the next turn start and after 2 minutes; stale settle ignored");
  }
}

// ── 5. Wiring in the chat host ──
{
  const src = fs.readFileSync(path.join(extRoot, "src/chatPanelProvider.ts"), "utf8");
  assert.match(src, /from ['"]\.\/finishNoticeHost['"]/, "chatPanelProvider imports the host module");
  assert.match(src, /finishNotice \?\?= createTaskNotifier/, "task-bound notifier built lazily (fixtures skip field initializers)");
  const finalAt = src.indexOf("const finalSpoolStatus = ctrl.signal.aborted ?");
  assert.ok(finalAt > 0, "turn end anchor present");
  const call = src.indexOf("this.finishNotifier.turnEnded(", finalAt);
  assert.ok(call > finalAt && call - finalAt < 600, "turnEnded called right after the turn's final status");
  const callLine = src.slice(call, src.indexOf("\n", call));
  assert.match(callLine, /status: finalSpoolStatus/);
  assert.match(callLine, /chatVisible: chatVisible\(/);
  assert.match(callLine, /instructor: this\._instructorMode\?\.isInstructor === true/);
  assert.match(callLine, /seat: profile,/, "the seat is the turn's own profile, not the cached one");
  assert.match(src, /view\.webview\.onDidReceiveMessage\([^\n]*\n\s*watchChatSurface\(view, this\.finishNotifier\);/, "sidebar view watched for becoming visible");
  assert.match(src, /entry\.webview\.onDidReceiveMessage\([^\n]*\n\s*watchChatSurface\(entry, this\.finishNotifier\);/, "editor chat panel watched for becoming visible");
  assert.match(src, /this\.activeStreams\.set\(streamId, ctrl\);\n\s*this\.finishNotifier\.release\(\);/, "the hold ends at the next turn start");
  assert.doesNotMatch(callLine, /assistantText|text:/, "no answer text reaches the notifier");
  assert.equal(src.split("this.finishNotifier.turnEnded(").length - 1, 1, "one call site");
  assert.match(callLine, /scope: accuracyScope/, "turn-end notice carries the scope captured at turn start");
  assert.match(src, /dispose: \(\) => this\.finishNotice\?\.release\(\)/, "extension disposal cancels pending task notices");
  assert.match(src, /approvalStarted\(\{scope: noticeScope,/, "prompted approval raises the task notice with the scope captured before the modal");
  ok("wiring: one call at turn end with the final status and the turn profile, both surfaces watched, release at turn start, no text");
}

console.log(`\nfinish-notice: ${passed} checks passed`);
