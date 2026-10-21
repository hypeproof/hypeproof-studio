// REQ-STUDIO-QUIT-GUARD (CGP-SHELL-R-004 / REQ-SHELL-04, CGP-SHELL-D-003 / DES-SHELL-03).
// The quit dialog: the extension's copy, the core guard's decisions, and the safe-default
// message box that keeps Enter and Esc on "계속하기".
import assert from "node:assert/strict";

const ext = await import("../src/quitGuardHelpers.ts");
const core = await import("../../../scripts/patches/core/src/vs/workbench/contrib/hpsQuitGuard/common/hpsQuitGuardCore.ts");
const dialog = await import("../../../scripts/patches/core/src/vs/platform/dialogs/common/hpsSafeDefaultDialog.ts");

// The extension answers the command the core calls.
assert.equal(ext.QUIT_GUARD_COMMAND, core.HPS_QUIT_GUARD_COMMAND);

// --- extension copy -------------------------------------------------------------------
assert.equal(ext.quitGuardPrompt({ turnRunning: false, queuedUnsent: false }), null, "no dialog when nothing is active");

const lines = (p) => p.detail.split("\n");
const turn = ext.quitGuardPrompt({ turnRunning: true, queuedUnsent: false });
assert.equal(turn.message, "Studio를 끝낼까요?");
assert.deepEqual(lines(turn), ["지금 하고 있는 대답이 멈춰요.", "만든 파일은 그대로 남아요."]);
assert.equal(turn.continueLabel, "계속하기");
assert.equal(turn.quitLabel, "끝내기");
const queued = ext.quitGuardPrompt({ turnRunning: false, queuedUnsent: true });
assert.deepEqual(lines(queued), ["보내지 않은 메시지가 있어요.", "끝내면 이 메시지는 보내지 않아요."]);
const both = ext.quitGuardPrompt({ turnRunning: true, queuedUnsent: true });
assert.deepEqual(lines(both), ["지금 하고 있는 대답이 멈춰요.", "보내려던 메시지도 보내지 않아요."]);
for (const p of [turn, queued, both]) {
  assert.ok(lines(p).length <= 2, "body is at most two lines");
  for (const line of lines(p)) assert.ok([...line].length <= 24, `short Korean line: ${line}`);
  // The core accepts the extension's copy unchanged (no truncation or rejection).
  assert.deepEqual(core.hpsReadQuitPrompt(p), p);
}

// --- native message box shape ---------------------------------------------------------
const box = core.hpsQuitMessageBox(core.hpsReadQuitPrompt(turn));
assert.deepEqual(box, {
  type: "warning",
  message: "Studio를 끝낼까요?",
  detail: "지금 하고 있는 대답이 멈춰요.\n만든 파일은 그대로 남아요.",
  buttons: ["계속하기", "끝내기"],
  defaultId: 0,
  cancelId: 0,
});
assert.equal(box.buttons[core.HPS_QUIT_BUTTON_INDEX], "끝내기", "the only button that quits is the destructive one");

// --- safe-default massage (dialogs.ts hook) -------------------------------------------
assert.equal(dialog.hpsIsSafeDefaultDialog(box), true);
for (const [options, why] of [
  [{ buttons: ["a", "b"] }, "no defaultId: upstream path"],
  [{ buttons: ["a", "b"], cancelId: 0 }, "cancel only: upstream path"],
  [{ buttons: ["a", "b"], defaultId: 0, cancelId: 1 }, "different default and cancel"],
  [{ buttons: ["a", "b"], defaultId: 2, cancelId: 2 }, "out of range"],
  [{ buttons: ["a", "b"], defaultId: 0.5, cancelId: 0.5 }, "not an index"],
  [{ buttons: ["a"], defaultId: 0, cancelId: 0 }, "single button"],
]) assert.equal(dialog.hpsIsSafeDefaultDialog(options), false, why);

const mnemonic = (label) => label.replace(/&&/g, "");
const massaged = dialog.hpsMassageSafeDefaultDialog(box, "HypeProof Studio", mnemonic);
assert.deepEqual(massaged.options.buttons, ["계속하기", "끝내기"], "order kept");
assert.equal(massaged.options.defaultId, 0);
assert.equal(massaged.options.cancelId, 0);
assert.equal(massaged.options.noLink, true);
assert.equal(massaged.options.title, "HypeProof Studio");
assert.equal(massaged.options.message, box.message, "title line reaches the native dialog (VoiceOver/Narrator)");
assert.equal(massaged.options.detail, box.detail, "body reaches the native dialog (VoiceOver/Narrator)");
assert.deepEqual(massaged.buttonIndeces, [0, 1]);
assert.equal(dialog.hpsMassageSafeDefaultDialog({ ...box, title: "x" }, "HypeProof Studio", mnemonic).options.title, "x");

