// REQ-STUDIO-MOTION-MEASURE-GUTTER — CGP-DS-R-014 motion tokens, CGP-DS-R-020 prose measure,
// CGP-DS-R-031 stable transcript scrollbar gutter.
//   node --experimental-strip-types test/motion-measure-gutter.smoke.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../webview-ui/src/", import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const cssFiles = readdirSync(dir).filter((n) => n.endsWith(".css"));
assert.ok(cssFiles.length >= 7 && cssFiles.includes("tokens.css"), `webview CSS files found: ${cssFiles.join(", ")}`);

// ─── CGP-DS-R-014: no literal transition/animation time outside tokens.css ───────────────────
// Every `transition*` / `animation*` declaration (shorthand or longhand, also across lines) whose
// value carries a time literal. The one allowed literal is the 0.01ms reduced-motion override.
const TIME = /(?<![\w.#-])(?:\d+\.?\d*|\.\d+)m?s\b/g;
const ALLOWED = /^0\.01ms$/;
function literalTimes(css) {
  const out = [];
  for (const m of strip(css).matchAll(/(?:^|[;{\s])((?:transition|animation)(?:-[a-z-]+)?)\s*:\s*([^;{}]*)/g)) {
    const [prop, value] = [m[1], m[2].trim()];
    for (const t of value.match(TIME) ?? []) if (!ALLOWED.test(t)) out.push(`${prop}: ${value}`);
  }
  return out;
}

// Negative controls: the literals this change replaced (verbatim from origin/main) must be caught.
for (const bad of [
  ".a { transition: border-color 120ms; }",
  ".studio-primary {\n  overflow-wrap:anywhere;\n  transition:background .15s}",
  ".b { animation: chat-pending 1.2s ease-in-out 3; }",
  ".c:nth-child(2) { animation-delay: 100ms; }",
  ".d:nth-child(4) { animation-delay: 0.3s; }",
  ".e {\n  transition: height 180ms ease,\n    opacity 180ms ease;\n}",
  "@media (prefers-reduced-motion: no-preference) {\n  .hps-voice-bar { transition: height .1s linear; }\n}",
  ".f { animation-duration: 0s; }",
]) assert.ok(literalTimes(bad).length > 0, `negative control not caught: ${bad}`);
// Positive controls: tokens, calc over tokens, `none`, keyframe percentages, the 0.01ms override.
for (const good of [
  ".a { transition: transform var(--hp-dur-press) var(--hp-ease), opacity var(--hp-dur-press) var(--hp-ease); }",
  ".b:nth-child(3) { animation-delay: calc(var(--hp-dur-stagger) * 2); }",
  ".c { animation: chat-pending var(--hp-dur-pending) ease-in-out 3; }",
  ".d { animation: none; transition: none; }",
  "@keyframes k { 0%, 70% { opacity: .45; } 35% { opacity: 1; } }",
  ":root[data-reduced-motion=\"true\"] * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }",
  "/* was transition: background .15s */ .e { color: red; }",
]) assert.deepEqual(literalTimes(good), [], `positive control flagged: ${good}`);

let checked = 0;
for (const f of cssFiles.filter((n) => n !== "tokens.css")) {
  const css = read(f);
  assert.deepEqual(literalTimes(css), [], `${f} has a literal transition/animation time; use a --hp-dur-* token from tokens.css`);
  checked += [...strip(css).matchAll(/(?:transition|animation)(?:-[a-z-]+)?\s*:/g)].length;
}
assert.ok(checked >= 25, `scanner saw ${checked} transition/animation declarations; it is not reading the files`);

// Tokens: DES-CGP-DS-15 values, each used token defined, and tokens.css itself holds times only in
// --hp-dur-* definitions and the reduced-motion override.
const tokens = read("tokens.css");
const rootBlock = strip(tokens).match(/:root\s*\{([^{}]*)\}/)[1];
const def = (name) => new RegExp(`${name}:\\s*([^;]+);`).exec(rootBlock)?.[1].trim();
assert.equal(def("--hp-dur-press"), "140ms");
assert.equal(def("--hp-dur-content"), "160ms");
assert.equal(def("--hp-dur-enter"), "180ms");
assert.equal(def("--hp-ease"), "cubic-bezier(.19, 1, .22, 1)");
const seconds = (v) => (v.endsWith("ms") ? parseFloat(v) / 1000 : parseFloat(v));
assert.ok(3 * seconds(def("--hp-dur-pending")) <= 3.8, "response dots: 3 cycles stay within the CP-R1 3.8s cap");
assert.match(read("chatDetails.css"), /animation: chat-pending var\(--hp-dur-pending\) ease-in-out 3;/, "response dots stay bounded to 3 cycles");
for (const f of cssFiles) {
  for (const m of read(f).matchAll(/var\((--hp-(?:dur-[a-z-]+|ease))\)/g)) assert.ok(def(m[1]), `${f} uses undefined ${m[1]}`);
}
for (const m of strip(tokens).matchAll(/([\w-]+)\s*:\s*([^;{}]*)/g)) {
  if (!TIME.test(m[2])) continue;
  TIME.lastIndex = 0;
  assert.ok(/^--hp-dur-/.test(m[1]) || /^0\.01ms !important$|^0s !important$/.test(m[2].trim()), `tokens.css: time outside a --hp-dur-* token: ${m[1]}: ${m[2]}`);
}
TIME.lastIndex = 0;
// The reduced-motion override still wins over every token (it is !important and unchanged).
for (const decl of ["animation-duration: 0.01ms !important", "transition-duration: 0.01ms !important", "animation-delay: 0s !important", "transition-delay: 0s !important"]) {
  assert.ok(tokens.includes(decl), `reduced-motion override kept: ${decl}`);
}
for (const decl of tokens.match(/--hp-dur-[a-z-]+:[^;]*;/g)) assert.doesNotMatch(decl, /!important/, `${decl} must not outrank the reduced-motion override`);

// The design doc is canonical for token values (sx-audit compares the whole :root block too).
const design = readFileSync(new URL("../../../docs/design/studio-learning-experience.md", import.meta.url), "utf8");
const fence = design.slice(design.indexOf("## 디자인 시스템")).match(/```css\n([\s\S]*?)```/)[1];
for (const name of ["--hp-ease", "--hp-dur-press", "--hp-dur-content", "--hp-dur-enter"]) {
  assert.match(fence, new RegExp(`${name}: ${def(name).replace(/[.()]/g, "\\$&")};`), `design doc records ${name}`);
}

// ─── CGP-DS-R-020: prose measure ───────────────────────────────────────────────────────────────
const MEASURE_SEL = '.hps-shell[data-chat-detail="personal"] .hps-prose';
function proseMeasure(css) {
  for (const m of strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== MEASURE_SEL) continue;
    const v = /max-(?:inline-size|width):\s*([\d.]+)em\b/.exec(m[2]);
    if (v) return { em: parseFloat(v[1]), body: m[2] };
  }
  return null;
}
const checkMeasure = (css) => {
  const m = proseMeasure(css);
  return Boolean(m && m.em >= 36 && m.em <= 40 && !/(?:^|[;\s])(?:min-)?(?:width|inline-size|min-inline-size)\s*:/.test(m.body.replace(/max-(?:inline-size|width)\s*:[^;]*;?/g, "")));
};
assert.ok(checkMeasure(read("chatDetails.css")), `${MEASURE_SEL} caps the line at <= 40em with no fixed width`);
// Negative controls: missing, too wide, a px cap, or a fixed width that would force a scroll.
for (const bad of [
  `${MEASURE_SEL} p { margin-bottom: 1em; }`,
  `${MEASURE_SEL} { max-inline-size: 48em; }`,
  `${MEASURE_SEL} { max-inline-size: 740px; }`,
  `${MEASURE_SEL} { max-inline-size: 40em; min-width: 40em; }`,
]) assert.equal(checkMeasure(bad), false, `negative control passed the measure check: ${bad}`);
// Tables and code keep their own overflow inside the capped column; prose never forces a scroll.
const styles = strip(read("styles.css"));
assert.match(styles, /\.hps-markdown-table \{[^}]*max-width: 100%;[^}]*overflow-x: auto;/, "tables scroll inside the column");
assert.match(styles, /\.hps-prose pre \{ white-space: pre-wrap; \}/, "code blocks wrap");
assert.match(styles, /\.hps-prose \{[^}]*overflow-wrap: anywhere;[^}]*min-width: 0;/, "long words wrap instead of widening the column");

// ─── CGP-DS-R-031: stable scrollbar gutter on the transcript scroller ────────────────────────
const SCROLLER = '.hps-shell[data-chat-detail="personal"] .hps-messages';
const hasGutter = (css) => [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .some((m) => m[1].trim() === SCROLLER && /scrollbar-gutter:\s*stable\b/.test(m[2]));
assert.ok(hasGutter(read("chatDetails.css")), `${SCROLLER} reserves a stable scrollbar gutter`);
assert.match(styles, /\.hps-messages \{[^}]*overflow-y: auto;/, "the gutter sits on the element that actually scrolls");
for (const bad of [
  `${SCROLLER} { scrollbar-width: thin; }`,
  `${SCROLLER} { scrollbar-gutter: auto; }`,
  `${SCROLLER} > * { scrollbar-gutter: stable; }`,
]) assert.equal(hasGutter(bad), false, `negative control passed the gutter check: ${bad}`);

console.log(`motion-measure-gutter smoke OK (${cssFiles.length} CSS files, ${checked} motion declarations)`);
