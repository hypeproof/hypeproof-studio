import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";
// CGP-DS-R-005 (REQ-CGP-DS-04, DES-11) — hover and pressed fills derive from the foreground via
// color-mix; boundaries that identify a control never do.
//   1. the state tokens: every --hp-bg-*-hover|pressed role is the text colour or the control's own
//      foreground (currentColor) mixed into transparent; hover 8%, pressed 12–20%; no --hp-border-*
//      role is a color-mix;
//   2. every :hover/:active fill in the webview CSS is one of those four layers (or transparent):
//      no host hover colour, no literal, no opacity or filter change; DES-CGP-DS-36
//      transcript scrollbar thumbs explicitly use the host scrollbar palette instead;
//   3. every painted hover has a pressed rule of the same shape, later in the same file;
//   4. every field and secondary-button boundary is the fixed control token (never color-mix,
//      never the divider, never the host's input/panel border);
//   5. the control token measures ≥3:1 against every surface a control sits on — the HP palette,
//      Paper, the eight default VS Code themes, the notice tints, and the field's own fill.
//   node --experimental-strip-types test/hover-pressed-fills.smoke.mjs
//
// Each check is a function over the stylesheet texts, so it also runs against mutated copies that
// must fail (negative controls). The rule walker is the one in test/control-state-layers.smoke.mjs.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const FILES = readdirSync(SRC).filter((f) => f.endsWith(".css") && f !== "designTokens.css").sort();
const real = Object.fromEntries(FILES.map((f) => [f, readFileSync(new URL(f, SRC), "utf8")]));
assert.ok(FILES.length >= 11 && FILES.includes("tokens.css") && FILES.includes("taskWorkspace.css"), "every webview stylesheet is read");
let passed = 0;
const failures = [];
const check = (label, fn) => {
  try { fn(); passed++; console.log(`  ok   ${label}`); } catch (e) { failures.push(label); console.error(`  FAIL ${label}: ${e.message.split("\n")[0]}`); }
};

// ─── CSS rules with their media context and source order ───────────────────────────────────────
function splitTop(list, sep = ",") {
  const out = []; let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
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
      if (/^@(media|supports|container|layer)\b/.test(head)) walk(open + 1, j - 1, (media + " " + head).trim());
      else if (!head.startsWith("@")) {
        const decls = {};
        for (const d of splitTop(css.slice(open + 1, j - 1), ";")) { const k = d.indexOf(":"); if (k > 0) decls[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim(); }
        out.push({ selectors: splitTop(head).map((s) => s.replace(/\s+/g, " ").trim()), decls, media });
      }
      i = j;
    }
  };
  walk(0, css.length, "");
  return out;
}
const all = (css) => Object.entries(css).flatMap(([file, text]) => rules(text).map((r, index) => ({ ...r, file, index })));
/** Component rules a learner sees in the default rendering: not tokens.css, not forced colours. */
const component = (css) => all(css).filter((r) => r.file !== "tokens.css" && !/forced-colors/.test(r.media));
const noImportant = (v) => v.replace(/\s*!important\s*$/, "");

