// #3586 2차 — the other approval windows (command, browser, folder, annotation) and outbound.
// A window that runs out of time reports `expired` once and refuses; a learner answer does not;
// the command and browser timeouts reach the learner as the 시간 초과 card (one per tool call, no
// report button); the folder window shows its own timeout sentence; annotation keeps its marks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CommandApprovalRequest } from "../src/commandApprovalPrompt.ts";
import { BrowserApprovalRequest } from "../src/browserApprovalPrompt.ts";
import { FolderConsentRequest } from "../src/folderConsentPrompt.ts";
import { AnnotationLeaveRequest } from "../src/annotationLeavePrompt.ts";
import * as MTF from "../src/missingTaskFolder.ts";
import * as BOA from "../src/localRuntime/browserOpenApproval.ts";
import { denialNotice, denialNoticeView } from "../src/denialNotice.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const cmd = (id) => ({ id, purpose: "shell", command: "ls", destructive: false, rememberAllowed: false });
const site = (id) => ({ id, title: "t", host: "example.com", label: "example.com", place: "internet", rememberLabel: null });

await t("a: a command window that runs out reports expired once and answers deny", async () => {
  const expired = [];
  const req = new CommandApprovalRequest({ scope: () => "s", present: async () => true, expired: (id) => expired.push(id) }, 5);
  assert.equal(await req.confirm(cmd("c-1")), "deny");
  assert.deepEqual(expired, ["c-1"]);
});

await t("b: a learner command answer does not report expiry", async () => {
  const expired = [];
  const req = new CommandApprovalRequest({ scope: () => "s", present: async () => true, expired: (id) => expired.push(id) }, 60_000);
  const pending = req.confirm(cmd("c-2"));
  req.respond("c-2", "allow");
  assert.equal(await pending, "allow");
  assert.deepEqual(expired, []);
});

await t("c: a browser window that runs out reports expired once and answers deny", async () => {
  const expired = [];
  const req = new BrowserApprovalRequest({ scope: () => "s", present: async () => true, expired: (id) => expired.push(id) }, 5);
  assert.equal(await req.confirm(site("b-1")), "deny");
  assert.deepEqual(expired, ["b-1"]);
});

await t("d: a learner browser refusal does not report expiry", async () => {
  const expired = [];
  const req = new BrowserApprovalRequest({ scope: () => "s", present: async () => true, expired: (id) => expired.push(id) }, 60_000);
  const pending = req.confirm(site("b-2"));
  req.respond("b-2", "deny");
  assert.equal(await pending, "deny");
  assert.deepEqual(expired, []);
});

await t("e: a folder window that runs out reports expired once and resolves undefined", async () => {
  const expired = [];
  const req = new FolderConsentRequest({ id: () => "f-1", scope: () => "s", present: async () => true, expired: (id) => expired.push(id) }, 5);
  assert.equal(await req.ask("/work/a"), undefined);
  assert.deepEqual(expired, ["f-1"]);
});

await t("f: a folder window the learner closes does not report expiry", async () => {
  const expired = [];
  const req = new FolderConsentRequest({ id: () => "f-2", scope: () => "s", present: async () => true, expired: (id) => expired.push(id) }, 60_000);
  const pending = req.ask("/work/b");
  req.respond("f-2", undefined);
  await pending;
  assert.deepEqual(expired, []);
});

await t("g: the folder timeout sentence is a new 시간 초과 line with no digits, and differs from the undecided note", async () => {
  const text = MTF.FOLDER_CONSENT_TIMED_OUT;
  assert.equal(typeof text, "string", "FOLDER_CONSENT_TIMED_OUT is exported");
  assert.ok(text.includes("시간"), "names 시간");
  assert.doesNotMatch(text, /[0-9]/);
  assert.notEqual(text, MTF.MISSING_TASK_FOLDER_UNDECIDED);
  assert.ok(JSON.stringify(MTF.missingTaskFolderNotice("/work/gone", text)).includes(text));
});

