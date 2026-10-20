// CGP-DS-R-018 / REQ-STUDIO-STROKE-ICONS — learner UI draws status and affordance icons from the
// stroke set (ChatIcon), never as emoji or Unicode status glyphs. Emoji render differently per OS,
// ignore the theme colour and forced colours, and looked unpolished in the released app
// ("🤖 AI 코치와 대화하고 있어요…", mixed ✓ / – marks).
//
// Three layers, each with planted controls (.claude/rules/verification.md rules 2 and 3):
//   1. Source scan of webview-ui/src: a status glyph outside the allowlist fails. Comments are
//      ignored. Every allowlist entry must still match something (no stale exemptions).
//   2. Host glyph keys: every icon the host puts on a timeline line or error banner maps to a
//      named stroke icon, so none falls back to the neutral dot by accident.
//   3. Render: the real ChatPanel (classroom and personal) and the panels draw no status glyph,
//      and every icon is currentColor, 16/20/24, and either aria-hidden or named in Korean.
// Run: node --experimental-strip-types test/stroke-icons.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ok = (msg) => console.log(`  ✓ ${msg}`);
const src = new URL("../webview-ui/src/", import.meta.url);
const hostSrc = new URL("../src/", import.meta.url);

// ── 1. Source scan ──────────────────────────────────────────────────────────────────────────

/** Emoji and pictographs, plus the Unicode status marks that are not in that property. */
const GLYPH = /\p{Extended_Pictographic}|[✓✗✕☑☐⚠▶◀▸▾☰⚙]/gu;
/** Typographic symbols that are text, not icons. */
const TEXT_SYMBOLS = new Set(["©", "®", "™", "↔"]);

/** Drop block comments and line comments; keep strings (a `//` after `:` is a URL, not a comment). */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[\s;{}(),])\/\/.*$/gm, (m, lead) => lead);
}

/** Every status glyph in code (not comments) of one file: [{ line, glyph }]. */
export function scanSource(code) {
  const hits = [];
  stripComments(code).split("\n").forEach((text, i) => {
    for (const m of text.matchAll(GLYPH)) if (!TEXT_SYMBOLS.has(m[0])) hits.push({ line: i + 1, glyph: m[0] });
  });
  return hits;
}

/**
 * The only places a glyph may stay, with the reason. `file` + `glyph` + exact `count` (default 1),
 * so an exempt glyph cannot hide a second, new use in the same file. `lane` names the other
 * branch that owns the surface (REQ-STUDIO-UI-POLISH-1 is reworking the capability card, the
 * header and the task rail at the same time, so this slice leaves them to it).
 */
const ALLOW = [
  // Keys, not drawn: the host protocol names icons with these strings; glyphIcon.ts maps them.
  ...["🔍", "🔎", "✍", "📝", "✏", "⌨", "🖥", "🌐", "🔧", "🛠", "🤖", "💭", "🖼", "📸", "🔗", "↗", "👀", "👆", "🖱", "◀", "▶", "💬", "🔽", "↕", "🔄", "🧪", "💡", "⏳", "🔒", "📖", "📄", "📦", "🗂", "📏", "🤝", "⚠", "✓", "✅", "🌙", "🎟", "🧰", "🔌"]
    .map((glyph) => ({ file: "glyphIcon.ts", glyph, why: "icon key table" })),
  ...["🌙", "🎟", "⏳", "🧰", "🔒", "🔌", "⚠"].map((glyph) => ({ file: "errorBannerPresentation.ts", glyph, count: glyph === "⏳" ? 4 : 1, why: "banner icon key, drawn through glyphIconKind" })),
  // Learner content: cohort world faces and the model's markdown task-list boxes.
  { file: "runner.ts", glyph: "✨", why: "runner face before a world opens (cohort content)" },
  { file: "MarkdownText.tsx", glyph: "☑", why: "model answer task list, content" },
  { file: "MarkdownText.tsx", glyph: "☐", why: "model answer task list, content" },
  // Decorative tone mark of the classroom naming card (not a status). Follow-up, not this slice.
  ...["🔍", "🌐", "✨", "🎮"].map((glyph) => ({ file: "ChatPanel.tsx", glyph, why: "classroom naming card tone mark" })),
  // Lane P (fix/ui-polish-personal-chat): header and capability card.
  { file: "ChatPanel.tsx", glyph: "⚙", why: "classroom header settings button", lane: "P" },
  { file: "ChatPanel.tsx", glyph: "🖼", why: "classroom header gallery button", lane: "P" },
  { file: "ChatPanel.tsx", glyph: "✓", count: 2, why: "header gallery done label and capability card mark", lane: "P" },
  { file: "TaskWorkspace.tsx", glyph: "☰", why: "personal heading rail toggle", lane: "P" },
];
const allowed = (file, glyph) => ALLOW.some((a) => a.file === file && a.glyph === glyph);

