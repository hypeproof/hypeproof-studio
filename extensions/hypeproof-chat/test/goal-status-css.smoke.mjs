import assert from 'node:assert/strict';
import { readDesignFile } from './lib/design-token-values.mjs';
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

const css = { 'goalStatusBar.css': readDesignFile(new URL('../webview-ui/src/goalStatusBar.css', import.meta.url), 'utf8') };
const expected = [
 ['.hps-goal-status button', 'background', 'transparent'],
 ['.hps-goal-status button', 'border', '1px solid var(--hp-border-control-default)'],
 ['.hps-goal-status button', 'border-radius', '4px'],
 ['.hps-goal-status button', 'padding-inline', '8px'],
 ['.hps-goal-status button:hover:not(:disabled)', 'background', 'var(--hp-bg-control-hover)'],
 ['.hps-goal-status button:active:not(:disabled)', 'background', 'var(--hp-bg-control-pressed)'],
 ['.hps-goal-status', 'min-width', '0'],
 ['.hps-goal-status', 'max-width', '100%'],
 ['.hps-goal-status', 'font-size', '14px'],
 ['.hps-goal-status', 'color', 'var(--hp-text-primary-default)'],
 ['.hps-goal-status', 'overflow-wrap', 'anywhere'],
 ['.hps-goal-status div', 'display', 'flex'],
 ['.hps-goal-status div', 'flex-wrap', 'wrap'],
 ['.hps-goal-status button', 'min-height', '44px'],
 ['.hps-goal-status button', 'min-width', '44px'],
 ['.hps-goal-status button', 'font', 'inherit'],
 ['.hps-goal-status button', 'color', 'inherit'],
 ['.hps-goal-status button:focus-visible', 'outline', '2px solid var(--hp-ring-focus-default)'],
 ['.hps-goal-status button:focus-visible', 'outline-offset', '2px'],
 ['.hps-goal-status', 'color', 'CanvasText', '(forced-colors: active)'],
 ['.hps-goal-status button', 'border-color', 'ButtonText', '(forced-colors: active)'],
];
for (const [selector, prop, want, media=''] of expected) assert.equal(value(css, selector, prop, media), want, selector+' '+prop);
console.log('goal status stylesheet geometry, typography, wrapping, focus and forced colours PASS');
