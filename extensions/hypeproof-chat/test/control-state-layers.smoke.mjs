import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";
// CGP-DS-D-003 (DES-CGP-DS-04) — state layers and the control boundary.
//   1. hover is the text colour at 8% over the surface; pressed is 12–20% on dark surfaces and
//      12–16% on light ones, in every scope that rebinds the text role (tokens.css);
//   2. every quiet control drawn with the control boundary paints those two layers on :hover and
//      :active, and nothing else (styles.css, start.css, chatDetails.css, refusalBanner.css);
//      while pressed under the pointer the pressed rule outranks every hover rule (specificity,
//      then order in the same file);
//   3. the secondary CTA boundary (.hp-cta-quiet, and the lesson-mode quiet Send/Run/Retry/…) is the
//      control-boundary token, ≥3:1 on #151D19, and never the old #35483A divider (1.75:1).
//   node --experimental-strip-types test/control-state-layers.smoke.mjs
//
// Each check is a function over the stylesheet text, so it also runs against mutated copies that
// must fail (negative controls). The rule walker is the one in test/ui-polish-1.smoke.mjs.
import assert from "node:assert/strict";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const FILES = ["tokens.css", "styles.css", "start.css", "chatDetails.css", "refusalBanner.css"];
const real = Object.fromEntries(FILES.map((f) => [f, readFileSync(new URL(f, SRC), "utf8")]));
let passed = 0;
const failures = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.message.split("\n")[0]}`); }
};

// ─── CSS rules with their media context ─────────────────────────────────────────────────────────
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
const all = (css) => Object.entries(css).flatMap(([file, text]) => rules(text).map((r, index) => ({ ...r, file, index })));
/** Selector specificity [ids, classes+attributes+pseudo-classes, types]; :not()/:is()/:has() count their argument. */
const specificity = (s) => {
  const inner = s.replace(/::[\w-]+/g, " x").replace(/:(not|is|has)\(/g, " (").replace(/:where\([^()]*\)/g, "");
  const ids = (inner.match(/#[\w-]+/g) ?? []).length;
  const cls = (inner.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const types = (inner.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^()]*\))?/g, " ").match(/(^|[\s>+~(,])[a-z][\w-]*/gi) ?? []).length;
  return [ids, cls, types];
};
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const fill = (decls) => decls["background-color"] ?? decls.background;

// ─── contrast ───────────────────────────────────────────────────────────────────────────────────
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => {
  const c = rgb(hex).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (top, alpha, under) => "#" + rgb(top).map((t, i) => Math.round(t * alpha + rgb(under)[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
/** The colour a token falls back to once every host variable is absent (the HP palette). */
const hexOf = (value) => /#[0-9A-Fa-f]{6}\b/.exec(value ?? "")?.[0];

// ─── 1. the state-layer tokens ──────────────────────────────────────────────────────────────────
const SCOPES = {
  ":root": { kind: "dark" },
  ".studio-start": { kind: "dark" },                   // branded screens: forest in every theme
  '[data-surface="growth"]': { kind: "light" },        // Paper reading surfaces
  "body.vscode-light": { kind: "light", pressedOnly: true }, // light host themes rebind the pressed share only
};
const LAYER = /^color-mix\(in srgb, var\(--hp-text-primary-default\) (\d+(?:\.\d+)?)%, transparent\)$/;
const tokenBlock = (css, scope) => rules(css["tokens.css"]).filter((r) => r.media === "" && r.selectors.includes(scope)).reduce((a, r) => ({ ...a, ...r.decls }), {});
const tokenChecks = {
  "1 hover is text at 8% and pressed text at 12–20% (dark) / 12–16% (light), over the surface": (css) => {
    const bad = [];
    for (const [scope, { kind, pressedOnly }] of Object.entries(SCOPES)) {
      const b = tokenBlock(css, scope);
      if (!pressedOnly) {
        const h = LAYER.exec(b["--hp-bg-control-hover"] ?? "");
        if (!h || Number(h[1]) !== 8) bad.push(`${scope}: hover is ${b["--hp-bg-control-hover"]}`);
      }
      const p = LAYER.exec(b["--hp-bg-control-pressed"] ?? "");
      const [lo, hi] = kind === "dark" ? [12, 20] : [12, 16];
      if (!p || Number(p[1]) < lo || Number(p[1]) > hi) bad.push(`${scope}: pressed is ${b["--hp-bg-control-pressed"]} (want ${lo}–${hi}% on a ${kind} surface)`);
    }
    return bad;
  },
};

// ─── 2. every quiet control paints both layers ─────────────────────────────────────────────────
/** Pressable controls (never fields) whose rule draws the control boundary on a transparent fill. */
const quietControls = (css) => {
  const out = new Set();
  for (const r of all(css)) {
    if (r.file === "tokens.css" || r.media) continue;
    const border = r.decls.border ?? r.decls["border-color"] ?? "";
    if (!/var\(--hp-border-control-default\b/.test(border) || !/^transparent\b/.test(fill(r.decls) ?? "")) continue;
    for (const s of r.selectors) if (!/\b(textarea|input|select|label)\b|:/.test(s.split(" ").pop())) out.add(s);
  }
  return [...out];
};
/** Rules (with the matching selector) that paint `selector` in a state. */
const stateRules = (css, selector, pseudo) => all(css).flatMap((r) => r.media ? [] : r.selectors.filter((s) => s.startsWith(selector + pseudo) && !s.slice((selector + pseudo).length).includes(" ")).map((s) => ({ ...r, s }))).filter((r) => fill(r.decls));
const statePaint = (css, selector, pseudo) => all(css).filter((r) => !r.media && r.selectors.some((s) => s.startsWith(selector + pseudo) && !s.slice((selector + pseudo).length).includes(" "))).map((r) => fill(r.decls)).filter(Boolean);
const coverageChecks = {
  "2a every quiet control paints the hover layer": (css) => quietControls(css).flatMap((s) => {
    const paints = statePaint(css, s, ":hover");
    return paints.length && paints.every((v) => v === "var(--hp-bg-control-hover)") ? [] : [`${s}:hover paints ${paints.join(" | ") || "nothing"}`];
  }),
  "2b every quiet control paints the pressed layer": (css) => quietControls(css).flatMap((s) => {
    const paints = statePaint(css, s, ":active");
    return paints.length && paints.every((v) => v === "var(--hp-bg-control-pressed)") ? [] : [`${s}:active paints ${paints.join(" | ") || "nothing"}`];
  }),
  "2d while pressed under the pointer, the pressed layer wins the cascade over the hover layer": (css) => quietControls(css).flatMap((s) => {
    // Both :hover and :active match during a press. The pressed rule must outrank every hover rule:
    // higher specificity, or equal specificity and later in the same file.
    const actives = stateRules(css, s, ":active");
    return stateRules(css, s, ":hover").filter((h) => !actives.some((a) => {
      const c = cmp(specificity(a.s), specificity(h.s));
      return c > 0 || (c === 0 && a.file === h.file && a.index > h.index);
    })).map((h) => `${h.s} (${h.file}) outranks every :active rule of ${s}`);
  }),
  "2c the family is the one the row names": (css) => {
    // A rename that drops a family out of quietControls() would make 2a/2b pass vacuously.
    const found = quietControls(css);
    const must = [".hp-cta-quiet", ".hps-shell:has(.hp-mission .hp-cta-primary) .hps-input .hps-btn-send", ".hps-shell:has(.hp-mission .hp-cta-primary) .hps-msg-run",
      ".studio-secondary", ".studio-choice", ".studio-plan", ".studio-nav button", ".hps-access button", ".hp-evidence-form button", ".hps-long-step-stop",
      ".hps-verdict-reason", ".hps-verdict-note-actions button", ".hps-refusal-banner button"];
    return must.filter((s) => !found.includes(s)).map((s) => `${s} is no longer a quiet control on the control boundary`);
  },
};

// ─── 3. the secondary CTA boundary ─────────────────────────────────────────────────────────────
const FOREST_BG = "#151D19";
const boundaryChecks = {
  "3 secondary CTA boundary is the control token, ≥3:1 on #151D19 and on the hover/pressed fill": (css) => {
    const bad = [];
    const root = tokenBlock(css, ":root");
    const token = hexOf(root["--hp-border-control-default"]);
    const ink = hexOf(root["--hp-text-primary-default"]);
    if (!token) return ["--hp-border-control-default has no colour"];
    if (/^#35483A$/i.test(token)) bad.push("the control boundary is still the #35483A divider");
    for (const [label, surface] of [["#151D19", FOREST_BG], ["panel", hexOf(root["--hp-bg-panel-default"])],
      ["hover over #151D19", over(ink, 0.08, FOREST_BG)], ["pressed over #151D19", over(ink, Number(LAYER.exec(root["--hp-bg-control-pressed"] ?? "")?.[1] ?? 100) / 100, FOREST_BG)]]) {
      if (!(ratio(token, surface) >= 3)) bad.push(`boundary ${token} on ${label} ${surface}: ${ratio(token, surface).toFixed(2)}:1`);
    }
    for (const s of [".hp-cta-quiet", ".hps-shell:has(.hp-mission .hp-cta-primary) .hps-input .hps-btn-send"]) {
      const r = all(css).filter((x) => !x.media && x.selectors.includes(s) && (x.decls.border || x.decls["border-color"])).pop();
      if (!/var\(--hp-border-control-default\)$/.test(r?.decls.border ?? r?.decls["border-color"] ?? "")) bad.push(`${s} border is ${r?.decls.border}`);
    }
    return bad;
  },
};

const checks = { ...tokenChecks, ...coverageChecks, ...boundaryChecks };
for (const [label, fn] of Object.entries(checks)) check(label, () => { const bad = fn(real); assert.deepEqual(bad, [], bad.join("; ")); });

// ─── negative controls: each mutation must make its check fail ─────────────────────────────────
const mutate = (file, from, to, all = false) => {
  const text = real[file];
  assert.ok(text.includes(from), `negative control is stale: "${from.slice(0, 60)}" not in ${file}`);
  return { ...real, [file]: all ? text.split(from).join(to) : text.replace(from, to) };
};
const negatives = [
  ["1 hover", "hover at 12% on :root", mutate("tokens.css", "--hp-bg-control-hover: color-mix(in srgb, var(--hp-text-primary-default) 8%", "--hp-bg-control-hover: color-mix(in srgb, var(--hp-text-primary-default) 12%")],
  ["1 hover", "hover back to the app background", (() => { const t = real["tokens.css"]; const i = t.indexOf("--hp-bg-control-hover"); const j = t.indexOf(";", i); return { ...real, "tokens.css": t.slice(0, i) + "--hp-bg-control-hover: var(--vscode-editor-background, #151D19)" + t.slice(j) }; })()],
  ["1 hover", "hover from the muted text", mutate("tokens.css", "var(--hp-text-primary-default) 8%, transparent", "var(--hp-text-muted-default) 8%, transparent")],
  ["1 hover", "pressed 24% on dark", mutate("tokens.css", "--hp-bg-control-pressed: color-mix(in srgb, var(--hp-text-primary-default) 14%", "--hp-bg-control-pressed: color-mix(in srgb, var(--hp-text-primary-default) 24%")],
  ["1 hover", "Paper pressed 18% (light cap is 16%)", (() => { const t = real["tokens.css"]; const i = t.indexOf('[data-surface="growth"]'); return { ...real, "tokens.css": t.slice(0, i) + t.slice(i).replace("--hp-bg-control-pressed: color-mix(in srgb, var(--hp-text-primary-default) 12%", "--hp-bg-control-pressed: color-mix(in srgb, var(--hp-text-primary-default) 18%") }; })()],
  ["1 hover", "light host pressed removed", mutate("tokens.css", "  --hp-bg-control-pressed: color-mix(in srgb, var(--hp-text-primary-default) 12%, transparent); /* CGP-DS-D-003: light surface */\n", "")],
  ["1 hover", "branded screens lose their own hover", (() => { const t = real["tokens.css"]; const i = t.indexOf(".studio-start, .studio-disconnected {"); return { ...real, "tokens.css": t.slice(0, i) + t.slice(i).replace(/  --hp-bg-control-hover: [^\n]*\n/, "") }; })()],
  ["2a every quiet control paints the hover layer", ".hp-cta-quiet hover removed", mutate("styles.css", ".hp-cta-quiet:hover:not(:disabled),\n", "")],
  ["2a every quiet control paints the hover layer", "lesson Send hover removed", mutate("styles.css", ".hps-shell:has(.hp-mission .hp-cta-primary) .hps-input .hps-btn-send:hover:not(:disabled),\n", "")],
  ["2a every quiet control paints the hover layer", "studio choice hover back to the app background", mutate("start.css", ".studio-choice:hover:enabled { background: var(--hp-bg-control-hover); }", ".studio-choice:hover:enabled { background: var(--hp-bg-app-default); }")],
  ["2a every quiet control paints the hover layer", "refusal banner hover removed", mutate("refusalBanner.css", ".hps-refusal-banner button:hover:not(:disabled) { background-color: var(--hp-bg-control-hover); }\n", "")],
  ["2a every quiet control paints the hover layer", "studio nav hover fill removed", mutate("start.css", ".studio-nav button:hover { background-color: var(--hp-bg-control-hover); ", ".studio-nav button:hover { ")],
  ["2b every quiet control paints the pressed layer", "studio pressed rule removed", mutate("start.css", ".studio-nav button:active, .studio-secondary:active:enabled, .studio-choice:active:enabled, .studio-plan:active:enabled { background: var(--hp-bg-control-pressed); }\n", "")],
  ["2b every quiet control paints the pressed layer", "quiet pressed paints hover", mutate("styles.css", "{ background: var(--hp-bg-control-pressed); }", "{ background: var(--hp-bg-control-hover); }")],
  ["2b every quiet control paints the pressed layer", "verdict pressed removed", mutate("chatDetails.css", ".hps-verdict-reason:active:not(:disabled):not([aria-pressed=\"true\"]), ", "")],
  ["2d while pressed", "studio pressed rule back before the choice/plan hover rules", (() => {
    const t = real["start.css"];
    const rule = t.slice(t.indexOf("/* CGP-DS-D-003 — pressed"), t.indexOf("{ background: var(--hp-bg-control-pressed); }\n") + "{ background: var(--hp-bg-control-pressed); }\n".length);
    assert.ok(rule.length > 40, "negative control is stale: start.css pressed rule");
    const moved = t.replace(rule, "");
    const at = moved.indexOf(".studio-secondary:hover:enabled");
    return { ...real, "start.css": moved.slice(0, at) + rule + moved.slice(at) };
  })()],
  ["2d while pressed", "verdict pressed loses its :not([aria-pressed]) weight", mutate("chatDetails.css", ".hps-verdict-reason:active:not(:disabled):not([aria-pressed=\"true\"])", ".hps-verdict-reason:active")],
  ["3 secondary CTA boundary", "control boundary back to #35483A", (() => { const t = real["tokens.css"]; const i = t.indexOf("--hp-border-control-default:"); const j = t.indexOf(";", i); return { ...real, "tokens.css": t.slice(0, i) + "--hp-border-control-default: #35483A" + t.slice(j) }; })()],
  ["3 secondary CTA boundary", "control boundary #6E8270 (the row's example, below 3:1 under the pressed fill)", (() => { const t = real["tokens.css"]; const i = t.indexOf("--hp-border-control-default:"); const j = t.indexOf(";", i); return { ...real, "tokens.css": t.slice(0, i) + "--hp-border-control-default: #6E8270" + t.slice(j) }; })()],
];
for (const [prefix, label, css] of negatives) {
  const name = Object.keys(checks).find((k) => k.startsWith(prefix));
  check(`negative control fails: ${label}`, () => assert.notDeepEqual(checks[name](css), [], `${name} still passes`));
}
// The quiet CTA drawn with the decorative line must fail check 3 and drop out of 2c.
{
  const t = real["styles.css"];
  const i = t.indexOf(".hp-cta-quiet {");
  const j = t.indexOf("}", i);
  const css = { ...real, "styles.css": t.slice(0, i) + t.slice(i, j).replace("var(--hp-border-control-default)", "var(--hp-border-divider-default)") + t.slice(j) };
  check("negative control fails: .hp-cta-quiet on the divider line", () => {
    assert.notDeepEqual(boundaryChecks[Object.keys(boundaryChecks)[0]](css), []);
    assert.notDeepEqual(coverageChecks["2c the family is the one the row names"](css), []);
  });
}

console.log(`control-state-layers: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
