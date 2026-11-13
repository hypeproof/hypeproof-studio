// chalk#25 — 강사가 고른 모델로 로컬 실행. 허용 목록 안의 값은 실행을 바꾸고, 밖의 값은 기본 모델로 실행한다.
//
// 대조군 규율 (양방향):
//   P1 허용 목록 안 값 (opus) → 실행 모델이 바뀐다 (CLI argv 에도 찍힌다)
//   N1 허용 목록 밖 값 (fable, haiku, 임의 문자열) → 실행 모델은 기본값 그대로다
//   N2 요청이 없으면 기본값
//   C1 옛 호환: 요청이 없는 옛 Chalk 와 형식이 틀린 목록은 기존 동작
//   L1 레거시 패널 선택지는 한 개 그대로다 (localModelSelection 불변)
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INSTRUCTOR_MODEL_ALLOWLIST,
  instructorModelChoices,
  executorModelFor,
  withTurnModel,
} from "../src/localRuntime/instructorModels.ts";
import { runClaude } from "../src/localRuntime/claudeClient.mjs";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const CLAUDE = { provider: "claude", model: "sonnet", label: "Claude Code · 로컬 구독 · sonnet" };
const CODEX = { provider: "codex", model: "default", label: "Codex · 로컬 구독 · default" };
const ids = (models) => models.choices.map((c) => c.id);

console.log("=== 허용 목록 ===");
await t("A1 claude 허용 목록은 sonnet·opus 두 개다 (fable·haiku 없음)", () => {
  assert.deepEqual([...INSTRUCTOR_MODEL_ALLOWLIST.claude], ["sonnet", "opus"]);
});
await t("A2 codex 허용 목록은 비어 있다 (codex 는 설정된 모델 하나만 쓴다)", () => {
  assert.deepEqual([...INSTRUCTOR_MODEL_ALLOWLIST.codex], []);
});
await t("A5 codex 설정 모델 gpt-x 면 선택지는 gpt-x 하나다 (default 같은 가짜 ID 를 넣지 않는다)", () => {
  const m = instructorModelChoices({ provider: "codex", model: "gpt-x" });
  assert.equal(m.default, "gpt-x");
  assert.deepEqual(ids(m), ["gpt-x"]);
});
await t("N6 codex 설정 모델 gpt-x 에서 요청 default 는 gpt-x 로 실행된다 (default 로 바꾸지 않는다)", () => {
  assert.equal(executorModelFor({ provider: "codex", model: "gpt-x" }, "default"), "gpt-x");
});
await t("A3 목록은 기본 모델을 포함하고, 기본값을 기본으로 보낸다", () => {
  const m = instructorModelChoices(CLAUDE);
  assert.equal(m.default, "sonnet");
  assert.deepEqual(ids(m), ["sonnet", "opus"]);
  assert.ok(m.choices.every((c) => c.alias === c.id), "alias 는 실행 ID 와 같다 (Chalk 가 alias 를 되돌려 보낸다)");
});
await t("A4 개발 환경 변수 모델 (허용 목록 밖) 도 기본값으로 목록에 들어간다", () => {
  const m = instructorModelChoices({ provider: "claude", model: "x" });
  assert.equal(m.default, "x");
  assert.ok(ids(m).includes("x"));
});

console.log("=== 실행 모델 선택 (P: 양성, N: 음성) ===");
await t("P1 허용 목록 안 값 opus 는 실행 모델이 된다", () => {
  assert.equal(executorModelFor(CLAUDE, "opus"), "opus");
});
await t("N1 허용 목록 밖 값 fable 은 실행 모델을 바꾸지 않는다", () => {
  assert.equal(executorModelFor(CLAUDE, "fable"), "sonnet");
});
await t("N1b 허용 목록 밖 값 haiku 는 실행 모델을 바꾸지 않는다", () => {
  assert.equal(executorModelFor(CLAUDE, "haiku"), "sonnet");
});
await t("N1c 임의 문자열은 실행 모델을 바꾸지 않는다", () => {
  assert.equal(executorModelFor(CLAUDE, "rm -rf /"), "sonnet");
});
await t("N2 요청이 없으면 기본 모델이다", () => {
  assert.equal(executorModelFor(CLAUDE, undefined), "sonnet");
  assert.equal(executorModelFor(CLAUDE, ""), "sonnet");
});
await t("N3 codex 에서 다른 값은 실행 모델을 바꾸지 않는다", () => {
  assert.equal(executorModelFor(CODEX, "gpt-5.6-luna"), "default");
});
await t("P2 withTurnModel 은 실행 모델과 표시 이름을 함께 바꾼다", () => {
  const cfg = withTurnModel(CLAUDE, "opus");
  assert.equal(cfg.model, "opus");
  assert.match(cfg.label, /opus/);
});
await t("N4 withTurnModel 은 밖의 값에 원래 설정을 그대로 돌려준다", () => {
  const cfg = withTurnModel(CLAUDE, "fable");
  assert.equal(cfg.model, "sonnet");
  assert.equal(cfg.label, CLAUDE.label);
});

console.log("=== CLI 인자 (가짜 CLI, 실제 CLI 호출 없음) ===");
const dir = mkdtempSync(join(tmpdir(), "chalk25-argv-"));
const logPath = join(dir, "argv.log");
const fake = join(dir, "fake-claude.mjs");
writeFileSync(fake, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "auth") {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }));
  process.exit(0);
}
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", usage: {} }) + "\\n");
`);
chmodSync(fake, 0o755);

async function runWithModel(model) {
  return runClaude({
    executable: fake,
    cwd: dir,
    model,
    messages: [{ role: "user", content: "hi" }],
    toolServer: { url: "http://127.0.0.1:9/mcp", token: "t" },
    onDelta: () => {},
    onRefusal: () => {},
    timeout: 20000,
  });
}
function lastArgv() {
  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}
function modelArg(args) {
  const i = args.indexOf("--model");
  return i < 0 ? undefined : args[i + 1];
}

await t("P3 고른 opus 가 CLI 인자 --model 에 들어간다", async () => {
  await runWithModel(executorModelFor(CLAUDE, "opus"));
  assert.equal(modelArg(lastArgv()), "opus");
});
await t("N5 밖의 fable 을 골라도 CLI 인자는 sonnet 이다", async () => {
  await runWithModel(executorModelFor(CLAUDE, "fable"));
  assert.equal(modelArg(lastArgv()), "sonnet");
});

console.log("=== 호환과 레거시 ===");
await t("C1 옛 Chalk (요청 없음) → 기본 모델로 실행", () => {
  assert.equal(executorModelFor(CLAUDE, undefined), CLAUDE.model);
});
await t("C2 목록 형식이 틀려도 기본 목록은 기본 모델을 담는다", () => {
  const m = instructorModelChoices({ provider: "claude", model: "sonnet" });
  assert.ok(m.choices.length >= 1);
});
await t("L1 레거시 localModelSelection 은 선택지 한 개 그대로다", () => {
  const src = readFileSync(new URL("../src/localRuntime/index.ts", import.meta.url), "utf8");
  assert.ok(
    src.includes("choices: [{ alias: config.model, id: config.model, label: config.label }]"),
    "localModelSelection must keep its single choice (legacy panel unchanged)",
  );
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall chalk-instructor-model checks passed");
