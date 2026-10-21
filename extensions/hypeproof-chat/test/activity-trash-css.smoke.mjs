// CGP-KNOW-D-013 (DES-KNOW-24) — the visual clauses of the activity trash, read from the stylesheet
// rules (the ui-polish-1 pattern): 되돌리기 and every trash control are 44px targets, the trash text
// stays on the caption step (the personal chat's 14px floor), the focus ring is the workspace's
// 2px ring, and forced colours keep every control's border. Each check also runs against a mutated
// copy of the stylesheet that must fail (negative controls).
//   node --experimental-strip-types test/activity-trash-css.smoke.mjs
import assert from "node:assert/strict";
import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";

const css = readFileSync(new URL("../webview-ui/src/taskWorkspace.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../webview-ui/src/tokens.css", import.meta.url), "utf8");

/** Rules with their @media context; selector lists split on top-level commas. */
function rules(raw) {
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const walk = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= to) return;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < to && depth; j++) depth += text[j] === "{" ? 1 : text[j] === "}" ? -1 : 0;
      if (/^@media\b/.test(head)) walk(open + 1, j - 1, head.replace(/^@media\s*/, ""));
      else if (!head.startsWith("@")) {
        const decls = {};
        for (const d of text.slice(open + 1, j - 1).split(";")) { const k = d.indexOf(":"); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
        out.push({ selectors: head.split(",").map(s => s.replace(/\s+/g, " ").trim()), decls, media });
      }
      i = j;
    }
  };
  walk(0, text.length, "");
  return out;
}
/** The last declaration of `prop` on an exact selector in one media context. */
const value = (sheet, selector, prop, media = "") => {
  let v;
  for (const r of rules(sheet)) if (r.media === media && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};
const CAPTION = "var(--hp-text-caption)";
const TARGETS = [".tw-trash button", ".tw-trash-dialog button", ".tw-trash-error button", ".tw-trash-toast .tw-trash-undo"];
const TEXT = [".tw-trash button", ".tw-trash-dialog button", ".tw-trash-name", ".tw-trash-list time", ".tw-trash-note", ".tw-trash-toast", ".tw-trash-toast .tw-trash-undo", ".tw-trash-error", ".tw-trash-dialog"];

const checks = {
  "되돌리기 is at least 44 × 44px": s => {
    const bad = [];
    if (value(s, ".tw-trash-toast .tw-trash-undo", "min-height") !== "44px") bad.push(`min-height ${value(s, ".tw-trash-toast .tw-trash-undo", "min-height")}`);
    if (value(s, ".tw-trash-toast .tw-trash-undo", "min-width") !== "44px") bad.push(`min-width ${value(s, ".tw-trash-toast .tw-trash-undo", "min-width")}`);
    return bad;
  },
  "every trash control (entry, 복원, 영구 삭제, dialog, 다시 확인) is a 44px target": s =>
    TARGETS.filter(sel => value(s, sel, "min-height") !== "44px").map(sel => `${sel} min-height ${value(s, sel, "min-height")}`),
  "trash text stays on the caption step (14px floor), the dialog title on the body step": s => {
    const bad = TEXT.filter(sel => value(s, sel, "font-size") !== CAPTION).map(sel => `${sel} font-size ${value(s, sel, "font-size")}`);
    if (value(s, ".tw-trash-dialog h3", "font-size") !== "var(--hp-text-body)") bad.push("dialog title");
    return bad;
  },
  "the trash entry spans the panel and sits under a divider": s => {
    const bad = [];
    if (value(s, ".tw-trash-entry", "width") !== "100%") bad.push("entry width");
    // width: 100% on a content-box button adds its padding and border past the panel edge.
    if (value(s, ".tw-trash-entry", "box-sizing") !== "border-box") bad.push("entry box-sizing");
    if (value(s, ".tw-trash", "border-top") !== "1px solid var(--tw-line)") bad.push("divider");
    return bad;
  },
  "a long Korean or path-like name wraps instead of widening the panel": s => {
    const bad = [];
    if (value(s, ".tw-trash-name", "overflow-wrap") !== "anywhere") bad.push("name wrap");
    if (value(s, ".tw-works", "min-width") !== "0") bad.push("works min-width");
    if (value(s, ".tw-trash-toast", "flex-wrap") !== "wrap") bad.push("toast wrap");
    if (value(s, ".tw-trash-dialog", "max-width") !== "420px" || value(s, ".tw-trash-dialog", "width") !== "100%") bad.push("dialog width");
    return bad;
  },
  "focus ring: the workspace's 2px ring reaches every trash button": s => {
    const ring = value(s, ".tw-workspace button:focus-visible", "outline");
    return ring === "2px solid var(--hp-ring)" ? [] : [`ring ${ring}`];
  },
  "forced colours keep every control's border and the toast's frame": s => {
    const M = "(forced-colors: active)";
    const bad = [...TARGETS].filter(sel => value(s, sel, "border-color", M) !== "ButtonText").map(sel => `${sel} ${value(s, sel, "border-color", M)}`);
    if (value(s, '.tw-trash-toast[data-shown="true"]', "border-color", M) !== "CanvasText") bad.push("toast frame");
    return bad;
  },
};

// Negative controls: one mutation per check, each must turn it red.
const mutants = {
  "되돌리기 is at least 44 × 44px": s => s.replace(".tw-trash-toast .tw-trash-undo { min-height: 44px; min-width: 44px;", ".tw-trash-toast .tw-trash-undo { min-height: 32px; min-width: 44px;"),
  "every trash control (entry, 복원, 영구 삭제, dialog, 다시 확인) is a 44px target": s => s.replace(".tw-trash button, .tw-trash-dialog button, .tw-trash-error button { min-height: 44px;", ".tw-trash button, .tw-trash-dialog button, .tw-trash-error button { min-height: 36px;"),
  "trash text stays on the caption step (14px floor), the dialog title on the body step": s => s.replace(".tw-trash-list time, .tw-trash-note { font-size: var(--hp-text-caption);", ".tw-trash-list time, .tw-trash-note { font-size: 11px;"),
  "the trash entry spans the panel and sits under a divider": s => s.replace(".tw-trash-entry { box-sizing: border-box; width: 100%;", ".tw-trash-entry { width: 100%;"),
  "a long Korean or path-like name wraps instead of widening the panel": s => s.replace(".tw-trash-name { font-size: var(--hp-text-caption); overflow-wrap: anywhere; }", ".tw-trash-name { font-size: var(--hp-text-caption); white-space: nowrap; }"),
  "focus ring: the workspace's 2px ring reaches every trash button": s => s.replace(".tw-workspace button:focus-visible, ", ""),
  "forced colours keep every control's border and the toast's frame": s => s.replace(".tw-trash button, .tw-trash-dialog button, .tw-trash-toast .tw-trash-undo, .tw-trash-error button { border-color: ButtonText; }", ".tw-trash button { border-color: ButtonText; }"),
};

let passed = 0;
for (const [label, check] of Object.entries(checks)) {
  assert.deepEqual(check(css), [], `${label} (real stylesheet)`);
  const mutated = mutants[label](css);
  assert.notEqual(mutated, css, `${label}: the mutant must change the stylesheet`);
  assert.notDeepEqual(check(mutated), [], `${label}: the negative control must fail`);
  passed++;
  console.log(`  ok   ${label}`);
}
// The caption step is never below 14px (DEC-29), so the rules above hold the floor.
assert.match(tokens, /--hp-text-caption: calc\(14px \+ var\(--hp-text-step\)\)/);
console.log(`activity-trash CSS: ${passed} rule checks with negative controls PASS`);
