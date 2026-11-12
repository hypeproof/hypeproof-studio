// #3594 — a learner's refusal in an approval window shows the 거절함 card (no report button), one per tool call.
// Timeouts and policy refusals are unchanged; cancels and turn ends are not learner refusals and show no card;
// an approval and a late timer never record a refusal. Plan: _worklog/chalk/engineer/issue-3594-plan-draft.md (9, 10).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WriteApprovalRequest } from "../src/writeApprovalPrompt.ts";
import { CommandApprovalRequest } from "../src/commandApprovalPrompt.ts";
import { BrowserApprovalRequest } from "../src/browserApprovalPrompt.ts";
import { DENIAL_SOURCE_LABEL } from "../src/denialSource.ts";
import { denialNotice, denialNoticeLabel, denialNoticeView, storedDenialNotice, taggedDenialSource } from "../src/denialNotice.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}
const wprompt = { id: "w-1", title: "t", verb: "쓰기", files: ["a.txt"], changes: [] };
const cprompt = { id: "c-1", purpose: "shell", command: "ls", destructive: false, rememberAllowed: false };
const bprompt = { id: "b-1", title: "t", host: "example.com", label: "example.com", place: "internet", rememberLabel: null };
const flush = () => new Promise((r) => setTimeout(r, 15));

const DECLINED_TEXT = "허용하지 않아서 하지 않았어요. 하고 싶으면 다시 말해 주세요.";

await t("a: the declined source has the label 거절함 and the agreed learner sentence", async () => {
  assert.equal(DENIAL_SOURCE_LABEL.declined, "거절함");
  const view = denialNoticeView(denialNotice("declined", false));
  assert.equal(view.label, "거절함");
  assert.equal(view.text, DECLINED_TEXT);
});

await t("b: the declined card has no report button", async () => {
  const view = denialNoticeView(denialNotice("declined", false));
  assert.equal(view.action, undefined);
});

await t("c: the stored label round-trips and a tagged 거절함 tool text reads as declined", async () => {
  const stored = denialNoticeLabel(denialNotice("declined", false));
  assert.equal(storedDenialNotice(stored)?.source, "declined", "the saved label decodes back to declined");
  assert.equal(taggedDenialSource("[거절함] 사용자가 이 작업을 허용하지 않았어요."), "declined");
});

await t("d: a write window learner refusal calls the refused port once, and an approval does not", async () => {
  const refused = [];
  const req = new WriteApprovalRequest({ scope: () => "s", present: async () => true, refused: (id) => refused.push(id) }, 60_000);
  const pending = req.confirm(wprompt);
  req.respond("w-1", false);
  assert.equal(await pending, false);
  assert.deepEqual(refused, ["w-1"]);
  const refused2 = [];
  const req2 = new WriteApprovalRequest({ scope: () => "s", present: async () => true, refused: (id) => refused2.push(id) }, 60_000);
  const pending2 = req2.confirm({ ...wprompt, id: "w-2" });
  req2.respond("w-2", true);
  assert.equal(await pending2, true);
  assert.deepEqual(refused2, []);
});

await t("e: a command learner refusal calls the refused port once; allow does not", async () => {
  const refused = [];
  const req = new CommandApprovalRequest({ scope: () => "s", present: async () => true, refused: (id) => refused.push(id) }, 60_000);
  const pending = req.confirm(cprompt);
  req.respond("c-1", "deny");
  assert.equal(await pending, "deny");
  assert.deepEqual(refused, ["c-1"]);
  const refused2 = [];
  const req2 = new CommandApprovalRequest({ scope: () => "s", present: async () => true, refused: (id) => refused2.push(id) }, 60_000);
  const pending2 = req2.confirm({ ...cprompt, id: "c-2" });
  req2.respond("c-2", "allow");
  assert.equal(await pending2, "allow");
  assert.deepEqual(refused2, []);
});

await t("f: a browser learner refusal calls the refused port once; open does not", async () => {
  const refused = [];
  const req = new BrowserApprovalRequest({ scope: () => "s", present: async () => true, refused: (id) => refused.push(id) }, 60_000);
  const pending = req.confirm(bprompt);
  req.respond("b-1", "deny");
  assert.equal(await pending, "deny");
  assert.deepEqual(refused, ["b-1"]);
  const refused2 = [];
  const req2 = new BrowserApprovalRequest({ scope: () => "s", present: async () => true, refused: (id) => refused2.push(id) }, 60_000);
  const pending2 = req2.confirm({ ...bprompt, id: "b-2" });
  req2.respond("b-2", "open");
  assert.equal(await pending2, "open");
  assert.deepEqual(refused2, []);
});

await t("g: a cancel (turn end or scope change) is not a learner refusal and records nothing", async () => {
  const refused = [];
  const req = new WriteApprovalRequest({ scope: () => "s", present: async () => true, refused: (id) => refused.push(id) }, 60_000);
  const pending = req.confirm(wprompt);
  req.cancel();
  assert.equal(await pending, false);
  assert.deepEqual(refused, []);
});

await t("h: after a learner refusal, the timer does not fire a timeout (no leak into the timed-out set)", async () => {
  const expired = [];
  const refused = [];
  const req = new WriteApprovalRequest({ scope: () => "s", present: async () => true, expired: (id) => expired.push(id), refused: (id) => refused.push(id) }, 5);
  const pending = req.confirm(wprompt);
  req.respond("w-1", false);
  assert.equal(await pending, false);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(expired, [], "a refused window does not expire");
  assert.deepEqual(refused, ["w-1"]);
});

await t("i: host wiring — the refused ports, the declined set, the card condition and the turn-end clear exist", async () => {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /declinedApprovals\s*=\s*new Set<string>\(\)/, "declined set");
  assert.match(src, /refused:id=>\{this\.declinedApprovals\.add\(id\);\}/, "write, command and browser ports record refusals");
  assert.match(src, /a\.actor === 'policy' \|\| a\.denialSource === 'declined'/, "the approval branch records a card for a learner refusal");
  assert.match(src, /declinedApprovals\?\.clear\(\)[\s\S]{0,200}timedOutApprovals\?\.clear\(\)|timedOutApprovals\?\.clear\(\)[\s\S]{0,200}declinedApprovals\?\.clear\(\)/, "turn end clears both sets");
});

await t("k: the native windows (publish_site, consultHelper) and the outward command record a learner refusal", async () => {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /const published = await publisher\.approveForTool\([\s\S]{0,160}if \(!published\) onDenied\?\.\("declined"\)/, "publish_site modal refusal");
  assert.match(src, /if \(pick !== copy\.verb\) onDenied\?\.\('declined'\)/, "consultHelper modal refusal");
  assert.match(src, /else if \(this\.declinedApprovals\?\.delete\(outwardPromptId\)\) onDenied\?\.\("declined"\)/, "outward command refusal");
});

await t("j: the saved patch's browser refusal copy stays a tagged sentence (the refusal text is 거절함, not unknown)", async () => {
  const src = readFileSync(new URL("../src/localRuntime/browserOpenApproval.ts", import.meta.url), "utf8");
  assert.match(src, /BROWSER_DECLINED_TEXT\s*=\s*"\[거절함\]/, "tagged refusal text for the instructor local path");
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall declined-refusal checks passed");
