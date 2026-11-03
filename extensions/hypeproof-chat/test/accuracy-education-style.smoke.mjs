import assert from 'node:assert/strict';
import { readDesignFile } from './lib/design-token-values.mjs';
const real={style:readDesignFile(new URL('../webview-ui/src/accuracyEducation.css',import.meta.url),'utf8')};
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


export function check(css) {
 assert.equal(value(css,'.hps-accuracy-card','max-inline-size'),'100%');
 assert.equal(value(css,'.hps-accuracy-card','box-sizing'),'border-box');
 assert.equal(value(css,'.hps-accuracy-card','font-size'),'var(--hp-font-body)');
 assert.equal(value(css,'.hps-accuracy-card','background'),'var(--hp-bg-app-default)');
 assert.equal(value(css,'.hps-accuracy-card','color'),'var(--hp-text-primary-default)');
 assert.equal(value(css,'.hps-accuracy-card button','min-block-size'),'var(--hp-control-min)');
 assert.equal(value(css,'.hps-accuracy-card button','min-inline-size'),'var(--hp-control-min)');
 assert.equal(value(css,'.hps-accuracy-card button','font'),'inherit');
 assert.equal(value(css,'.hps-accuracy-card button:focus-visible','outline'),undefined,'focus ring comes from the shared focus geometry, not a local override');
 assert.equal(value(css,'.hps-accuracy-card button','color','(forced-colors: active)'),'CanvasText');
 assert.equal(value(css,'.hps-accuracy-answer','white-space'),'pre-wrap');
 assert.equal(value(css,'.hps-accuracy-answer','overflow'),'auto');
}
check(real);
console.log('PASS accuracy card stylesheet: column, size, type, theme, focus and forced colors');
