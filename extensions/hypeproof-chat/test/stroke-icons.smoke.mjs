import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";
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
import { readdirSync } from "node:fs";

const ok = (msg) => console.log(`  ✓ ${msg}`);
const src = new URL("../webview-ui/src/", import.meta.url);
const hostSrc = new URL("../src/", import.meta.url);

// ── 1. Source scan ──────────────────────────────────────────────────────────────────────────

/** Emoji and pictographs, plus the Unicode status marks that are not in that property. */
const GLYPH = /\p{Extended_Pictographic}|[✓✗✕☑☐⚠▶◀▸▾☰⚙◷]/gu;
/** Typographic symbols that are text, not icons. */
const TEXT_SYMBOLS = new Set(["©", "®", "™", "↔"]);

const glyphsIn = (text) => [...text.matchAll(GLYPH)].map((m) => m[0]).filter((g) => !TEXT_SYMBOLS.has(g));

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
 * so an exempt glyph cannot hide a second, new use in the same file. Two kinds remain: protocol
 * keys that are never drawn (glyphIcon.ts maps them), and learner content.
 */
const ALLOW = [
  // Keys, not drawn: the host protocol names icons with these strings; glyphIcon.ts maps them.
  ...["🔍", "🔎", "✍", "📝", "✏", "⌨", "🖥", "🌐", "🔧", "🛠", "🤖", "💭", "🖼", "📸", "🔗", "↗", "👀", "👆", "🖱", "◀", "▶", "💬", "🔽", "↕", "🔄", "🧪", "💡", "⏳", "🔒", "📖", "📄", "📦", "🗂", "📏", "🤝", "⚠", "✓", "✅", "🌙", "🎟", "🧰", "🔌", "✨", "🎮"]
    .map((glyph) => ({ file: "glyphIcon.ts", glyph, why: "icon key table" })),
  ...["🌙", "🎟", "⏳", "🧰", "🔒", "🔌", "⚠"].map((glyph) => ({ file: "errorBannerPresentation.ts", glyph, count: glyph === "⏳" ? 4 : 1, why: "banner icon key, drawn through glyphIconKind" })),
  // Learner content: cohort world faces and the model's markdown task-list boxes.
  { file: "runner.ts", glyph: "✨", why: "runner face before a world opens (cohort content)" },
  { file: "MarkdownText.tsx", glyph: "☑", why: "model answer task list, content" },
  { file: "MarkdownText.tsx", glyph: "☐", why: "model answer task list, content" },
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
ok(`allowlist: all ${ALLOW.length} entries still match (protocol keys and learner content only)`);

// ── 1b. Icon size after CSS ─────────────────────────────────────────────────────────────
// The svg's width attribute is not its drawn size: a CSS rule on the svg wins over the attribute
// (verify F4: `.cp-citation > svg { width: 14px }` drew a 20px icon at 14px). The render below has no
// layout, so every CSS rule that can size an icon is checked here: whatever it sets must be 16/20/24.
const SIZE_PROPS = /^(?:width|height|inline-size|block-size|min-width|min-height|max-width|max-height|min-inline-size|min-block-size|max-inline-size|max-block-size)$/;
export function iconSizeFindings(css, file = "x.css") {
  const out = [];
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    if (!selectors.some((x) => /(?:^|[\s>+~])svg(?:\[[^\]]*\])?(?::[\w-]+)*$|\.hps-icon(?::[\w-]+)*$/.test(x))) continue;
    for (const d of m[2].split(";")) {
      const [prop, ...rest] = d.split(":");
      const value = rest.join(":").trim();
      if (!prop || !SIZE_PROPS.test(prop.trim())) continue;
      if (!/^(?:16|20|24)px$/.test(value)) out.push(`${file}: ${m[1].trim()} { ${prop.trim()}: ${value} }`);
    }
  }
  return out;
}
{
  assert.deepEqual(iconSizeFindings(".cp-citation > svg { flex: none; width: 14px; height: 14px; }"), ["x.css: .cp-citation > svg { width: 14px }", "x.css: .cp-citation > svg { height: 14px }"], "negative control: the 14px citation icon (verify F4) is caught");
  assert.equal(iconSizeFindings(".tw-source-empty > span > svg { width: 28px; }").length, 1, "negative control: a 28px empty-state icon is caught");
  assert.equal(iconSizeFindings(".a .hps-icon { inline-size: 1em; }").length, 1, "negative control: a relative size on the icon class is caught");
  assert.deepEqual(iconSizeFindings(".x > svg { width: 16px; height: 16px; color: red } .y svg { width: 24px } .hps-icon { flex: none } .svgish { width: 3px }"), [], "positive control: 16/24 sizes, non-size properties and other classes pass");
  const files = readdirSync(src).filter((f) => f.endsWith(".css"));
  const found = files.flatMap((f) => iconSizeFindings(readFileSync(new URL(f, src), "utf8"), f));
  assert.deepEqual(found, [], `CSS sizes an icon outside 16/20/24:\n${found.join("\n")}`);
  ok(`icon size after CSS: ${files.length} stylesheets, every rule that sizes an svg or .hps-icon keeps 16/20/24 (3 negative controls, 1 positive)`);
}

