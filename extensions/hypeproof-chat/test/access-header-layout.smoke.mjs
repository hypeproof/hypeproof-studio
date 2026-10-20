// CGP-SHELL-R-029 (REQ-L9) — the remaining-requests line in the chat header at narrow widths.
// At 320-640px the line must take a row of its own under the heading row, so the "…" menu (personal
// task heading) or the actions (classroom header, DEC-35 class seats) stay on the first row and the
// title truncates instead. Without these rules the 320px heading grows to four lines and the menu is
// pushed out of the pane (verify round 2: line box 90x84, horizontal overflow).
//   node --experimental-strip-types test/access-header-layout.smoke.mjs
//
// Same instrument as test/ui-polish-1.smoke.mjs: the CSS checks are functions over the stylesheet
// text with each rule's media context, and each one also runs against a mutated copy that must fail
// (negative controls). The render half bundles the real ChatPanel and checks the markup the
// selectors rely on. Real layout (menu on the title row, no overflow at 320px) needs a browser and
// is measured outside this smoke.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS_FILE = new URL("../webview-ui/src/styles.css", import.meta.url);
const real = readFileSync(CSS_FILE, "utf8");
let passed = 0;
const failures = [];
const check = async (label, fn) => {
  try { await fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.message.split("\n")[0]}`); }
};

// ─── CSS: rules with their media context ────────────────────────────────────────────────────────
function splitTop(list) {
  const out = []; let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
}
function rules(raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= to) return;
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
      if (/^@media\b/.test(head)) walk(open + 1, j - 1, head.replace(/^@media\s*/, "").replace(/\s+/g, " ").replace(/:\s*/g, ": "));
      else if (!head.startsWith("@")) {
        const decls = {};
        for (const d of css.slice(open + 1, j - 1).split(";")) { const k = d.indexOf(":"); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim().replace(/\s+/g, " "); }
        out.push({ selectors: splitTop(head).map((s) => s.replace(/\s+/g, " ").trim()), decls, media });
      }
      i = j;
    }
  };
  walk(0, css.length, "");
  return out;
}
/** The last declaration of `prop` on an exact selector within one media context (later wins). */
const value = (css, selector, prop, media = "") => {
  let v;
  for (const r of rules(css)) if (r.media === media && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};
const NARROW = "(max-width: 640px)";
const LINE = ".hps-access-header";
const TW = ".tw-heading:has(.hps-access-header)";
const HDR = ".hps-header:has(> .hps-access-header)";
/** flex shorthand → [grow, shrink, basis]. */
const flex = (v) => (v ?? "").split(" ");

const checks = {
  "1 the line never shrinks below its longest part and wraps only between parts": (css) => {
    const bad = [];
    const [, shrink] = flex(value(css, LINE, "flex"));
    if (value(css, LINE, "flex") === undefined || shrink === "0") bad.push(`line flex ${value(css, LINE, "flex")}: it must be able to give way`);
    if (value(css, LINE, "min-width") !== "min-content") bad.push(`line min-width ${value(css, LINE, "min-width")} (not min-content: a part would be cut)`);
    if (value(css, LINE, "white-space") !== "normal") bad.push(`line white-space ${value(css, LINE, "white-space")} (nowrap: one row wider than the pane)`);
    if (value(css, ".hps-access-part", "white-space") !== "nowrap") bad.push("a part can break inside itself (\"남은 요청\" / \"37회\")");
    return bad;
  },
  "2 personal heading at ≤640px: the line gets its own row, the activity yields first": (css) => {
    const bad = [];
    if (value(css, TW, "flex-wrap", NARROW) !== "wrap") bad.push("the task heading does not wrap, so the line squeezes the title and menu");
    if (value(css, `${TW} ${LINE}`, "order", NARROW) !== "3") bad.push(`line order ${value(css, `${TW} ${LINE}`, "order", NARROW)} (not after the menu)`);
    const [grow, , basis] = flex(value(css, `${TW} ${LINE}`, "flex", NARROW));
    if (grow !== "1" || basis !== "100%") bad.push(`line flex ${value(css, `${TW} ${LINE}`, "flex", NARROW)} (not a full row)`);
    const [, , activityBasis] = flex(value(css, `${TW} .hps-activity-now`, "flex", NARROW));
    if (activityBasis !== "0") bad.push(`current activity basis ${activityBasis ?? "unset"} (its text width pushes the menu off the first row)`);
    return bad;
  },
  "3 classroom header at ≤640px: the line gets its own row under the coach name and actions": (css) => {
    const bad = [];
    if (value(css, HDR, "flex-wrap", NARROW) !== "wrap") bad.push("the classroom header does not wrap (the coach name is squeezed to one letter)");
    if (value(css, `.hps-header > ${LINE}`, "order", NARROW) !== "3") bad.push("classroom line is not after the actions");
    const [grow, , basis] = flex(value(css, `.hps-header > ${LINE}`, "flex", NARROW));
    if (grow !== "1" || basis !== "100%") bad.push(`classroom line flex ${value(css, `.hps-header > ${LINE}`, "flex", NARROW)} (not a full row)`);
    return bad;
  },
};

const NARROW_BLOCK = /@media \(max-width: 640px\) \{\n  \.tw-heading:has\(\.hps-access-header\)[\s\S]*?\n\}/;
const NEGATIVE = [
  ["2", "c01 the whole @media (max-width:640px) block deleted", (s) => s.replace(NARROW_BLOCK, "")],
  ["3", "c01 the whole @media (max-width:640px) block deleted", (s) => s.replace(NARROW_BLOCK, "")],
  ["2", "c02 activity-chip zero basis dropped", (s) => s.replace("  .tw-heading:has(.hps-access-header) .hps-activity-now { flex: 1 1000 0; }\n", "")],
  ["1", "c03 line made flex:0 0 auto; nowrap", (s) => s.replace(".hps-access-header { flex: 0 1 auto; min-width: min-content; white-space: normal;", ".hps-access-header { flex: 0 0 auto; white-space: nowrap;")],
  ["1", "c04 .hps-access-part nowrap dropped", (s) => s.replace(".hps-access-part { white-space: nowrap; }", "")],
  ["2", "personal heading no longer wraps", (s) => s.replace(".tw-heading:has(.hps-access-header) { flex-wrap: wrap; row-gap: 0; }", ".tw-heading:has(.hps-access-header) { row-gap: 0; }")],
  ["2", "line shares the first row (no full basis)", (s) => s.replace(".tw-heading:has(.hps-access-header) .hps-access-header { order: 3; flex: 1 1 100%;", ".tw-heading:has(.hps-access-header) .hps-access-header { order: 3; flex: 0 1 auto;")],
  ["3", "classroom header rules dropped", (s) => s.replace("  .hps-header:has(> .hps-access-header) { flex-wrap: wrap; row-gap: 2px; }\n", "")],
  ["3", "classroom line not a full row", (s) => s.replace(".hps-header > .hps-access-header { order: 3; flex: 1 1 100%; }", ".hps-header > .hps-access-header { order: 3; }")],
  ["2", "narrow rules moved to a narrower breakpoint (max-width: 400px)", (s) => s.replace("@media (max-width: 640px) {\n  .tw-heading:has(.hps-access-header)", "@media (max-width: 400px) {\n  .tw-heading:has(.hps-access-header)")],
];
for (const [name, fn] of Object.entries(checks)) await check(`css ${name}`, () => assert.deepEqual(fn(real), [], fn(real).join("; ")));
for (const [key, label, mutate] of NEGATIVE) {
  const name = Object.keys(checks).find((n) => n.startsWith(key + " "));
  await check(`negative control: ${label} → css ${name.split(" ").slice(0, 3).join(" ")}… fails`, () => {
    const css = mutate(real);
    assert.notEqual(css, real, "mutation did not change the stylesheet (a stale search string proves nothing)");
    assert.ok(checks[name](css).length > checks[name](real).length, "the mutated stylesheet still passes");
  });
}

// ─── render: the markup the selectors rely on ───────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "hps-access-header-layout-"));
try {
  const out = join(dir, "render.cjs");
  const WV = join(ROOT, "webview-ui/node_modules");
  await build({
    stdin: { contents: 'export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react"; export { ChatPanel } from "./webview-ui/src/ChatPanel";', resolveDir: ROOT, loader: "tsx" },
    bundle: true, platform: "node", format: "cjs", outfile: out, write: true, external: ["vscode"], jsx: "automatic", logLevel: "error",
    alias: { react: join(WV, "react"), "react-dom": join(WV, "react-dom") }, nodePaths: [WV], loader: { ".css": "empty", ".svg": "empty" },
    banner: { js: "globalThis.window = globalThis.window ?? { acquireVsCodeApi: undefined, innerWidth: 320, addEventListener() {}, removeEventListener() {} };" },
  });
  const consoleError = console.error;
  console.error = (...a) => { if (typeof a[0] === "string" && a[0].includes("useLayoutEffect does nothing on the server")) return; consoleError(...a); };
  const { renderToStaticMarkup, createElement: h, ChatPanel } = createRequire(import.meta.url)(out);
  const noop = () => {};
  const PROPS = { messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop, onSetToken: noop, onSettings: noop,
    onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop, onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, instructor: false };
  const UX = { coach: { naming_mode: "fixed", fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" }, suggestions: { initial: [], follow_up: [] },
    hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } }, retry_button: { enabled: false, show_counter: false } };
  const access = (source_kind) => ({ status: "ready", selected: "src-1", view: { schema: "hps-access-view/1", configured: true, as_of: "2026-10-20T06:42:00Z", choices: [{
    id: "src-1", label: "이용권", source_kind, mode: "included", active: true, available: true, state: "ready", ends_at: 1, can_request: false,
    allowed: { models: [], efforts: [], features: [], runtimes: [] }, resources: [{ meter: "requests:count", remaining: 37, held: 3, unresolved: 2, spent: 10, limit: 50, overrun: 0, shared: false }] }] } });
  const classroom = { model: "m", hasToken: true, proxyUrl: "http://127.0.0.1/v1", coach: { name: "HypeProof", personality: "", configured: true },
    profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
    activity: { id: "c1", name: "수업", kind: "classroom", workspace: "/tmp/c", verified: true }, access: access("cohort") };
  /** Tag depth of the first element with `cls`, counted from the opening of `<header class="hps-header">`. */
  const depthInHeader = (html, cls) => {
    const start = html.indexOf('<header class="hps-header">');
    assert.ok(start >= 0, "no chat header");
    let depth = 0;
    for (const m of html.slice(start).matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/g)) {
      if (m[1]) { depth--; if (depth === 0) return -1; continue; }
      depth++;
      if (new RegExp(`class="[^"]*\\b${cls}\\b`).test(m[3])) return depth - 1;
      if (m[4] || /^(input|img|br|hr|meta|link|source|path|circle|rect|line|polyline)$/.test(m[2])) depth--;
    }
    return -1;
  };
  await check("render: in a classroom (DEC-35 class seat) the line is a direct child of the header, as `.hps-header > .hps-access-header` needs", () => {
    const html = renderToStaticMarkup(h(ChatPanel, { ...PROPS, config: classroom }));
    assert.ok(html.includes('title="수업·기관 지원 · 남은 요청 37회 · '), "classroom with class funding shows no line");
    assert.equal(depthInHeader(html, "hps-access-header"), 1, "the line is not a direct child of <header class=\"hps-header\">");
    // Control: the instrument finds a nested element at depth > 1.
    assert.ok(depthInHeader(html, "hps-access-part") > 1, "control: a part is nested inside the line");
  });
  console.error = consoleError;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failures.length) { console.error(`access-header-layout: ${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`access-header-layout: ${passed} passed`);
