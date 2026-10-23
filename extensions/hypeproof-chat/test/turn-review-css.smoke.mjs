// CGP-AGENT-D-022 / DES-CGP-AGENT-52 — the CSS half of the changed-file review, locked from the
// stylesheet text: unified under 1024px and split from 1024px, 44px summaries, the text-size token,
// a visible focus ring, added/removed backgrounds and the forced-colours border. Each check also
// runs against a mutated copy that must fail (negative controls).
//   node --experimental-strip-types test/turn-review-css.smoke.mjs
import assert from "node:assert/strict";
import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";

const SRC = new URL("../webview-ui/src/", import.meta.url);
const read = (f) => readFileSync(new URL(f, SRC), "utf8");
const real = { "styles.css": read("styles.css"), "chatDetails.css": read("chatDetails.css"), "tokens.css": read("tokens.css") };

import { rules } from './fixtures/stylesheet-rules.mjs';

const all = (css) => Object.entries(css).flatMap(([file, text]) => rules(text).map((r) => ({ ...r, file })));
const value = (css, selector, prop, media = "") => {
  let v;
  for (const r of all(css)) if (r.media === media && r.selectors.includes(selector) && r.decls[prop] !== undefined) v = r.decls[prop];
  return v;
};
const WIDE = "@container studio-chat (min-width: 1024px)";
const FORCED = "(forced-colors: active)";
const PERSONAL = '.hps-shell[data-chat-detail="personal"]';

