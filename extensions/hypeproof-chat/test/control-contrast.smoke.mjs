// CGP-DS-R-034 / DES-11 — required control boundaries meet 3:1 against every surface they sit on.
//   node --experimental-strip-types test/control-contrast.smoke.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../webview-ui/src/${f}`, import.meta.url), "utf8");
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const tokens = read("tokens.css");
const [root, paper] = tokens.split('[data-surface="growth"]');
const val = (block, name) => new RegExp(`--hp-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block)?.[1];
const dark = { bg: val(root, "bg"), panel: val(root, "panel"), control: val(root, "control-line"), line: val(root, "line") };
const light = { bg: val(root, "paper"), panel: "#FFFFFF", control: val(paper, "control-line") };
assert.ok(dark.control && light.control, "--hp-control-line defined for both surfaces");

for (const [label, fg, bg] of [["dark bg", dark.control, dark.bg], ["dark panel", dark.control, dark.panel], ["paper", light.control, light.bg], ["white", light.control, light.panel]]) {
  assert.ok(ratio(fg, bg) >= 3, `control line on ${label}: ${ratio(fg, bg).toFixed(2)}:1 < 3:1`);
}
// The decorative line stays below 3:1, which is exactly why controls must not use it.
assert.ok(ratio(dark.line, dark.bg) < 3, "control: --hp-line really is too faint for a control");

// No rule that styles a control draws its boundary with the decorative line.
const CONTROL = /\b(button|input|textarea|select)\b|\.hp-cta-quiet|\.hps-btn-send|\.studio-(choice|secondary|plan|nav)|\.studio-repo-(list|one)/;
for (const f of ["styles.css", "start.css"]) {
  const css = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [selector, body] = [m[1].trim(), m[2]];
    if (!CONTROL.test(selector)) continue;
    assert.doesNotMatch(body, /border(-color)?:[^;]*var\(--(hp|studio)-line\)/, `${f}: "${selector.slice(0, 80)}" draws a control boundary with the decorative line`);
  }
}
console.log("control-contrast smoke OK");