await t("h: the instructor browser_open timeout has its own 시간 초과 text; the refusal keeps USER_DECLINED_OPEN", async () => {
  assert.equal(typeof BOA.BROWSER_TIMEOUT_TEXT, "string", "BROWSER_TIMEOUT_TEXT is exported");
  assert.ok(BOA.BROWSER_TIMEOUT_TEXT.includes("시간 초과"), "tagged 시간 초과 text");
  assert.equal(BOA.USER_DECLINED_OPEN, "사용자가 이 작업을 허용하지 않았어요.");
  const src = readFileSync(new URL("../src/localRuntime/browserOpenApproval.ts", import.meta.url), "utf8");
  assert.match(src, /denialSource\s*===\s*"timeout"[\s\S]{0,120}BROWSER_TIMEOUT_TEXT/);
});

await t("i: the timeout card is one 시간 초과 card for a command or browser row, no report button", async () => {
  const view = denialNoticeView(denialNotice("timeout", false));
  assert.equal(view.label, "시간 초과");
  assert.equal(view.action, undefined);
});

await t("j: annotation keeps its marks on timeout (no card, no tool row)", async () => {
  const req = new AnnotationLeaveRequest({ scope: () => "s", id: () => "n-1", present: async () => true }, 5);
  assert.equal(await req.confirm(2), false);
});

await t("k: host wiring — command and browser timeouts reach resolveActionApproval through onDenied('timeout')", async () => {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /commandApprovalRequest\s*=\s*new CommandApprovalRequest\(\{[\s\S]{0,400}expired:/);
  assert.match(src, /browserApprovalRequest\s*=\s*new BrowserApprovalRequest\(\{[\s\S]{0,400}expired:/);
  assert.match(src, /folderConsentRequest\s*=\s*new FolderConsentRequest\(\{[\s\S]{0,400}expired:/);
  assert.match(src, /decideBrowserOpen\(\{[\s\S]{0,600}\}\)[\s\S]{0,200}timedOutApprovals/);
});

await t("l: one card per tool call — the approval branch sets deniedCalls and the tool_result branch reuses it", async () => {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /deniedCalls\.set\(a\.id, denial\)/, "approval branch records the card");
  assert.match(src, /const denial = deniedCalls\.get\(a\.id\) \?\?/, "tool_result branch reuses the recorded card");
});

// Source for m and n: folderConsentPrompt.ts:19-24 (ask: a pending window refuses a second ask; the timer
// calls expire), :41-42 (cancel and expire clear `pending` through finish), and the presenter wired at
// chatPanelProvider.ts:3265 (setFolderConsentPresenter → folderConsentRequest.ask). Every 'present' call with a
// prompt is one shown window, so a second call means the window was shown again.
await t("m: after a folder window ran out, a re-pick shows a new consent window (the expired one does not block it)", async () => {
  const shown = [];
  const req = new FolderConsentRequest({ id: (() => { let n = 0; return () => `f-r${++n}`; })(), scope: () => "s", present: async (prompt) => { if (prompt) shown.push(prompt.id); return true; }, expired: () => {} }, 5);
  assert.equal(await req.ask("/work/c"), undefined, "first window times out");
  const again = req.ask("/work/c");
  assert.equal(shown.length, 2, "the re-pick shows a second window");
  assert.notEqual(shown[0], shown[1], "a new id, not the old window");
  req.respond(shown[1], "read");
  assert.equal(await again, "read", "the new window answers normally");
});

await t("n: without a re-pick, a timed-out folder window is not shown again", async () => {
  const shown = [];
  const req = new FolderConsentRequest({ id: () => "f-n1", scope: () => "s", present: async (prompt) => { if (prompt) shown.push(prompt.id); return true; }, expired: () => {} }, 5);
  assert.equal(await req.ask("/work/d"), undefined);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(shown.length, 1, "nothing asks again on its own");
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall approval-timeout-windows checks passed");