// End to end: what Enter and Esc resolve to through the massaged native box.
// Electron returns the pressed index; dialogMainService maps it through buttonIndeces.
const pressed = (index) => ({ response: massaged.buttonIndeces[index] });
const enter = pressed(massaged.options.defaultId);
const esc = pressed(massaged.options.cancelId);
assert.equal(box.buttons[enter.response], "계속하기", "Enter = 계속하기");
assert.equal(box.buttons[esc.response], "계속하기", "Esc = 계속하기");

// --- guard decisions ------------------------------------------------------------------
function deps({ prompt = turn, response = 0, reject = false, hang = false, dialogThrows = false } = {}) {
  const calls = { query: 0, shown: [] };
  return {
    calls,
    queryPrompt: () => { calls.query++; return hang ? new Promise(() => {}) : reject ? Promise.reject(new Error("no host")) : Promise.resolve(prompt); },
    showMessageBox: async (options) => { calls.shown.push(options); if (dialogThrows) throw new Error("dialog"); return { response }; },
    timeout: () => Promise.resolve(),
  };
}
const RELOAD = 3, LOAD = 4;
for (const reason of [RELOAD, LOAD]) {
  const d = deps();
  assert.equal(await core.hpsRunQuitGuard(reason, d), false);
  assert.equal(d.calls.query, 0, "reload/workspace switch never asks");
}
for (const reason of [core.HPS_SHUTDOWN_CLOSE, core.HPS_SHUTDOWN_QUIT]) {
  let d = deps({ response: 0 });
  assert.equal(await core.hpsRunQuitGuard(reason, d), true, "계속하기 (Enter/Esc) vetoes");
  assert.deepEqual(d.calls.shown, [box]);
  d = deps({ response: 1 });
  assert.equal(await core.hpsRunQuitGuard(reason, d), false, "끝내기 lets the shutdown proceed");
  d = deps({ response: 7 });
  assert.equal(await core.hpsRunQuitGuard(reason, d), true, "any other answer keeps Studio open");
  d = deps({ prompt: null });
  assert.equal(await core.hpsRunQuitGuard(reason, d), false);
  assert.equal(d.calls.shown.length, 0, "nothing active: no dialog");
}
{
  const d = deps({ reject: true });
  assert.equal(await core.hpsRunQuitGuard(core.HPS_SHUTDOWN_QUIT, d), false, "unreachable extension never traps the learner");
  assert.equal(d.calls.shown.length, 0);
}
{
  // A hung extension host: the timeout wins the race and no dialog is shown.
  const d = deps({ hang: true });
  assert.equal(await core.hpsRunQuitGuard(core.HPS_SHUTDOWN_QUIT, d), false);
  assert.equal(d.calls.shown.length, 0);
}
{
  const d = deps({ dialogThrows: true });
  assert.equal(await core.hpsRunQuitGuard(core.HPS_SHUTDOWN_QUIT, d), false, "the guard never rejects");
}

// --- the answer is untrusted ----------------------------------------------------------
const RLO = String.fromCharCode(0x202e), LS = String.fromCharCode(0x2028), NUL = String.fromCharCode(0);
const hostile = core.hpsReadQuitPrompt({
  message: `Studio${RLO}를 끝낼까요?${NUL}`,
  detail: `한 줄${LS}\n두 줄\n세 줄`,
  continueLabel: "계속하기",
  quitLabel: "끝내기",
});
assert.equal(hostile.message, "Studio를 끝낼까요?");
assert.equal(hostile.detail, "한 줄\n두 줄", "control and bidi characters removed, at most two lines");
for (const bad of [null, "text", 1, {}, { ...turn, continueLabel: "끝내기" }, { ...turn, detail: "\n\n" }, { ...turn, message: 3 }]) {
  assert.equal(core.hpsReadQuitPrompt(bad), undefined);
}
assert.equal([...core.hpsReadQuitPrompt({ ...turn, message: "가".repeat(200) }).message].length, 60);

console.log("quit guard: copy, safe-default native box (Enter/Esc = 계속하기), guard decisions, hostile answers PASS");