// ─── colour ─────────────────────────────────────────────────────────────────────────────────────
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => {
  const c = rgb(hex).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex2 = (n) => Math.round(n).toString(16).padStart(2, "0");
const over = ([r, g, b, a], under) => "#" + rgb(under).map((u, i) => hex2([r, g, b][i] * a + u * (1 - a))).join("").toUpperCase();
/** #RRGGBB or #RRGGBBAA → [r, g, b, a] */
const parseHex = (h) => [...rgb(h.slice(0, 7)), h.length === 9 ? parseInt(h.slice(7, 9), 16) / 255 : 1];
const parseRgba = (v) => { const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(v ?? ""); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
/** The colour a token falls back to once every host variable is absent. */
const hexOf = (value) => /#[0-9A-Fa-f]{6}\b/.exec(value ?? "")?.[0]?.toUpperCase();

// ─── 1. state tokens ────────────────────────────────────────────────────────────────────────────
const MIX = /^color-mix\(in srgb, (var\(--hp-text-[a-z]+-default\)|currentColor) (\d+(?:\.\d+)?)%, transparent\)$/;
const tokenScopes = (css) => rules(css["tokens.css"]).filter((r) => !r.media);
const tokenChecks = {
  "1 every hover/pressed fill role mixes a foreground into transparent (hover 8%, pressed 12–20%); no boundary role is a mix": (css) => {
    const bad = [];
    const scopes = tokenScopes(css);
    const root = scopes.filter((r) => r.selectors.includes(":root")).reduce((a, r) => ({ ...a, ...r.decls }), {});
    if (MIX.exec(root["--hp-bg-layer-hover"] ?? "")?.[1] !== "currentColor") bad.push(`:root --hp-bg-layer-hover is ${root["--hp-bg-layer-hover"]}, not the control's own foreground`);
    if (MIX.exec(root["--hp-bg-layer-pressed"] ?? "")?.[1] !== "currentColor") bad.push(`:root --hp-bg-layer-pressed is ${root["--hp-bg-layer-pressed"]}, not the control's own foreground`);
    for (const r of scopes) {
      for (const [k, v] of Object.entries(r.decls)) {
        if (/^--hp-bg-[\w-]+-(hover|pressed)$/.test(k)) {
          const m = MIX.exec(v);
          if (!m) { bad.push(`${r.selectors[0]} ${k} is "${v}", not a foreground mixed into transparent`); continue; }
          const share = Number(m[2]);
          if (k.endsWith("-hover") && share !== 8) bad.push(`${r.selectors[0]} ${k} is ${share}% (hover is 8%)`);
          if (k.endsWith("-pressed") && (share < 12 || share > 20)) bad.push(`${r.selectors[0]} ${k} is ${share}% (pressed is 12–20%)`);
        }
        if (/^--hp-border-/.test(k) && /color-mix/.test(v)) bad.push(`${r.selectors[0]} ${k} is a color-mix: a boundary never derives from the foreground`);
      }
    }
    return bad;
  },
};

// ─── 2. every pointer-state fill is a layer ─────────────────────────────────────────────────────
const LAYER = {
  hover: { control: "var(--hp-bg-control-hover)", image: "linear-gradient(var(--hp-bg-layer-hover), var(--hp-bg-layer-hover))" },
  active: { control: "var(--hp-bg-control-pressed)", image: "linear-gradient(var(--hp-bg-layer-pressed), var(--hp-bg-layer-pressed))" },
};
const stateOf = (r) => {
  const h = r.selectors.some((s) => /:hover\b/.test(s)), a = r.selectors.some((s) => /:active\b/.test(s));
  return h && a ? "both" : h ? "hover" : a ? "active" : null;
};
/** What a state rule paints: "control" (the D-003 layer as the fill), "image" (the layer over the
 * fill), "clear" (transparent / none), or null when it paints nothing. Throws a reason otherwise. */
function paintOf(r, state) {
  const d = r.decls, kinds = [];
  // DES-CGP-DS-36 is a browser scrollbar contract, not a button-fill exception.
  // Only the exact transcript thumb selector and prescribed state palette are admitted.
  if (r.file === "chatDetails.css" && r.selectors.length === 1 &&
      r.selectors[0] === `.hps-shell .hps-messages::-webkit-scrollbar-thumb:${state}`) {
    const expected = state === "hover"
      ? "var(--vscode-scrollbarSlider-hoverBackground, var(--vscode-scrollbarSlider-background, var(--hp-text-muted-default)))"
      : "var(--vscode-scrollbarSlider-activeBackground, var(--vscode-scrollbarSlider-hoverBackground, var(--hp-text-muted-default)))";
    if (d.background !== expected || d["background-color"] != null || d["background-image"] != null) throw new Error("scrollbar must use its host state palette");
    return "scrollbar";
  }
  for (const k of ["background", "background-color"]) {
    if (d[k] == null) continue;
    const v = noImportant(d[k]);
    if (v === LAYER[state].control) kinds.push("control");
    else if (/^(transparent|none)$/.test(v)) kinds.push("clear");
    else throw new Error(`${k}: ${v}`);
  }
  if (d["background-image"] != null) {
    const v = noImportant(d["background-image"]);
    if (v === LAYER[state].image) kinds.push("image");
    else if (v !== "none") throw new Error(`background-image: ${v}`);
  }
  return kinds.find((k) => k !== "clear") ?? (kinds.length ? "clear" : null);
}
const fillChecks = {
  "2 every :hover/:active fill is the text or own-foreground layer (no host hover colour, literal, opacity or filter)": (css) => {
    const bad = [];
    for (const r of component(css)) {
      const state = stateOf(r);
      if (!state) continue;
      const where = `${r.file}: ${r.selectors.join(", ").slice(0, 90)}`;
      if (state === "both") { if (["background", "background-color", "background-image"].some((k) => r.decls[k] != null)) bad.push(`${where} paints :hover and :active with one fill`); continue; }
      try { paintOf(r, state); } catch (e) { bad.push(`${where} ${state} paints ${e.message}`); }
      if (r.decls.filter != null) bad.push(`${where} changes filter on ${state}`);
      if (r.decls.opacity != null && Number(r.decls.opacity) < 1) bad.push(`${where} fades to opacity ${r.decls.opacity} on ${state}`);
    }
    return bad;
  },
  "3 every painted hover has a pressed rule of the same shape, later in the same file": (css) => {
    const bad = [];
    const list = component(css);
    for (const r of list) {
      if (stateOf(r) !== "hover") continue;
      let kind;
      try { kind = paintOf(r, "hover"); } catch { continue; } // check 2 reports it
      if (kind !== "control" && kind !== "image" && kind !== "scrollbar") continue;
      for (const s of r.selectors.filter((x) => /:hover\b/.test(x))) {
        const want = s.replace(/:hover\b/g, ":active");
        const ok = list.some((a) => a.file === r.file && a.index > r.index && a.media === r.media && a.selectors.includes(want) && (() => { try { return paintOf(a, "active") === kind; } catch { return false; } })());
        if (!ok) bad.push(`${r.file}: ${s} has no later ${want} painting the pressed ${kind} layer`);
      }
    }
    return bad;
  },
};

// ─── 3c. a resting rule never out-ranks the hover ───────────────────────────────────────────────
// A resting rule that sets the fill of the same control at a higher specificity silently wins over
// the shared hover (the personal chips and the classroom composer tools did). Each such resting
// rule must have a hover rule of the same element that wins (a link-styled control may win with
// `transparent`: it has no fill to layer).
const specificity = (s) => {
  const inner = s.replace(/::[\w-]+/g, " x").replace(/:(not|is|has)\(/g, " (").replace(/:where\([^()]*\)/g, "");
  const ids = (inner.match(/#[\w-]+/g) ?? []).length;
  const cls = (inner.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const types = (inner.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^()]*\))?/g, " ").match(/(^|[\s>+~(,])[a-z][\w-]*/gi) ?? []).length;
  return [ids, cls, types];
};
const cmpSpec = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const STATE_PSEUDO = /:(hover|active|enabled)\b|:not\(:disabled\)|:not\(\.hps-edit-save\)|:not\(\[aria-pressed="true"\]\)/g;
// main.tsx imports tokens.css, then styles.css, then chatDetails.css; other files have no fixed order
// against these, so an equal-specificity tie across them counts as lost.
const LOAD = ["tokens.css", "styles.css", "chatDetails.css"];
const beats = (h, r) => {
  const c = cmpSpec(h.spec, specificity(r.s));
  if (c !== 0) return c > 0;
  if (h.file === r.file) return h.index > r.index;
  return LOAD.includes(h.file) && LOAD.includes(r.file) && LOAD.indexOf(h.file) > LOAD.indexOf(r.file);
};
/** A resting selector in a state of its own (chosen, current, focused) is not the control at rest. */
const RESTING_STATE = /\[aria-(checked|pressed|current|expanded|selected)="true"\]|:checked|:focus/;
/** The control a selector names: its last compound's tag and classes; a bare tag (`.x button`) is named by the classes of the whole selector. */
const tagAndClasses = (s) => { const clean = s.replace(STATE_PSEUDO, ""); const last = lastCompound(clean); const own = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]); return { tag: /^[a-z]+/i.exec(last)?.[0] ?? "", classes: own.length ? own : [...clean.matchAll(/\.([\w-]+)/g)].map((m) => m[1]), whole: !own.length }; };
const cascadeChecks = {
  "3c no resting fill out-ranks the hover layer of the same control": (css) => {
    const bad = [];
    const list = component(css);
    const hovers = list.filter((r) => stateOf(r) === "hover" && (() => { try { return ["control", "image", "clear"].includes(paintOf(r, "hover")); } catch { return false; } })()).flatMap((r) => r.selectors.filter((s) => /:hover\b/.test(s)).map((s) => ({ s, file: r.file, index: r.index, media: r.media, ...tagAndClasses(s), spec: specificity(s) })));
    for (const r of list) {
      if (stateOf(r)) continue;
      if (r.decls.background == null && r.decls["background-color"] == null) continue;
      for (const s of r.selectors) {
        if (RESTING_STATE.test(lastCompound(s))) continue;
        const t = tagAndClasses(s);
        const all = [...s.replace(STATE_PSEUDO, "").matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
        const mine = hovers.filter((h) => h.classes.length && h.classes.every((c) => (h.whole ? all : t.classes).includes(c)) && (!h.tag || h.tag === t.tag) && (!h.media || h.media === r.media));
        if (!mine.length) continue;
        if (!mine.some((h) => beats(h, { s, file: r.file, index: r.index }))) bad.push(`${r.file}: resting ${s} out-ranks every hover of its control (${mine.map((h) => h.s).join(", ").slice(0, 80)})`);
      }
    }
    return bad;
  },
};

// ─── 3b. the two layers never stack ─────────────────────────────────────────────────────────────
// Lesson mode turns some filled controls quiet. If its quiet rule set only background-color, the
// filled control's own image layer would still be drawn on top: two layers, 16%/28%.
const classesOf = (s) => [...(lastCompound(s).replace(/:[\w-]+(\([^()]*(\([^()]*\))*[^()]*\))?/g, "").matchAll(/\.([\w-]+)/g))].map((m) => m[1]);
const stackChecks = {
  "3b a quiet layer on a control that also has a filled layer clears the image (background shorthand)": (css) => {
    const bad = [];
    const list = component(css);
    for (const state of ["hover", "active"]) {
      const imageClasses = new Set(list.filter((r) => stateOf(r) === state && noImportant(r.decls["background-image"] ?? "") === LAYER[state].image).flatMap((r) => r.selectors.flatMap(classesOf)));
      for (const r of list.filter((x) => stateOf(x) === state && x.decls["background-color"] != null && noImportant(x.decls["background-color"]) === LAYER[state].control && x.decls.background == null && x.decls["background-image"] == null)) {
        for (const sel of r.selectors) if (classesOf(sel).some((c) => imageClasses.has(c))) bad.push(`${r.file}: ${sel} sets only background-color, so the filled layer stacks under it`);
      }
    }
    return bad;
  },
};

// ─── 4. boundaries that identify a control ──────────────────────────────────────────────────────
const lastCompound = (s) => splitTop(s.replace(/\s*([>+~])\s*/g, " "), " ").pop() ?? "";
const CONTROL = /^(button|input|textarea|select)\b|\.(hp-cta-quiet|hps-btn-[\w-]+|hps-input|hps-chip|hps-cit-chip|hps-msg-retry|hps-naming-input|hps-naming-btn-ghost|hps-codepill-toggle|hps-error-banner-(report|dismiss)|hps-safety-dismiss|hps-fatal-btn-ghost|hps-update-banner-dismiss|hps-delegation-stop|hps-notify-optin-(input|submit)|hps-queued-send|hps-voice-retry|hps-world|hps-panel-fallback-retry|hps-instructor-model-input|tw-new|tw-quiet|studio-(secondary|choice|plan))(?![\w-])/;
const STATE_SEL = /:(hover|active|focus|focus-visible|focus-within|checked|disabled)|\[aria-(checked|pressed|current|expanded|selected|invalid)|\[data-(drag|expanded)|-drag\b/;
const boundaryColour = (v) => noImportant(v).replace(/^(?:var\(--ds-[\w-]+\)|[\d.]+px|0)\s+/, "").replace(/^(solid|dashed|dotted|double)\s+/, "").trim();
// Allowed resting boundaries besides the control token: none at all (a ghost control is named by its
// text), the text colour itself, the Primary's accent edge, the link colour on the accented gallery
// button (a text role, 4.5:1 in every theme: test/host-theme-mapping.smoke.mjs), and VS Code's
// button.border, which only the high-contrast themes set (to their contrast border).
const RESTING_OK = [/^var\(--hp-border-control-default\b/, /^(transparent|none|0|currentColor)$/i, /^var\(--hp-border-accent-default\)$/, /^var\(--vscode-button-border, ?transparent\)$/, /^var\(--vscode-textLink-foreground\b/];
const boundaryRules = (css) => component(css).flatMap((r) => ["border", "border-color"].filter((k) => r.decls[k] != null && !/^(0|none)\b/.test(r.decls[k])).flatMap((k) =>
  r.selectors.filter((s) => CONTROL.test(lastCompound(s))).map((s) => ({ ...r, s, k, colour: boundaryColour(r.decls[k]) }))));
const MUST = ['.hps-shell[data-chat-detail="personal"] .hps-input', ".hps-input textarea", ".hps-edit-box textarea", ".hps-naming-input", ".hps-model-selection select", ".hps-effort select",
  ".hps-access select", ".hps-access input", ".hps-notify-optin-input", ".tw-workspace input", ".local-review textarea", ".local-review select", ".hps-verdict-note textarea",
  ".hp-cta-quiet", ".tw-quiet", ".tw-new", ".hps-queued-send", ".hps-msg-retry", ".hps-naming-btn-ghost", ".hps-codepill-toggle", ".hps-chip", ".hps-btn-roll", ".hps-cit-chip",
  ".hps-error-banner-dismiss", ".hps-error-banner-report", ".hps-fatal-btn-ghost", ".hps-update-banner-dismiss", ".hps-safety-dismiss", ".hps-delegation-stop", ".hps-notify-optin-submit",
  ".hps-turn-review-actions button", ".hps-page-card-actions button", ".hps-edit-actions button", ".hps-panel-fallback-retry", ".hps-catchup button",
  '.hps-shell[data-chat-detail="personal"] .hps-reply-choices button', '.hps-shell[data-chat-detail="personal"] .hps-chip', ".hps-voice-actions button", ".hps-voice-retry", ".hps-world", ".hps-native-observation textarea", ".hps-publish-form input", ".hps-evidence-note textarea", '.hps-shell[data-chat-detail="personal"] .hps-cit-chip',
  ".tw-trash button", '.tw-source-list button[aria-pressed="true"]', ".hps-native-observation button", ".studio-secondary", ".studio-choice", ".studio-nav button", ".studio-connect input"];
const boundaryChecks = {
  "4 every field and secondary-button boundary is the fixed control token, and no control boundary is a color-mix": (css) => {
    const bad = [];
    const found = boundaryRules(css);
    for (const b of found) {
      if (/color-mix/.test(b.colour)) { bad.push(`${b.file}: ${b.s} ${b.k} is derived from the foreground (${b.colour})`); continue; }
      if (STATE_SEL.test(b.s)) continue;
      if (!RESTING_OK.some((re) => re.test(b.colour))) { bad.push(`${b.file}: ${b.s} ${b.k} is ${b.colour}`); continue; }
      // No boundary is fine for a ghost (transparent) control and for a Primary whose fill names it;
      // a secondary fill (#2C3C2B is 1.4:1 on the forest) with no boundary is not identifiable.
      const fillValue = noImportant(b.decls.background ?? b.decls["background-color"] ?? "transparent");
      if (/^(transparent|none|0)$|^var\(--vscode-button-border/i.test(b.colour) && !/^(transparent|none|inherit)$|^var\(--vscode-button-background\b|^var\(--hp-bg-accent-default\)$/.test(fillValue)) bad.push(`${b.file}: ${b.s} paints a secondary fill (${fillValue}) with no boundary`);
    }
    const ctl = new Set(found.filter((b) => /^var\(--hp-border-control-default\b/.test(b.colour)).map((b) => b.s));
    for (const s of MUST) if (!ctl.has(s)) bad.push(`${s} no longer draws its boundary with the control token`);
    return bad;
  },
};

// ─── 5. the control token against every surface ─────────────────────────────────────────────────
// Theme surfaces a control can sit on, from the explicit theme-defaults colours already recorded in
// test/host-theme-mapping.smoke.mjs: the editor, the side bar (the webview body), quick input
// (panels) and the field fill.
const THEMES = {
  "Light+": { kind: "light", "editor.background": "#FFFFFF", "sideBar.background": "#F3F3F3", "quickInput.background": "#F3F3F3", "input.background": "#FFFFFF" },
  "Light Modern": { kind: "light", "editor.background": "#FFFFFF", "sideBar.background": "#F8F8F8", "quickInput.background": "#F8F8F8", "input.background": "#FFFFFF" },
  "HC Light": { kind: "light", "editor.background": "#FFFFFF", "sideBar.background": "#FFFFFF", "quickInput.background": "#FFFFFF", "input.background": "#FFFFFF" },
  "2026 Light": { kind: "light", "editor.background": "#FFFFFF", "sideBar.background": "#FAFAFD", "quickInput.background": "#FAFAFD", "input.background": "#FFFFFF" },
  "Dark+": { kind: "dark", "editor.background": "#1E1E1E", "sideBar.background": "#252526", "quickInput.background": "#252526", "input.background": "#3C3C3C" },
  "Dark Modern": { kind: "dark", "editor.background": "#1F1F1F", "sideBar.background": "#181818", "quickInput.background": "#222222", "input.background": "#313131" },
  "HC Dark": { kind: "dark", "editor.background": "#000000", "sideBar.background": "#000000", "quickInput.background": "#0C141F", "input.background": "#000000" },
  "2026 Dark": { kind: "dark", "editor.background": "#121314", "sideBar.background": "#191A1B", "quickInput.background": "#202122", "input.background": "#191A1B" },
};
const LIGHT_BODY = "body.vscode-light, body.vscode-high-contrast-light";
const PAPER = '[data-surface="growth"], .hp-reflection';
function controlToken(css, scope) {
  const decl = tokenScopes(css).filter((r) => r.selectors.join(", ") === scope).map((r) => r.decls["--hp-border-control-default"]).filter(Boolean).pop();
  return decl;
}
/** The notice tints a secondary button sits on (the error and update banners). */
const tints = (css) => component(css).filter((r) => r.selectors.some((s) => /^\.hps-(error|update)-banner$/.test(s))).map((r) => parseRgba(r.decls.background ?? r.decls["background-color"])).filter((c) => c && c[3] < 1);
const measureChecks = {
  "5 the control boundary is ≥3:1 against every surface, notice tint and field fill, in the HP palette, Paper and the eight default themes": (css) => {
    const bad = [];
    const dark = hexOf(controlToken(css, ":root"));
    const light = hexOf(controlToken(css, LIGHT_BODY)) ?? dark;
    const paper = hexOf(controlToken(css, PAPER));
    const tw = Object.fromEntries(component(css).filter((r) => r.selectors.includes(".tw-workspace") && r.decls["--tw-panel"]).flatMap((r) => Object.entries(r.decls)).map(([k, v]) => [k, hexOf(v)]));
    const ts = tints(css);
    if (ts.length < 2) bad.push(`expected the error and update notice tints, found ${ts.length}`);
    if (!dark || !paper) return [...bad, "the control token has no colour"];
    // A notice tint lies over the page surfaces, never over a field's own fill.
    const surfaces = (base) => [...base, ...base.filter(([l]) => !/input|field/.test(l)).flatMap(([l, h]) => ts.map((t, i) => [`${l} under notice tint ${i + 1}`, over(t, h)]))];
    const root = Object.fromEntries(Object.entries(tokenScopes(css).filter((r) => r.selectors.includes(":root")).reduce((a, r) => ({ ...a, ...r.decls }), {})).map(([k, v]) => [k, hexOf(v)]));
    const hp = [["HP app", root["--hp-bg-app-default"]], ["HP panel", root["--hp-bg-panel-default"]], ["HP side bar", "#18231C"], ["HP field (input.background)", "#18231C"], ["personal panel", tw["--tw-panel"]], ["personal canvas", tw["--tw-canvas"]]];
    for (const [l, s] of surfaces(hp)) if (!s || !(ratio(dark, s) >= 3)) bad.push(`${dark} on ${l} ${s}: ${s ? ratio(dark, s).toFixed(2) : "?"}:1`);
    for (const [l, s] of [["Paper", "#F4F6F0"], ["white", "#FFFFFF"]]) if (!(ratio(paper, s) >= 3)) bad.push(`Paper ${paper} on ${l}: ${ratio(paper, s).toFixed(2)}:1`);
    for (const [name, t] of Object.entries(THEMES)) {
      const token = t.kind === "light" ? light : dark;
      const base = ["editor.background", "sideBar.background", "quickInput.background", "input.background"].map((k) => [`${name} ${k}`, t[k]]);
      for (const [l, s] of surfaces(base)) if (!(ratio(token, s) >= 3)) bad.push(`${token} on ${l} ${s}: ${ratio(token, s).toFixed(2)}:1`);
    }
    return bad;
  },
};

const checks = { ...tokenChecks, ...fillChecks, ...cascadeChecks, ...stackChecks, ...boundaryChecks, ...measureChecks };
for (const [label, fn] of Object.entries(checks)) check(label, () => { const bad = fn(real); assert.deepEqual(bad, [], bad.join("; ")); });

// ─── negative controls: each mutation must make its check fail ─────────────────────────────────
const mutate = (file, from, to) => {
  const text = real[file];
  assert.ok(text.split(from).length === 2, `negative control is stale: "${from.slice(0, 70)}" is not exactly once in ${file}`);
  return { ...real, [file]: text.replace(from, to) };
};
/** Replace `from` inside the first rule whose selector text is exactly `selector`. */
const mutateRule = (file, selector, from, to) => {
  const text = real[file];
  const at = text.search(new RegExp(`(^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`));
  assert.ok(at >= 0, `negative control is stale: rule ${selector} not in ${file}`);
  const end = text.indexOf("}", at + 1);
  const body = text.slice(at, end);
  assert.ok(body.includes(from), `negative control is stale: "${from}" not in ${selector}`);
  return { ...real, [file]: text.slice(0, at) + body.replace(from, to) + text.slice(end) };
};
const negatives = [
  ["1 ", "own-foreground hover layer at 12%", mutate("tokens.css", "  --hp-bg-layer-hover: color-mix(in srgb, currentColor 8%, transparent);\n  --hp-bg-layer-pressed: color-mix(in srgb, currentColor 14%, transparent);\n  --hp-bg-control-selected: var(--vscode-editor", "  --hp-bg-layer-hover: color-mix(in srgb, currentColor 12%, transparent);\n  --hp-bg-layer-pressed: color-mix(in srgb, currentColor 14%, transparent);\n  --hp-bg-control-selected: var(--vscode-editor")],
  ["1 ", "own-foreground layer replaced by a fixed surface", mutate("tokens.css", "  --hp-bg-layer-hover: color-mix(in srgb, currentColor 8%, transparent);\n  --hp-bg-layer-pressed: color-mix(in srgb, currentColor 14%, transparent);\n  --hp-bg-control-selected: var(--vscode-editor", "  --hp-bg-layer-hover: var(--vscode-list-hoverBackground, #253526);\n  --hp-bg-layer-pressed: color-mix(in srgb, currentColor 14%, transparent);\n  --hp-bg-control-selected: var(--vscode-editor")],
  ["1 ", "pressed own-foreground layer at 30%", mutate("tokens.css", "  --hp-bg-layer-pressed: color-mix(in srgb, currentColor 14%, transparent);\n  --hp-bg-control-selected: var(--vscode-editor", "  --hp-bg-layer-pressed: color-mix(in srgb, currentColor 30%, transparent);\n  --hp-bg-control-selected: var(--vscode-editor")],
  ["1 ", "control boundary derived from the text colour", (() => { const t = real["tokens.css"]; const i = t.indexOf("--hp-border-control-default:"); const j = t.indexOf(";", i); return { ...real, "tokens.css": t.slice(0, i) + "--hp-border-control-default: color-mix(in srgb, var(--hp-text-primary-default) 45%, transparent)" + t.slice(j) }; })()],
  ["2 ", "scrollbar hover replaced with the host button color", mutateRule("chatDetails.css", ".hps-shell .hps-messages::-webkit-scrollbar-thumb:hover", "var(--vscode-scrollbarSlider-hoverBackground, var(--vscode-scrollbarSlider-background, var(--hp-text-muted-default)))", "var(--vscode-button-hoverBackground)")],
  ["3 ", "scrollbar pressed rule removed", mutate("chatDetails.css", "  .hps-shell .hps-messages::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground, var(--vscode-scrollbarSlider-hoverBackground, var(--hp-text-muted-default))); }", "")],
  ["2 ", "copy answer back to the host list hover", mutate("chatDetails.css", ".hps-copy-answer:hover { background-color: var(--hp-bg-control-hover); }", ".hps-copy-answer:hover { background: var(--vscode-list-hoverBackground, #2b3037); }")],
  ["2 ", "fatal retry back to the host button hover", mutate("styles.css", ".hps-fatal-btn:hover { background-image: linear-gradient(var(--hp-bg-layer-hover), var(--hp-bg-layer-hover)); }", ".hps-fatal-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }")],
  ["2 ", "naming button back to an opacity hover", mutate("styles.css", ".hps-naming-btn:hover { background-image: linear-gradient(var(--hp-bg-layer-hover), var(--hp-bg-layer-hover)); }", ".hps-naming-btn:hover { opacity: 0.88; }")],
  ["2 ", "citation chip back to a brightness filter", mutate("styles.css", ".hps-cit-chip:hover {\n  background-image: linear-gradient(var(--hp-bg-layer-hover), var(--hp-bg-layer-hover));", ".hps-cit-chip:hover {\n  filter: brightness(1.15);")],
  ["2 ", "start primary back to a literal surface", mutate("start.css", ".studio-primary:hover:not(:disabled) { background-image: linear-gradient(var(--hp-bg-layer-hover), var(--hp-bg-layer-hover)); }", ".studio-primary:hover:not(:disabled) { background: #E2FF92; }")],
  ["2 ", "pressed rule paints the hover layer", mutate("taskWorkspace.css", ".tw-new:active:not(:disabled) { background-image: linear-gradient(var(--hp-bg-layer-pressed), var(--hp-bg-layer-pressed)); }", ".tw-new:active:not(:disabled) { background-image: linear-gradient(var(--hp-bg-layer-hover), var(--hp-bg-layer-hover)); }")],
  ["3 ", "copy answer pressed rule removed", mutate("chatDetails.css", ".hps-copy-answer:active { background-color: var(--hp-bg-control-pressed); }\n", "")],
  ["3 ", "fatal retry pressed rule removed", mutate("styles.css", ".hps-fatal-btn:active { background-image: linear-gradient(var(--hp-bg-layer-pressed), var(--hp-bg-layer-pressed)); }\n", "")],
  ["3 ", "personal reply choice pressed rule removed", mutate("chatDetails.css", '.hps-shell[data-chat-detail="personal"] .hps-reply-choices button:active { background-color: var(--hp-bg-control-pressed); }\n', "")],
  ["3 ", "pressed rule moved before its hover rule", (() => {
    const t = real["chatDetails.css"]; const a = ".hps-tool-trigger:active { background-color: var(--hp-bg-control-pressed); }\n"; const h = ".hps-tool-trigger:hover {";
    assert.ok(t.includes(a) && t.includes(h), "negative control is stale: tool trigger rules");
    const moved = t.replace(a, ""); const at = moved.indexOf(h); return { ...real, "chatDetails.css": moved.slice(0, at) + a + moved.slice(at) };
  })()],
  ["3c", "classroom composer tools lose their restated hover", mutate("styles.css", ".hps-input:not([data-expanded]) > .hps-composer-tools .hps-tool-trigger:hover, .hps-input:not([data-expanded]) .hps-tools-menu button:hover { background-color: var(--hp-bg-control-hover); }\n", "")],
  ["3c", "personal chips lose their restated hover", mutate("chatDetails.css", '.hps-shell[data-chat-detail="personal"] .hps-chip:hover:not(:disabled) { background-color: var(--hp-bg-control-hover); }\n', "")],
  ["3c", "personal reply choices lose their restated hover", mutate("chatDetails.css", '.hps-shell[data-chat-detail="personal"] .hps-reply-choices button:hover { background-color: var(--hp-bg-control-hover); }\n', "")],
  ["4 ", "world chips back on the panel border", mutateRule("styles.css", ".hps-world", "solid var(--hp-border-control-default)", "solid var(--vscode-panel-border, #444)")],
  ["4 ", "publish form fields lose their boundary", mutate("styles.css", ".hps-publish-form input, .hps-publish-form textarea, .hps-publish-form select { width: 100%; box-sizing: border-box; border: 1px solid var(--hp-border-control-default); }", ".hps-publish-form input, .hps-publish-form textarea, .hps-publish-form select { width: 100%; box-sizing: border-box; }")],
  ["3b", "lesson-mode quiet hover back to background-color only", mutateRule("styles.css", ".hps-shell:has(.hp-mission .hp-cta-primary) .hps-edit-actions .hps-edit-save:hover:not(:disabled)", "background: var(--hp-bg-control-hover);", "background-color: var(--hp-bg-control-hover);")],
  ["4 ", "selected source back on the panel border", mutateRule("taskWorkspace.css", '.tw-source-list button[aria-pressed="true"]', "border-color: var(--hp-border-control-default)", "border-color: var(--tw-line)")],
  ["4 ", "personal composer back on the panel border", mutate("chatDetails.css", "gap: 4px; padding: 8px; border: 1px solid var(--hp-border-control-default); border-radius: 22px;", "gap: 4px; padding: 8px; border: 1px solid var(--tw-line); border-radius: 22px;")],
  ["4 ", "classroom composer back on the host input border", mutateRule("styles.css", ".hps-input textarea", "solid var(--hp-border-control-default)", "solid var(--vscode-input-border, transparent)")],
  ["4 ", "quiet task button back on the panel border", mutateRule("taskWorkspace.css", ".tw-quiet", "solid var(--hp-border-control-default)", "solid var(--tw-line)")],
  ["4 ", "a secondary button boundary derived via color-mix", mutate("styles.css", ".hps-delegation-stop:hover {", ".hps-delegation-stop { border-color: color-mix(in srgb, currentColor 40%, transparent); }\n.hps-delegation-stop:hover {")],
  ["4 ", "error dismiss back on its white 15% line", mutateRule("styles.css", ".hps-error-banner-dismiss", "solid var(--hp-border-control-default)", "solid rgba(255,255,255,0.15)")],
  ["4 ", "voice buttons back to a secondary fill with no boundary", mutateRule("styles.css", ".hps-voice-actions button, .hps-voice-compact button, .hps-voice-head-buttons button, .hps-voice-resume button, .hps-voice-retry", "solid var(--hp-border-control-default)", "solid var(--vscode-button-border, transparent)")],
  ["5 ", "light host themes lose the Paper control boundary", mutateRule("tokens.css", "body.vscode-light, body.vscode-high-contrast-light", "--hp-border-control-default:", "--hp-unused-control-default:")],
  ["5 ", "control boundary back to the #35483A divider", (() => { const t = real["tokens.css"]; const i = t.indexOf("--hp-border-control-default:"); const j = t.indexOf(";", i); return { ...real, "tokens.css": t.slice(0, i) + "--hp-border-control-default: #35483A" + t.slice(j) }; })()],
];
for (const [prefix, label, css] of negatives) {
  const name = Object.keys(checks).find((k) => k.startsWith(prefix));
  check(`negative control fails: ${label}`, () => assert.notDeepEqual(checks[name](css), [], `${name} still passes`));
}

console.log(`hover-pressed-fills: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