// Controls first: a planted emoji fails, a comment does not, a URL does not end the line early.
{
  assert.deepEqual(scanSource(`<div>🤖 AI 코치와 대화하고 있어요</div>`).map((h) => h.glyph), ["🤖"], "negative control: a status emoji in JSX is found");
  assert.deepEqual(scanSource(`const mark = ok ? "✓" : "⚠️";`).map((h) => h.glyph), ["✓", "⚠"], "negative control: marks in a string literal are found");
  assert.deepEqual(scanSource(`<span>{done ? '☑' : '☐'}</span>`).map((h) => h.glyph), ["☑", "☐"], "negative control: check boxes are found");
  assert.deepEqual(scanSource(`.x::before { content: "🪄"; }`).map((h) => h.glyph), ["🪄"], "negative control: CSS generated content is found");
  assert.deepEqual(scanSource(`// the old "🔄" button\n/* ⚠️ note */\n{/* ✨ */}`), [], "positive control: comments are not UI");
  assert.deepEqual(scanSource(`const u = "https://x.dev/a"; const g = "🔧";`).map((h) => h.glyph), ["🔧"], "negative control: a URL does not hide the rest of the line");
  assert.deepEqual(scanSource(`<ChatIcon kind="info" size={16} /> AI 코치와 대화하고 있어요 — © 2026 → 다음`), [], "positive control: a stroke icon and plain punctuation pass");
  assert.equal(allowed("ChatPanel.tsx", "🤖"), false, "negative control: an allowlisted file is not a blanket pass");
  ok("source scanner: 6 negative controls caught, 2 positive controls pass");
}

/** Hits that the allowlist does not cover, and allowlist entries whose count no longer matches. */
export function auditHits(hitsByFile, allow = ALLOW) {
  const offending = [], stale = [];
  for (const [file, hits] of hitsByFile) {
    const tally = new Map();
    for (const hit of hits) tally.set(hit.glyph, [...(tally.get(hit.glyph) ?? []), hit.line]);
    for (const [glyph, lines] of tally) {
      const entry = allow.find((a) => a.file === file && a.glyph === glyph);
      if (!entry || lines.length > (entry.count ?? 1)) offending.push(`${file}:${lines.join(",")} ${glyph}`);
    }
  }
  for (const a of allow) {
    const n = (hitsByFile.get(a.file) ?? []).filter((h) => h.glyph === a.glyph).length;
    if (n < (a.count ?? 1)) stale.push(`${a.file} ${a.glyph} (${n} of ${a.count ?? 1})`);
  }
  return { offending, stale };
}
{
  const planted = new Map([["ChatPanel.tsx", [{ line: 1, glyph: "⚙" }, { line: 9, glyph: "⚙" }]], ["New.tsx", [{ line: 3, glyph: "🔄" }]]]);
  const { offending, stale } = auditHits(planted, [{ file: "ChatPanel.tsx", glyph: "⚙" }, { file: "Gone.tsx", glyph: "✓" }]);
  assert.deepEqual(offending, ["ChatPanel.tsx:1,9 ⚙", "New.tsx:3 🔄"], "negative control: a second use of an exempt glyph and a new file are both caught");
  assert.deepEqual(stale, ["Gone.tsx ✓ (0 of 1)"], "negative control: an exemption that matches nothing is reported");
  ok("allowlist audit: 3 planted defects caught");
}

