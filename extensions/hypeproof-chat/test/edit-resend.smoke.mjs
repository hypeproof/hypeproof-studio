// CGP-CHAT-R-002 (REQ-STUDIO-CHAT-EDIT-RESEND) — the versions model behind "수정".
// Pure functions plus the production task store on disk. No vscode, no React.
//
// .claude/rules/verification.md §2: every judgement here has a positive control (a good sample
// must pass) and a negative control (a bad sample must fail), so a too-strict and a too-lenient
// rule both show up.
// Run: node --experimental-strip-types test/edit-resend.smoke.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  currentVersions, editableUserId, editResendPayload, historyForEdit, latestUserTurn,
  validEditOf, validEditTarget, versionCount, versionRuns, visibleVersions,
} = await import("../src/editResend.ts");
const { modelHistory } = await import("../src/chatTimeline.ts");
const { TaskWorkspaceStore } = await import("../src/taskWorkspaceStore.ts");

let n = 0;
const t = (label, fn) => { fn(); n++; console.log(`  ok   ${label}`); };
const at = 1000;
const u = (id, content, extra = {}) => ({ id, role: "user", content, createdAt: at, ...extra });
const a = (id, content) => ({ id, role: "assistant", content, createdAt: at });
const tool = (id) => ({ id, role: "tool", content: "", createdAt: at, tool: { icon: "🔧", label: "Write(index.html)", state: "done" } });
const shape = (items) => items.map((m) => `${m.role}:${m.id}`).join(" ");

// A legacy transcript (no editOf anywhere) and the same conversation after one edit.
const legacy = [u("u1", "첫 질문"), a("a1", "첫 답"), u("u2", "고양이 그려 줘"), tool("t2"), a("a2", "고양이 답")];
const edited = [...legacy, u("u2b", "강아지 그려 줘", { editOf: "u2", toolMode: "web-search" }), a("a2b", "강아지 답")];

t("legacy transcript: one version per turn, no pager, everything visible (positive control)", () => {
  const view = visibleVersions(legacy);
  assert.equal(shape(view.items), shape(legacy));
  assert.deepEqual(view.pagers, {});
  assert.equal(versionRuns(legacy).length, 2);
});

t("add a version: the latest is drawn by default and carries the pager 2/2", () => {
  const view = visibleVersions(edited);
  assert.equal(shape(view.items), "user:u1 assistant:a1 user:u2b assistant:a2b");
  assert.deepEqual(view.pagers, { u2b: { key: "u2", index: 1, count: 2 } });
  assert.equal(versionCount(edited, "u2"), 2);
});

t("switch to version 1: the original prompt, its tool line and its answer come back (no request involved)", () => {
  const view = visibleVersions(edited, { u2: 0 });
  assert.equal(shape(view.items), "user:u1 assistant:a1 user:u2 tool:t2 assistant:a2");
  assert.deepEqual(view.pagers, { u2: { key: "u2", index: 0, count: 2 } });
});

t("an out-of-range or junk choice falls back to the latest (negative control)", () => {
  for (const pick of [5, -1, 0.5, Number.NaN]) assert.equal(shape(visibleVersions(edited, { u2: pick }).items), "user:u1 assistant:a1 user:u2b assistant:a2b", String(pick));
});

t("history for later turns uses the latest version only, whatever version is on screen", () => {
  const history = modelHistory(currentVersions(edited));
  assert.equal(shape(history), "user:u1 assistant:a1 user:u2b assistant:a2b");
  assert.ok(!history.some((m) => m.id === "u2" || m.id === "a2"), "version 1 leaked into the model history");
});

t("negative control: the old filter (modelHistory alone) would send both versions", () => {
  assert.ok(modelHistory(edited).some((m) => m.id === "a2"), "control sample must contain the superseded answer");
});

t("history for the edited request itself drops the whole group being edited", () => {
  assert.equal(shape(historyForEdit(edited, "u2")), "user:u1 assistant:a1");
  assert.equal(shape(historyForEdit(legacy, "u2")), "user:u1 assistant:a1");
  // A key that is not the latest group leaves the (current-version) history alone.
  assert.equal(shape(historyForEdit(edited, "u1")), shape(currentVersions(edited)));
});

t("a third version groups with the same root and later turns follow it", () => {
  const three = [...edited, u("u2c", "토끼 그려 줘", { editOf: "u2" }), a("a2c", "토끼 답"), u("u3", "고마워"), a("a3", "천만에")];
  assert.deepEqual(visibleVersions(three).pagers, { u2c: { key: "u2", index: 2, count: 3 } });
  assert.equal(shape(currentVersions(three)), "user:u1 assistant:a1 user:u2c assistant:a2c user:u3 assistant:a3");
  assert.equal(latestUserTurn(three).key, "u3");
});

