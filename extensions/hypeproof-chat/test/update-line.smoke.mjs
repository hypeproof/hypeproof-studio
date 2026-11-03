// CGP-SHELL-D-001 (DES-SHELL-01, REQ-I17) — during class the update state is one quiet line in the
// chat panel, not a card and not a modal: ≤32px tall, ≥14px text, no animation, ≥4.5:1 in dark and
// light, and at 320px the verb is never truncated (the version ellipsizes first).
//   node --experimental-strip-types test/update-line.smoke.mjs
//
// Stylesheet-rule pattern of ui-polish-1: each clause is a function over the stylesheet text and
// also runs against a mutated copy that must fail (negative controls). The render half bundles the
// real ChatPanel with esbuild and renders it with react-dom/server.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readDesignFile } from "./lib/design-token-values.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = new URL("../webview-ui/src/", import.meta.url);
// Every stylesheet the webview imports, so a later rule in any of them is seen.
const FILES = readdirSync(SRC).filter((f) => f.endsWith(".css")).sort();
const real = Object.fromEntries(FILES.map((f) => [f, f === "designTokens.css" ? readFileSync(new URL(f, SRC), "utf8") : readDesignFile(new URL(f, SRC))]));
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
/** Last declaration of `prop` on an exact selector in the default media context. */
const value = (css, selector, prop) => {
  let v;
  for (const r of all(css)) if (r.media === "" && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};
/** Every rule (any file, any media) whose selector reaches the line or its children. */
const lineRules = (css) => all(css).filter((r) => r.selectors.some((s) => /\.hps-update-line\b/.test(s)));
const px = (v) => (/^-?\d+(\.\d+)?px$/.test(v ?? "") ? parseFloat(v) : NaN);
/** Block (first) and inline (second) values of a padding/margin shorthand. */
const sides = (v) => { const p = (v ?? "0").trim().split(/\s+/).map(px); return { block: p[0], inline: p.length > 1 ? p[1] : p[0], blockEnd: p.length > 2 ? p[2] : p[0], inlineEnd: p.length > 3 ? p[3] : p.length > 1 ? p[1] : p[0] }; };
const borderWidth = (v) => (v === undefined || v === "0" || v === "none" ? 0 : px((v.match(/(\d+(\.\d+)?px)/) ?? [])[1]));

const LINE = ".hps-update-line";
const VERSION = ".hps-update-line-version";
const VERB = ".hps-update-line-verb";
const ICON = 16; // ChatIcon size the line renders (asserted in the render half)
// Theme pairs the panel can sit on: the shipped HP theme read from its file, VS Code's own dark and
// light themes, and the HP Paper light palette (ui-philosophy §14).
const theme = readFileSync(new URL("../media/hypeproof-theme.json", import.meta.url), "utf8");
const themeColor = (key) => new RegExp(`"${key.replace(".", "\\.")}"\\s*:\\s*"(#[0-9A-Fa-f]{6})"`).exec(theme)?.[1];
const PAIRS = [
  [themeColor("foreground"), themeColor("sideBar.background"), "HP dark on the side bar"],
  [themeColor("foreground"), themeColor("editor.background"), "HP dark on the editor"],
  ["#CCCCCC", "#181818", "Dark Modern"], ["#CCCCCC", "#252526", "Dark+"],
  ["#3B3B3B", "#F8F8F8", "Light Modern"], ["#616161", "#F3F3F3", "Light+"], ["#151D19", "#F4F6F0", "HP Paper light"],
];
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Width of the verb at `size`: Hangul syllables a full em, spaces and punctuation 0.35em (wide side). */
const textWidth = (text, size) => [...text].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? size : /[ .,]/.test(ch) ? 0.35 * size : 0.6 * size), 0);
// The verb as rendered (checked against the real render below, so the copy and this budget agree).
const VERB_TEXT = "수업이 끝나면 설치할 수 있어요.";

