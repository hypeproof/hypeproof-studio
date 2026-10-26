// REQ-STUDIO-TOOL-LINE-LABELS (#2788) — the learner-facing line for an SDK/local tool call.
// RC1 showed `mcp__hypeproof__browser_open(search.naver.com · 인터넷)` and
// `mcp__hypeproof__browser_read({})`. Every learner line now comes from learnerToolLine:
// prefix stripped, browser tools through browserToolLogLine, plain Korean for common SDK tools,
// a neutral line for anything unknown, and never a raw identifier, `({})` or JSON.
// Run: node --experimental-strip-types test/tool-line-label.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { learnerToolLine, UNKNOWN_TOOL_LINE } = await import("../src/toolLineLabel.ts");
const WS = "/Users/kid/work";
const line = (name, input, root = WS) => learnerToolLine(name, input, root);
const RAW = /mcp__|\(\{\}\)|[{}[\]"]|^\w+\(/;
const clean = (l, why) => {
  assert.doesNotMatch(l.label, RAW, `${why}: no raw identifier, ({}) or JSON — ${l.label}`);
  assert.ok(l.label.trim().length > 0, `${why}: never blank`);
  return l;
};

// RC1's two lines.
assert.deepEqual(clean(line("mcp__hypeproof__browser_open", { url: "https://search.naver.com/search.naver?query=치과&token=abc" }), "open"),
  { icon: "🔗", label: "search.naver.com 열기 · 인터넷" });
assert.deepEqual(clean(line("mcp__hypeproof__browser_read", {}), "read"), { icon: "👀", label: "페이지 읽는 중" });

// browser_open keeps the host-only + place tag of REQ-E3: preview, local file, blank, unparseable.
assert.equal(line("mcp__hypeproof__browser_open", { url: "http://127.0.0.1:5500/index.html" }).label, "127.0.0.1 열기 · 내 미리보기");
assert.equal(line("mcp__hypeproof__browser_open", { url: "file:///Users/kid/work/a.html" }).label, "작업 폴더/a.html 열기 · 내 컴퓨터 파일");
assert.equal(line("mcp__hypeproof__browser_open", { url: "file:///Users/kid/.ssh/id_rsa" }).label, "작업 폴더 밖 · id_rsa 열기 · 내 컴퓨터 파일");
assert.equal(line("mcp__hypeproof__browser_open", { url: "about:blank" }).label, "빈 브라우저 열기");
assert.equal(line("mcp__hypeproof__browser_open", {}).label, "알 수 없는 주소 열기 · 인터넷");
assert.equal(line("mcp__hypeproof__browser_open", { url: "https://user:pw@evil.example:8443/x?k=1" }).label, "evil.example 열기 · 인터넷");
assert.equal(line("mcp__hypeproof__live_preview_start", { path: "index.html" }).label, "미리보기 열기");
assert.equal(line("mcp__hypeproof__browser_screenshot", {}).label, "화면 캡처");
assert.equal(line("mcp__hypeproof__browser_click", { ref: "e3" }).label, "e3 클릭");
console.log("✓ hypeproof browser tools: prefix stripped, browser_open host + place tag, preview/screenshot labels");

// Common SDK tools in plain Korean.
assert.deepEqual(line("Read", { file_path: `${WS}/index.html`, offset: 10 }), { icon: "📖", label: "파일 읽기 index.html" });
assert.equal(line("Read", { file_path: `${WS}/sub/a.css` }).label, "파일 읽기 sub/a.css");
assert.equal(line("Read", { file_path: "/etc/passwd" }).label, "파일 읽기 작업 폴더 밖 · passwd", "outside the work folder stays visible, never the full path");
assert.equal(line("Read", { file_path: "./agent.md" }).label, "파일 읽기 agent.md");
assert.equal(line("Write", { file_path: `${WS}/index.html`, content: "<html>" }).label, "파일 고치기 index.html");
assert.equal(line("Edit", { file_path: `${WS}/style.css`, old_string: "a", new_string: "b" }).label, "파일 고치기 style.css");
assert.equal(line("MultiEdit", { file_path: `${WS}/a.js`, edits: [] }).label, "파일 고치기 a.js");
assert.equal(line("NotebookEdit", { notebook_path: `${WS}/n.ipynb` }).label, "파일 고치기 n.ipynb");
assert.equal(line("Glob", { pattern: "**/*.html" }).label, "파일 찾기");
assert.equal(line("Grep", { pattern: "button", path: WS }).label, "파일 찾기");
assert.equal(line("WebSearch", { query: "서울 치과 임플란트 가격" }).label, "웹 검색: 서울 치과 임플란트 가격");
assert.equal(line("WebFetch", { url: "https://docs.example.com/a/b?secret=1", prompt: "요약" }).label, "docs.example.com 읽기");
assert.equal(line("WebFetch", {}).label, "알 수 없는 주소 읽기");
assert.equal(line("Bash", { command: "npm test", description: "테스트 실행" }).label, "명령 실행");
console.log("✓ SDK tools: 파일 읽기 / 파일 고치기 / 파일 찾기 / 웹 검색 / <host> 읽기 / 명령 실행");

// Unknown tools: the neutral line, never the identifier.
for (const [name, input] of [
  ["mcp__hypeproof__consult", { question: "x" }],
  ["mcp__hypeproof__publish_site", {}],
  ["mcp__other__browser_open", { url: "https://a.example" }],
  ["SomeFutureTool", { a: 1 }],
  ["mcp__hypeproof__browser_teleport", {}],
  ["", null],
]) assert.deepEqual(clean(line(name, input), name), UNKNOWN_TOOL_LINE, name);
assert.equal(UNKNOWN_TOOL_LINE.label, "도구 사용 중");
console.log("✓ unknown tools: 도구 사용 중, never the name, ({}) or JSON");

// Hostile model input: control, bidi and line-separator characters cannot fake a line; long text is clipped.
const q = line("WebSearch", { query: "a\u2028b\u202ec\u0000d\n\ne" }).label;
assert.doesNotMatch(q, /[\u0000-\u001f\u2028\u2029\u202a-\u202e\u2066-\u2069]/, JSON.stringify(q));
assert.equal(q, "웹 검색: a bcd e", "a line separator reads as a space, never a new line");
const long = line("WebSearch", { query: "가".repeat(200) }).label;
assert.ok(long.length <= "웹 검색: ".length + 41 && long.endsWith("…"), long);
const evilName = line("Read", { file_path: `${WS}/a\u202egnp.exe` }).label;
assert.equal(evilName, "파일 읽기 agnp.exe");
console.log("✓ hostile input: controls/bidi/U+2028 removed, clipped at 40");

// Wiring: the SDK/local path draws the learner label; the observation record keeps raw names.
const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
assert.match(provider, /observation\.toolRequest\(streamId,a\.id,`\$\{a\.name\}\(\$\{summarizeToolInput\(a\.name,a\.input,300,this\.resolveCoachCwd\(\)\)\}\)`\)/, "observation keeps the raw name");
assert.doesNotMatch(provider, /log\(line\.lineId, "🔧", (label|toolLabels)/, "no learner line is drawn from the raw label");
console.log("✓ wiring: learner lines from learnerToolLine, observation raw");

console.log("\n✓ tool-line-label smoke 통과");
