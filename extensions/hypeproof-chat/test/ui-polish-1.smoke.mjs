import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";
// REQ-STUDIO-UI-POLISH-1 — four details of the personal trial chat that Jay saw in 2026.1020.0
// (dark theme, about 1420px wide), each locked here from the CSS and from a real render:
//   1. the "여기서 AI가 할 수 있는 일" card: in the chat column, a quiet surface, a 44px summary whose
//      focus ring hugs it, rows of mark · label · state word (no <strong>), always closed with a
//      one-line count;
//   2. the access line above the composer: the offline banner's notice surface (.hps-notice-caution);
//   3. the task heading: activity / run state / actions read as three groups;
//   4. the rail card: one state word, never "작업 중" next to "시작 전", and no ▶ symbol.
//   node --experimental-strip-types test/ui-polish-1.smoke.mjs
//
// The CSS checks are functions over the stylesheet text, so each one also runs against a mutated
// copy that must fail (negative controls). The render half bundles the real ChatPanel and
// TaskWorkspace with esbuild and renders them with react-dom/server.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = new URL("../webview-ui/src/", import.meta.url);
const FILES = ["styles.css", "chatDetails.css", "taskWorkspace.css"];
const real = Object.fromEntries(FILES.map((f) => [f, readFileSync(new URL(f, SRC), "utf8")]));
let passed = 0;
const failures = [];
const ok = (label) => { passed++; console.log(`  ok   ${label}`); };
// Every check runs and reports, so a red run names each broken fix, not only the first.
const check = async (label, fn) => { try { await fn(); ok(label); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.message.split("\n")[0]}`); } };

// ─── CSS: rules with their media context ────────────────────────────────────────────────────────
/** Split a selector list on commas outside parentheses (":has(a, b)" stays one selector). */
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
      if (/^@media\b/.test(head)) walk(open + 1, j - 1, head.replace(/^@media\s*/, ""));
      else if (!head.startsWith("@")) {
        const body = css.slice(open + 1, j - 1);
        const decls = {};
        for (const d of body.split(";")) { const k = d.indexOf(":"); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
        out.push({ selectors: splitTop(head).map((s) => s.replace(/\s+/g, " ").trim()), decls, media });
      }
      i = j;
    }
  };
  walk(0, css.length, "");
  return out;
}
const all = (css) => Object.entries(css).flatMap(([file, text]) => rules(text).map((r) => ({ ...r, file })));
/** Every declaration of `prop` on an exact selector (later wins), within one media context. */
const value = (css, selector, prop, media = "") => {
  let v;
  for (const r of all(css)) if (r.media === media && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};
const PERSONAL = '.hps-shell[data-chat-detail="personal"]';
const CARD = `${PERSONAL} .hp-ai-can-do`;
const COLUMN_GUTTER = "max(20px, calc((100% - var(--chat-column)) / 2))";
/** The inline (second) value of a margin/padding shorthand, splitting on whitespace outside parentheses. */
const inline = (shorthand) => {
  const parts = []; let depth = 0, cur = "";
  for (const ch of shorthand ?? "") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.length >= 2 ? parts[1] : parts[0];
};

const checks = {
  "1a card shares the chat column": (css) => {
    const bad = [];
    const area = value(css, `${PERSONAL} .hps-input-area`, "padding");
    const messages = value(css, `${PERSONAL} .hps-messages`, "padding");
    const margin = value(css, CARD, "margin");
    if (inline(area) !== COLUMN_GUTTER || inline(messages) !== COLUMN_GUTTER) bad.push(`column gutter moved: input ${area}, messages ${messages}`);
    if (inline(margin) !== COLUMN_GUTTER) bad.push(`card margin-inline is not the column gutter: ${margin}`);
    if (value(css, CARD, "box-sizing") !== "border-box") bad.push("card is not border-box (its border would widen it past the column)");
    // Narrow panes: the messages' own 18px gutter.
    const narrowMessages = inline(value(css, `${PERSONAL} .hps-messages`, "padding", "(max-width: 700px)"));
    const narrowCard = value(css, CARD, "margin-inline", "(max-width: 700px)");
    if (narrowCard !== narrowMessages) bad.push(`narrow card ${narrowCard} != messages ${narrowMessages}`);
    return bad;
  },
  "1b card is a quiet surface that clips nothing": (css) => {
    const bad = [];
    if (!/^1px solid var\(--tw-line\)$/.test(value(css, CARD, "border") ?? "")) bad.push(`border ${value(css, CARD, "border")}`);
    if (!value(css, CARD, "border-radius")) bad.push("no radius");
    if (value(css, CARD, "background") !== "var(--tw-panel)") bad.push(`background ${value(css, CARD, "background")}`);
    if (value(css, CARD, "overflow") !== "visible" || value(css, CARD, "max-height") !== "none") bad.push("card still scrolls, so it would clip the summary's 2px ring");
    const pad = parseFloat(value(css, CARD, "padding") ?? "0");
    if (!(pad >= 4)) bad.push(`inner padding ${pad}px leaves no room for the 2px ring + 2px offset`);
    return bad;
  },
  "1c summary is one 44px row": (css) => {
    const bad = [];
    const s = ".hp-ai-can-do > summary";
    if (value(css, s, "min-height") !== "44px") bad.push(`min-height ${value(css, s, "min-height")}`);
    if (value(css, s, "box-sizing") !== "border-box") bad.push("content-box: padding is added on top of 44px (the 64px box Jay saw)");
    if (value(css, s, "display") !== "flex" || value(css, s, "align-items") !== "center") bad.push("label is not centred in the row");
    if (value(css, s, "list-style") !== "none") bad.push("native marker still drawn");
    // No extra height: the label at the largest text step (14 + 4px, line-height 1.5) fits in 44px.
    const block = parseFloat((value(css, s, "padding") ?? "0").split(/\s+/)[0]);
    if (2 * block + 18 * 1.5 > 44) bad.push(`padding-block ${block}px makes the row taller than 44px at 아주 크게`);
    return bad;
  },
  "2 access line uses the notice surface": (css) => {
    const bad = [];
    const base = all(css).find((r) => r.selectors.includes(".hps-offline-banner") && r.decls["border-left"]);
    if (!base?.selectors.includes(".hps-notice-caution")) bad.push(".hps-notice-caution does not share the offline banner's rule");
    const forced = all(css).find((r) => r.media.includes("forced-colors") && r.selectors.includes(".hps-offline-banner"));
    if (!forced?.selectors.includes(".hps-notice-caution")) bad.push("forced colors: the notice edge is not repainted for .hps-notice-caution");
    if (value(css, ".hps-access-attention button", "min-height") !== "44px") bad.push("access action below 44px");
    return bad;
  },
  "3 heading has three groups": (css) => {
    const bad = [];
    const pill = ".tw-heading .tw-run-note:not(:empty)";
    if (!/^1px solid/.test(value(css, pill, "border") ?? "")) bad.push("run state is not a bordered pill");
    const dividers = all(css).filter((r) => r.selectors.some((x) => x.endsWith(".tw-sources-toggle::before")) && /1px solid/.test(r.decls["border-inline-start"] ?? ""));
    if (!dividers.length) bad.push("no divider before the actions");
    // Classroom: nothing precedes 자료 while idle, so an unconditional divider floats alone (verify N1).
    for (const r of dividers) for (const x of r.selectors) if (!/:has\([^)]*\.hps-activity-now/.test(x)) bad.push(`divider drawn without anything before 자료: ${x}`);
    if (!value(css, ".tw-heading .hps-activity-kind", "font-weight")) bad.push("activity kind has no weight of its own");
    const forced = all(css).find((r) => r.media.includes("forced-colors") && r.selectors.includes(`${pill}::before`));
    if (forced?.decls.background !== "CanvasText") bad.push("forced colors: the pill dot (a background) would vanish");
    return bad;
  },
  "3b narrow running heading keeps the kind and moves the name to the title": (css) => {
    const r = all(css).find((x) => x.media === "(max-width: 900px)" && x.selectors.includes(".tw-heading:has(.tw-run-note:not(:empty)) .hps-activity-name"));
    return r && r.decls["clip-path"] === "inset(50%)" && r.decls.position === "absolute" ? [] : ["below 900px a running heading still ellipsizes the track name"];
  },
  "1d quiet card text follows the theme at ≥4.5:1": (css) => {
    const bad = [];
    const token = value(css, ".hp-ai-can-do", "--hp-ai-can-do-muted");
    if (token !== "var(--vscode-descriptionForeground, var(--hp-text-muted-default))") bad.push(`muted token ${token}`);
    for (const sel of [".hp-ai-can-do-count", ".hp-ai-can-do > summary::before", '.hp-ai-can-do li[data-on="false"]']) {
      if (value(css, sel, "color") !== "var(--hp-ai-can-do-muted)") bad.push(`${sel} uses ${value(css, sel, "color")} (a dark-only colour is 2.05:1 on white)`);
    }
    // The values that token resolves to: harness light, VS Code Light+ and the HP dark fallback.
    for (const [fg, bg, name] of [["#626873", "#FFFFFF", "harness light"], ["#717171", "#FFFFFF", "Light+"], ["#ACB9A5", "#151D19", "HP dark"]]) {
      if (contrast(fg, bg) < 4.5) bad.push(`${name} ${contrast(fg, bg).toFixed(2)}:1`);
    }
    return bad;
  },
  "1e chevron is not read aloud": (css) => (value(css, ".hp-ai-can-do > summary::before", "content") === '"›" / ""' ? [] : ["the › is part of the summary's accessible name"]),
};
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mutate = (file, fn) => ({ ...real, [file]: fn(real[file]) });
const NEGATIVE = [
  ["1a", "card back at full width", mutate("chatDetails.css", (s) => s.replace("margin: 12px max(20px, calc((100% - var(--chat-column)) / 2)) 0;", "margin: 8px 12px;"))],
  ["1a", "card content-box", mutate("chatDetails.css", (s) => s.replace("box-sizing: border-box; max-height: none;", "max-height: none;"))],
  ["1b", "card scrolls again", mutate("chatDetails.css", (s) => s.replace("max-height: none; overflow: visible;", ""))],
  ["1c", "summary content-box (the 64px box)", mutate("styles.css", (s) => s.replace("flex-wrap: wrap; box-sizing: border-box; min-height: 44px;", "flex-wrap: wrap; min-height: 44px;"))],
  ["1c", "summary padding back at 10px", mutate("styles.css", (s) => s.replace("padding: 6px 8px; border-radius: 8px; list-style: none;", "padding: 10px 4px; border-radius: 8px; list-style: none;"))],
  ["2", "access line without the notice surface", mutate("styles.css", (s) => s.replace(".hps-offline-banner, .hps-notice-caution { margin", ".hps-offline-banner { margin"))],
  ["3", "divider on every heading (classroom stray line)", mutate("taskWorkspace.css", (s) => s.replace(".tw-workspace .tw-heading:has(.hps-activity-now, .hps-trial-left, .tw-run-note:not(:empty)) .tw-sources-toggle::before {", ".tw-workspace .tw-heading .tw-sources-toggle::before {"))],
  ["3b", "running heading ellipsizes the name again", mutate("taskWorkspace.css", (s) => s.replace("@media (max-width: 900px) {\n  .tw-heading:has(.tw-run-note:not(:empty)) .hps-activity-name", "@media (max-width: 900px) {\n  .tw-heading:has(.tw-run-note:not(:empty)) .hps-activity-kind"))],
  ["1d", "count back on the dark-only --hp-text-muted-default", mutate("styles.css", (s) => s.replace(".hp-ai-can-do-count { color: var(--hp-ai-can-do-muted); }", ".hp-ai-can-do-count { color: var(--hp-text-muted-default); }"))],
  ["1d", "classroom off rows back on --hp-text-muted-default", mutate("styles.css", (s) => s.replace('.hp-ai-can-do li[data-on="false"] { color: var(--hp-ai-can-do-muted); }', '.hp-ai-can-do li[data-on="false"] { color: var(--hp-text-muted-default); }'))],
  ["1e", "chevron read aloud", mutate("styles.css", (s) => s.replace('content: "›" / "";', 'content: "›";'))],
  ["3", "no divider", mutate("taskWorkspace.css", (s) => s.replace("border-inline-start: 1px solid var(--tw-line); pointer-events: none;", "pointer-events: none;"))],
];
for (const [name, fn] of Object.entries(checks)) await check(`css ${name}`, () => assert.deepEqual(fn(real), [], fn(real).join("; ")));
for (const [key, label, css] of NEGATIVE) {
  const name = Object.keys(checks).find((n) => n.startsWith(key + " "));
  await check(`negative control: ${label} → ${name} fails`, () => {
    // The mutation must actually apply (a stale search string proves nothing).
    assert.ok(FILES.some((f) => css[f] !== real[f]), "mutation did not change any file");
    assert.ok(checks[name](css).length > checks[name](real).length, "the mutated stylesheet still passes");
  });
}

// ─── render ─────────────────────────────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "hps-ui-polish-1-"));
try {
  const out = join(dir, "render.cjs");
  const WV = join(ROOT, "webview-ui/node_modules");
  await build({
    stdin: { contents: 'export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react"; export { ChatPanel } from "./webview-ui/src/ChatPanel"; export { TaskWorkspace } from "./webview-ui/src/TaskWorkspace"; export * as runState from "./src/taskRunState"; export { aiCapabilities } from "./src/aiCapabilities";', resolveDir: ROOT, loader: "tsx" },
    bundle: true, platform: "node", format: "cjs", outfile: out, write: true, external: ["vscode"], jsx: "automatic", logLevel: "error",
    alias: { react: join(WV, "react"), "react-dom": join(WV, "react-dom") }, nodePaths: [WV], loader: { ".css": "empty", ".svg": "empty" },
    banner: { js: "globalThis.window = globalThis.window ?? { acquireVsCodeApi: undefined, innerWidth: 1420, addEventListener() {}, removeEventListener() {} };" },
  });
  // SSR cannot run layout effects; that warning is not what this smoke measures.
  const consoleError = console.error;
  console.error = (...a) => { if (typeof a[0] === "string" && a[0].includes("useLayoutEffect does nothing on the server")) return; consoleError(...a); };
  const { renderToStaticMarkup, createElement: h, ChatPanel, TaskWorkspace, runState, aiCapabilities } = createRequire(import.meta.url)(out);
  const { TASK_RUN_STATE_LABELS, taskCountLine } = runState;

  const noop = () => {};
  const PROPS = { messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop, onSetToken: noop, onSettings: noop,
    onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop, onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, instructor: false };
  const UX = { coach: { naming_mode: "fixed", fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" }, suggestions: { initial: [], follow_up: [] },
    hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } }, retry_button: { enabled: false, show_counter: false } };
  const caps = aiCapabilities({ sdk_tools: { read: true, write: true, browser: true }, tools: { web_search: true } }, "agent-sdk");
  const view = { scope: "s", revision: 1, activeTaskId: "t1", sourceSelection: null, tasks: [{ id: "t1", title: "새 작업", createdAt: 1, updatedAt: 1_700_000_000_000, messageCount: 0 }] };
  const config = (extra = {}) => ({ model: "m", hasToken: true, proxyUrl: "http://127.0.0.1/v1", coach: { name: "HypeProof", personality: "", configured: true },
    profile: { profile_id: "studio-native-trial", activity_kind: "trial", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
    activity: { id: "a1", name: "Studio · 내 삶에 AI 더하기", kind: "trial", free: true, workspace: "/tmp/w", verified: true }, aiCapabilities: caps, ...extra });
  const panel = (extra) => renderToStaticMarkup(h(ChatPanel, { ...PROPS, config: config(extra) }));
  const personal = panel({ taskWorkspace: view, access: { status: "unknown" } });

  await check("render 1: closed card, 6가지 중 4가지 summary, six rows of mark · label · one state word, no <strong>", () => {
  const card = /<details class="hp-rail-lesson hp-ai-can-do">[\s\S]*?<\/details>/.exec(personal)?.[0] ?? "";
  assert.ok(card, "card missing in the personal chat");
  assert.ok(!/<details[^>]*\bopen\b/.test(card.slice(0, 80)), "card is drawn open");
  assert.ok(card.includes('<span class="hp-ai-can-do-title">여기서 AI가 할 수 있는 일</span><span class="hp-ai-can-do-count">6가지 중 4가지<span class="hp-ai-can-do-more"> · 자세히</span></span>'), "one-line summary with the count");
  assert.ok(!card.includes("<strong"), "raw bold state words");
  const rows = [...card.matchAll(/<li data-capability="(\w+)" data-on="(true|false)" aria-label="[^"]+">([\s\S]*?)<\/li>/g)];
  assert.equal(rows.length, 6, "six rows");
  for (const [, key, on, body] of rows) {
    assert.match(body, /^<span class="hp-ai-can-do-mark"><svg [^>]*data-icon="(?:check|minus|info)"[^>]*aria-hidden="true">(?:(?!<\/svg>)[\s\S])*<\/svg><\/span><span class="hp-ai-can-do-label">[^<]+<\/span><span class="hp-ai-can-do-state">(해요|안 해요|물어봐요)<\/span>$/, `${key}: row shape`);
    assert.equal(/state">안 해요</.test(body), on === "false", `${key}: state word disagrees with data-on`);
    assert.equal(/state">물어봐요</.test(body), key === "browser", `${key}: conditional browser confirmation`);
  }
  });
  await check("render 1: the browser row says 해요 on the proxy runtime, where the browser loop has no approval modal (control: agent-sdk asks)", () => {
  const stateOf = (rows, key) => {
    const card = /<details class="hp-rail-lesson hp-ai-can-do">[\s\S]*?<\/details>/.exec(panel({ taskWorkspace: view, aiCapabilities: rows }))?.[0] ?? "";
    return new RegExp(`data-capability="${key}"[\\s\\S]*?hp-ai-can-do-state">([^<]+)<`).exec(card)?.[1];
  };
  const grants = { sdk_tools: { read: true, write: true, shell: true, browser: true }, tools: { web_search: true }, browser_control: { enabled: true } };
  assert.equal(stateOf(aiCapabilities(grants, "agent-sdk"), "browser"), "물어봐요", "control: agent-sdk browser asks");
  assert.equal(stateOf(aiCapabilities(grants, "proxy"), "browser"), "해요", "proxy browser auto-runs");
  });
  await check("render 1: a seat with no capability reads 지금은 없음 (never 0가지)", () => {
  const none = panel({ taskWorkspace: view, aiCapabilities: aiCapabilities(null, "proxy") });
  assert.ok(none.includes('<span class="hp-ai-can-do-count">지금은 없음'), "a seat with nothing on says so instead of 0가지");
  });

  await check("render 2: the access line carries the notice class; none outside the personal chat or without a problem (negative controls)", () => {
  assert.ok(personal.includes('<div class="hps-notice-caution hps-access-attention" role="status"><span>이용권 상태를 확인해 주세요.</span><button type="button">이용권 확인</button></div>'), "access line is not a notice");
  assert.ok(!panel({ access: { status: "unknown" } }).includes("hps-access-attention"), "classroom shell drew the personal access line");
  assert.ok(!panel({ taskWorkspace: view }).includes("hps-access-attention"), "access line without an access problem");
  });

  // 4 — one state word on the rail card.
  const STATE_WORDS = ["시작 전", ...Object.values(TASK_RUN_STATE_LABELS).map((l) => l.label)];
  const railCard = (runState, messageCount = 0) => {
    const html = renderToStaticMarkup(h(TaskWorkspace, { view: { ...view, tasks: [{ ...view.tasks[0], messageCount }] }, messages: [], busy: runState === "running", error: null, runState, onDismissError: noop }, h("div")));
    const at = html.indexOf('class="tw-task"');
    const button = html.slice(at, html.indexOf("</button>", at));
    return button.replace(/<[^>]+>/g, "\n");
  };
  await check("render 4: every state × {0, 3} messages shows at most one state word; 시작 전 only when idle; no ▶", () => {
  for (const state of [null, ...Object.keys(TASK_RUN_STATE_LABELS)]) {
    for (const count of [0, 3]) {
      const text = railCard(state, count);
      const words = STATE_WORDS.filter((w) => text.split("\n").some((line) => line.trim() === w));
      assert.ok(words.length <= 1, `${state ?? "no state"}, ${count} messages: ${words.join(" + ")}`);
    }
  }
  assert.ok(railCard(null, 0).includes("시작 전"), "positive control: an idle empty task still says 시작 전");
  assert.ok(railCard("running", 0).includes("작업 중") && !railCard("running", 0).includes("시작 전"), "running empty task");
  assert.equal(taskCountLine?.(3, "running"), "대화 3", "taskCountLine");
  // REQ-STUDIO-STROKE-ICONS: run states draw stroke icons; none is the play triangle.
  assert.ok(!Object.values(TASK_RUN_STATE_LABELS).some((l) => l.icon === "play" || l.symbol === "▶"), "a state still uses ▶");
  });
  console.error = consoleError;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failures.length) { console.error(`ui-polish-1: ${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`ui-polish-1: ${passed} passed`);
