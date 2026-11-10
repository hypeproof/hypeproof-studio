// #3586 — a write approval that runs out of time reports `expired` once, then refuses as before;
// the timeout card names 시간 초과 with no policy or safety wording and no report button; and the
// host records a timeout as policy with the timeout source, never as a learner refusal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WriteApprovalRequest } from "../src/writeApprovalPrompt.ts";
import { denialNotice, denialNoticeLabel, denialNoticeView, storedDenialNotice } from "../src/denialNotice.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}
const prompt = { id: "w-1", title: "t", verb: "쓰기", files: ["a.txt"], changes: [] };

await t("a: the write window reports expiry once and resolves a refusal (value unchanged)", async () => {
  const expired = [];
  const req = new WriteApprovalRequest({
    scope: () => "s",
    present: async () => true,
    expired: (id) => expired.push(id),
  }, 5);
  const answer = await req.confirm(prompt);
  assert.equal(answer, false);
  assert.deepEqual(expired, ["w-1"]);
});

await t("b: a learner answer does not report expiry", async () => {
  const expired = [];
  const req = new WriteApprovalRequest({ scope: () => "s", present: async () => true, expired: (id) => expired.push(id) }, 60_000);
  const pending = req.confirm(prompt);
  req.respond("w-1", true);
  assert.equal(await pending, true);
  assert.deepEqual(expired, []);
});

await t("c: the timeout card is 시간 초과 with the learner sentence and no report button", async () => {
  const view = denialNoticeView(denialNotice("timeout", false));
  assert.equal(view.label, "시간 초과");
  assert.equal(view.text, "확인 창을 오래 고르지 않아서 하지 않았어요. 하고 싶으면 다시 말해 주세요.");
  assert.equal(view.action, undefined);
});

await t("d: the timeout card carries no policy or safety wording", async () => {
  const view = denialNoticeView(denialNotice("timeout", true));
  for (const word of ["정책", "안전", "수업 설정", "이용권", "앱 버전"]) assert.ok(!`${view.label} ${view.text}`.includes(word), word);
});

await t("e: the stored timeout card decodes back to the timeout source (one label string, enum only)", async () => {
  const label = denialNoticeLabel(denialNotice("timeout", false));
  assert.equal(storedDenialNotice(label)?.source, "timeout");
});

await t("f: the host records a timeout as policy with the timeout source, not a learner refusal", async () => {
  const host = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.equal((host.match(/actor:denialSource==='timeout'\?'policy'/g) || []).length, 2);
  assert.match(host, /actor: denialSource === 'timeout' \? 'policy' as const/);
  assert.match(host, /a\.denialSource==='timeout'\?'승인 창을 시간 안에 고르지 않아 실행하지 않았습니다\.'/);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\napproval-timeout smoke: all ok");