const checks = {
  "height ≤ 32px, one line": (css) => {
    const bad = [];
    if (value(css, LINE, "box-sizing") !== "border-box") bad.push("content-box: padding and border add to the height");
    if (!(px(value(css, LINE, "max-height")) <= 32)) bad.push(`max-height ${value(css, LINE, "max-height")}`);
    const pad = sides(value(css, LINE, "padding"));
    const total = pad.block + pad.blockEnd + px(value(css, LINE, "line-height")) + 2 * borderWidth(value(css, LINE, "border"));
    if (!(total <= 32)) bad.push(`padding + line-height + border = ${total}px`);
    if (value(css, LINE, "flex-wrap") !== "nowrap") bad.push("the line may wrap to a second row");
    if (value(css, LINE, "white-space") !== "nowrap") bad.push("text may wrap inside the line");
    // Only the base rule sets the box; the spans may only repeat nowrap.
    for (const r of lineRules(css)) {
      if (r.media === "" && r.selectors.length === 1 && r.selectors[0] === LINE) continue;
      for (const p of ["display", "height", "min-height", "max-height", "line-height", "padding", "padding-block", "padding-top", "padding-bottom", "flex-wrap", "white-space", "word-break", "overflow-wrap"]) {
        if (r.decls[p] !== undefined && !(p === "white-space" && r.decls[p] === "nowrap")) bad.push(`${r.file} ${r.selectors.join(", ")} overrides ${p}: ${r.decls[p]}`);
      }
    }
    return bad;
  },
  "text ≥ 14px": (css) => {
    const bad = [];
    if (!(px(value(css, LINE, "font-size")) >= 14)) bad.push(`font-size ${value(css, LINE, "font-size")}`);
    for (const r of lineRules(css)) if (r.decls["font-size"] !== undefined && !(px(r.decls["font-size"]) >= 14)) bad.push(`${r.file} ${r.selectors.join(", ")} font-size ${r.decls["font-size"]}`);
    return bad;
  },
  "no animation": (css) => {
    const bad = [];
    if (value(css, LINE, "animation") !== "none") bad.push(`animation ${value(css, LINE, "animation")}`);
    if (value(css, LINE, "transition") !== "none") bad.push(`transition ${value(css, LINE, "transition")}`);
    for (const r of [...lineRules(css), ...all(css).filter((x) => x.selectors.includes(".hps-icon"))]) {
      for (const p of ["animation", "animation-name", "transition", "transition-property"]) if (r.decls[p] !== undefined && r.decls[p] !== "none") bad.push(`${r.file} ${r.selectors.join(", ")} ${p}: ${r.decls[p]}`);
    }
    return bad;
  },
  "contrast ≥ 4.5:1 in dark and light": (css) => {
    const bad = [];
    // Theme body text on the panel's own background: no tint, no fade, no muted token.
    if (value(css, LINE, "color") !== "var(--vscode-foreground, #F2F4E8)") bad.push(`color ${value(css, LINE, "color")}`);
    if (value(css, LINE, "background") !== "transparent") bad.push(`background ${value(css, LINE, "background")}`);
    for (const r of lineRules(css)) for (const p of ["color", "opacity", "filter", "background", "background-color", "mix-blend-mode"]) {
      if (r.decls[p] === undefined) continue;
      if (r.media.includes("forced-colors")) continue;
      if (r.media === "" && r.selectors.length === 1 && r.selectors[0] === LINE && (p === "color" || p === "background")) continue;
      bad.push(`${r.file} ${r.selectors.join(", ")} sets ${p}: ${r.decls[p]}`);
    }
    for (const [fg, bg, name] of PAIRS) if (!fg || !bg || contrast(fg, bg) < 4.5) bad.push(`${name} ${fg} on ${bg}`);
    return bad;
  },
  "fits 320px without truncating the verb": (css) => {
    const bad = [];
    if (value(css, VERB, "flex") !== "0 0 auto") bad.push(`verb flex ${value(css, VERB, "flex")} (may shrink)`);
    if (value(css, VERB, "white-space") !== "nowrap") bad.push("verb may wrap");
    for (const p of ["overflow", "text-overflow", "max-width", "width"]) if (value(css, VERB, p) !== undefined) bad.push(`verb sets ${p}`);
    if (value(css, VERSION, "min-width") !== "0") bad.push("version cannot shrink below its text");
    if (value(css, VERSION, "overflow") !== "hidden" || value(css, VERSION, "text-overflow") !== "ellipsis") bad.push("version does not ellipsize");
    if (!/^0 1 /.test(value(css, VERSION, "flex") ?? "")) bad.push(`version flex ${value(css, VERSION, "flex")} (does not give way first)`);
    const m = sides(value(css, LINE, "margin")), pad = sides(value(css, LINE, "padding"));
    const used = m.inline + m.inlineEnd + pad.inline + pad.inlineEnd + 2 * borderWidth(value(css, LINE, "border")) + ICON + 2 * px(value(css, LINE, "gap")) + textWidth(VERB_TEXT, px(value(css, LINE, "font-size")));
    if (!(used <= 320)) bad.push(`icon + verb + chrome need ${used.toFixed(0)}px at 320px`);
    return bad;
  },
};