t("edit target: only the latest prompt group is accepted", () => {
  assert.ok(validEditTarget(edited, "u2"));
  assert.ok(validEditTarget(legacy, "u2"));
  for (const bad of ["u1", "u2b", "nope", "", "../x", 7, undefined, null]) assert.ok(!validEditTarget(edited, bad), String(bad));
  assert.ok(!validEditTarget([], "u1"), "empty transcript");
  assert.ok(validEditOf("local-0f2a") && !validEditOf("a b") && !validEditOf("x".repeat(129)));
});

t("an orphan editOf (its v1 failed and was never saved) reads as a single version", () => {
  const orphan = [u("u1", "q"), a("a1", "r"), u("u9", "고친 질문", { editOf: "u8" }), a("a9", "답")];
  assert.deepEqual(visibleVersions(orphan).pagers, {});
  assert.equal(latestUserTurn(orphan).key, "u8");
  assert.ok(validEditTarget(orphan, "u8"));
});

const idle = { streaming: false, sendPending: false, parked: false, instructor: false, locked: false };
t("수정 is offered on the latest user line only, when idle (positive control)", () => {
  assert.equal(editableUserId(legacy, idle), "u2");
  assert.equal(editableUserId(edited, idle), "u2b");
});
t("수정 is withheld while streaming, pending, queued/parked, instructor, locked, or with no prompt (negative controls)", () => {
  for (const key of ["streaming", "sendPending", "parked", "instructor", "locked"]) assert.equal(editableUserId(legacy, { ...idle, [key]: true }), null, key);
  assert.equal(editableUserId([a("a0", "안녕")], idle), null, "no user line");
  assert.equal(editableUserId([u("u0", "   ")], idle), null, "blank prompt");
});

t("DEC-08 payload carries ids, counts and lengths, never text", () => {
  const payload = editResendPayload({ editOf: "u2", fromMessageId: "u2", toMessageId: "u2b", versions: 1, originalLength: 8, editedLength: 9, images: 1, toolMode: "auto" });
  assert.deepEqual(payload, { group: "u2", from_message: "u2", to_message: "u2b", version: 2, original_length: 8, edited_length: 9, images: 1, tool_mode: "auto" });
  const serialized = JSON.stringify(payload);
  for (const text of ["고양이", "강아지"]) assert.ok(!serialized.includes(text));
});

// Persistence: the production store keeps editOf, reloads it, and still loads lines without it.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hps-edit-resend-"));
try {
  const store = new TaskWorkspaceStore(root, "edit-resend");
  await store.initialize();
  const taskId = store.getView().activeTaskId;
  await store.append(taskId, legacy);
  t("legacy lines without editOf persist and load unchanged", () => assert.equal(shape(new TaskWorkspaceStore(root, "edit-resend").getHistory(taskId)), shape(legacy)));
  await store.append(taskId, edited.slice(legacy.length));
  const reopened = new TaskWorkspaceStore(root, "edit-resend");
  t("round trip: reopening keeps both versions and the pager", () => {
    const history = reopened.getHistory(taskId);
    assert.equal(history.find((m) => m.id === "u2b")?.editOf, "u2");
    assert.deepEqual(visibleVersions(history).pagers, { u2b: { key: "u2", index: 1, count: 2 } });
    assert.equal(shape(visibleVersions(history, { u2: 0 }).items), "user:u1 assistant:a1 user:u2 tool:t2 assistant:a2");
  });
  let rejected = 0;
  for (const bad of [a("bad1", "x"), u("bad2", "x", { editOf: "a b" }), u("bad3", "x", { editOf: 3 })]) {
    const target = bad.role === "assistant" ? { ...bad, editOf: "u1" } : bad;
    await store.append(taskId, [target]).then(() => {}, (error) => { if (error?.code === "invalid") rejected++; });
  }
  t("the store refuses editOf on an assistant line or with a malformed id (negative controls)", () => assert.equal(rejected, 3));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// Host wiring, read from the source (the host itself needs vscode).
const host = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
t("host: model history goes through historyForEdit / currentVersions", () => assert.match(host, /modelHistory\(clampTimeline\(editOf \? historyForEdit\(conversation, editOf\) : currentVersions\(conversation\), HISTORY_MAX\)\)/));
t("host: an edit target is checked before the send is accepted", () => assert.match(host, /msg\.type === 'sendMessage' && msg\.editOf !== undefined\) this\.requireEditTarget\(msg\.editOf\)/));
t("host: edit_resend is recorded through the spool with the pure payload", () => assert.match(host, /recordWorkflow\(\{ event: "edit_resend", payload: editResendPayload\(/));
t("host: every saved user line of a turn goes through userLine (keeps editOf)", () => assert.equal((host.match(/userLine\((text|historyText)\)/g) ?? []).length, 5));

console.log(`edit-resend smoke OK (${n})`);