const files = readdirSync(src).filter((f) => /\.(tsx?|css)$/.test(f));
const { offending, stale } = auditHits(new Map(files.map((file) => [file, scanSource(readFileSync(new URL(file, src), "utf8"))])));
assert.deepEqual(offending, [], `status glyphs in learner UI source (use ChatIcon, or allowlist with a reason):\n${offending.join("\n")}`);
ok(`learner UI source: ${files.length} files, no status glyph outside the allowlist`);
assert.deepEqual(stale, [], `allowlist entries that no longer match (update them):\n${stale.join("\n")}`);
ok(`allowlist: all ${ALLOW.length} entries still match (${ALLOW.filter((a) => a.lane).length} left to lane P)`);

// ── 2. Host glyph keys → stroke icons ──────────────────────────────────────────────────────

const { glyphIconKind, stripLeadingGlyph, splitLeadingGlyph } = await import("../webview-ui/src/glyphIcon.ts");
const { AI_DISCLOSURE_TEXT, browserToolLogLine } = await import("../src/chatPanelHelpers.ts");
const { DELEGATION_ICON } = await import("../src/delegationRow.ts");
const { CONSULT_ICON } = await import("../src/consultTool.ts");
const { errorBannerPresentation } = await import("../webview-ui/src/errorBannerPresentation.ts");

{
  assert.equal(glyphIconKind("🦄"), "dot", "negative control: an unknown key draws the neutral dot, not the emoji");
  assert.equal(glyphIconKind(""), "dot");
  assert.equal(glyphIconKind(undefined), "dot");
  assert.equal(glyphIconKind("⚠️"), "alert", "the variation selector is not part of the key");
  assert.equal(glyphIconKind("⚠"), "alert");
  ok("glyphIconKind: unknown and empty keys draw the dot; variation selectors are ignored");
}

