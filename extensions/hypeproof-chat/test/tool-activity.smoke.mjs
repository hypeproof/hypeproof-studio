// How much tool work the chat timeline draws follows the Service, per cohort (hype-dental D-027,
// 2026-10-14). The rehearsal showed a dentist twelve lines per turn: `Edit(index.html)`,
// `mcp__hypeproof__browser_read({})`, five "미리보기를 열었어요", and a red
// `— 실패: <tool_use_error>String to replace not found…` for an edit the coach then retried.
//
// What is locked: only `tool_activity: "summary"` changes anything (absent keeps #414's lines);
// a summary line never carries a tool name, an input or an error; at most one line is open, it
// changes in place, and once closed it sits under a `pending-` id that ToolLine hides. The
// drawing in the app is checked by the class rehearsal (e2e/one-click-publish/).
//
// Run: node --experimental-strip-types test/tool-activity.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { toolActivityMode, workPhrase, WorkLine, THINKING_PHRASE, NEXT_STEP_PHRASE } = await import("../src/toolActivity.ts");

assert.equal(toolActivityMode(null), "detailed", "no profile yet: the #414 lines");
assert.equal(toolActivityMode({}), "detailed", "a cohort served without the field (every cohort before it) keeps the lines");
assert.equal(toolActivityMode({ tool_activity: "detailed" }), "detailed");
assert.equal(toolActivityMode({ tool_activity: "Summary" }), "detailed", "only the exact value switches");
assert.equal(toolActivityMode({ tool_activity: "summary" }), "summary", "1017");
console.log("✓ mode: only an explicit \"summary\" changes the timeline");

// The rehearsal's own calls (2026-10-14, LUNA, 1017) → Korean, no names, no input.
const calls = [
  ["Write", { file_path: "index.html", content: "<html>…" }, "홈페이지를 고치는 중…"],
  ["Edit", { file_path: "/Users/x/HypeProofDentalSeminar/index.html", old_string: "a", new_string: "b" }, "홈페이지를 고치는 중…"],
  ["MultiEdit", { file_path: "about.htm", edits: [] }, "홈페이지를 고치는 중…"],
  ["Write", { file_path: "agent.md", content: "# 메모" }, "agent.md에 정리하는 중…"],
  ["Edit", { file_path: "C:\\Users\\x\\HypeProofDentalSeminar\\agent.md" }, "agent.md에 정리하는 중…"],
  ["Write", { file_path: "shared.css", content: "" }, "파일을 고치는 중…"],
  ["Read", { file_path: "index.html", offset: 244, limit: 12 }, "파일을 살펴보는 중…"],
  ["Grep", { pattern: "<h2>", path: "index.html" }, "파일을 살펴보는 중…"],
  ["Glob", { pattern: "*.html" }, "파일을 살펴보는 중…"],
  ["mcp__hypeproof__live_preview_start", {}, "화면을 확인하는 중…"],
  ["mcp__hypeproof__browser_read", {}, "화면을 확인하는 중…"],
  ["mcp__hypeproof__browser_screenshot", {}, "화면을 확인하는 중…"],
  ["Bash", { command: "gh repo view me/dental-homepage" }, "명령을 실행하는 중…"],
  ["WebFetch", { url: "https://example.com" }, "인터넷에서 찾아보는 중…"],
  ["TodoWrite", { todos: [] }, "작업하는 중…"],
];
for (const [name, input, label] of calls) {
  const p = workPhrase(name, input);
  assert.equal(p.label, label, `${name} → ${label}`);
  const raw = name.replace(/^mcp__.+?__/, "");
  assert.ok(!p.label.includes(raw) || raw === "agent", `${name}: the tool name is not drawn`);
  assert.ok(!/[(){}<>_]|\.html|gh |http/.test(p.label), `${name}: no input or markup is drawn — "${p.label}"`);
}
console.log("✓ phrases: every rehearsal call becomes a Korean phrase without its name or input");

// One stretch of the rehearsal turn, replayed through the line: thinking, a Read, a failed Edit
// the coach retried, the retry, four Greps, the preview tools, then the coach's text.
const posted = [];
const line = new WorkLine("pending-s1", (e) => posted.push(e));
line.show(THINKING_PHRASE);
line.show(THINKING_PHRASE); // token ticks: no repost
line.show(workPhrase("Read", { file_path: "index.html" }));
line.show(NEXT_STEP_PHRASE);
line.show(workPhrase("Edit", { file_path: "index.html" })); // fails: nothing is posted for the failure
line.show(NEXT_STEP_PHRASE);
line.show(workPhrase("Edit", { file_path: "index.html" }));
for (let i = 0; i < 4; i++) line.show(workPhrase("Grep", { pattern: "x" }));
line.show(workPhrase("mcp__hypeproof__live_preview_start", {}));
line.show(workPhrase("mcp__hypeproof__browser_read", {}));
assert.ok(line.isOpen);
line.close("고쳤어요"); // the coach starts writing
line.close("고쳤어요"); // a second close is a no-op
assert.ok(!line.isOpen);
assert.ok(posted.every((e) => e.id === "pending-s1-w0"), "the whole stretch is one line, changed in place");
// 생각 · 살펴보는 · 다음 단계 · 고치는 · 다음 단계 · 고치는 · 살펴보는(Grep ×4) · 화면 확인(preview + read)
assert.equal(posted.filter((e) => e.state === "running").length, 8, "consecutive identical phrases are posted once");
assert.ok(posted.every((e) => e.state !== "error"), "no error line");
assert.deepEqual(posted.at(-1), { id: "pending-s1-w0", icon: "✍️", label: "고쳤어요", state: "done" });
// After the coach's text, the next stretch opens a new line (at the bottom of the timeline).
line.show(workPhrase("Edit", { file_path: "index.html" }));
assert.equal(posted.at(-1).id, "pending-s1-w1");
line.close("고쳤어요");
console.log("✓ line: one line per stretch, in place, closed under a pending- id; the next stretch gets a new id");

// The timeline hides a closed pending- line, and the provider routes the SDK activity through it.
const panel = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
assert.match(panel, /if \(message\.id\.startsWith\('pending-'\) && t\.state === 'done'\) return null;/, "ToolLine hides a closed pending- line");
const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
assert.match(provider, /const work = toolActivityMode\(profile\) === "summary"\s*\? new WorkLine\(PENDING_ID,/, "summary cohorts get the line");
assert.match(provider, /if \(work\) \{\s*pendingShown = true;\s*work\.show\(workPhrase\(a\.name, a\.input\)\);\s*\} else \{\s*log\(a\.id, "🔧", label, "running"\);/, "tool_use: a phrase instead of the raw label");
assert.match(provider, /if \(!work\) log\(\s*a\.id,\s*"🔧",\s*a\.isError/, "tool_result: no per-call line (failures included)");
assert.match(provider, /case "thinking":[\s\S]{0,200}if \(work\) \{\s*pendingShown = true;\s*work\.show\(THINKING_PHRASE\);\s*break;/, "thinking: the phrase, never the thought text");
assert.match(provider, /toolLabels\.set\(a\.id, label\);/, "observation still records the raw label");
assert.match(provider, /const revealLogId = summaryActivity \? `pending-reveal-\$\{randomId\(\)\}` : randomId\(\);/, "preview line hidden once open");
console.log("✓ wiring: ChatPanel hides closed lines; the provider sends summary cohorts through the line");

console.log("\n✓ tool-activity smoke 통과");