// ── 1c. Stroke weight (CGP-DS-D-015) ────────────────────────────────────────────────────────
// Every stroked icon draws a 1.5-2 stroke in its own coordinate system. A stroked svg with no
// stroke-width falls back to 1, which is why the two approval-dialog icons were fixed. Fill-only
// glyphs (the three filled dots, the stop square, a brand logo) have no stroke and are exempt.
// Scanned: the webview source, and Chalk's inline icons (HTML svg and its status-chip icon builder).
const STROKE_MIN = 1.5, STROKE_MAX = 2;
export function strokeWeightFindings(code, file = "x") {
  const out = [];
  const text = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/<!--[\s\S]*?-->/g, "");
  let widths = 0;
  for (const m of text.matchAll(/stroke-?[wW]idth["']?\s*[=:,]\s*\{?\s*["']?(\d*\.?\d+)/g)) {
    widths++;
    const w = Number(m[1]);
    if (w < STROKE_MIN || w > STROKE_MAX) out.push(`${file}: stroke-width ${m[1]} is outside ${STROKE_MIN}-${STROKE_MAX}`);
  }
  let stroked = 0;
  for (const m of text.matchAll(/<svg\b[\s\S]*?(?:<\/svg>|$)/g)) {
    const block = m[0].replace(/<svg\b[\s\S]*?<\/svg>[\s\S]*$/, (x) => x.slice(0, x.indexOf("</svg>")));
    if (!/\bstroke=(["'])(?!none)[^"']+\1/.test(block)) continue; // fill-only: exempt
    stroked++;
    if (!/stroke-?[wW]idth/.test(block)) out.push(`${file}: a stroked <svg> sets no stroke-width (the default is 1): ${block.slice(0, 70).replace(/\s+/g, " ")}`);
  }
  // Chalk builds its status icon with setAttribute pairs instead of markup.
  if (/\["stroke",\s*"(?!none)[^"]+"\]/.test(text)) {
    stroked++;
    if (!/\["stroke-width",\s*"[\d.]+"\]/.test(text)) out.push(`${file}: a built svg strokes without a stroke-width`);
  }
  return { out, widths, stroked };
}
{
  const bad = (c) => strokeWeightFindings(c).out.length;
  assert.equal(bad(`<path d="M6 12h.01" strokeWidth="2.6" />`), 1, "negative control: the old 2.6 dots stroke is caught");
  assert.equal(bad(`<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path d="M1 1"/></svg>`), 1, "negative control: a 3 root stroke is caught");
  assert.equal(bad(`<svg viewBox="0 0 16 16"><path d="M1 1" fill="none" stroke="currentColor"/></svg>`), 1, "negative control: a stroked svg with the default width 1 is caught");
  assert.equal(bad(`url("data:image/svg+xml,%3Csvg stroke='black' stroke-width='1'%3E")`), 1, "negative control: a thin CSS data-URI stroke is caught");
  assert.equal(bad(`for (const [k, v] of [["stroke", "currentColor"], ["fill", "none"]]) svg.setAttribute(k, v);`), 1, "negative control: a built svg with no stroke-width is caught");
  assert.equal(bad(`["stroke-width", "2.6"]`), 1, "negative control: a built svg with 2.6 is caught");
  assert.equal(bad(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><g fill="currentColor" stroke="none"><circle r="1.5"/></g></svg>`), 0, "positive control: 1.7 with a fill-only child passes");
  assert.equal(bad(`<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M1 1"/></svg>`), 0, "positive control: a fill-only logo has no stroke to weigh");
  assert.equal(bad(`<svg stroke="currentColor" stroke-width={2}><path d="M1 1"/></svg> <svg stroke="currentColor" strokeWidth="1.5"><path d="M2 2"/></svg>`), 0, "positive control: both ends of the range pass, and one svg does not borrow the next one's width");
  assert.equal(bad(`<svg stroke="currentColor"><path d="M1 1"/></svg><svg stroke="currentColor" strokeWidth="2"/>`), 1, "negative control: a missing width is not rescued by a later svg");
  const dir = (u) => readdirSync(u).map((f) => new URL(f, u));
  const chalkSrc = new URL("../../../chalk/src/", import.meta.url);
  const targets = [
    ...dir(src).filter((u) => /\.(tsx|css)$/.test(u.pathname)),
    ...dir(new URL("ui/", chalkSrc)).filter((u) => u.pathname.endsWith(".html")),
    ...dir(new URL("lib/", chalkSrc)).filter((u) => /board-status\.ts$|design-tokens\.ts$/.test(u.pathname)),
  ];
  let widths = 0, stroked = 0;
  const found = targets.flatMap((u) => {
    const r = strokeWeightFindings(readFileSync(u, "utf8"), u.pathname.split("/").slice(-3).join("/"));
    widths += r.widths; stroked += r.stroked;
    return r.out;
  });
  assert.ok(stroked >= 7 && widths >= 9, `the stroke scan saw ${stroked} stroked svgs and ${widths} widths; the instrument is broken`);
  assert.deepEqual(found, [], `a stroked icon is outside ${STROKE_MIN}-${STROKE_MAX}:\n${found.join("\n")}`);
  const details = readFileSync(new URL("ChatDetails.tsx", src), "utf8");
  assert.match(details, /kind === 'dots' && <g fill="currentColor" stroke="none"><circle[^>]*\/><circle[^>]*\/><circle[^>]*\/><\/g>/, "the dots icon is three filled circles, not a heavy stroke");
  ok(`stroke weight: ${stroked} stroked svgs and ${widths} widths in ${targets.length} Studio and Chalk files, all ${STROKE_MIN}-${STROKE_MAX} (6 negative controls, 3 positive); dots are filled circles`);
}

{
  // Verify F3: the classroom done check (its row's only visual cue) measured 2.97:1 on the light theme
  // in the theme green alone. The rule mixes the theme foreground in; the screenshots measure the result.
  const css = readFileSync(new URL("styles.css", src), "utf8");
  const rule = /\.hps-tool-done \.hps-tool-mark \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /color:\s*color-mix\(in srgb, var\(--vscode-charts-green[^)]*\) \d+%, var\(--vscode-foreground/, `done check colour is the bare theme green again: ${rule}`);
  ok("done check: theme green mixed with the foreground (F3 contrast fix stays in place)");
}

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
{
  // Host copy and tables the webview draws as-is: no glyph may ride in on them.
  const { TASK_RUN_STATE_LABELS } = await import("../src/taskRunState.ts");
  const { FREE_START_COPY } = await import("../src/freeStart.ts");
  const drawn = [...Object.values(TASK_RUN_STATE_LABELS).map((v) => v.label), ...Object.values(FREE_START_COPY).filter((v) => typeof v === "string")];
  const carried = drawn.filter((text) => glyphsIn(text).length || /[↗•⋯■]/.test(text));
  assert.deepEqual(carried, [], `host copy drawn in the webview carries a glyph: ${carried.join(" | ")}`);
  assert.ok(Object.values(TASK_RUN_STATE_LABELS).every((v) => v.icon && !("symbol" in v)), "a run state still carries a Unicode symbol instead of a stroke icon");
  assert.deepEqual(glyphsIn("작업 중 ▶ 보호자 안내 보기 ↗"), ["▶", "↗"], "negative control: the old run-state triangle and guardian arrow are caught");
  ok(`host copy: ${drawn.length} run-state labels and free-start strings carry no glyph; run states name stroke icons`);
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
    const weight = /stroke-width="([\d.]+)"/.exec(svg)?.[1];
    assert.ok(weight && Number(weight) >= 1.5 && Number(weight) <= 2, `${where}: icon stroke-width ${weight} is outside 1.5-2: ${svg}`);
    const hidden = /aria-hidden="true"/.test(svg);
    const named = /role="img"/.test(svg) && /aria-label="[^"]*[가-힣][^"]*"/.test(svg);
    assert.ok(hidden !== named, `${where}: an icon must be aria-hidden or a named img, not both or neither: ${svg}`);
  }
  return svgs;
}

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
  const caps = [{ key: "read", label: "작업 폴더의 파일 읽기", on: true }, { key: "shell", label: "명령 실행하기", on: false }];
  const base = { ...chatConfig(), aiCapabilities: caps };
  const classroom = chatPanelProps({ config: base, messages: TOOL_LINES, aiNotice: AI_DISCLOSURE_TEXT, pageNotice: "🖼 화면과 내용을 코치에게 붙였어요 — 제목", error: "알 수 없는 오류", canRetryLast: true });
  const personalConfig = { ...base, profile: { ...base.profile, lesson: undefined }, taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } };
  const personal = { ...classroom, config: personalConfig };
  for (const [where, props] of [["classroom chat", classroom], ["personal chat", personal]]) {
    const html = await renderComponent("ChatPanel", props);
    const svgs = auditIcons(html, where);
    assert.ok(html.includes("AI 코치와 대화하고 있어요"), `${where}: the disclosure did not render; the checks below would be vacuous`);
    const disclosure = html.match(/<div class="hps-ai-disclosure"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    assert.match(disclosure, /^<svg[^>]*data-icon="info"[^>]*aria-hidden="true"/, `${where}: the disclosure opens with the hidden info icon: ${disclosure}`);
    assert.match(html, /data-glyph="🔍"><svg[^>]*data-icon="search"/, `${where}: a tool line's key draws its stroke icon`);
    assert.match(html, /data-icon="alert"[^>]*role="img" aria-label="실패"|role="img" aria-label="실패"[^>]*data-icon="alert"|data-icon="alert" class="hps-icon" role="img" aria-label="실패"/, `${where}: a failed step's mark is named 실패`);
    assert.match(html, /data-glyph="🦄"><svg[^>]*data-icon="dot"/, `${where}: an unknown key draws the dot`);
    assert.ok(visibleText(html).includes("390·1280px 확인 — 통과") && !html.includes("📏 390"), `${where}: the label's leading glyph is dropped`);
    assert.ok(html.includes("화면과 내용을 코치에게 붙였어요"), `${where}: page notice text kept`);
    assert.match(html, /<span class="hp-ai-can-do-mark"><svg [^>]*data-icon="check"/, `${where}: the capability card's on mark is a stroke icon`);
    assert.match(html, /<span class="hp-ai-can-do-mark"><svg [^>]*data-icon="minus"/, `${where}: the capability card's off mark is a stroke icon`);
    if (where === "classroom chat") assert.match(html, /aria-label="설정"><svg [^>]*data-icon="settings"[^>]*aria-hidden="true"/, "classroom header settings button draws the settings icon under its Korean name");
    const left = glyphsIn(visibleText(html));
    assert.deepEqual(left, [], `${where}: status glyphs still drawn as text: ${left.join(" ")}`);
    ok(`${where}: ${svgs.length} stroke icons, each currentColor at 16/20/24 and hidden or named; no glyph in the visible text`);
  }
  // Negative control for the render audit: the old markup must fail it.
  {
    const old = `<div class="hps-ai-disclosure">🤖 AI 코치와 대화하고 있어요.</div><span class="hps-tool-mark">⚠️</span>`;
    assert.deepEqual(glyphsIn(old), ["🤖", "⚠"], "negative control: the released markup is caught");
    assert.throws(() => auditIcons(`<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="1.7" data-icon="x" aria-hidden="true">`, "control"), /16\/20\/24/, "negative control: an 18px icon fails");
    assert.throws(() => auditIcons(`<svg width="16" height="16" stroke="currentColor" stroke-width="1.7" data-icon="x">`, "control"), /aria-hidden or a named img/, "negative control: an unlabelled visible icon fails");
    assert.throws(() => auditIcons(`<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.6" data-icon="x" aria-hidden="true">`, "control"), /1\.5-2/, "negative control: a 2.6 stroke fails");
    assert.throws(() => auditIcons(`<svg width="16" height="16" stroke="#fff" stroke-width="1.7" data-icon="x" aria-hidden="true">`, "control"), /currentColor/, "negative control: a fixed colour fails");
    ok("render audit: 5 negative controls caught");
  }
  // The side panels' close buttons are not rendered by the fixtures above: check their markup source.
  for (const name of ["EvidencePanel", "MemoryPanel", "SkillsPanel", "PublishPanel", "ReviewPanel"]) {
    const source = readFileSync(new URL(`${name}.tsx`, src), "utf8");
    assert.match(source, /aria-label="닫기"><ChatIcon kind="close" size=\{16\} \/><\/button>/, `${name}: close button draws the close icon under its Korean name`);
  }
  ok("panel close buttons: the icon is hidden and the button keeps its Korean name");
}