const read = (rel) => readFileSync(new URL(rel, hostSrc), "utf8");
const literalIcons = (code) => [...code.matchAll(/icon:\s*["'`]([^"'`]{1,4})["'`]/g)].map((m) => m[1]);
const hostKeys = new Map();
const addKey = (key, from) => { if (!hostKeys.has(key)) hostKeys.set(key, from); };
for (const file of ["toolActivity.ts", "chatPanelProvider.ts", "orchestratorHooks.ts"]) for (const key of literalIcons(read(file))) addKey(key, file);
for (const m of read("chatPanelProvider.ts").matchAll(/\blog\([^,]+,\s*"([^"]{1,4})"/g)) addKey(m[1], "chatPanelProvider.ts log()");
for (const m of read("chatPanelHelpers.ts").matchAll(/case "(browser_\w+|verify_\w+)"/g)) addKey(browserToolLogLine(m[1], {}).icon, `browserToolLogLine(${m[1]})`);
addKey(browserToolLogLine("some_new_tool", {}).icon, "browserToolLogLine(default)");
addKey(DELEGATION_ICON, "DELEGATION_ICON");
addKey(CONSULT_ICON, "CONSULT_ICON");
for (const m of readFileSync(new URL("errorBannerPresentation.ts", src), "utf8").matchAll(/"(\p{Extended_Pictographic}️?)"/gu)) addKey(m[1], "errorBannerPresentation");
assert.ok(hostKeys.size >= 30, `the key extraction found only ${hostKeys.size} host icons; the instrument is broken`);
{
  const unmapped = [...hostKeys].filter(([key]) => glyphIconKind(key) === "dot").map(([key, from]) => `${key} (${from})`);
  assert.deepEqual(unmapped, [], `host icons with no stroke icon (add them to glyphIcon.ts):\n${unmapped.join("\n")}`);
  ok(`host icon keys: ${hostKeys.size} keys, each maps to a named stroke icon`);
}
for (const message of ["알 수 없는 오류", "오늘 준비한 무료 사용량이 모두 소진되었습니다"]) {
  assert.notEqual(glyphIconKind(errorBannerPresentation(message).icon), "dot", message);
}

{
  assert.equal(stripLeadingGlyph("📏 390·1280px 확인 — 통과"), "390·1280px 확인 — 통과");
  assert.equal(stripLeadingGlyph("🗂 이전 버전 보관 — a.html"), "이전 버전 보관 — a.html");
  assert.equal(stripLeadingGlyph("✏️ 저장 비교 — index.html"), "저장 비교 — index.html");
  assert.equal(stripLeadingGlyph("Write(index.html) ✓"), "Write(index.html) ✓", "positive control: only a leading glyph is dropped");
  assert.equal(stripLeadingGlyph("기대 조건 테스트 중"), "기대 조건 테스트 중", "positive control: words are never touched");
  assert.deepEqual(splitLeadingGlyph("🖼 화면과 내용을 코치에게 붙였어요"), { glyph: "🖼", text: "화면과 내용을 코치에게 붙였어요" });
  assert.deepEqual(splitLeadingGlyph("내용을 붙였어요"), { glyph: null, text: "내용을 붙였어요" });
  ok("leading glyphs: dropped from labels the icon slot already marks; words unchanged");
}

{
  assert.equal(scanSource(JSON.stringify(AI_DISCLOSURE_TEXT)).length, 0, `the disclosure copy carries a glyph: ${AI_DISCLOSURE_TEXT}`);
  assert.match(AI_DISCLOSURE_TEXT, /^AI 코치와 대화하고 있어요\./, "the copy itself is unchanged apart from the dropped emoji");
  ok("AI disclosure copy has no leading emoji");
}

// ── 3. Render ──────────────────────────────────────────────────────────────────────────────

const { rendererStatus, renderComponent, visibleText } = await import("./sx-render.mjs");
const { chatPanelProps, chatConfig } = await import("./sx-screen-fixtures.mjs");

/** Every <svg> must be a stroke-set icon at 16/20/24 that is hidden or named in Korean. */
function auditIcons(html, where) {
  const svgs = [...html.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
  for (const svg of svgs) {
    assert.match(svg, /data-icon="[a-z-]+"/, `${where}: an svg outside the icon set: ${svg}`);
    assert.match(svg, /stroke="currentColor"/, `${where}: icon not drawn in currentColor: ${svg}`);
    assert.match(svg, /width="(16|20|24)" height="\1"/, `${where}: icon size outside 16/20/24: ${svg}`);
    const hidden = /aria-hidden="true"/.test(svg);
    const named = /role="img"/.test(svg) && /aria-label="[^"]*[가-힣][^"]*"/.test(svg);
    assert.ok(hidden !== named, `${where}: an icon must be aria-hidden or a named img, not both or neither: ${svg}`);
  }
  return svgs;
}
/** Lane P owns the chat header and the capability card in this round; their marks are its call. */
const withoutLaneP = (html) => html
  .replace(/<header class="hps-header">[\s\S]*?<\/header>/g, "")
  .replace(/<details class="[^"]*hp-ai-can-do[^"]*">[\s\S]*?<\/details>/g, "");
const glyphsIn = (text) => [...text.matchAll(GLYPH)].map((m) => m[0]).filter((g) => !TEXT_SYMBOLS.has(g));

const TOOL_LINES = [
  { id: "u1", role: "user", content: "내 소개 페이지를 만들어 줘", createdAt: 1 },
  { id: "t1", role: "tool", content: "", createdAt: 2, tool: { icon: "🔍", label: "파일을 살펴보는 중…", state: "done" } },
  { id: "t2", role: "tool", content: "", createdAt: 3, tool: { icon: "⚠️", label: "미리보기 열기 실패: 시간 초과", state: "error" } },
  { id: "t3", role: "tool", content: "", createdAt: 4, tool: { icon: "📏", label: "📏 390·1280px 확인 — 통과", state: "done" } },
  { id: "t4", role: "tool", content: "", createdAt: 5, tool: { icon: "🦄", label: "새 도구", state: "running" } },
];

const status = rendererStatus();
if (!status.available) {
  console.log(`NOT RUN stroke icon renders — ${status.detail}`);
} else {
  const classroom = chatPanelProps({ messages: TOOL_LINES, aiNotice: AI_DISCLOSURE_TEXT, pageNotice: "🖼 화면과 내용을 코치에게 붙였어요 — 제목", error: "알 수 없는 오류", canRetryLast: true });
  const base = chatConfig();
  const personalConfig = { ...base, profile: { ...base.profile, lesson: undefined }, taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } };
  const personal = { ...classroom, config: personalConfig };
  for (const [where, props] of [["classroom chat", classroom], ["personal chat", personal]]) {
    const html = await renderComponent("ChatPanel", props);
    const svgs = auditIcons(withoutLaneP(html), where);
    assert.ok(html.includes("AI 코치와 대화하고 있어요"), `${where}: the disclosure did not render; the checks below would be vacuous`);
    const disclosure = html.match(/<div class="hps-ai-disclosure"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    assert.match(disclosure, /^<svg[^>]*data-icon="info"[^>]*aria-hidden="true"/, `${where}: the disclosure opens with the hidden info icon: ${disclosure}`);
    assert.match(html, /data-glyph="🔍"><svg[^>]*data-icon="search"/, `${where}: a tool line's key draws its stroke icon`);
    assert.match(html, /data-icon="alert"[^>]*role="img" aria-label="실패"|role="img" aria-label="실패"[^>]*data-icon="alert"|data-icon="alert" class="hps-icon" role="img" aria-label="실패"/, `${where}: a failed step's mark is named 실패`);
    assert.match(html, /data-glyph="🦄"><svg[^>]*data-icon="dot"/, `${where}: an unknown key draws the dot`);
    assert.ok(visibleText(html).includes("390·1280px 확인 — 통과") && !html.includes("📏 390"), `${where}: the label's leading glyph is dropped`);
    assert.ok(html.includes("화면과 내용을 코치에게 붙였어요"), `${where}: page notice text kept`);
    assert.ok(html.includes('class="hps-header"'), `${where}: no header rendered; the lane P cut below would hide nothing`);
    const left = glyphsIn(visibleText(withoutLaneP(html)));
    assert.deepEqual(left, [], `${where}: status glyphs still drawn as text: ${left.join(" ")}`);
    ok(`${where}: ${svgs.length} stroke icons, each currentColor at 16/20/24 and hidden or named; no glyph in the visible text`);
  }
  // Negative control for the render audit: the old markup must fail it.
  {
    const old = `<div class="hps-ai-disclosure">🤖 AI 코치와 대화하고 있어요.</div><span class="hps-tool-mark">⚠️</span>`;
    assert.deepEqual(glyphsIn(old), ["🤖", "⚠"], "negative control: the released markup is caught");
    assert.throws(() => auditIcons(`<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" data-icon="x" aria-hidden="true">`, "control"), /16\/20\/24/, "negative control: an 18px icon fails");
    assert.throws(() => auditIcons(`<svg width="16" height="16" stroke="currentColor" data-icon="x">`, "control"), /aria-hidden or a named img/, "negative control: an unlabelled visible icon fails");
    assert.throws(() => auditIcons(`<svg width="16" height="16" stroke="#fff" data-icon="x" aria-hidden="true">`, "control"), /currentColor/, "negative control: a fixed colour fails");
    ok("render audit: 4 negative controls caught");
  }
  // The side panels' close buttons are not rendered by the fixtures above: check their markup source.
  for (const name of ["EvidencePanel", "MemoryPanel", "SkillsPanel", "PublishPanel", "ReviewPanel"]) {
    const source = readFileSync(new URL(`${name}.tsx`, src), "utf8");
    assert.match(source, /aria-label="닫기"><ChatIcon kind="close" size=\{16\} \/><\/button>/, `${name}: close button draws the close icon under its Korean name`);
  }
  ok("panel close buttons: the icon is hidden and the button keeps its Korean name");
}