const mutate = (file, from, to) => ({ ...real, [file]: real[file].replace(from, to) });
const NEGATIVE = [
  ["height", "content-box", mutate("styles.css", "box-sizing: border-box; display: flex; flex-wrap: nowrap;", "display: flex; flex-wrap: nowrap;")],
  ["height", "max-height 40px", mutate("styles.css", "max-height: 32px; margin: 6px 12px 0;", "max-height: 40px; margin: 6px 12px 0;")],
  ["height", "taller padding", mutate("styles.css", "margin: 6px 12px 0; padding: 4px 10px;", "margin: 6px 12px 0; padding: 8px 10px;")],
  ["height", "line wraps", mutate("styles.css", "display: flex; flex-wrap: nowrap; align-items: center; gap: 6px;", "display: flex; flex-wrap: wrap; align-items: center; gap: 6px;")],
  ["height", "version wraps to a second row", mutate("styles.css", "flex: 0 1 auto; min-width: 0; overflow: hidden;", "flex: 0 1 auto; min-width: 0; white-space: normal; overflow: hidden;")],
  ["height", "taller verb line", mutate("styles.css", ".hps-update-line-verb { flex: 0 0 auto;", ".hps-update-line-verb { line-height: 40px; flex: 0 0 auto;")],
  ["height", "personal override wraps the text", mutate("chatDetails.css", /$/, "\n.hps-shell .hps-update-line { white-space: normal; }\n")],
  ["text", "13px text", mutate("styles.css", "font-size: 14px; line-height: 22px; white-space: nowrap;", "font-size: 13px; line-height: 22px; white-space: nowrap;")],
  ["text", "12px verb", mutate("styles.css", ".hps-update-line-verb { flex: 0 0 auto;", ".hps-update-line-verb { font-size: 12px; flex: 0 0 auto;")],
  ["no animation", "animation removed", mutate("styles.css", "animation: none; transition: none;\n}\n.hps-update-line-version", "\n}\n.hps-update-line-version")],
  ["no animation", "pulsing line", mutate("styles.css", "animation: none; transition: none;\n}\n.hps-update-line-version", "animation: hp-pulse 1.4s infinite; transition: none;\n}\n.hps-update-line-version")],
  ["no animation", "spinning icon", mutate("styles.css", ".hps-update-line-verb {", ".hps-update-line .hps-icon { animation: hp-spin 1s linear infinite; }\n.hps-update-line-verb {")],
  ["contrast", "muted text", mutate("styles.css", "background: transparent; color: var(--vscode-foreground, #F2F4E8);", "background: transparent; color: var(--hp-muted);")],
  ["contrast", "faded line", mutate("styles.css", ".hps-update-line-verb {", ".hps-update-line { opacity: 0.6; }\n.hps-update-line-verb {")],
  ["contrast", "tinted background", mutate("styles.css", "background: transparent; color: var(--vscode-foreground, #F2F4E8);", "background: rgba(91,141,239,0.35); color: var(--vscode-foreground, #F2F4E8);")],
  ["fits", "verb shrinks", mutate("styles.css", ".hps-update-line-verb { flex: 0 0 auto;", ".hps-update-line-verb { flex: 0 1 auto;")],
  ["fits", "verb ellipsizes", mutate("styles.css", ".hps-update-line-verb { flex: 0 0 auto; white-space: nowrap; }", ".hps-update-line-verb { flex: 0 0 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }")],
  ["fits", "version does not shrink", mutate("styles.css", "flex: 0 1 auto; min-width: 0; overflow: hidden;", "flex: 0 1 auto; overflow: hidden;")],
  ["fits", "wide margins", mutate("styles.css", "max-height: 32px; margin: 6px 12px 0;", "max-height: 32px; margin: 6px 40px 0;")],
];
for (const [name, fn] of Object.entries(checks)) await check(`css ${name}`, () => assert.deepEqual(fn(real), [], fn(real).join("; ")));
for (const [key, label, css] of NEGATIVE) {
  const name = Object.keys(checks).find((n) => n.startsWith(key));
  await check(`negative control: ${label} → "${name}" fails`, () => {
    assert.ok(FILES.some((f) => css[f] !== real[f]), "mutation did not change any file");
    assert.ok(checks[name](css).length > checks[name](real).length, "the mutated stylesheet still passes");
  });
}
await check("positive control: the HP dark pair is read from the shipped theme", () => {
  assert.equal(themeColor("foreground"), "#F2F4E8");
  assert.ok(themeColor("sideBar.background") && themeColor("editor.background"));
});

