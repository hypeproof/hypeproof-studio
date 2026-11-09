// #3586 — a write approval that times out names the timeout in the tool error the coach reads
// (and so in the learner's card); a user refusal keeps today's sentence and today's card.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { workspaceTools } from "../src/localRuntime/tools.ts";
import { INSTRUCTOR_TOOL_PROFILE } from "../src/chalk/instructorTurn.ts";
import { DENIAL_SOURCE_LABEL } from "../src/denialSource.ts";
import { denialNotice, taggedDenialSource } from "../src/denialNotice.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}
const USER_REFUSAL = "사용자가 파일 변경을 허용하지 않았습니다.";
const TIMEOUT_TEXT = "[시간 초과] 확인 창이 시간 안에 선택되지 않아 실행하지 않았어요. 사용자가 원하면 다시 요청할 수 있어요.";

async function writeWith(approveResult) {
  const cwd = mkdtempSync(path.join(tmpdir(), "approval-timeout-"));
  const tools = workspaceTools({
    cwd, profile: INSTRUCTOR_TOOL_PROFILE, signal: new AbortController().signal,
    approve: async () => approveResult,
  });
  try {
    await tools.call("Write", { file_path: "note.txt", content: "x" });
    return { message: null };
  } catch (err) {
    return { message: String(err.message) };
  }
}

await t("a: a timed-out write approval is tagged 시간 초과 for the coach and the learner card", async () => {
  const { message } = await writeWith({ approved: false, actor: "policy", denialSource: "timeout" });
  assert.ok(message && message.startsWith("[시간 초과] "), `got: ${message}`);
  assert.equal(taggedDenialSource(message), "timeout");
  assert.equal(message, TIMEOUT_TEXT);
});

await t("b: a user refusal keeps today's sentence and today's unknown card", async () => {
  const { message } = await writeWith(false);
  assert.equal(message, USER_REFUSAL);
  assert.equal(taggedDenialSource(message), null);
  assert.equal(denialNotice(taggedDenialSource(message)).source, "unknown");
});

await t("c: the timeout label is one of the sources", async () => {
  assert.equal(DENIAL_SOURCE_LABEL.timeout, "시간 초과");
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\napproval-timeout-denial smoke: all ok");