const checks = {
  "unified below 1024px, split from 1024px": (css) => {
    const bad = [];
    if (value(css, ".hps-turn-split", "display") !== "none") bad.push(`split view is not hidden by default: ${value(css, ".hps-turn-split", "display")}`);
    if (value(css, ".hps-turn-split", "display", WIDE) !== "grid") bad.push("split view is not shown from 1024px");
    if (!/^minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)$/.test(value(css, ".hps-turn-split", "grid-template-columns", WIDE) ?? "")) bad.push("split view is not two equal columns");
    if (value(css, ".hps-turn-unified", "display", WIDE) !== "none") bad.push("unified view still shows beside the split view");
    if (value(css, ".hps-turn-unified", "display") === "none") bad.push("unified view is hidden below 1024px");
    return bad;
  },
  "summary is a 44px target with a visible focus ring": (css) => {
    const bad = [], s = ".hps-turn-review summary";
    if (value(css, s, "min-height") !== "44px") bad.push(`min-height ${value(css, s, "min-height")}`);
    if (value(css, s, "box-sizing") !== "border-box") bad.push("summary is not border-box");
    if (value(css, `${s}:focus-visible`, "outline") !== "2px solid var(--hp-ring-focus-default)") bad.push(`focus ring ${value(css, `${s}:focus-visible`, "outline")}`);
    if (value(css, `${s}:focus-visible`, "outline-offset") !== "2px") bad.push("focus ring offset");
    return bad;
  },
  "text follows the 14px caption token in every seat": (css) => {
    const bad = [];
    if (value(css, ".hps-turn-review", "font-size") !== "var(--hp-font-caption)") bad.push(`base size ${value(css, ".hps-turn-review", "font-size")}`);
    if (!/--hp-font-caption:\s*calc\(14px \+ var\(--hp-font-step\)\)/.test(css["tokens.css"])) bad.push("caption token floor is not 14px");
    const personal = value(css, `${PERSONAL} .hps-turn-review`, "font-size");
    if (personal === undefined || (/px$/.test(personal) && parseFloat(personal) < 14)) bad.push(`personal override ${personal}`);
    return bad;
  },
  "added and removed lines are tinted, and still bordered in forced colours": (css) => {
    const bad = [];
    const added = value(css, '.hps-turn-diff-line[data-kind="added"]', "background"), removed = value(css, '.hps-turn-diff-line[data-kind="removed"]', "background");
    if (!/var\(--vscode-diffEditor-insertedTextBackground/.test(added ?? "")) bad.push(`added background ${added}`);
    if (!/var\(--vscode-diffEditor-removedTextBackground/.test(removed ?? "")) bad.push(`removed background ${removed}`);
    const forced = '.hps-turn-diff-line[data-kind="added"]';
    for (const sel of [forced, '.hps-turn-diff-line[data-kind="removed"]']) {
      const r = all(css).find((x) => x.media === FORCED && x.selectors.includes(sel));
      if (!r || r.decls["border-inline-start"] !== "1px solid CanvasText") bad.push(`forced-colours border on ${sel}: ${r?.decls["border-inline-start"]}`);
    }
    return bad;
  },
  "long diff lines wrap inside the column": (css) => {
    const bad = [], s = ".hps-turn-diff-line";
    if (value(css, s, "white-space") !== "pre-wrap" || value(css, s, "overflow-wrap") !== "anywhere") bad.push("diff line does not wrap");
    if (!/^1\.25em minmax\(0,\s*1fr\)$/.test(value(css, s, "grid-template-columns") ?? "")) bad.push("glyph + text columns changed");
    for (const sel of [".hps-turn-review", ".hps-turn-file", ".hps-turn-diff"]) if (value(css, sel, "min-width") !== "0") bad.push(`${sel} can force horizontal overflow`);
    return bad;
  },
};

const failures = [];
const run = (label, css) => checks[label](css);
for (const label of Object.keys(checks)) {
  const bad = run(label, real);
  if (bad.length) { failures.push(label); console.error(`  FAIL ${label}: ${bad.join("; ")}`); } else console.log(`  ok   ${label}`);
}
// Negative controls: each mutated stylesheet must trip the named check.
const mutate = (file, from, to) => { assert.ok(real[file].includes(from), `mutation target present: ${from}`); return { ...real, [file]: real[file].replace(from, to) }; };
const NEGATIVE = [
  ["unified below 1024px, split from 1024px", "breakpoint 1024px -> 768px", mutate("styles.css", "@container studio-chat (min-width: 1024px)", "@container studio-chat (min-width: 768px)")],
  ["unified below 1024px, split from 1024px", "split view always shown", mutate("styles.css", ".hps-turn-split { display: none; }", ".hps-turn-split { display: grid; }")],
  ["summary is a 44px target with a visible focus ring", "summary 44px -> 30px", mutate("styles.css", ".hps-turn-review summary { min-height: 44px;", ".hps-turn-review summary { min-height: 30px;")],
  ["summary is a 44px target with a visible focus ring", "focus ring removed", mutate("styles.css", ".hps-turn-review summary:focus-visible { outline: 2px solid var(--hp-ring-focus-default); outline-offset: 2px; }", ".hps-turn-review summary:focus-visible { outline: none; }")],
  ["text follows the 14px caption token in every seat", "base font 10px", mutate("styles.css", ".hps-turn-review { min-width: 0; font-size: var(--hp-font-caption); }", ".hps-turn-review { min-width: 0; font-size: 10px; }")],
  ["added and removed lines are tinted, and still bordered in forced colours", "added background transparent", mutate("styles.css", '[data-kind="added"] { background: var(--vscode-diffEditor-insertedTextBackground, rgba(0,128,0,.12)); }', '[data-kind="added"] { background: transparent; }')],
  ["added and removed lines are tinted, and still bordered in forced colours", "forced-colours border removed", mutate("styles.css", "{ border-inline-start: 1px solid CanvasText; }", "{ }")],
  ["long diff lines wrap inside the column", "wrapping removed", mutate("styles.css", "white-space: pre-wrap; overflow-wrap: anywhere; }\n.hps-turn-diff-line[data-kind=\"added\"]", "white-space: pre; }\n.hps-turn-diff-line[data-kind=\"added\"]")],
];
for (const [label, what, css] of NEGATIVE) {
  if (run(label, css).length) console.log(`  ok   negative control: ${what} is caught`);
  else { failures.push(`${what} survived`); console.error(`  FAIL negative control: ${what} survived`); }
}
if (failures.length) { console.error(`turn-review-css: ${failures.length} failure(s)`); process.exit(1); }
console.log("turn-review-css: all passed");
