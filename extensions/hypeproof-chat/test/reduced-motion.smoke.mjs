import { readDesignFile } from "./lib/design-token-values.mjs";
// CGP-DS-R-015 — an explicit reduce-motion preference stops motion even when the OS allows it.
//   node --experimental-strip-types test/reduced-motion.smoke.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { reduceMotionForced, withReducedMotionAttr } = await import("../src/motionPreference.ts");

assert.equal(reduceMotionForced("on"), true);
for (const v of ["auto", "off", undefined, null, true, "ON"]) assert.equal(reduceMotionForced(v), false, `negative control: ${String(v)} follows the OS`);

const html = '<!doctype html><html lang="ko"><head></head><body></body></html>';
assert.equal(withReducedMotionAttr(html, true), '<!doctype html><html data-reduced-motion="true" lang="ko"><head></head><body></body></html>');
assert.equal(withReducedMotionAttr(html, false), html, "no attribute unless forced");

const tokens = readDesignFile(new URL("../webview-ui/src/tokens.css", import.meta.url), "utf8");
for (const sel of ['*', '*::before', '*::after']) assert.ok(tokens.includes(`:root[data-reduced-motion="true"] ${sel}`), `rule covers ${sel}`);
for (const decl of ["animation-duration: 0.01ms !important", "animation-iteration-count: 1 !important", "animation-delay: 0s !important", "transition-duration: 0.01ms !important", "transition-delay: 0s !important", "scroll-behavior: auto !important"]) assert.ok(tokens.includes(decl), decl);

const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
assert.match(provider, /return withReducedMotionAttr\(html, reduceMotionForced\(vscode\.workspace\.getConfiguration\("workbench"\)\.get\("reduceMotion"\)\)\);/, "every webview render marks the root");
assert.match(provider, /reduceMotion: reduceMotionForced\(/, "the chat config carries it for live changes");
const ext = readFileSync(new URL("../src/extension.ts", import.meta.url), "utf8");
assert.match(ext, /affectsConfiguration\("workbench\.reduceMotion"\)\) void provider\.refreshConfig\(\)/, "a settings change is pushed");
const app = readFileSync(new URL("../webview-ui/src/App.tsx", import.meta.url), "utf8");
assert.match(app, /document\.documentElement\.dataset\.reducedMotion = "true"/);
assert.match(app, /delete document\.documentElement\.dataset\.reducedMotion/, "turning it off removes the mark");

// JS scrolling: an explicit behavior "smooth" overrides CSS, so no webview call may hard-code it.
const { readdirSync } = await import("node:fs");
for (const f of readdirSync(new URL("../webview-ui/src/", import.meta.url)).filter((n) => /\.tsx?$/.test(n))) {
  const src = readFileSync(new URL(`../webview-ui/src/${f}`, import.meta.url), "utf8");
  assert.doesNotMatch(src, /behavior:\s*["']smooth["']/, `${f} hard-codes smooth scrolling`);
}
const { motionReduced } = await import("../webview-ui/src/motion.ts");
const doc = (v) => ({ documentElement: { dataset: v === undefined ? {} : { reducedMotion: v } } });
const os = (reduce) => ({ matchMedia: () => ({ matches: reduce }) });
assert.equal(motionReduced(doc("true"), os(false)), true, "setting on wins over OS motion");
assert.equal(motionReduced(doc(undefined), os(true)), true, "OS reduce still applies");
assert.equal(motionReduced(doc(undefined), os(false)), false, "negative control: motion allowed");

console.log("reduced-motion smoke OK");
