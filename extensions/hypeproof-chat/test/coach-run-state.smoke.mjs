// REQ-STUDIO-COACH-RUN-STATE (CGP-LEARN-R-016): the pure derivation with positive and negative controls.
//   node --experimental-strip-types test/coach-run-state.smoke.mjs
import assert from "node:assert/strict";
import { COACH_RUN_STATES, currentToolActivity, deriveCoachRunState, toolLineRunState } from "../src/coachRunState.ts";

// The fixed set, word for word, and nothing else.
assert.deepEqual(Object.values(COACH_RUN_STATES).map((s) => s.label), ["준비됨", "생각 중", "찾는 중", "만드는 중", "확인이 필요해요", "멈춤", "문제가 생겼어요"]);
assert.equal(new Set(Object.values(COACH_RUN_STATES).map((s) => s.icon)).size, 7, "each state has its own icon");

// Classifier: the host's tool-line icons.
for (const icon of ["📖", "🔍", "🌐", "👀", "📸", "🔗", "🖥️"]) assert.equal(toolLineRunState({ icon, label: "x" }), "searching", icon);
for (const icon of ["✍️", "✏️"]) assert.equal(toolLineRunState({ icon, label: "x" }), "creating", icon);
assert.equal(toolLineRunState({ icon: "📝", label: "agent.md에 정리하는 중…" }), "creating", "agent.md write");
assert.equal(toolLineRunState({ icon: "📝", label: "할 일 정리" }), "thinking", "TodoWrite plans, it writes no file");
// Negative controls: unknown or missing icons, and a label that names a verb, never decide.
for (const t of [{ icon: "🔧", label: "도구 사용 중" }, { icon: "💭", label: "생각" }, { icon: "…", label: "다음 단계를 준비하는 중…" }, { icon: "🤝", label: "도우미에게 맡기기" }, { icon: "🖼️", label: "미리보기 열기" }, { icon: "⌨️", label: "명령 실행" }, { icon: "📦", label: "설치" }, {}, { icon: 5, label: null }, { icon: "", label: "파일을 고치는 중…" }]) {
  assert.equal(toolLineRunState(t), "thinking", JSON.stringify(t));
}

// Current-turn scan.
const user = { role: "user", content: "고쳐 줘" };
const run = (icon) => ({ role: "tool", content: "", tool: { state: "running", icon, label: "x" } });
const done = (icon) => ({ role: "tool", content: "", tool: { state: "done", icon, label: "x" } });
const said = { role: "assistant", content: "살펴볼게요" };
assert.equal(currentToolActivity([]), "thinking");
assert.equal(currentToolActivity([user, run("📖")]), "searching");
assert.equal(currentToolActivity([user, run("📖"), run("✍️")]), "creating", "the newest running line");
assert.equal(currentToolActivity([user, run("✍️"), done("📖")]), "creating", "a finished line is skipped");
assert.equal(currentToolActivity([run("✍️"), user]), "thinking", "an earlier turn's line never counts");
assert.equal(currentToolActivity([user, run("✍️"), said]), "thinking", "text after the line: the coach is answering");
assert.equal(currentToolActivity([user, run("✍️"), { role: "assistant", content: "   " }]), "creating", "an empty bubble is not text");
assert.equal(currentToolActivity([user, done("✍️")]), "thinking");

// Precedence: approval > running > preparing > error banner > outcome > ready.
const base = { preparing: false, running: false, approvalPending: false, error: false, lastOutcome: null, messages: [user, run("✍️")] };
const d = (o) => deriveCoachRunState({ ...base, ...o });
assert.equal(d({}), "ready");
assert.equal(d({ lastOutcome: "done" }), "ready");
assert.equal(d({ lastOutcome: "stopped" }), "paused");
assert.equal(d({ lastOutcome: "error" }), "error");
assert.equal(d({ error: true, lastOutcome: "done" }), "error", "an error banner is a problem");
assert.equal(d({ unavailable: true, lastOutcome: "done" }), "error", "offline or unavailable is never 준비됨");
assert.equal(d({ unavailable: true, running: true }), "creating", "a running turn still reads its activity");
assert.equal(d({ unavailable: true, approvalPending: true }), "approval");
assert.equal(d({ preparing: true, lastOutcome: "error" }), "thinking", "a new send moves on");
assert.equal(d({ running: true }), "creating");
assert.equal(d({ running: true, error: true }), "creating", "streaming wins over a stale banner");
assert.equal(d({ approvalPending: true }), "approval", "an approval without a turn");
assert.equal(d({ approvalPending: true, running: true, error: true, lastOutcome: "stopped" }), "approval", "approval wins over everything");
assert.equal(d({ running: false, messages: [user, run("📖")] }), "ready", "a running line alone is not a running turn");
console.log("PASS coach-run-state: fixed set, icon classifier with negative controls, current-turn scan, precedence");