// ─── render ─────────────────────────────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "hps-update-line-"));
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
  const update = (heldForClass, notes = "- 고친 점") => ({ version: "0.1.123", notes, releaseUrl: "https://example.org/r", sizeBytes: 180 * 1024 * 1024, heldForClass });
  const classConfig = (u) => ({ model: "m", hasToken: true, proxyUrl: "http://127.0.0.1/v1", coach: { name: "HypeProof", personality: "", configured: true },
    profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
    activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true }, update: u });
  const render = (config) => renderToStaticMarkup(h(ChatPanel, { ...PROPS, config }));
  const LINE_HTML = /<div class="hps-update-line" role="status">([\s\S]*?)<\/div>/;

  await check("render: in class the update state is one status line — icon, version, verb — and nothing to press", () => {
    const html = render(classConfig(update(true)));
    const line = LINE_HTML.exec(html)?.[1];
    assert.ok(line, "no update line in class");
    assert.match(line, /^<svg [^>]*width="16"[^>]*data-icon="upload"[^>]*aria-hidden="true">(?:(?!<\/svg>)[\s\S])*<\/svg><span class="hps-update-line-version">새 버전 v0\.1\.123<\/span><span class="hps-update-line-verb">([^<]+)<\/span>$/, "line shape");
    assert.equal(/hps-update-line-verb">([^<]+)</.exec(line)[1], VERB_TEXT, "the verb the width budget measures is the rendered verb");
    assert.ok(!/<button/.test(line), "a control inside the line");
    assert.ok(!html.includes("hps-update-banner"), "the multi-line card is still drawn in class");
    assert.ok(!html.includes("업데이트하면 자동으로 재시작됩니다."), "restart copy in class");
    assert.ok(!html.includes("자세히 보기") && !html.includes("고친 점"), "release-notes toggle in class");
    assert.ok(!/aria-modal|role="dialog"|role="alertdialog"/.test(html), "a modal in class");
  });
  await check("render (positive control): outside class the card keeps install, notes and dismiss", () => {
    const html = render(classConfig(update(false)));
    assert.ok(!LINE_HTML.test(html), "class line drawn outside class");
    for (const s of ["hps-update-banner-install", "hps-update-banner-dismiss", "자세히 보기", "업데이트하면 자동으로 재시작됩니다."]) assert.ok(html.includes(s), `${s} missing outside class`);
  });
  await check("render: no update, no line", () => {
    assert.ok(!render(classConfig(undefined)).includes("hps-update-line"), "line without an update");
  });
  console.error = consoleError;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failures.length) { console.error(`update-line: ${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`update-line: ${passed} passed`);
